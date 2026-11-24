"""End-user data and training API; every route is scoped to the signed-in user."""
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from .. import curation, datasets, store
from ..catalog_input import read_object
from ..config import BACKEND, USER_DATASET_LIMIT
from ..data import BaselineError, sha256
from ..schemas import KAMEI_2013_SCHEMA, resolve
from ..split_preview import dataset_split_preview
from ..store import dataset_references
from ..users import current_user
from .dataset_import_jobs import DatasetImportJobs, import_csv, upload_name
from .pr_review import github_request, github_token
from .published_dataset_imports import MAX_UPLOAD_BYTES, import_projects
from .user_predictions import UserPredictionService

MAX_EXPORT_BYTES = 64 * 1024 * 1024


def _user(request):
    name = current_user(request)
    if not name:
        raise BaselineError('AUTH_REQUIRED', '请先登录用户账户')
    return name


def _registry(root):
    try:
        return datasets.load_all(root)
    except BaselineError as exc:
        if exc.code == 'DATASET_REGISTRY_EMPTY':
            return {}
        raise


def _owners(storage, version):
    return storage.dataset_owners(version)


def _manifest_registered_at(manifest):
    """目录库尚未导入描述文件时，用描述文件的写入时间作为登记事实。"""
    declared = manifest.get('manifestPath')
    if not isinstance(declared, str) or not declared:
        return None
    path = Path(declared)
    if not path.is_absolute():
        path = BACKEND / path
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat().replace('+00:00', 'Z')
    except OSError:
        return None


def _manifest_integrity(storage, manifest, version):
    """目录库已导入时读取登记哈希；仅文件登记时以描述文件内容与声明的源哈希为准。"""
    record = storage.dataset(version) or {}
    declared = manifest.get('manifestPath')
    digest = record.get('manifestSha256')
    if not digest and isinstance(declared, str) and declared:
        path = Path(declared)
        if not path.is_absolute():
            path = BACKEND / path
        try:
            digest = sha256(path.read_bytes())
        except OSError:
            digest = None
    source = record.get('sourceSha256') or (manifest.get('file') or {}).get('sha256')
    return {'manifestSha256': digest, 'sourceSha256': source}


def _timestamps(storage, manifest, version, username, usage):
    """返回可核验的时间事实，不把导入、构建和归属混成一个“创建时间”。"""
    with storage.connection() as db:
        registered = db.execute(
            'SELECT created_at FROM dataset_record WHERE dataset_version=?',
            (version,)).fetchone()
        owned = db.execute(
            'SELECT created_at FROM dataset_owner WHERE dataset_version=? AND username=?',
            (version, username)).fetchone()
        built = db.execute(
            "SELECT completed_at FROM dataset_build_task WHERE dataset_version=? "
            "AND status='completed' AND completed_at IS NOT NULL "
            "ORDER BY completed_at DESC LIMIT 1",
            (version,)).fetchone()
    registered_at = registered[0] if registered is not None else _manifest_registered_at(manifest)
    return {
        'registeredAt': registered_at,
        'importedAt': registered[0] if registered is not None and usage == 'import' else None,
        'ownedAt': owned[0] if owned is not None else None,
        'builtAt': built[0] if built is not None else None,
    }


def _visible(storage, version, username, registry):
    if version not in registry:
        raise BaselineError('NOT_FOUND', '数据集版本未登记')
    owners = _owners(storage, version)
    if registry[version].get('benchmark') and not owners:
        raise BaselineError('NOT_FOUND', '数据集版本未登记')
    if owners and username not in owners:
        raise BaselineError('DATASET_FORBIDDEN', '该数据版本属于其他用户')
    return registry[version], owners


