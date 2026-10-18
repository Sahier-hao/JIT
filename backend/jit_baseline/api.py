"""Local historical replay plus authorized catalog and feature-input API."""
from pathlib import Path
import os

from fastapi import FastAPI, Request
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
               member_token=None, admin_token=None, sync_service=None, dataset_root=None):
    directory = Path(directory) if directory is not None else _supplied_directory()
    app = FastAPI(title="JIT 历史回放", docs_url=None, redoc_url=None, openapi_url=None)
    from .team_access import install_access
    from .catalog_schema import schema_info
    from .catalog import ModelCatalog
    from .catalog_storage import CatalogStorage, DEFAULT_DATABASE
    from .catalog_input import read_object, registration_input
    from .team_access import RequestError
    from starlette.concurrency import run_in_threadpool
    install_access(app, os.environ.get('JIT_MEMBER_TOKEN', '') if member_token is None else member_token,
                   os.environ.get('JIT_ADMIN_TOKEN', '') if admin_token is None else admin_token)
    database = database if database is not None else os.environ.get('JIT_CATALOG_DATABASE', DEFAULT_DATABASE)
    storage = CatalogStorage(database)
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
                                        channel='http-admin', request_id=request.state.request_id)
        request.state.business_ids = (result['model']['modelId'], result['model']['runId'], None)
        return JSONResponse(result, status_code=201 if result['created'] else 200)

    @app.get('/api/v1/models')
    def models(state: str | None = None):
        if state not in (None, 'ready', 'invalid'):
            raise RequestError('INPUT_INVALID', field='state')
        return {'models': catalog.models(state)}

    @app.get('/api/v1/feature-schemas/{version}')
    def feature_schema(version: str):
        return schema_info(version)

    @app.get('/api/v1/datasets')
    def dataset_versions_all():
        return {'datasets': store.dataset_list(registered)}

    @app.get('/api/v1/datasets/{name}/versions')
    def dataset_versions(name: str):
        view = store.version_view(registered, name)
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

    @app.get('/api/v1/repository-syncs/{sync_id}/commits')
    def sync_commits(sync_id: str, limit: int = 100, offset: int = 0, search: str | None = None,
                     start: str | None = None, end: str | None = None, sort: str = 'risk'):
        return sync_service.commits(sync_id, limit, offset, search=search, start=start,
                                    end=end, sort=sort)

    @app.get('/api/v1/repository-syncs/{sync_id}/commits/{commit_id}')
    def sync_commit(sync_id: str, commit_id: str):
        return sync_service.commit(sync_id, commit_id)
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
