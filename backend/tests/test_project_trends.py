"""使用可控的一次性目录库验证项目趋势，不读取真实模型、标签或数据库。"""
import json
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest

from jit_baseline.api_errors import RequestError
from jit_baseline.catalog import ModelCatalog
from jit_baseline.catalog_storage import CatalogStorage, utc_now
from jit_baseline.project_trends import ProjectTrendService
from jit_baseline.sync import SyncStorage

WINDOW = dict(start='2026-01-01', end='2026-02-01', grain='day')


def epoch(value):
    return int(datetime.fromisoformat(value).timestamp())


def observation(number, *, when='2026-01-05T12:00:00+08:00', risk=None):
    return dict(id=f'{number:040x}', epoch=epoch(when)+number,
                risk=(.4 if number % 3 == 0 else .1) if risk is None else risk,
                addedLines=number, deletedLines=2, files=1, features={'la': number, 'nf': 1},
                label=number % 2, subject=f'提交 {number}', authorName='测试作者')


@pytest.fixture
def context(tmp_path):
    storage = CatalogStorage(tmp_path/'catalog.sqlite3')
    storage.initialize()
    sync = SyncStorage(storage)

    def repository(name):
        repository_id = str(uuid4())
        sync.repository_create(dict(id=repository_id, url=f'https://github.com/example/{name}',
            display_name=name, created_at=utc_now(), updated_at=utc_now(), commit_count=0,
            high_count=0, medium_count=0, low_count=0, unknown_count=0))
        return repository_id

    repo = repository('trends')
    serial = 0

    def source(rows=None, *, repository_id=repo, branch='main', model='model-a', run='run-a',
               schema='kamei14-git-v1', rule='repo-distribution-v1', kind='branch', status='completed'):
        nonlocal serial
        serial += 1
        sync_id = str(uuid4())
        completed = (datetime.fromisoformat('2026-02-01T00:00:00+00:00')+timedelta(seconds=serial)).isoformat()
        sync.create(dict(id=sync_id, repository_url='https://github.com/example/trends', repository_id=repository_id,
            branch=branch, since='2026-01-01T00:00:00Z', until='2026-02-01T00:00:00Z', commit_limit=500,
            source_kind=kind, requested_strategy='generic-model', status='scoring', stage='scoring',
            created_at=completed, updated_at=completed))
        sync.complete(sync_id, repository_id, rows if rows is not None else [observation(serial)],
            head_commit='a'*40, dataset_version=f'dataset-{serial}', model_id=model, run_id=run,
            analysis_branch=branch, feature_schema_version=schema)
        with storage.connection(write=True) as db:
            db.execute('UPDATE repository_sync SET completed_at=?,distribution_rule=?,status=? WHERE id=?',
                       (completed, rule, status, sync_id))
        return sync_id

    return SimpleNamespace(storage=storage, sync=sync, service=ProjectTrendService(SimpleNamespace(sync=sync)),
                           repo=repo, repository=repository, source=source)


def assert_error(code, fn, *args, **kwargs):
    with pytest.raises(RequestError) as failure:
        fn(*args, **kwargs)
    assert failure.value.code == code
    return failure.value


