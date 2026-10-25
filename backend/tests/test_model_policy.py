"""Model policy changes selection without rewriting models or past analyses."""
import shutil
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from jit_baseline.api import create_app
from jit_baseline.artifacts import build_run
from jit_baseline.catalog import ModelCatalog
from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.config import BACKEND
from jit_baseline.errors import BaselineError
from jit_baseline.sync import SyncService
from test_artifacts import real_run  # noqa: F401
from test_repository_sync import _small_repo, _wait


@pytest.fixture(scope='session')
def tree_run(tmp_path_factory):
    target = tmp_path_factory.mktemp('policy-tree') / 'run'
    build_run(BACKEND / 'data/openstack', target, algorithm='decision-tree-v1')
    return target


@pytest.fixture
def policy(tmp_path, real_run, tree_run):
    root = tmp_path / 'artifacts'
    shutil.copytree(real_run, root / 'baseline')
    shutil.copytree(tree_run, root / 'tree')
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    catalog = ModelCatalog(storage, root)
    first = catalog.register_key('baseline')['model']['modelId']
    second = catalog.register_key('tree')['model']['modelId']
    return catalog, first, second


def test_first_compatible_registration_bootstraps_default_and_reregistration_preserves_policy(policy):
    catalog, first, second = policy
    assert catalog.policy(first) == {'enabled': True, 'isDefault': True}
    catalog.update_policy(second, {'enabled': False})
    catalog.register_key('tree')
    assert catalog.policy(second) == {'enabled': False, 'isDefault': False}
    assert catalog.default_model_id() == first
    assert catalog.load_model(second)[1]['modelId'] == second  # history may still load


def test_verified_load_is_reused_but_tampering_still_fails(policy, monkeypatch):
    import joblib
    catalog, first, second = policy
    original = joblib.load
    loads = []
    def load(*args, **kwargs):
        loads.append(args[0])
        return original(*args, **kwargs)
    monkeypatch.setattr(joblib, 'load', load)
    catalog.load_model(first)
    catalog.load_model(first)
    assert len(loads) == 1
    catalog.update_policy(second, {'isDefault': True})
    catalog.update_policy(first, {'enabled': False})
    assert catalog.load_model(first)[1]['enabled'] is False
    (catalog.root / 'baseline/model.joblib').write_bytes(b'tampered')
    with pytest.raises(BaselineError) as error:
        catalog.load_model(first)
    assert error.value.code == 'INTEGRITY_ERROR'
    assert next(m for m in catalog.models() if m['modelId'] == first)['state'] == 'invalid'


def test_default_switch_is_atomic_and_cannot_be_disabled(policy):
    catalog, first, second = policy
    catalog.update_policy(second, {'isDefault': True})
    with pytest.raises(BaselineError) as error:
        catalog.update_policy(second, {'enabled': False})
    assert error.value.code == 'DEFAULT_MODEL_REQUIRED'
    assert catalog.policy(second) == {'enabled': True, 'isDefault': True}
    catalog.update_policy(first, {'enabled': False})
    assert catalog.default_model_id() == second


def test_concurrent_default_changes_leave_one_default(policy):
    catalog, first, second = policy
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda key: catalog.update_policy(key, {'isDefault': True}), [first, second]))
    assert sum(item['isDefault'] for item in catalog.models()) == 1


def test_model_list_uses_one_policy_snapshot_even_during_default_switch(policy, monkeypatch):
    catalog, first, second = policy
    first, second = sorted([first, second])
    catalog.update_policy(first, {'isDefault': True})
    original = catalog.load_model
    switched = False
    def load(key):
        nonlocal switched
        snapshot, payload = original(key)
        if not switched:
            switched = True
            catalog.update_policy(second, {'isDefault': True})
        return snapshot, payload
    monkeypatch.setattr(catalog, 'load_model', load)
    models = catalog.models()
    assert sum(model['isDefault'] for model in models) == 1
    assert next(model for model in models if model['isDefault'])['modelId'] == second


@pytest.mark.parametrize('body', [{}, {'enabled': 'false'}, {'isDefault': False},
                                  {'isDefault': True, 'enabled': False}, {'other': True}])
def test_policy_rejects_malformed_changes_without_mutation(policy, body):
    catalog, first, _ = policy
    with pytest.raises(BaselineError) as error:
        catalog.update_policy(first, body)
    assert error.value.code == 'INPUT_INVALID'
    assert catalog.policy(first) == {'enabled': True, 'isDefault': True}


