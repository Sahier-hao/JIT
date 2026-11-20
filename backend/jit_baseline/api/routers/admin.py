"""Admin-only HTTP routes.

Every route on this router declares ``require_admin`` as a router-level
dependency. The middleware no longer authenticates these paths from a
hard-coded prefix list; it only keeps Origin/CSRF and no-store headers.
"""
import os
from pathlib import Path

from fastapi import APIRouter, Depends, Request, Response
from starlette.concurrency import run_in_threadpool

from ...auth.dependencies import require_admin
from ...catalog_input import read_object
from ...core.api_errors import RequestError
from ...core.config import BACKEND
from ...errors import BaselineError
from ...ml import curation
from ...ml.split_preview import dataset_split_preview
from ...storage import store
from ..schemas.common import SharingResponse, SharingUpdate


def require_trainable_dataset(registry_root, dataset_version):
    """Shared data must be usable for the same split/training path shown to users."""
    try:
        preview = dataset_split_preview(registry_root, dataset_version)
    except BaselineError as exc:
        raise RequestError(exc.code) from exc
    if not preview.get('available'):
        raise RequestError('DATASET_NOT_TRAINABLE')
    return preview


def install_admin_routes(app, *, storage, registry_root, dataset_root, dataset_module,
                         multi_project_reports, evaluation_evidence):
    router = APIRouter(prefix='/api/admin', dependencies=[Depends(require_admin)])

    @router.get('/multi-project-reports')
    def list_multi_project_reports():
        return multi_project_reports.list()

    @router.get('/multi-project-reports/{report_id}')
    def get_multi_project_report(report_id: str):
        return multi_project_reports.get(report_id)

    @router.get('/evaluation-evidence')
    def list_evaluation_evidence():
        return evaluation_evidence.list()

    @router.get('/evaluation-evidence/{evidence_id}')
    def get_evaluation_evidence(evidence_id: str):
        return evaluation_evidence.get(evidence_id)

    @router.post('/curation/preview')
    async def curation_preview(request: Request):
        payload = await read_object(request)
        if not isinstance(payload, dict) or set(payload) - {'datasetVersion', 'recipe'}:
            raise RequestError('INPUT_INVALID')
        return await run_in_threadpool(curation.preview, payload.get('datasetVersion'),
                                       payload.get('recipe'), dataset_root)

    @router.post('/curation/derive')
    async def curation_derive(request: Request):
        payload = await read_object(request)
        if not isinstance(payload, dict) or set(payload) - {'datasetVersion', 'recipe'}:
            raise RequestError('INPUT_INVALID')
        return await run_in_threadpool(curation.derive, payload.get('datasetVersion'),
                                       payload.get('recipe'), dataset_root)

    @router.get('/curation/compare')
    def curation_compare(source: str, derived: str):
        return curation.compare(source, derived, dataset_root)

    @router.get('/curation/export')
    def curation_export(version: str):
        data = curation.export_bundle(version, dataset_root)
        return Response(content=data, media_type='application/zip',
                        headers={'Content-Disposition': f'attachment; filename="{version}.zip"'})

    @router.get('/datasets/prunable')
    def dataset_prunable(keep: int | None = None):
        registered = dataset_module.load_all(registry_root)
        retain = keep if keep is not None else int(os.environ.get('JIT_PR_DATASET_KEEP', '10'))
        rows = store.prunable_datasets(storage, registered, retain)
        return {'keep': retain,
                'versions': [{key: value for key, value in row.items() if key != 'manifest'}
                             for row in rows]}

    @router.post('/datasets/prune')
    async def dataset_prune(request: Request):
        payload = await read_object(request)
        versions = payload.get('versions') if isinstance(payload, dict) else None
        keep = payload.get('keep') if isinstance(payload, dict) else None
        if (not isinstance(versions, list) or not versions
                or any(not isinstance(version, str) or not version.strip() for version in versions)
                or keep is not None and (type(keep) is not int or keep < 0)):
            raise RequestError('INPUT_INVALID')
        registered = dataset_module.load_all(registry_root)
        retain = keep if keep is not None else int(os.environ.get('JIT_PR_DATASET_KEEP', '10'))
        eligible = {row['version']: row for row in store.prunable_datasets(
            storage, registered, retain)}
        deleted, skipped = [], []
        for version in dict.fromkeys(versions):
            row = eligible.get(version)
            if row is None:
                skipped.append({'version': version, 'reason': 'not_prunable'})
                continue
            result = await run_in_threadpool(store.delete_dataset_version, storage, row['manifest'])
            deleted.append(result)
        return {'deleted': deleted, 'skipped': skipped}

    @router.put('/datasets/{dataset_version}/sharing', response_model=SharingResponse)
    async def update_dataset_sharing(dataset_version: str, payload: SharingUpdate,
                                     admin: str = Depends(require_admin)):
        manifest = dataset_module.load_all(registry_root).get(dataset_version)
        if manifest is None:
            raise RequestError('NOT_FOUND')
        if payload.shared:
            await run_in_threadpool(require_trainable_dataset, registry_root, dataset_version)
        if payload.shared and storage.dataset(dataset_version) is None:
            manifest_path = Path(manifest['manifestPath'])
            if not manifest_path.is_absolute():
                manifest_path = BACKEND / manifest_path
            await run_in_threadpool(store.import_dataset, None, manifest_path, storage)
        storage.set_dataset_share(dataset_version, payload.shared, admin)
        return {'version': dataset_version, 'shared': payload.shared}

    @router.get('/datasets/{dataset_version}/split-preview')
    def dataset_split_preview_route(dataset_version: str, preset: str | None = None,
                                    maturityPolicy: str | None = None):
        return dataset_split_preview(registry_root, dataset_version, preset, maturityPolicy)

    app.include_router(router)