def test_overlap_is_deduplicated_without_loading_models_or_using_labels(context, monkeypatch):
    ctx = context
    first = ctx.source([observation(i) for i in range(25)])
    second = ctx.source([observation(i) for i in range(15, 30)])
    monkeypatch.setattr(ModelCatalog, 'load_model', lambda *_: pytest.fail('趋势不能加载模型'))
    groups = ctx.service.groups(ctx.repo)
    assert len(groups['groups']) == 1
    group = groups['groups'][0]
    assert group['sourceSyncIds'] == [first, second]
    assert 'datasetVersion' not in group
    view = ctx.service.create(ctx.repo, dict(WINDOW, groupId=group['groupId']))
    assert view['sourceSyncIds'] == [first, second]
    assert view['summary'] == dict(commitCount=30, scoredCount=30, unknownCount=0,
                                 highCount=10, highRate=1/3, riskMean=pytest.approx(.2), rateReason=None)
    commits = ctx.service.commits(ctx.repo, view['viewId'], limit=200)
    assert len(commits['commits']) == commits['total'] == 30
    assert next(item for item in commits['commits'] if item['commitId'] == f'{20:040x}')['sourceSyncId'] == first
    assert view['sources'][0]['datasetVersion'] != view['sources'][1]['datasetVersion']
    with ctx.storage.connection() as db:
        frozen = json.loads(db.execute('SELECT payload_json FROM project_trend_view').fetchone()[0])
    assert set(frozen['sources'][0]) == {'syncId', 'fingerprint'}
    assert 'risk' not in json.dumps(frozen)
    assert all(key not in json.dumps(view) for key in ('label', 'artifact', 'path', 'verification'))
    with ctx.storage.connection(write=True) as db:
        db.execute('UPDATE repository_commit SET label=1-label,label_note=?', ('不参与趋势',))
    assert ctx.service.get(ctx.repo, view['viewId']) == view


def test_groups_separate_branch_model_run_schema_and_rule_but_not_dataset(context):
    ctx = context
    first = ctx.source()
    second = ctx.source()
    for change in (dict(branch='release'), dict(model='model-b'), dict(run='run-b'),
                   dict(schema='openstack-six-v1'), dict(rule='future-rule')):
        ctx.source(**change)
    ctx.source(kind='pr')
    ctx.source(kind='unknown')
    ctx.source(schema=None)
    ctx.source(model=None)
    ctx.source(status='failed')
    foreign = ctx.repository('foreign')
    ctx.source(repository_id=foreign)
    groups = ctx.service.groups(ctx.repo)['groups']
    assert len(groups) == 6
    assert next(item for item in groups if first in item['sourceSyncIds'])['sourceSyncIds'] == [first, second]
    assert sum(len(item['sourceSyncIds']) for item in groups) == 7
    assert set(item['groupId'] for item in groups).isdisjoint(
        item['groupId'] for item in ctx.service.groups(foreign)['groups'])
    assert_error('INPUT_INVALID', ctx.service.create, ctx.repo, WINDOW)
    incompatible = next(item for item in groups if item['distributionRule'] == 'future-rule')
    assert_error('INPUT_SCHEMA_MISMATCH', ctx.service.create, ctx.repo, dict(WINDOW, groupId=incompatible['groupId']))


@pytest.mark.parametrize('field,value', [('epoch', epoch('2026-01-06T00:00:00+08:00')),
    ('features', {'la': 999}), ('addedLines', 999), ('deletedLines', 99), ('files', 99), ('risk', .9)])
def test_conflicting_sha_refuses_whole_group_even_outside_query_and_allows_single(context, field, value):
    ctx = context
    first = ctx.source([observation(1)])
    changed = dict(observation(1), **{field: value})
    second = ctx.source([changed, observation(2)])
    failure = assert_error('TREND_SOURCE_CONFLICT', ctx.service.create, ctx.repo,
                           dict(start='2026-03-01', end='2026-03-02'))
    assert failure.details[0]['sourceSyncIds'] == [first, second]
    assert failure.details[0]['commitId'] == f'{1:040x}'
    with ctx.storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM project_trend_view').fetchone()[0] == 0
    view = ctx.service.create(ctx.repo, dict(WINDOW, sourceSyncId=second))
    assert view['sourceSyncIds'] == [second] and view['summary']['commitCount'] == 2
    assert view['hasNewSources'] is False


def test_score_tolerance_matches_saved_analysis_comparison(context):
    ctx = context
    first = ctx.source([observation(1, risk=.2)])
    second = ctx.source([observation(1, risk=.2+5e-11)])
    view = ctx.service.create(ctx.repo, WINDOW)
    assert view['summary']['commitCount'] == 1
    assert ctx.service.commits(ctx.repo, view['viewId'])['commits'][0]['sourceSyncId'] == first
    with ctx.storage.connection(write=True) as db:
        db.execute('UPDATE repository_commit SET risk=? WHERE sync_id=?', (.2+2e-10, second))
    assert_error('TREND_SOURCE_CONFLICT', ctx.service.create, ctx.repo, WINDOW)
    assert_error('TREND_SOURCE_UNAVAILABLE', ctx.service.get, ctx.repo, view['viewId'])


