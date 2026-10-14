import json
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from jit_baseline.errors import BaselineError
from test_artifacts import real_run, rewrite_manifest, _resync  # noqa: F401


@pytest.fixture
def catalog(tmp_path, real_run):
    from types import SimpleNamespace
    from jit_baseline.catalog_storage import CatalogStorage
    root = tmp_path / 'artifacts'
    root.mkdir()
    shutil.copytree(real_run, root / 'baseline')
    shutil.copytree(real_run, root / 'development')
    store = CatalogStorage(tmp_path / 'catalog.sqlite3')
    store.initialize()
    return SimpleNamespace(store=store, root=root)


def service(fixture):
    from jit_baseline.catalog import ModelCatalog
    return ModelCatalog(fixture.store, fixture.root)


def register(catalog, key='baseline'):
    candidate = next(c for c in catalog.candidates() if c['displayName'] == key)
    return catalog.register(candidate['candidateId'], candidate['manifestSha256'])


def test_candidates_do_not_load_models_or_include_development(catalog, monkeypatch):
    catalog = service(catalog)
    monkeypatch.setattr('joblib.load', lambda *_: pytest.fail('Discovery must not deserialize'))
    candidates = catalog.candidates()
    assert [c['displayName'] for c in candidates] == ['baseline']
    assert candidates[0]['state'] == 'candidate'
    assert catalog.models() == []


def test_bad_manifest_is_diagnostic_and_paths_are_confined(catalog):
    catalog = service(catalog)
    bad = catalog.root / 'bad'
    bad.mkdir()
    (bad / 'manifest.json').write_text('broken', encoding='utf-8')
    candidates = catalog.candidates()
    assert next(c for c in candidates if c['displayName'] == 'bad')['state'] == 'invalid'
    for key in ('../outside', str(catalog.root / 'baseline'), 'development', 'external/../baseline'):
        with pytest.raises(BaselineError):
            catalog.register_key(key)


def test_repeated_and_concurrent_registration_share_identity(catalog):
    catalog = service(catalog)
    before = {p.name: p.read_bytes() for p in (catalog.root / 'baseline').iterdir()}
    first = register(catalog)
    assert first['created'] is True
    assert first['model']['jsonPredictionSupported'] is True
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: register(catalog), range(2)))
    assert {r['model']['modelId'] for r in results} == {first['model']['modelId']}
    assert all(r['created'] is False for r in results)
    assert before == {p.name: p.read_bytes() for p in (catalog.root / 'baseline').iterdir()}
    with catalog.store.connection() as db:
        assert db.execute('SELECT count(*) FROM model_version').fetchone()[0] == 1
        assert db.execute('SELECT count(*) FROM registration_event').fetchone()[0] == 3


