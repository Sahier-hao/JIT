"""清洗预览、派生版本与前后对比；来源版本保持不变。"""
import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from jit_baseline import collect, curation, datasets
from jit_baseline.api import create_app
from jit_baseline.schemas import resolve
from test_catalog_api import settings  # noqa: F401
from test_artifacts import real_run  # noqa: F401
from label_fixtures import register_labeled


def _records():
    fields = resolve('kamei14-git-v2').in_model_names()
    base = dict(ns=1, nd=2, nf=3, entropy=0.5, la=10, ld=1, lt=100, fix=0,
                ndev=2, age=3, nuc=2, exp=4, rexp=1, sexp=2)
    return [{'id': f'{index:040x}', 'epoch': 1704067200 + index * 86400,
             'time': f'2024-01-0{index + 1}T00:00:00Z', 'label': index % 2,
             'metrics': {name: (1000 if index == 1 and name == 'la' else base[name]) for name in fields}}
            for index in range(4)]


def test_preview_derive_and_compare_keep_source_unchanged(tmp_path):
    root = tmp_path / 'datasets'
    source = tmp_path / 'source.csv'
    names = resolve('kamei14-git-v2').in_model_names()
    source.write_bytes(collect._csv_bytes(_records(), names))
    registered = datasets.register(source, schema='kamei14-git-v2', dataset='demo', root=root,
                                   cohort=collect.cohort('2024-01-01', '2024-01-10'))
    source_manifest = root / 'demo' / f"{registered['version']}.json"
    before = source_manifest.read_bytes()

    recipe = {'version': 1, 'rules': [{'id': 'max-value', 'field': 'la', 'value': 100}]}
    preview = curation.preview(registered['version'], recipe, root)
    assert preview['stats']['includedRows'] == 3
    assert preview['stats']['excluded'] == {'max-value': 1}
    assert preview['beforeStats']['includedRows'] == 4
    la = next(item for item in preview['featureComparison'] if item['field'] == 'la')
    assert la['before']['records'] == 4
    assert la['after']['records'] == 3
    assert la['before']['max'] == 1000
    assert sum(la['before']['bucketCounts']) == 4
    assert sum(la['after']['bucketCounts']) == 3

    derived = curation.derive(registered['version'], recipe, root)
    assert derived['dataset']['version'].startswith('demo-')
    assert source_manifest.read_bytes() == before
    derived_manifest = root / 'demo' / f"{derived['dataset']['version']}.json"
    assert derived_manifest.exists()

    compared = curation.compare(registered['version'], derived['dataset']['version'], root)
    assert compared['recipeSha256'] == preview['recipeSha256']
    assert compared['derived']['quality']['includedRows'] == 3
    decisions = root / 'demo' / f"{derived['dataset']['version']}.curation.jsonl"
    assert decisions.exists() and 'max-value' in decisions.read_text(encoding='utf-8')
    bundle = curation.export_bundle(derived['dataset']['version'], root)
    with zipfile.ZipFile(io.BytesIO(bundle)) as archive:
        assert f"{derived['dataset']['version']}.csv" in archive.namelist()
        assert 'SHA256SUMS' in archive.namelist()


def test_invalid_recipe_is_rejected(tmp_path):
    import pytest
    from jit_baseline.errors import BaselineError
    with pytest.raises(BaselineError) as error:
        curation.normalize({'version': 1, 'rules': [{'id': 'unknown'}]})
    assert error.value.code == 'INPUT_INVALID'


def test_v1_recipe_shape_remains_compatible():
    recipe = {'version': 1, 'rules': [
        {'id': 'drop-duplicates'},
        {'id': 'drop-missing', 'fields': ['la']},
        {'id': 'max-value', 'field': 'nf', 'value': 100},
    ]}
    assert curation.normalize(recipe) == recipe