def test_score_tolerance_is_checked_across_all_sources_not_only_first(context):
    ctx = context
    ctx.source([observation(1, risk=.2)])
    lower = ctx.source([observation(1, risk=.2-6e-11)])
    higher = ctx.source([observation(1, risk=.2+6e-11)])
    failure = assert_error('TREND_SOURCE_CONFLICT', ctx.service.create, ctx.repo, WINDOW)
    assert failure.details[0]['sourceSyncIds'] == [lower, higher]


def test_fixed_sources_do_not_drift_and_refresh_is_explicit_and_idempotent(context):
    ctx = context
    first = ctx.source([observation(i) for i in range(20)])
    group_id = ctx.service.groups(ctx.repo)['groups'][0]['groupId']
    view = ctx.service.create(ctx.repo, dict(WINDOW, groupId=group_id))
    assert ctx.service.create(ctx.repo, WINDOW) == view
    second = ctx.source([observation(i) for i in range(10, 30)])
    old = ctx.service.get(ctx.repo, view['viewId'])
    assert old == dict(view, hasNewSources=True)
    assert old['sourceSyncIds'] == [first]
    assert ctx.service.commits(ctx.repo, view['viewId'], limit=200)['total'] == 20
    assert ctx.service.groups(ctx.repo)['groups'][0]['groupId'] == group_id
    refreshed = ctx.service.create(ctx.repo, dict(WINDOW, groupId=group_id))
    assert refreshed['viewId'] != view['viewId']
    assert refreshed['sourceSyncIds'] == [first, second]
    assert refreshed['summary']['commitCount'] == 30 and refreshed['hasNewSources'] is False
    assert ctx.service.create(ctx.repo, WINDOW) == refreshed
    ctx.source(branch='another', model='another')
    assert ctx.service.get(ctx.repo, refreshed['viewId']) == refreshed


def test_new_conflicting_source_does_not_invalidate_an_existing_manifest(context):
    ctx = context
    ctx.source([observation(1)])
    view = ctx.service.create(ctx.repo, WINDOW)
    ctx.source([observation(1, risk=.99)])
    assert ctx.service.get(ctx.repo, view['viewId']) == dict(view, hasNewSources=True)
    assert ctx.service.commits(ctx.repo, view['viewId'])['total'] == 1
    assert_error('TREND_SOURCE_CONFLICT', ctx.service.create, ctx.repo, WINDOW)


@pytest.mark.parametrize('change', ['delete', 'status', 'risk', 'epoch', 'features', 'subject', 'schema', 'rule', 'dataset', 'ownership'])
def test_fixed_view_rejects_deleted_or_tampered_sources_on_all_read_paths(context, change):
    ctx = context
    source = ctx.source([observation(1)])
    view = ctx.service.create(ctx.repo, WINDOW)
    if change == 'delete':
        ctx.sync.sync_delete(source)
    else:
        foreign = ctx.repository('another-owner')
        changes = {
            'status': ('repository_sync', 'status', 'failed'),
            'risk': ('repository_commit', 'risk', .8),
            'epoch': ('repository_commit', 'epoch', epoch('2026-01-07T00:00:00+08:00')),
            'features': ('repository_commit', 'features_json', '{"la":99}'),
            'subject': ('repository_commit', 'subject', '已篡改'),
            'schema': ('repository_sync', 'feature_schema_version', 'another-schema'),
            'rule': ('repository_sync', 'distribution_rule', 'another-rule'),
            'dataset': ('repository_sync', 'dataset_version', 'another-dataset'),
            'ownership': ('repository_sync', 'repository_id', foreign),
        }
        table, field, value = changes[change]
        with ctx.storage.connection(write=True) as db:
            db.execute(f'UPDATE {table} SET {field}=? WHERE {"id" if table == "repository_sync" else "sync_id"}=?', (value, source))
    assert_error('TREND_SOURCE_UNAVAILABLE', ctx.service.get, ctx.repo, view['viewId'])
    assert_error('TREND_SOURCE_UNAVAILABLE', ctx.service.commits, ctx.repo, view['viewId'])


