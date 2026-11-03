"""Register delivered runs without retraining or rewriting their artifacts."""
import json
import os
from functools import lru_cache
from pathlib import Path, PurePosixPath
from uuid import UUID, uuid4

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
OFFLINE_SCHEMAS = ('kamei14-benchmark-v1',)
SEMANTIC_SCHEMAS = ('code-semantic-codebert-v1', 'kamei14-semantic-codebert-v1')
EXPERIMENT_REPORT_NAMES = ('multi-project-report.json',)
METRIC_KEYS = ('averagePrecision', 'rocAuc', 'recall20Loc', 'popt', 'f1', 'ifa')


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
        candidate = directory / name
        if candidate.is_symlink():
            raise RequestError('INPUT_INVALID')
        path = candidate.resolve()
        if not path.is_relative_to(self.root):
            raise RequestError('INPUT_INVALID')
        return path

    def _nested_directory(self, key):
        """Resolve a server-discovered nested artifact without following links."""
        if not isinstance(key, str) or not key or '\\' in key or ':' in key or key.startswith('/'):
            raise RequestError('INPUT_INVALID')
        parts = PurePosixPath(key).parts
        if (not parts or any(part in ('.', '..') or part.startswith('.') for part in parts)
                or parts[0] in ('development',)):
            raise RequestError('INPUT_INVALID')
        current = self.root
        for part in parts:
            current = current / part
            if current.is_symlink():
                raise RequestError('INPUT_INVALID')
        path = current.resolve()
        if not path.is_relative_to(self.root) or path == self.root:
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

    @staticmethod
    def _compatibility(schema):
        if schema in REPOSITORY_SCHEMAS:
            return {'state': 'repository-analysis', 'reason': None}
        if schema in OFFLINE_SCHEMAS:
            return {'state': 'offline-only', 'reason': '该特征 schema 仅支持离线基准，不接入用户仓库分析。'}
        if schema in SEMANTIC_SCHEMAS:
            return {'state': 'input-unsupported', 'reason': '该模型需要离线生成的语义向量，当前用户仓库分析不能现场构造。'}
        return {'state': 'schema-incompatible', 'reason': f'当前用户仓库分析不支持 schema {schema}。'}

    def _artifact_row(self, key):
        directory = self._nested_directory(key)
        row = {
            'candidateId': self._candidate_id(key),
            'displayName': key,
            'artifactKey': key,
            'candidateKind': 'experiment',
            'artifactState': 'invalid',
            'manifestSha256': None,
            'artifactRunId': None,
            'runId': None,
            'modelId': None,
            'modelState': None,
            'enabled': None,
            'isDefault': None,
            'method': None,
            'featureSchemaVersion': None,
            'datasetVersion': None,
            'metricSet': None,
            'metrics': {},
            'trainingSeconds': None,
            'split': {},
            'source': {},
            'limitations': [],
            'artifactStateReason': None,
            'serviceCompatibility': 'schema-incompatible',
            'serviceCompatibilityReason': '运行产物无效，无法判断用户分析兼容性。',
        }
        try:
            manifest_file = self._file(directory, 'manifest.json')
            if manifest_file.stat().st_size > 1024 * 1024:
                raise RequestError('ARTIFACT_INVALID')
            row['manifestSha256'] = sha256(manifest_file.read_bytes())
            manifest = read_json(manifest_file)
            config = manifest['config']
            schema = config.get('schema') or config.get('protocol')
            if not schema:
                raise RequestError('ARTIFACT_INVALID')
            compatibility = self._compatibility(schema)
            row.update({
                'artifactRunId': manifest.get('runId'),
                'method': config.get('algorithmVersion') or 'logistic-regression-l2-v1',
                'featureSchemaVersion': schema,
                'datasetVersion': config.get('datasetVersion'),
                'metricSet': config.get('metricSet'),
                'serviceCompatibility': compatibility['state'],
                'serviceCompatibilityReason': compatibility['reason'],
            })
            required = (*CORE_FILES, 'summary.json')
            missing = [name for name in required
                       if not (directory / name).is_file() or (directory / name).is_symlink()]
            if missing:
                row['artifactStateReason'] = f'缺少必要产物：{", ".join(missing)}'
            else:
                summary = read_json(self._file(directory, 'summary.json'))
                metrics = summary.get('metrics')
                model = summary.get('model') or {}
                if not isinstance(metrics, dict):
                    raise RequestError('ARTIFACT_INVALID')
                row.update({
                    'artifactState': 'complete',
                    'name': model.get('name') or config.get('algorithmVersion'),
                    'datasetVersion': summary.get('datasetVersion') or config.get('datasetVersion'),
                    'metrics': {key: metrics[key] for key in METRIC_KEYS if key in metrics},
                    'trainingSeconds': summary.get('trainingSeconds'),
                    'split': summary.get('split') or {},
                    'source': summary.get('source') or {},
                    'limitations': list(summary.get('limitations') or []),
                })
        except (BaselineError, KeyError, TypeError, ValueError, OSError) as exc:
            code = exc.code if isinstance(exc, BaselineError) else 'ARTIFACT_INVALID'
            row['artifactStateReason'] = MESSAGES.get(code, '运行产物无效，请核验声明和文件')
        return row

    def _suite_failure_rows(self):
        rows = []
        for current, dirs, files in os.walk(self.root, followlinks=False):
            dirs[:] = sorted(name for name in dirs
                             if not name.startswith('.') and not (Path(current) == self.root and name == 'development'))
            if 'suite.json' not in files:
                continue
            suite_file = Path(current) / 'suite.json'
            if suite_file.is_symlink():
                continue
            try:
                suite = read_json(suite_file)
            except BaselineError:
                continue
            suite_key = PurePosixPath(*suite_file.parent.relative_to(self.root).parts).as_posix()
            schema = suite.get('schemaName')
            compatibility = self._compatibility(schema)
            for entry in suite.get('methods') or []:
                if not isinstance(entry, dict) or entry.get('status') != 'failed':
                    continue
                method = entry.get('method')
                if not isinstance(method, str) or not method:
                    continue
                key = f'{suite_key}::{method}'
                rows.append({
                    'candidateId': identity({'root': 'artifacts', 'suiteFailure': key}),
                    'displayName': key,
                    'artifactKey': None,
                    'candidateKind': 'experiment',
                    'artifactState': 'failed',
                    'artifactStateReason': entry.get('message') or '套件方法训练失败',
                    'manifestSha256': None,
                    'artifactRunId': None,
                    'runId': None,
                    'modelId': None,
                    'modelState': None,
                    'enabled': None,
                    'isDefault': None,
                    'method': method,
                    'name': method,
                    'featureSchemaVersion': schema,
                    'datasetVersion': suite.get('version'),
                    'metricSet': suite.get('metricSet'),
                    'metrics': {},
                    'trainingSeconds': None,
                    'split': {},
                    'source': {},
                    'limitations': [],
                    'serviceCompatibility': compatibility['state'],
                    'serviceCompatibilityReason': compatibility['reason'],
                    'promotable': False,
                })
        return rows

    def _registered_runs(self):
        with self.store.connection() as db:
            rows = db.execute(
                "SELECT e.artifact_run_id,m.id,m.state,m.payload_json,"
                "COALESCE(p.enabled,1) AS enabled,d.model_id=m.id AS is_default "
                "FROM experiment_run e JOIN model_version m ON m.run_id=e.id "
                "LEFT JOIN model_policy p ON p.model_id=m.id CROSS JOIN model_default d"
            ).fetchall()
        result = {}
        for row in rows:
            payload = json.loads(row['payload_json'])
            result[row['artifact_run_id']] = {
                'modelId': row['id'],
                'runId': payload.get('runId'),
                'modelState': row['state'],
                'enabled': bool(row['enabled']),
                'isDefault': bool(row['is_default']),
                'name': payload.get('name'),
            }
        return result

    def _experiment_inventory(self):
        discovered = []
        if self.root.exists():
            for current, dirs, files in os.walk(self.root, followlinks=False):
                dirs[:] = sorted(name for name in dirs
                                 if not name.startswith('.') and not (Path(current) == self.root and name == 'development'))
                if 'manifest.json' not in files:
                    continue
                directory = Path(current)
                if directory.is_symlink():
                    continue
                key = PurePosixPath(*directory.relative_to(self.root).parts).as_posix()
                discovered.append(self._artifact_row(key))
        discovered.extend(self._suite_failure_rows())
        registered = self._registered_runs()
        grouped = {}
        for row in discovered:
            identity_key = row.get('artifactRunId') or row['candidateId']
            grouped.setdefault(identity_key, []).append(row)
        runs = []
        for locations in grouped.values():
            complete = [item for item in locations if item['artifactState'] == 'complete']
            primary = complete[0] if complete else locations[0]
            primary = dict(primary)
            primary['locations'] = [{
                'candidateId': item['candidateId'],
                'artifactKey': item['artifactKey'],
                'artifactState': item['artifactState'],
                'manifestSha256': item['manifestSha256'],
                'reason': item['artifactStateReason'],
            } for item in locations]
            artifact_run_id = primary.get('artifactRunId')
            model = registered.get(artifact_run_id) if artifact_run_id else None
            primary['registrationState'] = 'registered' if model else 'unregistered'
            if model:
                primary.update(modelId=model['modelId'], runId=model['runId'], modelState=model['modelState'],
                               enabled=model['enabled'], isDefault=model['isDefault'])
            primary['promotable'] = primary['artifactState'] == 'complete' and not model
            runs.append(primary)
        runs.sort(key=lambda item: (
            item.get('datasetVersion') or '', item.get('featureSchemaVersion') or '',
            item.get('method') or '', item.get('artifactRunId') or item['candidateId']))
        return runs

    def experiment_runs(self, *, registration_state=None, compatibility=None,
                        artifact_state=None, limit=50, offset=0):
        runs = self._experiment_inventory()
        if registration_state:
            runs = [item for item in runs if item['registrationState'] == registration_state]
        if compatibility:
            runs = [item for item in runs if item.get('serviceCompatibility') == compatibility]
        if artifact_state:
            runs = [item for item in runs if item['artifactState'] == artifact_state]
        reports = []
        if self.root.exists():
            for current, dirs, files in os.walk(self.root, followlinks=False):
                dirs[:] = sorted(name for name in dirs if not name.startswith('.'))
                for name in EXPERIMENT_REPORT_NAMES:
                    if name in files:
                        key = PurePosixPath(*((Path(current) / name).relative_to(self.root)).parts).as_posix()
                        reports.append({'artifactKey': key, 'registrationEligible': False,
                                        'reason': '聚合报告不含完整模型产物，不能登记为模型。'})
        reports.sort(key=lambda item: item['artifactKey'])
        return {'runs': runs[offset:offset + limit], 'reports': reports,
                'total': len(runs), 'limit': limit, 'offset': offset}

    def experiment_detail(self, candidate_id):
        for run in self._experiment_inventory():
            if run['candidateId'] == candidate_id or any(
                    location['candidateId'] == candidate_id for location in run['locations']):
                return run
        raise RequestError('NOT_FOUND')

    def _run_has_verified_location(self, run):
        if run.get('artifactState') != 'complete':
            return False
        for location in run.get('locations') or []:
            key = location.get('artifactKey')
            if not key or location.get('artifactState') != 'complete':
                continue
            try:
                verify_run(self._nested_directory(key))
            except (BaselineError, OSError, ValueError):
                continue
            return True
        return False

    def readiness(self, registered=None):
        registered = self.models() if registered is None else registered
        page = self.experiment_runs(limit=100000)
        complete = [run for run in page['runs'] if self._run_has_verified_location(run)]
        invalid_artifacts = [
            run for run in page['runs']
            if run['artifactState'] != 'complete'
            or run['artifactState'] == 'complete' and run not in complete
        ]
        unregistered = sum(run['registrationState'] == 'unregistered' for run in complete)
        ready_models = [model for model in registered if model.get('state') == 'ready']
        invalid_models = [model for model in registered if model.get('state') != 'ready']
        dependency_unavailable = sum(
            (model.get('error') or {}).get('code') == 'MODEL_DEPENDENCY_UNAVAILABLE'
            for model in invalid_models
        )
        artifact_invalid = len(invalid_models) - dependency_unavailable
        disabled_models = [model for model in ready_models if not model.get('enabled')]
        incompatible_models = [model for model in ready_models
                               if model.get('featureSchemaVersion') not in REPOSITORY_SCHEMAS]
        selectable = [model for model in ready_models if model.get('enabled')
                      and model.get('featureSchemaVersion') in REPOSITORY_SCHEMAS]
        with self.store.connection() as db:
            default_id = db.execute('SELECT model_id FROM model_default WHERE singleton=1').fetchone()[0]
        default = next((model for model in registered if model['modelId'] == default_id), None)
        default_available = bool(default and default.get('state') == 'ready' and default.get('enabled'))
        issues = []
        if not complete:
            issues.append({'code': 'NO_COMPLETE_ARTIFACTS',
                           'message': '没有完整实验运行，先完成训练或检查产物目录。'})
        if unregistered:
            issues.append({'code': 'UNREGISTERED_EXPERIMENTS',
                           'message': f'{unregistered} 个完整实验运行尚未登记。'})
        if invalid_artifacts:
            issues.append({'code': 'INVALID_ARTIFACTS',
                           'message': f'{len(invalid_artifacts)} 个实验产物缺失、失败或校验不一致。'})
        if invalid_models:
            issues.append({'code': 'INVALID_MODEL_ARTIFACTS',
                           'message': f'{len(invalid_models)} 个已登记模型产物不可用。'})
        if dependency_unavailable:
            issues.append({'code': 'DEPENDENCY_UNAVAILABLE',
                           'message': f'{dependency_unavailable} 个模型缺少运行依赖。'})
        if disabled_models:
            issues.append({'code': 'DISABLED_MODELS',
                           'message': f'{len(disabled_models)} 个候选模型已停用。'})
        if incompatible_models:
            issues.append({'code': 'INCOMPATIBLE_MODELS',
                           'message': f'{len(incompatible_models)} 个模型不能用于当前仓库分析。'})
        if not ready_models:
            issues.append({'code': 'NO_READY_MODELS',
                           'message': '模型目录没有可用模型，用户不能选择模型。'})
        if default_id is None:
            issues.append({'code': 'DEFAULT_MISSING',
                           'message': '尚未设置默认模型。'})
        elif not default_available:
            issues.append({'code': 'DEFAULT_UNAVAILABLE',
                           'message': '当前默认模型不可用或已停用。'})
        if not selectable:
            issues.append({'code': 'NO_REPOSITORY_MODEL',
                           'message': '没有可用于当前用户仓库分析的已登记模型。'})
        return {
            'ready': bool(ready_models) and default_available and bool(selectable),
            'completeArtifacts': len(complete),
            'unregisteredExperiments': unregistered,
            'completeUnregisteredExperiments': unregistered,
            'invalidArtifacts': len(invalid_artifacts),
            'registeredModels': len(registered),
            'readyModels': len(ready_models),
            'repositorySelectableModels': len(selectable),
            'userSelectableModels': len(selectable),
            'invalidModels': len(invalid_models),
            'artifactInvalidModels': artifact_invalid,
            'dependencyUnavailableModels': dependency_unavailable,
            'disabledModels': len(disabled_models),
            'incompatibleModels': len(incompatible_models),
            'defaultModelId': default_id,
            'defaultAvailable': default_available,
            'reportOnlyArtifacts': len(page['reports']),
            'issues': issues,
        }

    def promote_experiments(self, items, *, request_id=None):
        results = []

        def item_result(candidate_id, status, *, model_id=None, run_id=None, code=None, message=None):
            return {'candidateId': candidate_id, 'status': status, 'modelId': model_id,
                    'runId': run_id, 'code': code, 'message': message}

        for item in items:
            candidate_id = item['candidateId']
            expected = item['expectedManifestSha256']
            try:
                run = self.experiment_detail(candidate_id)
                if run['registrationState'] == 'registered':
                    results.append(item_result(candidate_id, 'already-registered',
                                               model_id=run['modelId'], run_id=run['runId']))
                    continue
                if run['artifactState'] != 'complete':
                    results.append(item_result(candidate_id, 'failed', code='ARTIFACT_INVALID',
                                               message=run.get('artifactStateReason') or '运行产物不完整'))
                    continue
                result = self.register(candidate_id, expected, channel='experiment-promotion',
                                       request_id=request_id)
                results.append(item_result(candidate_id, 'registered' if result['created'] else 'reused',
                                           model_id=result['model']['modelId'],
                                           run_id=result['model']['runId']))
            except BaselineError as exc:
                results.append(item_result(candidate_id, 'failed', code=exc.code,
                                           message=MESSAGES.get(exc.code, str(exc))))
        return {'items': results,
                'registered': sum(item['status'] in ('registered', 'reused', 'already-registered') for item in results),
                'failed': sum(item['status'] == 'failed' for item in results)}

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

    def register(self, candidate_id, expected_hash, *, channel='local-cli', request_id=None,
                 preferred_model_id=None):
        request_id = request_id or str(uuid4())
        if preferred_model_id is not None:
            if not isinstance(preferred_model_id, str):
                raise RequestError('INPUT_INVALID', field='modelId')
            try:
                preferred_model_id = str(UUID(preferred_model_id))
            except ValueError as exc:
                raise RequestError('INPUT_INVALID', field='modelId') from exc
        # Check storage before expensive verification; never create the catalog implicitly.
        with self.store.connection():
            pass
        try:
            candidate = next((c for c in self._experiment_inventory() if any(
                location['candidateId'] == candidate_id for location in c['locations'])), None)
            if candidate is None:
                raise RequestError('NOT_FOUND')
            if candidate['artifactState'] != 'complete':
                raise RequestError('ARTIFACT_INVALID')
            candidate_location = next(location for location in candidate['locations']
                                      if location['candidateId'] == candidate_id)
            artifact_key = candidate_location['artifactKey']
            if candidate_location['artifactState'] != 'complete' or not artifact_key:
                raise RequestError('ARTIFACT_INVALID')
            directory = self._nested_directory(artifact_key)
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
                if model:
                    model_id = model['id']
                else:
                    model_id = preferred_model_id or str(uuid4())
                    collision = db.execute('SELECT run_id FROM model_version WHERE id=?',
                                           (model_id,)).fetchone()
                    if collision is not None:
                        raise RequestError('CONTEXT_MISMATCH')
                location = db.execute('SELECT id,run_id FROM run_location WHERE relative_key=?',
                                      (artifact_key,)).fetchone()
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
                               (location_id, run_id, artifact_key, *values))
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
                try:
                    with self.store.connection(write=True) as db:
                        self._event(db, candidate_id, request_id, channel, 'failed', exc.code)
                except BaselineError:
                    pass
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

    def run_id(self, model_id):
        """Catalog model's business run identity, without loading the model."""
        return self._row(model_id)['run_id']

    def artifact_run_id(self, model_id):
        """Artifact run identity recorded in the model payload (manifest runId)."""
        payload = json.loads(self._row(model_id)['payload_json'])
        value = payload.get('artifactRunId')
        if not isinstance(value, str) or not value:
            raise RequestError('ARTIFACT_INVALID')
        return value

    def load_model(self, model_id):
        row = self._row(model_id)
        if row['state'] != 'ready':
            raise RequestError('MODEL_NOT_READY')
        try:
            directory = self._nested_directory(row['relative_key'])
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