def test_disabled_or_incompatible_model_cannot_become_default(policy):
    catalog, first, second = policy
    catalog.update_policy(second, {'enabled': False})
    with pytest.raises(BaselineError) as error:
        catalog.update_policy(second, {'isDefault': True})
    assert error.value.code == 'MODEL_DISABLED'
    # Enabling and setting default is one valid operation.
    catalog.update_policy(second, {'enabled': True, 'isDefault': True})
    assert catalog.default_model_id() == second
    with catalog.store.connection(write=True) as db:
        db.execute("UPDATE model_version SET state='invalid' WHERE id=?", (first,))
    with pytest.raises(BaselineError):
        catalog.update_policy(first, {'isDefault': True})
    assert catalog.default_model_id() == second


def test_policy_api_authorization_public_metadata_and_validation(policy, tmp_path):
    catalog, first, second = policy
    app = create_app(tmp_path / 'missing', database=catalog.store.path, artifact_root=catalog.root)
    with TestClient(app) as client:
        path = f'/api/v1/models/{second}/policy'
        assert client.patch(path, json={'enabled': False}).status_code == 401
        assert client.post('/api/admin/setup', json={'username': 'admin', 'password': 'model-policy-test-password'}).status_code == 201
        assert client.patch(path, json={'enabled': False}, headers={'Origin': 'https://other.example'}).status_code == 403
        response = client.patch(path, json={'enabled': False})
        assert response.status_code == 200, response.text
        assert response.json()['enabled'] is False
        malformed = client.patch(path, json={'enabled': 0})
        assert malformed.status_code == 422
        assert malformed.json()['error']['requestId']
        assert client.patch(f'/api/v1/models/{first}/policy', json={'enabled': False}).status_code == 409
        assert client.patch('/api/v1/models/missing/policy', json={'enabled': True}).status_code == 404
        client.post('/api/admin/logout')
        choices = client.get('/api/v1/repository-models').json()['models']
        assert next(m for m in choices if m['modelId'] == first)['isDefault'] is True
        disabled = next(m for m in choices if m['modelId'] == second)
        assert disabled['enabled'] is False and disabled['repositoryPredictionSupported'] is False
        assert 'trainingEnvironment' not in disabled


def test_model_policy_contract_matches_real_responses(policy, tmp_path):
    from test_openapi import document, jsonschema
    catalog, first, second = policy
    doc = document()
    from referencing import Registry
    from referencing.jsonschema import DRAFT202012
    registry = Registry().with_resource('urn:jit:openapi', DRAFT202012.create_resource(doc))
    def validate(name, payload):
        jsonschema.Draft202012Validator({'$ref': f'urn:jit:openapi#/components/schemas/{name}'}, registry=registry).validate(payload)
    app = create_app(tmp_path / 'missing', database=catalog.store.path, artifact_root=catalog.root)
    with TestClient(app) as client:
        client.post('/api/admin/setup', json={'username': 'admin', 'password': 'model-policy-test-password'})
        validate('ModelRegistration', catalog.register_key('baseline'))
        validate('ModelList', client.get('/api/v1/models').json())
        validate('ModelChoiceList', client.get('/api/v1/repository-models').json())
        validate('ModelPolicy', client.patch(f'/api/v1/models/{second}/policy', json={'enabled': False}).json())
        assert doc['paths']['/api/v1/models/{modelId}/policy']['patch']['security'] == [{'AdminSession': []}]


def test_upgrade_from_v7_preserves_models_and_history_and_sets_initial_default(policy, tmp_path):
    import sqlite3
    catalog, first, second = policy
    from jit_baseline.sync import SyncStorage
    SyncStorage(catalog.store).create({'id': 'historical', 'repository_url': 'https://example.com/a.git',
        'branch': 'HEAD', 'requested_strategy': 'generic-model', 'status': 'completed', 'stage': 'completed',
        'model_id': first, 'created_at': '2024-01-01', 'updated_at': '2024-01-01'})
    before_models = catalog.models()
    with sqlite3.connect(catalog.store.path) as db:
        db.execute('DROP TABLE model_policy')
        db.execute('DROP TABLE model_default')
        db.execute('ALTER TABLE repository_sync DROP COLUMN resolved_model_id')
        # Reconstruct a real v7 schema, including removal of later task-control columns.
        db.execute('DROP TABLE repository_explanation')
        for column in ('started_at', 'deadline_at', 'cancel_requested_at'):
            db.execute(f'ALTER TABLE repository_sync DROP COLUMN {column}')
        db.execute('UPDATE schema_migration SET version=7')
        before_rows = db.execute('SELECT * FROM model_version ORDER BY id').fetchall()
        before_events = db.execute('SELECT * FROM registration_event ORDER BY id').fetchall()
        db.execute("INSERT INTO admin_account VALUES ('keep-admin','salt','hash',1)")
    catalog.store.initialize()
    catalog.store.initialize()
    assert catalog.default_model_id() == min(first, second)
    assert len(catalog.models()) == len(before_models)
    with catalog.store.connection() as db:
        assert [tuple(row) for row in db.execute('SELECT * FROM model_version ORDER BY id')] == before_rows
        assert [tuple(row) for row in db.execute('SELECT * FROM registration_event ORDER BY id')] == before_events
        assert db.execute('SELECT username FROM admin_account').fetchone()[0] == 'keep-admin'
        assert db.execute("SELECT model_id,status FROM repository_sync WHERE id='historical'").fetchone()[:] == (first, 'completed')