def test_canonical_feature_json_and_row_order_do_not_falsely_invalidate(context):
    ctx = context
    source = ctx.source([observation(1)])
    view = ctx.service.create(ctx.repo, WINDOW)
    with ctx.storage.connection(write=True) as db:
        db.execute('UPDATE repository_commit SET features_json=? WHERE sync_id=?', (' { "nf": 1, "la": 1 } ', source))
    assert ctx.service.get(ctx.repo, view['viewId']) == view


def test_legacy_unknown_is_explicit_single_source_without_invented_metadata(context):
    ctx = context
    first = ctx.source(kind='unknown', schema=None, rule=None, model=None, run=None)
    ctx.source(kind='unknown', schema=None, rule=None, model=None, run=None)
    assert ctx.service.groups(ctx.repo)['groups'] == []
    assert_error('NOT_FOUND', ctx.service.create, ctx.repo, WINDOW)
    view = ctx.service.create(ctx.repo, dict(WINDOW, sourceSyncId=first))
    assert view['sourceSyncIds'] == [first]
    assert view['group']['groupId'] is None and view['group']['featureSchemaVersion'] is None
    assert view['summary']['commitCount'] == view['summary']['scoredCount'] == 1
    assert view['summary']['highCount'] is view['summary']['highRate'] is None
    assert view['summary']['rateReason']
    assert ctx.service.get(ctx.repo, view['viewId']) == view


def test_pr_and_incomplete_or_failed_branch_sources_cannot_be_selected(context):
    ctx = context
    assert_error('INPUT_INVALID', ctx.service.create, ctx.repo, dict(WINDOW, sourceSyncId=ctx.source(kind='pr')))
    for changes in (dict(schema=None), dict(run=None), dict(rule=None), dict(status='failed')):
        source = ctx.source(**changes)
        assert_error('TREND_SOURCE_UNAVAILABLE', ctx.service.create, ctx.repo, dict(WINDOW, sourceSyncId=source))


@pytest.mark.parametrize('count,rate', [(0, None), (19, None), (20, .35)])
def test_small_sample_keeps_counts_and_null_rate_with_reason(context, count, rate):
    ctx = context
    ctx.source([observation(i) for i in range(count)])
    view = ctx.service.create(ctx.repo, WINDOW)
    assert view['summary']['commitCount'] == view['summary']['scoredCount'] == count
    assert view['summary']['unknownCount'] == 0
    assert view['summary']['highCount'] == sum(i % 3 == 0 for i in range(count))
    assert view['summary']['highRate'] == rate
    assert (view['summary']['rateReason'] is None) == (rate is not None)
    empty = view['buckets'][0]
    assert empty['coverage'] == 'unknown'
    assert all(empty[key] is None for key in ('commitCount', 'scoredCount', 'unknownCount', 'highCount', 'highRate', 'riskMean'))
    assert empty['rateReason']
    if count:
        assert sum(bucket['commitCount'] or 0 for bucket in view['buckets']) == count
        nonempty = next(bucket for bucket in view['buckets'] if bucket['coverage'] == 'observed')
        assert nonempty['highRate'] == rate