def test_reproduction_metadata_differs_without_new_model(catalog):
    catalog = service(catalog)
    first = register(catalog)
    other = catalog.root / 'reproduction'
    shutil.copytree(catalog.root / 'baseline', other)
    summary = json.loads((other / 'summary.json').read_text(encoding='utf-8'))
    summary['trainingSeconds'] = 456.0
    (other / 'summary.json').write_text(json.dumps(summary), encoding='utf-8')
    _resync(other, ('summary.json',))
    manifest = json.loads((other / 'manifest.json').read_text(encoding='utf-8'))
    manifest['generatedAt'] = '2020-01-01T00:00:00Z'
    (other / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    second = register(catalog, 'reproduction')
    assert second['model']['modelId'] == first['model']['modelId']
    with catalog.store.connection() as db:
        assert db.execute('SELECT count(*) FROM run_location').fetchone()[0] == 2


@pytest.mark.parametrize('bad', ['missing', 'hash', 'method', 'reference', 'metric', 'shape'])
def test_rejected_artifacts_leave_only_failed_event(catalog, bad):
    catalog = service(catalog)
    directory = catalog.root / 'baseline'
    if bad == 'missing':
        (directory / 'model.joblib').unlink()
    elif bad == 'hash':
        (directory / 'model.joblib').write_bytes(b'broken')
    elif bad == 'method':
        rewrite_manifest(directory, lambda c: c.__setitem__('algorithmVersion', 'unknown-v1'))
    elif bad == 'reference':
        from test_artifacts import _perturb_reference
        _perturb_reference(directory, .1)
    elif bad == 'metric':
        metrics = json.loads((directory / 'metrics.json').read_text(encoding='utf-8'))
        metrics['rocAuc']['value'] = .123
        (directory / 'metrics.json').write_text(json.dumps(metrics), encoding='utf-8')
        _resync(directory, ('metrics.json',))
    else:
        (directory / 'model.joblib').write_bytes(b'broken-but-hashed')
        _resync(directory, ('model.joblib',))
    with pytest.raises(BaselineError):
        register(catalog)
    with catalog.store.connection() as db:
        assert db.execute('SELECT count(*) FROM model_version').fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM registration_event WHERE result='failed'").fetchone()[0] == 1


def test_candidate_change_is_conflict_and_model_recovery_is_explicit(catalog):
    catalog = service(catalog)
    candidate = catalog.candidates()[0]
    path = catalog.root / 'baseline/manifest.json'
    original = path.read_bytes()
    path.write_bytes(original + b' ')
    with pytest.raises(BaselineError) as error:
        catalog.register(candidate['candidateId'], candidate['manifestSha256'])
    assert error.value.code == 'CONTEXT_MISMATCH'
    path.write_bytes(original)
    model = register(catalog)['model']
    model_path = catalog.root / 'baseline/model.joblib'
    saved = model_path.read_bytes()
    model_path.unlink()
    assert catalog.models()[0]['state'] == 'invalid'
    model_path.write_bytes(saved)
    assert catalog.models()[0]['state'] == 'invalid'
    with pytest.raises(BaselineError):
        catalog.load_model(model['modelId'])
    assert register(catalog)['model']['modelId'] == model['modelId']
    assert catalog.models()[0]['state'] == 'ready'


def test_first_registration_race_and_same_model_distinct_runs(catalog):
    catalog = service(catalog)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: register(catalog), range(2)))
    assert sum(r['created'] for r in results) == 1
    other = catalog.root / 'distinct-run'
    shutil.copytree(catalog.root / 'baseline', other)
    rewrite_manifest(other, lambda c: c['sourceCode'].__setitem__('config.py', '1' * 64))
    second = register(catalog, 'distinct-run')['model']
    assert second['sha256'] == results[0]['model']['sha256']
    assert second['modelId'] != results[0]['model']['modelId']


def test_kamei_catalog_retains_twelve_fields_without_json_capability(catalog):
    catalog = service(catalog)
    from jit_baseline.artifacts import build_run
    from jit_baseline.config import BACKEND
    build_run(BACKEND / 'data/openstack', catalog.root / 'kamei', 'kamei14-v1')
    model = register(catalog, 'kamei')['model']
    assert len(model['featureSchema']['inModel']) == 12
    assert model['jsonPredictionSupported'] is False
    assert len(model['featureSchema']['limitations']) == 2


def test_junction_and_individual_file_escape_rejected(catalog, tmp_path):
    import subprocess
    catalog = service(catalog)
    outside = tmp_path / 'outside'
    shutil.copytree(catalog.root / 'baseline', outside)
    link = catalog.root / 'escape'
    result = subprocess.run(['cmd', '/c', 'mklink', '/J', str(link), str(outside)], capture_output=True)
    assert result.returncode == 0
    assert 'escape' not in {c['displayName'] for c in catalog.candidates()}
    with pytest.raises(BaselineError):
        catalog.register_key('escape')
    file = catalog.root / 'baseline/model.joblib'
    with pytest.raises(BaselineError):
        catalog._file(outside, 'model.joblib')
    hidden = catalog.root / 'external/.cache'
    shutil.copytree(outside, hidden)
    assert 'external/.cache' not in {c['displayName'] for c in catalog.candidates()}