def test_explicit_override_default_and_disabled_selection(policy, tmp_path):
    catalog, first, second = policy
    service = SyncService(catalog.store, catalog, dataset_root=tmp_path / 'datasets')
    try:
        catalog.update_policy(second, {'isDefault': True})
        assert service._generic_model()[1]['modelId'] == second
        assert service._generic_model(first)[1]['modelId'] == first
        catalog.update_policy(first, {'enabled': False})
        with pytest.raises(BaselineError) as error:
            service._generic_model(first)
        assert error.value.code == 'MODEL_DISABLED'
        (catalog.root / 'tree/model.joblib').unlink()
        with pytest.raises(BaselineError):
            service._generic_model()  # never falls back to a different model
    finally:
        service._executor.shutdown(wait=True)


def test_missing_default_does_not_bind_a_model_created_after_selection(policy, tmp_path, monkeypatch):
    catalog, first, _ = policy
    service = SyncService(catalog.store, catalog, dataset_root=tmp_path / 'datasets')
    defaults = iter([None, first])
    monkeypatch.setattr(catalog, 'default_model_id', lambda: next(defaults))
    monkeypatch.setattr(service._executor, 'submit', lambda *_: None)
    try:
        with pytest.raises(BaselineError) as error:
            service.create({'repositoryUrl': 'https://example.com/project.git', 'strategy': 'generic-model'})
        assert error.value.code == 'DEFAULT_MODEL_REQUIRED'
        assert service.pages()['total'] == 0
    finally:
        service._executor.shutdown(wait=True)


@pytest.mark.parametrize('strategy', ['generic-model', 'auto'])
def test_queued_default_is_pinned_and_disabled_model_keeps_completed_results(policy, tmp_path, strategy):
    catalog, first, second = policy
    service = SyncService(catalog.store, catalog, dataset_root=tmp_path / 'datasets',
                          artifact_root=catalog.root, allow_local=True)
    repo = _small_repo(tmp_path)
    payload = {'repositoryUrl': str(repo), 'since': '2024-01-01', 'until': '2025-01-01',
               'strategy': strategy}
    # Hold the single worker so policy changes happen deterministically before execution.
    from threading import Event
    release = Event()
    service._executor.submit(release.wait)
    try:
        queued, _ = service.create(payload)
        assert queued['resolvedModelId'] == first
        assert queued['requestedModelId'] is None
        catalog.update_policy(second, {'isDefault': True})
        newer, created = service.create(payload)
        assert created and newer['syncId'] != queued['syncId']
        assert newer['resolvedModelId'] == second
        release.set()
        done = _wait(service, queued['syncId'])
        assert done['status'] == 'completed', done
        assert done['modelId'] == first
        assert _wait(service, newer['syncId'])['modelId'] == second
        before = service.commits(done['syncId'])
        catalog.update_policy(first, {'enabled': False})
        assert service.commits(done['syncId']) == before
        assert service.get(done['syncId'])['modelId'] == first
        with pytest.raises(BaselineError) as error:
            service.create(dict(payload, modelId=first, strategy='generic-model'))
        assert error.value.code == 'MODEL_DISABLED'
    finally:
        release.set()
        service._executor.shutdown(wait=True)


def test_disabled_queued_model_fails_without_substitution(policy, tmp_path):
    catalog, first, second = policy
    service = SyncService(catalog.store, catalog, dataset_root=tmp_path / 'datasets',
                          artifact_root=catalog.root, allow_local=True)
    from threading import Event
    release = Event()
    service._executor.submit(release.wait)
    try:
        queued, _ = service.create({'repositoryUrl': str(_small_repo(tmp_path)),
                                    'since': '2024-01-01', 'until': '2025-01-01',
                                    'strategy': 'generic-model', 'modelId': first})
        catalog.update_policy(second, {'isDefault': True})
        catalog.update_policy(first, {'enabled': False})
        release.set()
        done = _wait(service, queued['syncId'])
        assert done['status'] == 'failed'
        assert done['error']['code'] == 'MODEL_DISABLED'
        assert done['modelId'] is None
    finally:
        release.set()
        service._executor.shutdown(wait=True)