def test_unknown_scores_are_not_treated_as_low_risk_or_rate_denominator(context):
    ctx = context
    ctx.source([observation(i) for i in range(21)])
    # 当前写入器只保存完整评分；用一次性表取消非空约束，验证未来缺分观测的读取语义。
    with ctx.storage.connection(write=True) as db:
        db.execute('CREATE TABLE trend_commit_copy AS SELECT * FROM repository_commit')
        db.execute('DROP TABLE repository_commit')
        db.execute('ALTER TABLE trend_commit_copy RENAME TO repository_commit')
        db.execute('UPDATE repository_commit SET risk=NULL WHERE commit_id=?', (f'{20:040x}',))
    view = ctx.service.create(ctx.repo, WINDOW)
    assert view['summary'] == dict(commitCount=21, scoredCount=20, unknownCount=1,
                                  highCount=7, highRate=.35, riskMean=pytest.approx(.205), rateReason=None)
    commits = ctx.service.commits(ctx.repo, view['viewId'], limit=200)['commits']
    assert commits[-1]['risk'] is None
    with ctx.storage.connection(write=True) as db:
        db.execute('UPDATE repository_commit SET risk=NULL WHERE commit_id=?', (f'{19:040x}',))
    sparse = ctx.service.create(ctx.repo, WINDOW)
    assert sparse['summary']['commitCount'] == 21 and sparse['summary']['scoredCount'] == 19
    assert sparse['summary']['unknownCount'] == 2 and sparse['summary']['highRate'] is None
    assert sparse['summary']['rateReason']
    assert_error('TREND_SOURCE_UNAVAILABLE', ctx.service.get, ctx.repo, view['viewId'])


@pytest.mark.parametrize('field,value', [('risk', 2.0), ('risk', 'invalid'), ('features_json', '{'),
                                       ('features_json', '[]'), ('features_json', '{"la":NaN}')])
def test_malformed_saved_observations_are_not_silently_dropped(context, field, value):
    ctx = context
    source = ctx.source([observation(1), observation(2)])
    with ctx.storage.connection(write=True) as db:
        db.execute(f'UPDATE repository_commit SET {field}=? WHERE sync_id=? AND commit_id=?', (value, source, f'{1:040x}'))
    assert_error('TREND_SOURCE_UNAVAILABLE', ctx.service.create, ctx.repo, WINDOW)
    with ctx.storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM project_trend_view').fetchone()[0] == 0


def test_timezone_midnight_and_exclusive_end_match_bucket_drilldown(context):
    ctx = context
    moments = ['2025-12-31T15:59:59+00:00', '2025-12-31T16:00:00+00:00',
               '2026-01-01T15:59:59+00:00', '2026-01-01T16:00:00+00:00', '2026-01-02T16:00:00+00:00']
    rows = [dict(observation(i), epoch=epoch(moment)) for i, moment in enumerate(moments)]
    ctx.source(rows)
    view = ctx.service.create(ctx.repo, dict(start='2026-01-01', end='2026-01-03', grain='day'))
    assert view['timezone'] == 'UTC+08:00' and view['minSample'] == 20
    assert [bucket['commitCount'] for bucket in view['buckets']] == [2, 1]
    assert view['summary']['commitCount'] == 3
    selected = []
    for bucket in view['buckets']:
        result = ctx.service.commits(ctx.repo, view['viewId'], start=bucket['start'], end=bucket['end'])
        assert result['total'] == bucket['commitCount']
        selected.extend(item['commitId'] for item in result['commits'])
    assert set(selected) == {f'{i:040x}' for i in (1, 2, 3)}


@pytest.mark.parametrize('query,bounds', [
    (dict(start='2026-01-01', end='2026-01-14', grain='week'),
     [('2026-01-01', '2026-01-05'), ('2026-01-05', '2026-01-12'), ('2026-01-12', '2026-01-14')]),
    (dict(start='2025-12-20', end='2026-02-03', grain='month'),
     [('2025-12-20', '2026-01-01'), ('2026-01-01', '2026-02-01'), ('2026-02-01', '2026-02-03')]),
])
def test_calendar_bucket_boundaries_are_clipped_to_fixed_query(context, query, bounds):
    ctx = context
    ctx.source()
    view = ctx.service.create(ctx.repo, query)
    assert [(bucket['start'], bucket['end']) for bucket in view['buckets']] == bounds


def test_default_window_is_recent_90_local_days_with_week_grain(context, monkeypatch):
    import jit_baseline.project_trends as trends
    ctx = context
    ctx.source()

    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromisoformat('2026-01-31T16:30:00+00:00').astimezone(tz)

    monkeypatch.setattr(trends, 'datetime', FixedDatetime)
    view = ctx.service.create(ctx.repo, {})
    assert view['start'] == '2025-11-04' and view['end'] == '2026-02-02'
    assert view['grain'] == 'week'
    assert ctx.service.create(ctx.repo, {}) == view


