"""Local project analysis, model catalog and historical verification API."""
from pathlib import Path
from contextlib import asynccontextmanager
import os

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from .artifacts import DEFAULT_RUN, Snapshot
from .data import BaselineError


def _supplied_directory():
    """所供给的运行目录：默认既有固定运行，可用 `JIT_RUN_DIR` 指向另一个已校验的运行。

    指定的目录与默认目录走**同一个**准入路径（`Snapshot.load`），因此未通过校验的
    目录只会得到明确的不可用状态，不会退回原运行冒充成功（PDB-08）。
    """
    configured = os.environ.get("JIT_RUN_DIR")
    return Path(configured) if configured else DEFAULT_RUN


def create_app(directory: Path | None = None, *, database=None, artifact_root=None,
               sync_service=None, dataset_root=None):
    directory = Path(directory) if directory is not None else _supplied_directory()
    owns_sync = sync_service is None

    @asynccontextmanager
    async def lifespan(app):
        app.state.updates.start()
        try:
            yield
        finally:
            from starlette.concurrency import run_in_threadpool
            await run_in_threadpool(app.state.updates.close)
            if owns_sync:
                await run_in_threadpool(app.state.sync.close)

    app = FastAPI(title="JIT 历史回放", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    @app.get('/api/health')
    def health():
        return {'status': 'ok'}
    from .api_errors import install_errors
    from .catalog_schema import schema_info
    from .catalog import ModelCatalog
    from .catalog_storage import CatalogStorage, DEFAULT_DATABASE
    from .catalog_input import read_object, registration_input
    from .api_errors import RequestError
    from starlette.concurrency import run_in_threadpool
    install_errors(app)
    database = database if database is not None else os.environ.get('JIT_CATALOG_DATABASE', DEFAULT_DATABASE)
    storage = CatalogStorage(database)
    from .admin import install_admin
    install_admin(app, storage)
    catalog = ModelCatalog(storage, artifact_root if artifact_root is not None else os.environ.get('JIT_ARTIFACT_ROOT'))
    app.state.catalog = catalog
    app.state.storage = storage
    from . import store
    from . import datasets as dataset_module
    # 描述文件是登记事实：缺失或校验失败即拒绝启动（DSR-06），不退回空目录。
    registered = dataset_module.load_all()
    app.state.datasets = registered
    from .prediction import PredictionService
    prediction_service = PredictionService(catalog)
    from .sync import SyncService
    if sync_service is None:
        # 本地仓库只用于验收与测试；默认只接受公开 HTTP(S) 地址。
        allow_local = os.environ.get('JIT_SYNC_ALLOW_LOCAL') == '1'
        dataset_root = dataset_root if dataset_root is not None else os.environ.get('JIT_DATASET_ROOT')
        sync_service = SyncService(storage, catalog, artifact_root=catalog.root,
                                   dataset_root=dataset_root, allow_local=allow_local)
    sync_service.recover()
    app.state.sync = sync_service
    from .repository_updates import RepositoryUpdates
    updates = RepositoryUpdates(sync_service)
    app.state.updates = updates
    from .pr_review import PullRequestReview
    pr_review = PullRequestReview(sync_service)
    app.state.pr_review = pr_review

    @app.post('/api/v1/review-sources')
    async def review_source(request: Request):
        return await run_in_threadpool(pr_review.intake, await read_object(request))

    @app.post('/api/v1/pr-sources/{owner}/{name}/{number}/refresh')
    def refresh_pull_request(owner: str, name: str, number: int):
        return pr_review.refresh(owner, name, number)

    @app.get('/api/v1/pr-snapshots/{snapshot_id}')
    def pull_request_snapshot(snapshot_id: str):
        return pr_review.get(snapshot_id)

    @app.get('/api/v1/pr-snapshots/{snapshot_id}/context')
    def pull_request_context(snapshot_id: str, path: str, side: str = 'head'):
        return pr_review.context(snapshot_id, path, side)

    @app.get('/api/v1/pr-snapshots/{snapshot_id}/analyses')
    def pull_request_analyses(snapshot_id: str):
        return pr_review.analyses(snapshot_id)

    @app.post('/api/v1/pr-snapshots/{snapshot_id}/analyses')
    async def analyze_pull_request(snapshot_id: str, request: Request):
        return await run_in_threadpool(pr_review.analyze, snapshot_id, await read_object(request))
    from .repository_explanation import RepositoryExplanationService
    explanation_service = RepositoryExplanationService(sync_service, catalog)
    from .review_plan import ReviewPlanService, read_plan
    review_plan_service = ReviewPlanService(sync_service)
    from .analysis_comparison import AnalysisComparisonService
    comparison_service = AnalysisComparisonService(sync_service)
    from fastapi.exceptions import RequestValidationError

    @app.exception_handler(RequestValidationError)
    def invalid_request(request: Request, exc: RequestValidationError):
        """查询参数类型或范围不合法时也保持 `{"error": {...}}` 结构（API-R-02）。"""
        return JSONResponse({'error': {'code': 'INPUT_INVALID', 'message': '请求格式或字段值无效',
                                       'requestId': getattr(request.state, 'request_id', None)}},
                            status_code=422)

    @app.post('/api/v1/predictions')
    async def create_prediction(request: Request):
        result = await run_in_threadpool(prediction_service.create, await read_object(request))
        request.state.business_ids = (result['model']['modelId'], result['runId'], result['batchId'])
        return JSONResponse(result, status_code=201)

    @app.get('/api/v1/prediction-batches/{batch_id}')
    def prediction_batch(batch_id: str, request: Request):
        result = prediction_service.get(batch_id)
        request.state.business_ids = (result['model']['modelId'], result['runId'], result['batchId'])
        return result

    @app.get('/api/v1/model-candidates')
    def model_candidates():
        return {'candidates': catalog.candidates()}

    @app.post('/api/v1/models/register')
    async def register_model(request: Request):
        data = registration_input(await read_object(request))
        result = await run_in_threadpool(catalog.register, data['candidateId'], data['expectedManifestSha256'],
                                        channel='http-local', request_id=request.state.request_id)
        request.state.business_ids = (result['model']['modelId'], result['model']['runId'], None)
        return JSONResponse(result, status_code=201 if result['created'] else 200)

    @app.get('/api/v1/models')
    def models(state: str | None = None):
        if state not in (None, 'ready', 'invalid'):
            raise RequestError('INPUT_INVALID', field='state')
        from .algorithms import ALGORITHMS
        registered_models = catalog.models()
        candidates = catalog.candidates()
        methods = [dict(method=key, name=value['name'], category=value['category'],
                        registeredModels=sum(model['method'] == key and model['state'] == 'ready'
                                             for model in registered_models),
                        deliveredArtifacts=sum(candidate.get('method') == key for candidate in candidates))
                   for key, value in ALGORITHMS.items()]
        return {'models': [model for model in registered_models if state is None or model['state'] == state],
                'methods': methods}

    @app.get('/api/v1/repository-models')
    def repository_models():
        # Public selection metadata only: no training evidence, paths or verification reports.
        return {'models': [dict(modelId=item['modelId'], name=item['name'], method=item['method'],
                                featureSchemaVersion=item['featureSchemaVersion'], state=item['state'],
                                enabled=item['enabled'], isDefault=item['isDefault'],
                                repositoryPredictionSupported=item['enabled'] and item['state'] == 'ready' and item['featureSchemaVersion'] in
                                ('openstack-six-v1', 'kamei14-git-v1')) for item in catalog.models()]}

    @app.patch('/api/v1/models/{model_id}/policy')
    async def model_policy(model_id: str, request: Request):
        return await run_in_threadpool(catalog.update_policy, model_id, await read_object(request))

    @app.get('/api/v1/feature-schemas/{version}')
    def feature_schema(version: str):
        return schema_info(version)

    @app.get('/api/v1/datasets')
    def dataset_versions_all():
        return {'datasets': store.dataset_list(dataset_module.load_all())}

    @app.get('/api/v1/datasets/{name}/versions')
    def dataset_versions(name: str):
        view = store.version_view(dataset_module.load_all(), name)
        if view is None:
            raise RequestError('NOT_FOUND')
        return view

    @app.get('/api/v1/commits')
    def commit_list(version: str, module: str | None = None, limit: int = 100, offset: int = 0):
        if storage.dataset(version) is None:
            raise RequestError('NOT_FOUND')
        if not 1 <= limit <= 500:
            raise RequestError('INPUT_INVALID', field='limit')
        if offset < 0:
            raise RequestError('INPUT_INVALID', field='offset')
        if module:
            total = storage.count_by_entity('module', module)
            records = storage.commits_by_entity('module', module, limit, offset, summary=True)
        else:
            total = storage.count_commits(version)
            records = storage.commits(version, limit, offset, summary=True)
        return {'datasetVersion': version, 'total': total, 'limit': limit, 'offset': offset,
                'commits': records}

    @app.get('/api/v1/commits/{commit_id}')
    def commit_detail(commit_id: str, version: str):
        record = store.commit_view(storage, version, commit_id)
        if record is None:
            raise RequestError('NOT_FOUND')
        return record

    @app.post('/api/v1/repository-syncs')
    async def create_sync(request: Request):
        result, created = await run_in_threadpool(sync_service.create, await read_object(request),
                                                  request.state.request_id)
        request.state.business_ids = (result.get('modelId'), result.get('runId'), None)
        return JSONResponse(result, status_code=202 if created else 200)

    @app.get('/api/v1/repository-syncs')
    def sync_list(limit: int = 20, offset: int = 0):
        return sync_service.pages(limit, offset)

    @app.get('/api/v1/repository-syncs/{sync_id}')
    def sync_detail(sync_id: str):
        return sync_service.get(sync_id)

    @app.delete('/api/v1/repository-syncs/{sync_id}')
    def sync_delete(sync_id: str):
        sync_service.delete_sync(sync_id)
        return Response(status_code=204)

    @app.post('/api/v1/repository-syncs/{sync_id}/cancel')
    def sync_cancel(sync_id: str):
        result = sync_service.cancel(sync_id)
        return JSONResponse(result, status_code=200 if result['status'] == 'cancelled' else 202)

    @app.get('/api/v1/repository-syncs/{sync_id}/commits')
    def sync_commits(sync_id: str, limit: int = 100, offset: int = 0, search: str | None = None,
                     start: str | None = None, end: str | None = None, sort: str = 'risk'):
        return sync_service.commits(sync_id, limit, offset, search=search, start=start,
                                    end=end, sort=sort)

    @app.get('/api/v1/repository-syncs/{sync_id}/commits/{commit_id}')
    def sync_commit(sync_id: str, commit_id: str):
        return sync_service.commit(sync_id, commit_id)

    @app.get('/api/v1/repositories')
    def repository_list(limit: int = 50, offset: int = 0):
        return sync_service.repositories(limit, offset)

    @app.post('/api/v1/repositories')
    async def repository_create(request: Request):
        payload = await read_object(request)
        if 'autoUpdate' in payload and not isinstance(payload['autoUpdate'], bool):
            raise RequestError('INPUT_INVALID', field='autoUpdate')
        result, created = await run_in_threadpool(sync_service.create_repository,
                                                  payload)
        if created and payload.get('autoUpdate', True):
            await run_in_threadpool(updates.enroll, result['repositoryId'])
        return JSONResponse(result, status_code=201 if created else 200)

    @app.get('/api/v1/repositories/{repository_id}/updates')
    def repository_updates(repository_id: str):
        return updates.get(repository_id)

    @app.patch('/api/v1/repositories/{repository_id}/updates')
    async def configure_repository_updates(repository_id: str, request: Request):
        return await run_in_threadpool(updates.configure, repository_id, await read_object(request))

    @app.post('/api/v1/repositories/{repository_id}/refresh')
    def refresh_repository(repository_id: str):
        return JSONResponse(updates.request(repository_id), status_code=202)

    @app.patch('/api/v1/repositories/{repository_id}')
    async def repository_update(repository_id: str, request: Request):
        payload = await read_object(request)
        if isinstance(payload, dict) and "viewSyncId" in payload:
            return await run_in_threadpool(sync_service.select_view, repository_id, payload)
        return await run_in_threadpool(sync_service.rename_repository, repository_id, payload)

    @app.delete('/api/v1/repositories/{repository_id}')
    def repository_delete(repository_id: str):
        sync_service.delete_repository(repository_id)
        return Response(status_code=204)

    @app.get('/api/v1/repositories/{repository_id}/syncs')
    def repository_syncs(repository_id: str, limit: int = 20, offset: int = 0):
        return sync_service.repository_syncs(repository_id, limit, offset)

    @app.get('/api/v1/repositories/{repository_id}')
    def repository_detail(repository_id: str, viewSyncId: str | None = None):
        return sync_service.repository(repository_id, view_sync_id=viewSyncId)

    @app.get('/api/v1/repositories/{repository_id}/commits')
    def repository_commits(repository_id: str, limit: int = 50, offset: int = 0,
                           search: str | None = None, start: str | None = None,
                           end: str | None = None, sort: str = 'risk', viewSyncId: str | None = None):
        return sync_service.repository_commits(repository_id, limit, offset, search=search,
                                               start=start, end=end, sort=sort, view_sync_id=viewSyncId)

    @app.get('/api/v1/repositories/{repository_id}/commits/{commit_id}')
    def repository_commit(repository_id: str, commit_id: str, viewSyncId: str | None = None):
        return sync_service.repository_commit(repository_id, commit_id, view_sync_id=viewSyncId)

    @app.get('/api/v1/repositories/{repository_id}/commits/{commit_id}/explanation')
    def repository_explanation(repository_id: str, commit_id: str, viewSyncId: str):
        return explanation_service.get(repository_id, commit_id, viewSyncId)

    @app.post('/api/v1/repositories/{repository_id}/commits/{commit_id}/explanation')
    def generate_repository_explanation(repository_id: str, commit_id: str, viewSyncId: str):
        return explanation_service.generate(repository_id, commit_id, viewSyncId)

    @app.post('/api/v1/repositories/{repository_id}/review-plan/validate')
    async def validate_review_plan(repository_id: str, request: Request, viewSyncId: str):
        return await run_in_threadpool(review_plan_service.validate, repository_id, viewSyncId, await read_plan(request))

    @app.get('/api/v1/repositories/{repository_id}/comparison')
    def compare_repository_analyses(repository_id: str, baseSyncId: str, targetSyncId: str,
                                   limit: int = 20, offset: int = 0, change: str = 'all'):
        return comparison_service.get(repository_id, baseSyncId, targetSyncId, limit=limit, offset=offset, change=change)

    @app.get('/api/v1/repositories/{repository_id}/summary')
    def repository_summary(repository_id: str, viewSyncId: str | None = None):
        return sync_service.repository_summary(repository_id, view_sync_id=viewSyncId)
    app.state.snapshot, app.state.error = None, None
    try:
        app.state.snapshot = Snapshot.load(directory)
    except BaselineError as exc:
        app.state.error = {"code": exc.code, "message": str(exc)}
    except Exception:
        app.state.error = {"code": "ARTIFACT_INVALID", "message": "运行产物无效，请核验后重启服务"}

    @app.get("/api/review-batch")
    def review_batch():
        if app.state.snapshot is None:
            return JSONResponse({"error": app.state.error}, status_code=503)
        try:
            return JSONResponse(app.state.snapshot.batch(), headers={"Cache-Control": "no-store"})
        except Exception:
            return JSONResponse({"error": {"code": "INFERENCE_ERROR", "message": "模型推理失败，请核验产物并重启服务后重试"}}, status_code=500)
    return app


app = create_app()
