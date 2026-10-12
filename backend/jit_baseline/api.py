"""One localhost product endpoint; training stays in the offline CLI."""
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .artifacts import DEFAULT_RUN, Snapshot
from .data import BaselineError


def create_app(directory: Path = DEFAULT_RUN):
    app = FastAPI(title="JIT 历史回放", docs_url=None, redoc_url=None, openapi_url=None)
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