def test_pagination_is_stable_risk_time_sha_order_without_lost_or_repeated_commits(context):
    ctx = context
    rows = [dict(observation(i), epoch=epoch('2026-01-05T12:00:00+08:00')+i//4, risk=.2 if i % 2 else .5) for i in range(27)]
    ctx.source(rows[:20])
    ctx.source(rows[10:])
    view = ctx.service.create(ctx.repo, WINDOW)
    pages = [ctx.service.commits(ctx.repo, view['viewId'], limit=10, offset=offset) for offset in (0, 10, 20)]
    saved = [item for page in pages for item in page['commits']]
    expected = sorted(rows, key=lambda item: (-item['risk'], -item['epoch'], item['id']))
    assert [item['commitId'] for item in saved] == [item['id'] for item in expected]
    assert len(set(item['commitId'] for item in saved)) == 27
    assert all(page['total'] == 27 and page['limit'] == 10 for page in pages)
    assert ctx.service.commits(ctx.repo, view['viewId'], offset=100)['commits'] == []


def test_project_ownership_and_cascade_delete(context):
    ctx = context
    source = ctx.source()
    view = ctx.service.create(ctx.repo, WINDOW)
    foreign = ctx.repository('foreign')
    for fn, args in ((ctx.service.get, (foreign, view['viewId'])),
                     (ctx.service.commits, (foreign, view['viewId'])),
                     (ctx.service.create, (foreign, dict(WINDOW, sourceSyncId=source))),
                     (ctx.service.create, (foreign, dict(WINDOW, groupId=view['group']['groupId'])))):
        assert_error('NOT_FOUND', fn, *args)
    assert_error('REPOSITORY_UNKNOWN', ctx.service.groups, 'missing-project')
    assert_error('NOT_FOUND', ctx.service.get, ctx.repo, 'missing-view')
    ctx.sync.repository_delete(ctx.repo)
    with ctx.storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM project_trend_view').fetchone()[0] == 0


@pytest.mark.parametrize('payload', [None, [], {'unknown': 1}, {'groupId': ''}, {'sourceSyncId': True},
    {'groupId': 'group', 'sourceSyncId': 'source'}, {'grain': 'year'}, {'grain': None},
    {'start': '2026-1-01'}, {'end': '2026-02-30'}, {'start': '2026-02-01', 'end': '2026-01-01'},
    {'start': None}, {'start': '0001-01-01', 'end': '0001-01-01'},
    {'start': '2000-01-01', 'end': '2026-01-01', 'grain': 'day'}])
def test_malformed_create_payloads_fail_before_persisting(context, payload):
    ctx = context
    ctx.source()
    assert_error('INPUT_INVALID', ctx.service.create, ctx.repo, payload)
    with ctx.storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM project_trend_view').fetchone()[0] == 0


@pytest.mark.parametrize('query', [{'limit': 0}, {'limit': 201}, {'limit': True}, {'limit': 1.2},
    {'offset': -1}, {'offset': True}, {'offset': '0'}, {'start': '2026-01-05T00:00:00Z'},
    {'start': '2025-12-01'}, {'end': '2026-03-01'}, {'start': '2026-01-06', 'end': '2026-01-06'}])
def test_invalid_pagination_and_dates_cannot_escape_fixed_view(context, query):
    ctx = context
    ctx.source()
    view = ctx.service.create(ctx.repo, WINDOW)
    assert_error('INPUT_INVALID', ctx.service.commits, ctx.repo, view['viewId'], **query)


def test_manifest_tampering_is_not_silently_repaired_by_create(context):
    ctx = context
    ctx.source()
    view = ctx.service.create(ctx.repo, WINDOW)
    with ctx.storage.connection(write=True) as db:
        db.execute('UPDATE project_trend_view SET payload_json=? WHERE id=?', ('{}', view['viewId']))
    assert_error('TREND_SOURCE_UNAVAILABLE', ctx.service.get, ctx.repo, view['viewId'])
    assert_error('TREND_SOURCE_UNAVAILABLE', ctx.service.create, ctx.repo, WINDOW)
