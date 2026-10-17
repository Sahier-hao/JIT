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
               member_token=None, admin_token=None):
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
    def commit_list(version: str, module: str | None = None):
        if storage.dataset(version) is None:
            raise RequestError('NOT_FOUND')
        records = (storage.commits_by_entity('module', module) if module
                   else storage.commits(version))
        return {'datasetVersion': version, 'commits': records}

    @app.get('/api/v1/commits/{commit_id}')
    def commit_detail(commit_id: str, version: str):
        record = store.commit_view(storage, version, commit_id)
        if record is None:
            raise RequestError('NOT_FOUND')
        return record
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