def test_v2_preview_records_changes_after_each_step(tmp_path):
    root = tmp_path / 'datasets'
    source = tmp_path / 'source.csv'
    fields = resolve('kamei14-git-v2').in_model_names()
    records = [{
        'id': f'{index:040x}',
        'epoch': 1704067200 + index * 86400,
        'time': f'2024-01-{index + 1:02d}T00:00:00Z',
        'label': index % 2,
        'metrics': {
            'ns': 1, 'nd': 2, 'nf': 3, 'entropy': 0.5,
            'la': index + 1, 'ld': 1, 'lt': 100, 'fix': 0,
            'ndev': 2, 'age': 3, 'nuc': 2, 'exp': 4, 'rexp': 1, 'sexp': 2,
        },
    } for index in range(10)]
    source.write_bytes(collect._csv_bytes(records, fields))
    registered = datasets.register(
        source, schema='kamei14-git-v2', dataset='steps', root=root,
        cohort=collect.cohort('2024-01-01', '2024-01-31'),
    )
    recipe = {'version': 2, 'rules': [
        {'id': 'keep-date', 'start': '2024-01-03', 'end': '2024-01-09'},
        {'id': 'keep-range', 'field': 'la', 'min': 3, 'max': 7},
        {'id': 'quantile-range', 'field': 'la', 'lower': 0.1, 'upper': 0.9},
    ]}

    preview = curation.preview(registered['version'], recipe, root)

    assert [step['index'] for step in preview['steps']] == [1, 2, 3]
    assert [step['afterStats']['includedRows'] for step in preview['steps']] == [7, 5, 3]
    assert preview['steps'][0]['afterStats']['excluded'] == {'before-date': 2, 'after-date': 1}
    assert preview['steps'][1]['afterStats']['excluded'] == {'above-max': 2}
    assert preview['steps'][2]['afterStats']['excluded'] == {
        'below-quantile': 1, 'above-quantile': 1,
    }
    bounds = preview['steps'][2]['details']['la']
    assert 3 < bounds['min'] < 4
    assert 6 < bounds['max'] < 7
    la_step = next(item for item in preview['steps'][1]['featureComparison'] if item['field'] == 'la')
    assert la_step['before']['mean'] == 6
    assert la_step['after']['mean'] == 5
    assert la_step['before']['records'] == 7
    assert la_step['after']['records'] == 5

    derived = curation.derive(registered['version'], recipe, root)
    compared = curation.compare(registered['version'], derived['dataset']['version'], root)
    assert len(compared['decisions']['steps']) == 3
    assert compared['decisions']['steps'][2]['afterStats']['includedRows'] == 3


def test_v2_rejects_fields_outside_schema():
    import pytest
    from jit_baseline.errors import BaselineError
    with pytest.raises(BaselineError) as error:
        curation.normalize(
            {'version': 2, 'rules': [{'id': 'keep-range', 'field': 'missing', 'min': 0}]},
            'kamei14-git-v2',
        )
    assert error.value.code == 'INPUT_INVALID'


def test_curation_requires_admin(settings):  # noqa: F811
    app = create_app(**settings)
    with TestClient(app) as client:
        assert client.post('/api/admin/curation/preview', json={}).status_code == 401


def test_derived_version_can_train(tmp_path):
    import time
    from jit_baseline.catalog_storage import CatalogStorage
    from jit_baseline.training_tasks import TrainingTaskService
    root = tmp_path / 'datasets'
    source = tmp_path / 'source.csv'
    names = resolve('kamei14-git-v2').in_model_names()
    base = dict(ns=1, nd=2, nf=3, entropy=0.5, la=10, ld=1, lt=100, fix=0,
                ndev=2, age=3, nuc=2, exp=4, rexp=1, sexp=2)
    records = [{'id': f'{index:040x}', 'epoch': 1704067200 + index * 86400,
                'time': f'2024-{(index // 28) + 1:02d}-{(index % 28) + 1:02d}T00:00:00Z',
                'label': index % 2,
                'metrics': {name: (1000 if index == 1 and name == 'la' else base[name]) for name in names}}
               for index in range(300)]
    source.write_bytes(collect._csv_bytes(records, names))
    registered = register_labeled(source, records, schema='kamei14-git-v2',
                                  dataset='train-demo', root=root,
                                  cohort=collect.cohort('2024-01-01', '2024-12-31'))
    derived = curation.derive(registered['version'], {'version': 1, 'rules': [
        {'id': 'max-value', 'field': 'la', 'value': 100}]}, root)
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    service = TrainingTaskService(storage, dataset_root=root, artifact_root=tmp_path / 'artifacts', timeout=60)
    try:
        task, _ = service.create({'datasetVersion': derived['dataset']['version'],
                                  'method': 'logistic-regression-l2-v1',
                                  'metricSet': 'metric-set-v2'}, created_by='admin')
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            current = service.get(task['taskId'])
            if current['status'] in ('succeeded', 'failed', 'interrupted'):
                break
            time.sleep(0.05)
        assert current['status'] == 'succeeded', current
        assert current['datasetVersion'] == derived['dataset']['version']
    finally:
        service.close()
