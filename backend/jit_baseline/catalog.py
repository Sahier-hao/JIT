"""Register delivered runs without retraining or rewriting their artifacts."""
import json
from functools import lru_cache
from pathlib import Path, PurePosixPath
from uuid import uuid4

from .artifacts import (CORE_FILES, SERVICE_FILES, Snapshot, declared_reproducibility,
                        environment, identity, read_json, run_origin, verify_run)
from .catalog_schema import schema_info
from .catalog_storage import CatalogStorage, utc_now
from .config import BACKEND
from .data import sha256
from .errors import BaselineError
from .api_errors import MESSAGES, RequestError


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True)


REPOSITORY_SCHEMAS = ('openstack-six-v1', 'kamei14-git-v1')


class ModelCatalog:
    def __init__(self, store=None, root=None):
        self.store = store if store is not None else CatalogStorage()
        self.root = Path(root if root is not None else BACKEND / 'artifacts').resolve()
        # Cache only parsed artifacts. Every use still verifies the service-file
        # hashes on both sides of this lookup and reads current policy separately.
        self._snapshot_cache = lru_cache(maxsize=16)(lambda directory, _manifest_sha: Snapshot.load(directory))

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
            # 方法标识：具名方法运行自己有声明，旧六字段运行没有——按协议默认值回落，不编造版本号。
            method = config.get('algorithmVersion') or 'logistic-regression-l2-v1'
            # 产物的模型身份：具名 schema 之前的运行 summary 里没有 model 段（见 add-classic-methods
            # 之前的基线）。旧产物没有可展示的模型名，就用声明的方法标识，不去造一个中文名。
            artifact_model = summary.get('model') or {'id': method, 'name': method}
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
                           'artifactModelId': artifact_model['id'], 'name': artifact_model['name'],
                           'method': method,
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
                if snapshot.schema.name in REPOSITORY_SCHEMAS:
                    db.execute('UPDATE model_default SET model_id=? WHERE singleton=1 AND model_id IS NULL',
                               (model_id,))
                self._event(db, candidate_id, request_id, channel, 'created' if model is None else 'reused',
                            run_id=run_id, model_id=model_id)
            return {'created': model is None, 'model': dict(payload, state='ready', **self.policy(model_id))}
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
            snapshot = self._snapshot_cache(directory, saved['sha256'])
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
        return snapshot, dict(payload, state='ready', **self.policy(model_id))

    def detail(self, model_id):
        """Read-only model details from the verified preferred run location."""
        snapshot, payload = self.load_model(model_id)
        summary = snapshot.summary
        manifest = snapshot.manifest
        metrics = summary.get('metrics')
        if not isinstance(metrics, dict):
            raise RequestError('ARTIFACT_INVALID')
        dataset_version = summary.get('datasetVersion')
        if dataset_version != payload.get('artifactDatasetVersion'):
            raise RequestError('ARTIFACT_INVALID')
        return dict(
            payload,
            artifactKey=self._row(model_id)['relative_key'],
            artifactDatasetVersion=dataset_version,
            metrics=metrics,
            trainingSeconds=summary.get('trainingSeconds'),
            threshold=summary.get('threshold'),
            metricSet=manifest['config'].get('metricSet'),
            split=summary.get('split'),
            source=summary.get('source'),
            limitations=summary.get('limitations') or payload.get('limitations') or [],
            featureSchemaVersion=snapshot.schema.name,
        )

    def default_model_id(self):
        with self.store.connection() as db:
            return db.execute('SELECT model_id FROM model_default WHERE singleton=1').fetchone()[0]

    def policy(self, model_id):
        with self.store.connection() as db:
            row = db.execute('SELECT COALESCE(p.enabled,1) AS enabled,d.model_id=m.id AS is_default '
                             'FROM model_version m LEFT JOIN model_policy p ON p.model_id=m.id '
                             'CROSS JOIN model_default d WHERE m.id=?', (model_id,)).fetchone()
        if row is None:
            raise RequestError('NOT_FOUND')
        return {'enabled': bool(row['enabled']), 'isDefault': bool(row['is_default'])}

    def update_policy(self, model_id, changes):
        if (not isinstance(changes, dict) or not changes or set(changes) - {'enabled', 'isDefault'} or
                any(type(value) is not bool for value in changes.values()) or
                'isDefault' in changes and changes['isDefault'] is not True or
                changes.get('isDefault') and changes.get('enabled') is False):
            raise RequestError('INPUT_INVALID')
        # Verify the actual artifacts before enabling or making a default. Disabling an
        # invalid artifact remains possible; policy never rewrites its historical identity.
        if changes.get('enabled') or changes.get('isDefault'):
            _, payload = self.load_model(model_id)
            if payload['featureSchemaVersion'] not in REPOSITORY_SCHEMAS:
                raise RequestError('INPUT_SCHEMA_MISMATCH')
        with self.store.connection(write=True) as db:
            row = db.execute('SELECT m.state,COALESCE(p.enabled,1) AS enabled FROM model_version m '
                             'LEFT JOIN model_policy p ON p.model_id=m.id WHERE m.id=?', (model_id,)).fetchone()
            if row is None:
                raise RequestError('NOT_FOUND')
            default_id = db.execute('SELECT model_id FROM model_default WHERE singleton=1').fetchone()[0]
            enabled = changes.get('enabled', bool(row['enabled']))
            if not enabled and default_id == model_id:
                raise RequestError('DEFAULT_MODEL_REQUIRED')
            if changes.get('isDefault'):
                if not enabled:
                    raise RequestError('MODEL_DISABLED')
                if row['state'] != 'ready':
                    raise RequestError('MODEL_NOT_READY')
                db.execute('UPDATE model_default SET model_id=? WHERE singleton=1', (model_id,))
            db.execute('INSERT INTO model_policy VALUES (?,?) ON CONFLICT(model_id) '
                       'DO UPDATE SET enabled=excluded.enabled', (model_id, int(enabled)))
            result = {'modelId': model_id, 'enabled': enabled,
                      'isDefault': bool(changes.get('isDefault') or default_id == model_id)}
        return result

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
                               **self.policy(model_id),
                               error={'code': row['error_code'], 'message': MESSAGES.get(row['error_code'], '运行不可用')})
            if state is None or payload['state'] == state:
                result.append(payload)
        # All list items share one policy snapshot, even if a default changes
        # while expensive artifact validation is in progress.
        with self.store.connection() as db:
            default_id = db.execute('SELECT model_id FROM model_default WHERE singleton=1').fetchone()[0]
            disabled = {row[0] for row in db.execute('SELECT model_id FROM model_policy WHERE enabled=0')}
        for payload in result:
            payload.update(enabled=payload['modelId'] not in disabled, isDefault=payload['modelId'] == default_id)
        return result
