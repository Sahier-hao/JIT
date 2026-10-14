"""Register delivered runs without retraining or rewriting their artifacts."""
import json
from pathlib import Path, PurePosixPath
from uuid import uuid4

from .artifacts import (CORE_FILES, SERVICE_FILES, Snapshot, declared_reproducibility,
                        environment, identity, read_json, run_origin, verify_run)
from .catalog_schema import schema_info
from .catalog_storage import CatalogStorage, utc_now
from .config import BACKEND
from .data import sha256
from .errors import BaselineError
from .team_access import MESSAGES, RequestError


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)


class ModelCatalog:
    def __init__(self, store=None, root=None):
        self.store = store if store is not None else CatalogStorage()
        self.root = Path(root if root is not None else BACKEND / 'artifacts').resolve()

    def _directory(self, key):
        parts = PurePosixPath(key).parts
        if (not parts or '\\' in key or ':' in key or key.startswith('/') or
                any(part in ('.', '..') for part in key.split('/')) or
                not (len(parts) == 1 or len(parts) == 2 and parts[0] == 'external') or
                any(part.startswith('.') for part in parts) or
                parts[0] in ('development', 'external') and len(parts) == 1):
            raise RequestError('INPUT_INVALID')
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root) or path == self.root:
            raise RequestError('INPUT_INVALID')
        return path

    def _file(self, directory, name):
        path = (directory / name).resolve()
        if not path.is_relative_to(self.root):
            raise RequestError('INPUT_INVALID')
        return path

    def _manifest_hash(self, directory):
        try:
            file = self._file(directory, 'manifest.json')
            if file.stat().st_size > 1024 * 1024:
                raise RequestError('ARTIFACT_INVALID')
            return sha256(file.read_bytes())
        except OSError as exc:
            raise RequestError('ARTIFACT_UNAVAILABLE') from exc

    @staticmethod
    def _candidate_id(key):
        return identity({'root': 'artifacts', 'key': key})

    def candidates(self):
        if not self.root.exists():
            return []
        try:
            keys = [p.name for p in self.root.iterdir() if p.is_dir() and p.name != 'external']
            external = self.root / 'external'
            if external.is_dir() and external.resolve().is_relative_to(self.root):
                keys += ['external/' + p.name for p in external.iterdir() if p.is_dir()]
        except OSError as exc:
            raise RequestError('ARTIFACT_UNAVAILABLE') from exc
        result = []
        for key in sorted(keys):
            try:
                directory = self._directory(key)
                if not (directory / 'manifest.json').is_file():
                    continue
            except BaselineError:
                continue
            row = {'candidateId': self._candidate_id(key), 'displayName': key,
                   'state': 'candidate', 'manifestSha256': None}
            try:
                row['manifestSha256'] = self._manifest_hash(directory)
                manifest = read_json(self._file(directory, 'manifest.json'))
                config = manifest['config']
                row.update(artifactRunId=manifest['runId'], method=config.get('algorithmVersion'),
                           featureSchemaVersion=config.get('schema') or config.get('protocol'))
            except (BaselineError, KeyError, TypeError):
                row.update(state='invalid', error={'code': 'ARTIFACT_INVALID',
                                                  'message': MESSAGES['ARTIFACT_INVALID']})
            result.append(row)
        return result

    def _event(self, db, candidate_id, request_id, channel, result, code=None, run_id=None, model_id=None):
        db.execute('INSERT INTO registration_event VALUES (?,?,?,?,?,?,?,?,?)',
                   (str(uuid4()), request_id, candidate_id, channel, result, code,
                    utc_now(), run_id, model_id))

    def register_key(self, key, **kwargs):
        directory = self._directory(key)
        return self.register(self._candidate_id(key), self._manifest_hash(directory), **kwargs)

    def register(self, candidate_id, expected_hash, *, channel='local-cli', request_id=None):
        request_id = request_id or str(uuid4())
        # Check storage before expensive verification; never create the catalog implicitly.
        with self.store.connection():
            pass
        try:
            candidate = next((c for c in self.candidates() if c['candidateId'] == candidate_id), None)
            if candidate is None:
                raise RequestError('NOT_FOUND')
            directory = self._directory(candidate['displayName'])
            if self._manifest_hash(directory) != expected_hash:
                raise RequestError('CONTEXT_MISMATCH')
            for name in (*CORE_FILES, 'summary.json'):
                self._file(directory, name)
            manifest = verify_run(directory)
            snapshot = Snapshot.load(directory)
            if self._manifest_hash(directory) != expected_hash or manifest != snapshot.manifest:
                raise RequestError('CONTEXT_MISMATCH')
            self._check_location(directory, {'manifest': manifest, 'sha256': expected_hash}, full=True)
            config, summary = manifest['config'], snapshot.summary
            schema = schema_info(snapshot.schema.name)
            verification = {'origin': run_origin(manifest), 'verificationEnvironment': environment(),
                            'reproducibility': declared_reproducibility(manifest)[1]}
            with self.store.connection(write=True) as db:
                dataset = db.execute('SELECT id FROM dataset_version WHERE artifact_version=?',
                                     (config['datasetVersion'],)).fetchone()
                dataset_id = dataset['id'] if dataset else str(uuid4())
                if dataset is None:
                    db.execute('INSERT INTO dataset_version VALUES (?,?,?)',
                               (dataset_id, config['datasetVersion'], encoded(summary['source'])))
                run = db.execute('SELECT id FROM experiment_run WHERE artifact_run_id=?',
                                 (manifest['runId'],)).fetchone()
                run_id = run['id'] if run else str(uuid4())
                if run is None:
                    db.execute('INSERT INTO experiment_run VALUES (?,?,?,?,?)',
                               (run_id, manifest['runId'], dataset_id, encoded(config), encoded(schema)))
                model = db.execute('SELECT id FROM model_version WHERE run_id=?', (run_id,)).fetchone()
                model_id = model['id'] if model else str(uuid4())
                location = db.execute('SELECT id,run_id FROM run_location WHERE relative_key=?',
                                      (candidate['displayName'],)).fetchone()
                if location and location['run_id'] != run_id:
                    raise RequestError('CONTEXT_MISMATCH')
                location_id = location['id'] if location else str(uuid4())
                values = (encoded({'manifest': manifest, 'sha256': expected_hash}), encoded(summary),
                          encoded(verification), utc_now())
                if location:
                    db.execute('UPDATE run_location SET manifest_json=?,summary_json=?,verification_json=?,verified_at=? WHERE id=?',
                               (*values, location_id))
                else:
                    db.execute('INSERT INTO run_location VALUES (?,?,?,?,?,?,?)',
                               (location_id, run_id, candidate['displayName'], *values))
                payload = {'modelId': model_id, 'runId': run_id, 'datasetVersion': dataset_id,
                           'artifactRunId': manifest['runId'], 'artifactDatasetVersion': config['datasetVersion'],
                           'artifactModelId': summary['model']['id'], 'name': summary['model']['name'],
                           'method': config.get('algorithmVersion') or 'logistic-regression-l2-v1',
                           'sha256': config['modelSha256'], 'featureSchemaVersion': snapshot.schema.name,
                           'featureSchema': schema, 'jsonPredictionSupported': schema['jsonPredictionSupported'],
                           'trainingEnvironment': config.get('trainingEnvironment') or config.get('environment'),
                           'origin': verification['origin'], 'verificationEnvironment': verification['verificationEnvironment'],
                           'reproducibility': verification['reproducibility'], 'limitations': summary['limitations']}
                if model is None:
                    db.execute('INSERT INTO model_version VALUES (?,?,?,?,?,?)',
                               (model_id, run_id, location_id, 'ready', None, encoded(payload)))
                else:
                    db.execute("UPDATE model_version SET preferred_location_id=?,state='ready',error_code=NULL,payload_json=? WHERE id=?",
                               (location_id, encoded(payload), model_id))
                self._event(db, candidate_id, request_id, channel, 'created' if model is None else 'reused',
                            run_id=run_id, model_id=model_id)
            return {'created': model is None, 'model': dict(payload, state='ready')}
        except BaselineError as exc:
            if exc.code != 'STORAGE_UNAVAILABLE':
                with self.store.connection(write=True) as db:
                    self._event(db, candidate_id, request_id, channel, 'failed', exc.code)
            raise

    def _check_location(self, directory, saved, *, full=False):
        if self._manifest_hash(directory) != saved['sha256']:
            raise RequestError('INTEGRITY_ERROR')
        for name in (*CORE_FILES, 'summary.json') if full else SERVICE_FILES:
            try:
                digest = sha256(self._file(directory, name).read_bytes())
            except OSError as exc:
                raise RequestError('ARTIFACT_UNAVAILABLE') from exc
            if digest != saved['manifest']['files'][name]:
                raise RequestError('INTEGRITY_ERROR')

    def _row(self, model_id):
        with self.store.connection() as db:
            row = db.execute('SELECT m.*,l.relative_key,l.manifest_json FROM model_version m '
                             'JOIN run_location l ON l.id=m.preferred_location_id WHERE m.id=?', (model_id,)).fetchone()
        if row is None:
            raise RequestError('NOT_FOUND')
        return dict(row)

    def load_model(self, model_id):
        row = self._row(model_id)
        if row['state'] != 'ready':
            raise RequestError('MODEL_NOT_READY')
        try:
            directory = self._directory(row['relative_key'])
            saved = json.loads(row['manifest_json'])
            self._check_location(directory, saved)
            snapshot = Snapshot.load(directory)
            self._check_location(directory, saved)
            payload = json.loads(row['payload_json'])
            if (snapshot.manifest['runId'] != payload['artifactRunId'] or
                    snapshot.manifest['config']['modelSha256'] != payload['sha256'] or
                    schema_info(snapshot.schema.name) != payload['featureSchema']):
                raise RequestError('ARTIFACT_INVALID')
        except (BaselineError, KeyError, TypeError, ValueError) as exc:
            code = exc.code if isinstance(exc, BaselineError) else 'ARTIFACT_INVALID'
            with self.store.connection(write=True) as db:
                db.execute("UPDATE model_version SET state='invalid',error_code=? WHERE id=?", (code, model_id))
            raise RequestError(code) from exc
        return snapshot, dict(payload, state='ready')

    def models(self, state=None):
        with self.store.connection() as db:
            ids = [r['id'] for r in db.execute('SELECT id FROM model_version ORDER BY id')]
        result = []
        for model_id in ids:
            try:
                _, payload = self.load_model(model_id)
            except BaselineError as exc:
                if exc.code == 'STORAGE_UNAVAILABLE':
                    raise
                row = self._row(model_id)
                payload = dict(json.loads(row['payload_json']), state='invalid',
                               error={'code': row['error_code'], 'message': MESSAGES.get(row['error_code'], '运行不可用')})
            if state is None or payload['state'] == state:
                result.append(payload)
        return result
