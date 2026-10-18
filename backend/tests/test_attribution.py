import json

import pytest


def test_explain_orders_by_absolute_contribution():
    from jit_baseline import attribution

    def predict(vector):
        return 0.01 * vector[0] + 0.05 * vector[1] + 0.09 * vector[2]

    result = attribution.explain(predict, [1, 2, 3], {'ns': 0, 'nd': 0, 'ent': 0}, ['ns', 'nd', 'ent'])
    assert result['method'] == attribution.METHOD
    assert [item['feature'] for item in result['items']] == ['ent', 'nd', 'ns']
    assert [item['delta'] for item in result['items']] == [0.27, 0.1, 0.01]
    assert all(item['direction'] == 'increases' for item in result['items'])
    assert 'ent' in result['summary']


def test_zero_contribution_is_not_listed_and_not_padded():
    from jit_baseline import attribution

    def predict(vector):
        return 0.5 * vector[0]

    result = attribution.explain(predict, [1, 7], {'a': 0, 'b': 0}, ['a', 'b'])
    assert [item['feature'] for item in result['items']] == ['a']
    assert '没有单个特征' not in result['summary']
    empty = attribution.explain(predict, [0, 7], {'a': 0, 'b': 0}, ['a', 'b'])
    assert empty['items'] == []
    assert '没有单个特征' in empty['summary']


def test_direction_follows_the_sign_of_the_delta():
    from jit_baseline import attribution

    def predict(vector):
        return 0.5 + 0.1 * vector[0] - 0.05 * vector[1]

    result = attribution.explain(predict, [1, 2], {'a': 0, 'b': 0}, ['a', 'b'])
    by_feature = {item['feature']: item for item in result['items']}
    assert by_feature['a']['delta'] > 0 and by_feature['a']['direction'] == 'increases'
    assert by_feature['b']['delta'] < 0 and by_feature['b']['direction'] == 'decreases'


def test_top_k_limits_items():
    from jit_baseline import attribution

    def predict(vector):
        return 0.01 * sum(vector)

    names = ['f1', 'f2', 'f3', 'f4', 'f5']
    result = attribution.explain(predict, [1, 2, 3, 4, 5], {}, names, top_k=2)
    assert [item['feature'] for item in result['items']] == ['f5', 'f4']


def test_invalid_inference_is_rejected():
    from jit_baseline import attribution

    with pytest.raises(ValueError):
        attribution.explain(lambda vector: 1.5, [1], {}, ['a'])
    with pytest.raises(ValueError):
        attribution.explain(lambda vector: float('nan'), [1], {}, ['a'])
    with pytest.raises(ValueError):
        attribution.explain(lambda vector: 0.1, [1, 2], {}, ['a'])


class _Storage:
    def __init__(self, means):
        self.means = means

    def feature_means(self, version, fields):
        return {name: value for name, value in self.means.items() if name in fields}


def test_feature_baseline_keeps_only_available_fields():
    from jit_baseline import attribution

    baseline = attribution.feature_baseline(_Storage({'ns': 1.5, 'nd': 2.0}), 'demo-v1', ['ns', 'nd', 'ent'])
    assert baseline == {'ns': 1.5, 'nd': 2.0}


def test_feature_baseline_without_version_or_names_is_empty():
    from jit_baseline import attribution

    assert attribution.feature_baseline(_Storage({'ns': 1.0}), '', ['ns']) == {}
    assert attribution.feature_baseline(_Storage({'ns': 1.0}), 'demo-v1', []) == {}


def _seed(store, version='demo-v1'):
    with store.connection(write=True) as db:
        db.execute('INSERT INTO dataset_record VALUES (?,?,?,?,?,?,?)',
                   (version, 'demo', '{}', 'manifest-sha', 'source-sha', 3, '2026-01-01T00:00:00Z'))
        for index, values in enumerate([{'ns': 1, 'nd': 2}, {'ns': 3, 'nd': 4}, {'ns': 5}]):
            commit_id = f'{index:040x}'
            db.execute('INSERT INTO commit_record VALUES (?,?,?,?,?)',
                       (version, commit_id, '2026-01-01T00:00:00Z', 0, 'rule'))
            for field, value in values.items():
                db.execute('INSERT INTO feature_record VALUES (?,?,?,?)',
                           (version, commit_id, field, json.dumps(value)))


def test_feature_means_average_and_missing_fields(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage
    from jit_baseline import store as store_module

    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    _seed(storage)
    assert storage.feature_means('demo-v1', ('ns', 'nd')) == {'ns': 3.0, 'nd': 3.0}
    assert storage.feature_means('demo-v1', ('ns', 'ent')) == {'ns': 3.0}
    assert storage.feature_means('missing', ('ns',)) == {}
    assert storage.feature_means('demo-v1', ()) == {}
    assert store_module.feature_means(storage, 'demo-v1', ('nd',)) == {'nd': 3.0}