def _view(storage, manifest, version, owners, username):
    file = manifest.get('file') or {}
    fields = [field for field in (manifest.get('fields') or []) if isinstance(field, dict)]
    source = manifest.get('source') or manifest
    benchmark = manifest.get('benchmark')
    usage = manifest.get('usage') or 'branch'
    return {
        'version': version,
        'dataset': manifest.get('dataset'),
        'schema': manifest.get('schemaName'),
        'timeRange': manifest.get('timeRange'),
        'quality': manifest.get('quality'),
        'file': {'name': Path(file.get('path') or '').name, 'sha256': file.get('sha256'),
                 'bytes': file.get('bytes')},
        'source': ({'publisher': manifest['publisher'], **benchmark} if benchmark else
                   store._source(manifest) if manifest.get('collection') or manifest.get('source') else {
                       'publisher': source.get('publisher'), 'url': source.get('url'),
                       'revision': source.get('revision'), 'branch': source.get('branch'),
                       'head': source.get('head')}),
        'fieldCount': sum(1 for field in fields if field.get('inModel') is not False),
        'fieldNames': [field.get('name') for field in fields
                       if isinstance(field.get('name'), str)],
        'featureFields': [field.get('name') for field in fields
                          if field.get('inModel') is not False and isinstance(field.get('name'), str)],
        'labelRule': store._label_rule(manifest),
        'labelMaturity': store._label_maturity(manifest),
        'labelObservations': store._observations(manifest),
        'limitations': store._limitations(manifest) or list(manifest.get('limitations') or []),
        'curation': manifest.get('curation'),
        'integrity': _manifest_integrity(storage, manifest, version),
        'mine': username in owners,
        'shared': not owners,
        'usage': usage,
        'timestamps': _timestamps(storage, manifest, version, username, usage),
    }


def _csv_path(manifest):
    declared = Path((manifest.get('file') or {}).get('path') or '')
    return declared if declared.is_absolute() else BACKEND / declared


def _portable_manifest(manifest, version):
    portable = json.loads(json.dumps(manifest, ensure_ascii=False))
    file = portable.get('file') or {}
    if file.get('path'):
        file['path'] = Path(file['path']).name
    status = portable.get('labelStatusFile')
    if isinstance(status, dict) and status.get('path'):
        status['path'] = Path(status['path']).name
    labeling = portable.get('labeling') or {}
    nested = labeling.get('statusFile')
    if isinstance(nested, dict) and nested.get('path'):
        nested['path'] = Path(nested['path']).name
    return portable


async def _upload(request):
    blob = bytearray()
    try:
        async for chunk in request.stream():
            if len(chunk) > MAX_UPLOAD_BYTES - len(blob):
                raise BaselineError('DATASET_IMPORT_TOO_LARGE', '上传文件超过 64 MiB 上限')
            blob.extend(chunk)
    except BaselineError:
        raise
    except (OSError, RuntimeError, ClientDisconnect) as exc:
        raise BaselineError('DATASET_UNAVAILABLE', '上传文件读取失败') from exc
    if not blob:
        raise BaselineError('INPUT_INVALID', '上传文件为空')
    return bytes(blob)


