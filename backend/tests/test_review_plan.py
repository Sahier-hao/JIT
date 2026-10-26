"""Portable plans are all-or-nothing references to one saved successful analysis."""
import copy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from jit_baseline.api import create_app
from jit_baseline.catalog import ModelCatalog
from jit_baseline.catalog_storage import CatalogStorage, utc_now
from jit_baseline.sync import SyncService


@pytest.fixture
def plan_context(tmp_path):
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    root = tmp_path / 'artifacts'
    service = SyncService(storage, ModelCatalog(storage, root), artifact_root=root, dataset_root=tmp_path / 'datasets')
    repo, _ = service.create_repository({'repositoryUrl': 'https://github.com/example/plans'})
    sync_id = str(uuid4())
    service.sync.create(dict(id=sync_id, repository_url=repo['url'], repository_id=repo['repositoryId'],
        branch='main', requested_strategy='generic-model', status='scoring', stage='scoring',
        created_at=utc_now(), updated_at=utc_now()))
    # Historical references; plan validation must not require loading these artifacts.
    model_id, run_id = str(uuid4()), str(uuid4())
    service.sync.complete(sync_id, repo['repositoryId'], [dict(id=f'{i:040x}', epoch=1700000000,
        risk=.2, addedLines=1, deletedLines=2, files=1, features={}, label=0) for i in range(26)],
        head_commit='a'*40, dataset_version='plan-data', model_id=model_id, run_id=run_id)
    manifest = dict(format='jit-review-plan-v1', source=dict(repositoryId=repo['repositoryId'],
        viewSyncId=sync_id, datasetVersion='plan-data', modelId=model_id, runId=run_id),
        commitIds=[f'{25:040x}', f'{1:040x}'])
    path = f"/api/v1/repositories/{repo['repositoryId']}/review-plan/validate"
    app = create_app(database=storage.path, artifact_root=root, sync_service=service)
    with TestClient(app) as client:
        yield client, service, path, {'viewSyncId': sync_id}, manifest
    service.close()


def test_validation_is_public_pinned_ordered_and_does_not_load_models(plan_context, monkeypatch):
    client, service, path, params, manifest = plan_context
    monkeypatch.setattr(service.catalog, 'load_model', lambda *_: pytest.fail('no inference during plan validation'))
    before = service.repository(manifest['source']['repositoryId'], view_sync_id=params['viewSyncId'])
    result = client.post(path, params=params, json=manifest)
    assert result.status_code == 200, result.text
    assert result.json() == manifest  # Includes a commit beyond the first review page, in the selected order.
    assert service.repository(manifest['source']['repositoryId'], view_sync_id=params['viewSyncId']) == before
    assert result.headers['Cache-Control'] == 'no-store'


@pytest.mark.parametrize('field', ['repositoryId', 'viewSyncId', 'datasetVersion', 'modelId', 'runId'])
def test_context_mismatch_never_transfers_selection(plan_context, field):
    client, _, path, params, original = plan_context
    manifest = copy.deepcopy(original)
    manifest['source'][field] = 'different'
    response = client.post(path, params=params, json=manifest)
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'REVIEW_PLAN_CONTEXT_MISMATCH'
    assert response.json()['error']['requestId']


def test_unknown_commit_rejects_entire_plan_and_deleted_analysis_cannot_be_restored(plan_context):
    client, service, path, params, manifest = plan_context
    invalid = dict(manifest, commitIds=manifest['commitIds']+['f'*40])
    response = client.post(path, params=params, json=invalid)
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'REVIEW_PLAN_COMMIT_UNKNOWN'
    assert 'commitIds' not in response.json()
    service.delete_sync(params['viewSyncId'])
    assert client.post(path, params=params, json=manifest).status_code == 404


@pytest.mark.parametrize('patch', [dict(format='other'), dict(commitIds=['x','x']), dict(commitIds=[True]),
    dict(commitIds='not-a-list'), dict(source={}), dict(extra='untrusted'), dict(commitIds=['x']*5001)])
def test_malformed_plan_is_rejected_with_public_error(plan_context, patch):
    client, _, path, params, manifest = plan_context
    response = client.post(path, params=params, json=dict(manifest, **patch))
    assert response.status_code in (413, 422)
    assert response.json()['error']['requestId']


def test_missing_pin_incomplete_analysis_and_bounded_stream(plan_context):
    client, service, path, params, manifest = plan_context
    assert client.post(path, json=manifest).status_code == 422
    response = client.post(path, params=params, content=b' '* (1024*1024+1))
    assert response.status_code == 413 and response.json()['error']['code'] == 'REVIEW_PLAN_LIMIT_EXCEEDED'
    with service.sync.storage.connection(write=True) as db:
        db.execute("UPDATE repository_sync SET status='scoring' WHERE id=?", (params['viewSyncId'],))
    assert client.post(path, params=params, json=manifest).status_code == 409


def test_empty_plan_with_legacy_nullable_model_context_is_accepted(plan_context):
    client, service, path, params, manifest = plan_context
    with service.sync.storage.connection(write=True) as db:
        db.execute('UPDATE repository_sync SET model_id=NULL,run_id=NULL,dataset_version=NULL WHERE id=?', (params['viewSyncId'],))
    manifest['source'].update(modelId=None, runId=None, datasetVersion=None)
    manifest['commitIds'] = []
    assert client.post(path, params=params, json=manifest).json() == manifest


def test_plan_matches_documented_contract(plan_context):
    from pathlib import Path
    yaml = pytest.importorskip('yaml')
    jsonschema = pytest.importorskip('jsonschema')
    document = yaml.safe_load((Path(__file__).resolve().parents[2] / 'docs/api/openapi.yaml').read_text(encoding='utf-8'))
    endpoint = document['paths']['/api/v1/repositories/{repositoryId}/review-plan/validate']['post']
    assert endpoint['security'] == []
    assert any(p['name']=='viewSyncId' and p['required'] for p in endpoint['parameters'])
    client, _, path, params, manifest = plan_context
    schema = {'$ref': '#/components/schemas/PortableReviewPlan', 'components': document['components']}
    jsonschema.Draft202012Validator(schema).validate(client.post(path, params=params, json=manifest).json())
