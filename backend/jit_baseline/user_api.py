"""End-user data and training API; every route is scoped to the signed-in user."""
import io
import json
import zipfile
from pathlib import Path

from fastapi import Request
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from . import curation, datasets
from .catalog_input import read_object
from .config import BACKEND
from .data import BaselineError, sha256
from .split_preview import dataset_split_preview
from .store import dataset_references
from .users import current_user

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


def _visible(storage, version, username, registry):
    if version not in registry:
        raise BaselineError('NOT_FOUND', '数据集版本未登记')
    owners = _owners(storage, version)
    if owners and username not in owners:
        raise BaselineError('DATASET_FORBIDDEN', '该数据版本属于其他用户')
    return registry[version], owners


def _view(manifest, version, owners, username):
    file = manifest.get('file') or {}
    source = manifest.get('source') or manifest
    return {
        'version': version,
        'dataset': manifest.get('dataset'),
        'schema': manifest.get('schemaName'),
        'timeRange': manifest.get('timeRange'),
        'quality': manifest.get('quality'),
        'file': {'name': Path(file.get('path') or '').name, 'sha256': file.get('sha256'),
                 'bytes': file.get('bytes')},
        'source': {'publisher': source.get('publisher'), 'url': source.get('url'),
                   'revision': source.get('revision'), 'branch': source.get('branch'),
                   'head': source.get('head')},
        'labelRule': manifest.get('labelRule'),
        'limitations': manifest.get('limitations') or [],
        'mine': username in owners,
        'shared': not owners,
    }


def _csv_path(manifest):
    declared = Path((manifest.get('file') or {}).get('path') or '')
    return declared if declared.is_absolute() else BACKEND / declared


def _portable_manifest(manifest, version):
    portable = json.loads(json.dumps(manifest, ensure_ascii=False))
    file = portable.get('file') or {}
    if file.get('path'):
        file['path'] = Path(file['path']).name
    return portable


def install_user_routes(app, storage, dataset_root, training_service, catalog):
    root = Path(dataset_root) if dataset_root is not None else None

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
                'datasetCount': datasets, 'modelCount': models, 'experimentCount': experiments}

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
                     'kamei14-git-v2', 'kamei14-benchmark-v1'}

        def usable(version):
            manifest = registry.get(version)
            if manifest is None or manifest.get('schemaName') not in supported:
                return False
            csv = _csv_path(manifest)
            return csv.is_file()

        owned = [version for version in storage.user_datasets(username) if usable(version)]
        versions = list(owned)
        if scope != 'mine':
            latest = {}
            for version, manifest in registry.items():
                if version in versions or not usable(version):
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
            result.append(_view(manifest, version, _owners(storage, version), username))
        return {'datasets': result, 'limit': 5}

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
        return _view(manifest, version, owners, username)

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
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(Path(csv_path).name, blob)
            archive.writestr(manifest_name, portable_bytes)
            archive.writestr('SHA256SUMS',
                             f'{sha256(blob)}  {Path(csv_path).name}\n'
                             f'{sha256(portable_bytes)}  {manifest_name}\n')
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
            storage.add_dataset_owner(derived, username, limit=5)
        return result

    @app.post('/api/v1/user/training-experiments')
    async def user_create_experiment(request: Request):
        username = _user(request)
        payload = await read_object(request)
        registry = _registry(root)
        version = payload.get('datasetVersion')
        if not isinstance(version, str):
            raise BaselineError('INPUT_INVALID', '缺少数据集版本')
        _visible(storage, version, username, registry)
        result, created = await run_in_threadpool(
            training_service.create_experiment, payload, getattr(request.state, 'request_id', None),
            created_by=username, owner_user_id=username)
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
