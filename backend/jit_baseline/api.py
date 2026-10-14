"""Local historical replay plus authorized catalog and feature-input API."""
from pathlib import Path
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .artifacts import DEFAULT_RUN, Snapshot
from .data import BaselineError


def create_app(directory: Path = DEFAULT_RUN, *, database=None, artifact_root=None,
               member_token=None, admin_token=None):
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
    catalog = ModelCatalog(CatalogStorage(database if database is not None else
                           os.environ.get('JIT_CATALOG_DATABASE', DEFAULT_DATABASE)),
                           artifact_root if artifact_root is not None else os.environ.get('JIT_ARTIFACT_ROOT'))
    app.state.catalog = catalog
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