def install_user_routes(app, storage, dataset_root, training_service, catalog):
    root = Path(dataset_root) if dataset_root is not None else None
    predictions = UserPredictionService(storage, catalog)
    imports = DatasetImportJobs(storage, root)
    app.state.dataset_imports = imports

    @app.get('/api/v1/user/profile')
    def user_profile(request: Request):
        username = _user(request)
        with storage.connection() as db:
            row = db.execute('SELECT username,display_name,created_at FROM user_account WHERE username=?',
                             (username,)).fetchone()
            datasets = db.execute('SELECT COUNT(*) FROM dataset_owner WHERE username=?',
                                  (username,)).fetchone()[0]
            models = db.execute('SELECT COUNT(*) FROM model_version WHERE owner_user_id=?',
                                (username,)).fetchone()[0]
            experiments = db.execute('SELECT COUNT(*) FROM training_experiment WHERE owner_user_id=?',
                                     (username,)).fetchone()[0]
        if row is None:
            raise BaselineError('NOT_FOUND', '用户账户不存在')
        return {'username': row[0], 'displayName': row[1], 'createdAt': row[2],
                'datasetCount': datasets, 'modelCount': models, 'experimentCount': experiments,
                'github': {'connected': bool(github_token()), 'login': None}}

    @app.post('/api/v1/user/github/link')
    async def link_user_github(request: Request):
        _user(request)
        if not github_token():
            raise BaselineError('GITHUB_CONNECTION_REQUIRED', '请先在本机完成 GitHub 登录')
        profile = await run_in_threadpool(github_request, '/user')
        login = profile.get('login') if isinstance(profile, dict) else None
        if not isinstance(login, str) or not login:
            raise BaselineError('PR_SOURCE_UNAVAILABLE', '无法读取 GitHub 账户')
        return {'connected': True, 'login': login}

    @app.patch('/api/v1/user/profile')
    async def update_user_profile(request: Request):
        username = _user(request)
        data = await read_object(request)
        display = data.get('displayName')
        if display is not None and (not isinstance(display, str) or len(display.strip()) > 40):
            raise BaselineError('INPUT_INVALID', '显示名称最多 40 个字符')
        normalized = display.strip() if isinstance(display, str) and display.strip() else None
        with storage.connection(write=True) as db:
            db.execute('UPDATE user_account SET display_name=? WHERE username=?',
                       (normalized, username))
        return {'username': username, 'displayName': normalized}

    @app.get('/api/v1/user/datasets')
    def user_datasets(request: Request, scope: str = 'usable'):
        username = _user(request)
        registry = _registry(root)
        supported = {'openstack-six-v1', 'kamei14-v1', 'kamei14-git-v1',
                     'kamei14-git-v2', 'kamei14-benchmark-v1', KAMEI_2013_SCHEMA}

        def usable(version):
            manifest = registry.get(version)
            if manifest is None or manifest.get('schemaName') not in supported:
                return False
            csv = _csv_path(manifest)
            return csv.is_file()

        owned = [version for version in storage.user_datasets(username) if usable(version)]
        versions = list(owned)
        if scope != 'mine':
            shared_versions = set(storage.shared_dataset_versions())
            latest = {}
            for version, manifest in registry.items():
                if version in versions or version not in shared_versions or not usable(version):
                    continue
                if _owners(storage, version):
                    continue
                key = manifest.get('dataset') or version
                current = latest.get(key)
                end = ((manifest.get('timeRange') or {}).get('end') or '')
                if current is None or end > latest[key][0]:
                    latest[key] = (end, version)
            versions.extend(version for _, version in
                            sorted(latest.values(), key=lambda item: item[1]))
        result = []
        for version in versions:
            manifest = registry.get(version)
            if manifest is None:
                continue
            result.append(_view(storage, manifest, version, _owners(storage, version), username))
        return {'datasets': result, 'limit': USER_DATASET_LIMIT}

    @app.post('/api/v1/user/dataset-builds')
    async def create_user_dataset_build(request: Request):
        username = _user(request)
        payload = await read_object(request)
        repository_url = payload.pop('repositoryUrl', None) if isinstance(payload, dict) else None
        if not isinstance(repository_url, str) or not repository_url.strip():
            raise BaselineError('INPUT_INVALID', '缺少公开仓库地址')
        result, created = await run_in_threadpool(
            app.state.dataset_builds.create_url, repository_url.strip(), payload,
            getattr(request.state, 'request_id', None),
            created_by=username, owner_user_id=username,
        )
        request.state.business_ids = (None, None, result.get('datasetVersion'))
        return Response(
            json.dumps(result, ensure_ascii=False), media_type='application/json',
            status_code=202 if created else 200,
        )

    @app.get('/api/v1/user/dataset-builds')
    def user_dataset_builds(request: Request, limit: int = 20, offset: int = 0):
        return app.state.dataset_builds.user_pages(_user(request), limit, offset)

    @app.get('/api/v1/user/dataset-builds/{task_id}')
    def user_dataset_build(task_id: str, request: Request):
        return app.state.dataset_builds.user_get(task_id, _user(request))

    @app.post('/api/v1/user/dataset-builds/{task_id}/cancel')
    def cancel_user_dataset_build(task_id: str, request: Request):
        result = app.state.dataset_builds.user_cancel(task_id, _user(request))
        return Response(json.dumps(result, ensure_ascii=False), media_type='application/json')

    @app.post('/api/v1/user/dataset-builds/{task_id}/retry')
    async def retry_user_dataset_build(task_id: str, request: Request):
        username = _user(request)
        result, created = await run_in_threadpool(
            app.state.dataset_builds.user_retry, task_id,
            getattr(request.state, 'request_id', None),
            created_by=username, owner_user_id=username,
        )
        return Response(
            json.dumps(result, ensure_ascii=False), media_type='application/json',
            status_code=202 if created else 200,
        )

    @app.post('/api/v1/user/datasets/import')
    async def import_user_dataset(request: Request):
        """导入用户提供的原始 CSV；观察与成熟声明不会被伪造。"""
        username = _user(request)
        content_type = (request.headers.get('content-type') or '').split(';', 1)[0].strip().lower()
        if content_type not in ('text/csv', 'application/octet-stream', 'application/vnd.ms-excel'):
            raise BaselineError('INPUT_INVALID', 'CSV 导入只接受 text/csv 或二进制 CSV 请求体')
        blob = await _upload(request)
        schema_name = request.query_params.get('schema') or 'kamei14-benchmark-v1'
        resolve(schema_name)
        filename = upload_name(request.query_params.get('filename'), 'csv')
        manifests, created = await run_in_threadpool(
            import_csv, storage, root, username, filename, blob, schema=schema_name,
            dataset=request.query_params.get('dataset'))
        manifest = manifests[0]
        version = manifest['version']
        request.state.business_ids = (None, None, version)
        return Response(json.dumps(_view(storage, manifest, version, [username], username),
                                   ensure_ascii=False),
                        media_type='application/json',
                        status_code=201 if created or schema_name != KAMEI_2013_SCHEMA else 200)

    @app.post('/api/v1/user/datasets/import-zip')
    async def import_user_dataset_zip(request: Request):
        username = _user(request)
        content_type = (request.headers.get('content-type') or '').split(';', 1)[0].strip().lower()
        if content_type not in ('application/zip', 'application/x-zip-compressed', 'application/octet-stream'):
            raise BaselineError('INPUT_INVALID', '请选择 ZIP 文件')
        blob = await _upload(request)
        filename = upload_name(request.query_params.get('filename'), 'zip')
        manifests, created = await run_in_threadpool(
            import_projects, storage, root, username, filename, blob, zipped=True)
        items = [_view(storage, manifest, manifest['version'], [username], username) for manifest in manifests]
        return Response(json.dumps({'datasets': items, 'createdCount': created}, ensure_ascii=False),
                        media_type='application/json', status_code=201 if created else 200)

    @app.post('/api/v1/user/dataset-imports', status_code=202)
    async def start_dataset_import(request: Request, format: str, filename: str | None = None,
                                   schema: str | None = None, dataset: str | None = None):
        username = _user(request)
        content_type = (request.headers.get('content-type') or '').split(';', 1)[0].strip().lower()
        allowed = {
            'csv': ('text/csv', 'application/octet-stream', 'application/vnd.ms-excel'),
            'zip': ('application/zip', 'application/octet-stream', 'application/x-zip-compressed'),
        }
        if format not in allowed or content_type not in allowed[format]:
            raise BaselineError('INPUT_INVALID', '请选择 CSV 或 ZIP 文件')
        if format == 'csv':
            schema = resolve(schema or 'kamei14-benchmark-v1').name
        else:
            schema = dataset = None
        blob = await _upload(request)
        return await run_in_threadpool(imports.create, username, blob, filename=upload_name(filename, format),
                                       kind=format, schema=schema, dataset=dataset)

    @app.get('/api/v1/user/dataset-imports')
    def list_dataset_imports(request: Request, activeOnly: bool = False):
        return {'tasks': imports.list(_user(request), activeOnly)}

    @app.get('/api/v1/user/dataset-imports/{task_id}')
    def get_dataset_import(task_id: str, request: Request):
        return imports.get(_user(request), task_id)

    @app.delete('/api/v1/user/datasets/{version}')
    def user_delete_dataset(version: str, request: Request):
        username = _user(request)
        registry = _registry(root)
        manifest, owners = _visible(storage, version, username, registry)
        if not owners:
            raise BaselineError('DATASET_FORBIDDEN', '共享数据不可删除')
        references = [item for item in dataset_references(storage, version)
                      if item != 'dataset-build']
        if references:
            raise BaselineError(
                'DATASET_IN_USE',
                f'该版本仍被{("、".join(references))}引用，不能删除')
        declared = []
        for entry in (manifest.get('file'), manifest.get('text'), manifest.get('labelEvidenceFile')):
            if isinstance(entry, dict) and entry.get('path'):
                declared.append(entry['path'])
        decisions = ((manifest.get('curation') or {}).get('decisionsFile') or {}).get('path')
        if decisions:
            declared.append(decisions)
        with storage.connection(write=True) as db:
            db.execute('UPDATE dataset_build_task SET parent_task_id=NULL '
                       'WHERE parent_task_id IN (SELECT id FROM dataset_build_task WHERE dataset_version=?)',
                       (version,))
            db.execute('DELETE FROM dataset_build_task WHERE dataset_version=?', (version,))
            db.execute('DELETE FROM import_run WHERE dataset_version=?', (version,))
            db.execute('DELETE FROM feature_record WHERE dataset_version=?', (version,))
            db.execute('DELETE FROM commit_record WHERE dataset_version=?', (version,))
            db.execute('DELETE FROM dataset_owner WHERE dataset_version=?', (version,))
            db.execute('DELETE FROM dataset_record WHERE dataset_version=?', (version,))
            db.execute('DELETE FROM dataset_version WHERE artifact_version=?', (version,))
        allowed_root = (root or datasets.DATASETS).resolve()
        for value in declared:
            path = Path(value)
            path = path if path.is_absolute() else BACKEND / path
            try:
                resolved = path.resolve()
            except OSError:
                continue
            if not resolved.is_relative_to(allowed_root):
                # 共享源文件（如公开数据集原始 CSV）不属于该用户版本，不能删除。
                continue
            try:
                if resolved.is_file():
                    resolved.unlink()
            except OSError:
                pass
        manifest_path = Path(registry[version].get('manifestPath') or '')
        if manifest_path:
            manifest_path = manifest_path if manifest_path.is_absolute() else BACKEND / manifest_path
            try:
                resolved = manifest_path.resolve()
            except OSError:
                resolved = None
            if resolved is not None and resolved.is_relative_to(allowed_root):
                try:
                    if resolved.is_file():
                        resolved.unlink()
                except OSError:
                    pass
        return {'deleted': version}

    @app.get('/api/v1/user/datasets/{version}')
    def user_dataset(version: str, request: Request):
        username = _user(request)
        registry = _registry(root)
        manifest, owners = _visible(storage, version, username, registry)
        return _view(storage, manifest, version, owners, username)

    @app.get('/api/v1/user/datasets/{version}/split-preview')
    def user_split_preview(version: str, request: Request, preset: str | None = None):
        username = _user(request)
        registry = _registry(root)
        _visible(storage, version, username, registry)
        return dataset_split_preview(root, version, preset)

    @app.get('/api/v1/user/datasets/{version}/export')
    def user_dataset_export(version: str, request: Request):
        username = _user(request)
        registry = _registry(root)
        manifest, _ = _visible(storage, version, username, registry)
        csv_path = _csv_path(manifest)
        try:
            blob = csv_path.read_bytes()
        except OSError as exc:
            raise BaselineError('DATASET_UNAVAILABLE', '原始 CSV 不可用') from exc
        if sha256(blob) != (manifest.get('file') or {}).get('sha256'):
            raise BaselineError('DATASET_INTEGRITY_ERROR', '原始 CSV 校验值不匹配')
        portable_bytes = (json.dumps(_portable_manifest(manifest, version), ensure_ascii=False,
                                     sort_keys=True, indent=2) + '\n').encode('utf-8')
        manifest_name = f'{version}.json'
        status_entry = manifest.get('labelStatusFile')
        status_blob, status_name = None, None
        if isinstance(status_entry, dict) and status_entry.get('path'):
            status_path = _csv_path({'file': {'path': status_entry['path']}})
            try:
                status_blob = status_path.read_bytes()
            except OSError as exc:
                raise BaselineError('DATASET_UNAVAILABLE', '逐提交标签状态文件不可用') from exc
            if sha256(status_blob) != status_entry.get('sha256'):
                raise BaselineError('DATASET_INTEGRITY_ERROR', '逐提交标签状态文件校验值不匹配')
            status_name = status_path.name
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(Path(csv_path).name, blob)
            archive.writestr(manifest_name, portable_bytes)
            hashes = [f'{sha256(blob)}  {Path(csv_path).name}',
                      f'{sha256(portable_bytes)}  {manifest_name}']
            if status_blob is not None and status_name is not None:
                archive.writestr(status_name, status_blob)
                hashes.append(f'{sha256(status_blob)}  {status_name}')
            archive.writestr('SHA256SUMS', '\n'.join(hashes) + '\n')
        if buffer.tell() > MAX_EXPORT_BYTES:
            raise BaselineError('DATASET_EXPORT_LIMIT_EXCEEDED', '数据集导出总大小超过上限')
        return Response(buffer.getvalue(), media_type='application/zip',
                        headers={'Content-Disposition': f'attachment; filename="{version}.zip"'})

    @app.post('/api/v1/user/datasets/{version}/curation/preview')
    async def user_curation_preview(version: str, request: Request):
        username = _user(request)
        registry = _registry(root)
        _visible(storage, version, username, registry)
        data = await read_object(request)
        return await run_in_threadpool(curation.preview, version, data.get('recipe'), root)

    @app.post('/api/v1/user/datasets/{version}/curation/derive')
    async def user_curation_derive(version: str, request: Request):
        username = _user(request)
        registry = _registry(root)
        _visible(storage, version, username, registry)
        data = await read_object(request)
        result = await run_in_threadpool(curation.derive, version, data.get('recipe'), root)
        derived = (result.get('dataset') or {}).get('version')
        if derived:
            storage.add_dataset_owner(derived, username, limit=USER_DATASET_LIMIT)
        return result

    @app.post('/api/v1/user/training-experiments')
    async def user_create_experiment(request: Request):
        username = _user(request)
        payload = await read_object(request)
        version = payload.get('datasetVersion')
        if not isinstance(version, str):
            raise BaselineError('INPUT_INVALID', '缺少数据集版本')
        request_id = getattr(request.state, 'request_id', None)

        def create_visible_experiment():
            _visible(storage, version, username, _registry(root))
            return training_service.create_experiment(payload, request_id, created_by=username,
                                                      owner_user_id=username)

        result, created = await run_in_threadpool(create_visible_experiment)
        request.state.business_ids = (None, None, result.get('experimentId'))
        return Response(json.dumps(result, ensure_ascii=False),
                        media_type='application/json', status_code=202 if created else 200)

    def _owned_experiment(experiment_id, username):
        view = training_service.get_experiment(experiment_id)
        if view.get('ownerUserId') != username:
            raise BaselineError('NOT_FOUND', '训练实验不存在')
        return view

    @app.get('/api/v1/user/training-experiments')
    def user_experiments(request: Request, limit: int = 20, offset: int = 0):
        username = _user(request)
        return training_service.experiments(username, limit, offset)

    @app.get('/api/v1/user/training-experiments/{experiment_id}')
    def user_experiment(experiment_id: str, request: Request):
        return _owned_experiment(experiment_id, _user(request))

    @app.get('/api/v1/user/training-experiments/{experiment_id}/comparison')
    def user_experiment_comparison(experiment_id: str, request: Request):
        _owned_experiment(experiment_id, _user(request))
        return training_service.compare_experiment(experiment_id)

    @app.post('/api/v1/user/training-experiments/{experiment_id}/comparison/thresholds')
    async def user_experiment_thresholds(experiment_id: str, request: Request):
        _owned_experiment(experiment_id, _user(request))
        return await run_in_threadpool(training_service.evaluate_experiment_thresholds,
                                       experiment_id, await read_object(request))

    @app.post('/api/v1/user/training-experiments/{experiment_id}/register')
    async def user_register_experiment(experiment_id: str, request: Request):
        username = _user(request)
        view = _owned_experiment(experiment_id, username)
        candidates = catalog.experiment_runs(registration_state='unregistered')['runs']
        by_key = {item['artifactKey']: item for item in candidates}
        items = []
        for task in view['tasks']:
            if task['status'] != 'succeeded' or task.get('modelId'):
                continue
            candidate = by_key.get(task['artifactKey'])
            if candidate is not None:
                items.append({'candidateId': candidate['candidateId'],
                              'expectedManifestSha256': candidate['manifestSha256']})
        if not items:
            return {'items': [], 'registered': 0, 'failed': 0}
        promoted = await run_in_threadpool(
            catalog.promote_experiments, items,
            request_id=getattr(request.state, 'request_id', None), owner_user_id=username)
        key_to_task = {task['artifactKey']: task for task in view['tasks']}
        for entry in promoted['items']:
            detail = catalog.experiment_detail(entry['candidateId'])
            task = key_to_task.get(detail.get('artifactKey'))
            if task is not None and entry.get('modelId'):
                training_service.tasks.update(task['taskId'], model_id=entry['modelId'],
                                              run_id=entry['runId'])
        return promoted

    def _owned_task(task_id, username):
        task = training_service.get(task_id)
        if task.get('ownerUserId') != username:
            raise BaselineError('NOT_FOUND', '训练任务不存在')
        return task

    @app.post('/api/v1/user/training-tasks/{task_id}/cancel')
    def user_cancel_task(task_id: str, request: Request):
        username = _user(request)
        _owned_task(task_id, username)
        result = training_service.cancel(task_id)
        return Response(json.dumps(result, ensure_ascii=False), media_type='application/json')

    @app.post('/api/v1/user/training-tasks/{task_id}/retry')
    async def user_retry_task(task_id: str, request: Request):
        username = _user(request)
        _owned_task(task_id, username)
        result, created = await run_in_threadpool(
            training_service.retry, task_id, getattr(request.state, 'request_id', None),
            created_by=username)
        return Response(json.dumps(result, ensure_ascii=False), media_type='application/json',
                        status_code=202 if created else 200)

    @app.get('/api/v1/user/models')
    def user_models(request: Request):
        username = _user(request)
        mine = [model for model in catalog.models() if model.get('ownerUserId') == username]
        return {'models': [{
            'modelId': model['modelId'], 'name': model['name'], 'method': model['method'],
            'featureSchemaVersion': model['featureSchemaVersion'], 'state': model['state'],
            'enabled': model['enabled'], 'parameters': model.get('parameters'),
            'datasetVersion': model.get('artifactDatasetVersion'),
        } for model in mine]}

    @app.get('/api/v1/user/prediction-models')
    def user_prediction_models(request: Request, datasetVersion: str):
        username = _user(request)
        registry = _registry(root)
        manifest, _ = _visible(storage, datasetVersion, username, registry)
        return predictions.models(username, manifest['schemaName'])

    @app.get('/api/v1/user/prediction-batches')
    def user_prediction_batches(request: Request, limit: int = 20, offset: int = 0):
        return predictions.list(_user(request), limit, offset)

    @app.post('/api/v1/user/prediction-batches', status_code=201)
    async def create_user_prediction_batch(request: Request):
        username = _user(request)
        data = await read_object(request)
        if set(data) - {'datasetVersion', 'modelId', 'threshold'}:
            raise BaselineError('INPUT_INVALID', '预测请求包含未声明字段')
        version = data.get('datasetVersion')
        model_id = data.get('modelId')
        if not isinstance(version, str) or not version.strip():
            raise BaselineError('INPUT_INVALID', '缺少数据版本')
        if not isinstance(model_id, str) or not model_id.strip():
            raise BaselineError('INPUT_INVALID', '缺少模型')
        registry = _registry(root)
        manifest, _ = _visible(storage, version.strip(), username, registry)
        result = await run_in_threadpool(
            predictions.create, username, version.strip(), manifest, model_id.strip(),
            data.get('threshold', 0.5),
        )
        request.state.business_ids = (
            result['model']['modelId'], result['model']['runId'], result['batchId'],
        )
        return result

    @app.get('/api/v1/user/prediction-batches/{batch_id}')
    def user_prediction_batch(batch_id: str, request: Request, limit: int = 100,
                              offset: int = 0, sort: str = 'risk'):
        result = predictions.get(_user(request), batch_id, limit, offset, sort)
        request.state.business_ids = (
            result['model']['modelId'], result['model']['runId'], result['batchId'],
        )
        return result
