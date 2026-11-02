"""开放接口文档与真实预测响应的契约测试（PEX-07）。

依赖 PyYAML / jsonschema，只在契约工具环境可用（`scripts/requirements-contract.txt`）；
普通测试环境会 skip，不算通过。
"""
import json
from functools import lru_cache
from pathlib import Path

import pytest

yaml = pytest.importorskip('yaml')
jsonschema = pytest.importorskip('jsonschema')

from test_catalog_api import HEADERS, settings  # noqa: F401,E402
from test_artifacts import real_run  # noqa: F401,E402

ROOT = Path(__file__).resolve().parents[2]
DOCUMENT = ROOT / 'docs/api/openapi.yaml'


@lru_cache(maxsize=1)
def document():
    return yaml.safe_load(DOCUMENT.read_text(encoding='utf-8'))


def register(client):
    candidate = client.get('/api/v1/model-candidates', headers=HEADERS).json()['candidates'][0]
    return client.post('/api/v1/models/register', headers=HEADERS, json={
        'candidateId': candidate['candidateId'], 'expectedManifestSha256': candidate['manifestSha256']}).json()['model']


def payload(model_id):
    return {'modelId': model_id, 'featureSchemaVersion': 'openstack-six-v1', 'project': 'fixture-project',
            'record': {'recordId': 'openapi-1', 'features': {'ns': 1, 'nd': 2, 'nf': 3, 'ent': .8, 'la': 10, 'ld': 2}}}


def test_prediction_explanation_is_documented():
    schemas = document()['components']['schemas']
    record = schemas['PredictionRecord']
    assert record['properties']['explanationStatus']['enum'] == ['supported', 'not-supported']
    assert {'explanation', 'explanationMethod', 'explanationSummary', 'explanationReason'} <= set(record['properties'])
    assert 'explanationReason' not in record['required']
    assert record['properties']['explanation']['maxItems'] == 5
    explanation = schemas['PredictionExplanation']
    assert set(explanation['required']) == {'feature', 'value', 'baseline', 'delta', 'direction'}
    assert explanation['properties']['direction']['enum'] == ['increases', 'decreases']
    assert explanation['additionalProperties'] is False


def test_supported_explanation_matches_documented_schema(settings):
    from admin_support import AdminTestClient as TestClient
    from jit_baseline.api import create_app
    schema = document()['components']['schemas']['PredictionExplanation']
    validator = jsonschema.Draft202012Validator(schema)
    with TestClient(create_app(**settings)) as client:
        model = register(client)
        response = client.post('/api/v1/predictions', headers=HEADERS, json=payload(model['modelId']))
        assert response.status_code == 201, response.text
        record = response.json()['records'][0]
        assert record['explanationStatus'] == 'supported'
        assert record['explanationMethod']
        assert record['explanationSummary']
        for item in record['explanation']:
            validator.validate(item)


def test_degraded_explanation_keeps_documented_reason(settings, monkeypatch):
    from admin_support import AdminTestClient as TestClient
    from jit_baseline import attribution
    from jit_baseline.api import create_app

    def boom(*_args, **_kwargs):
        raise RuntimeError('fixture attribution failure')
    monkeypatch.setattr(attribution, 'explain', boom)
    with TestClient(create_app(**settings)) as client:
        model = register(client)
        record = client.post('/api/v1/predictions', headers=HEADERS, json=payload(model['modelId'])).json()['records'][0]
        assert record['explanationStatus'] == 'not-supported'
        assert record['explanationReason']
        assert 'explanation' not in record
        assert 'explanation' not in document()['components']['schemas']['PredictionRecord']['required']


def contract_validator(schema):
    return jsonschema.Draft202012Validator(
        dict(schema, components=document()['components']), format_checker=jsonschema.FormatChecker())


def validate_response(response, path, method='get', status=200):
    """验证实际HTTP响应、公开请求标识及文档中的对应状态码。"""
    assert response.status_code == status, response.text
    entry = document()['paths'][path][method]['responses'][str(status)]
    if '$ref' in entry:
        entry = document()['components']['responses'][entry['$ref'].rsplit('/', 1)[1]]
    if path in PROJECT_OPERATIONS:
        assert entry['headers']['X-Request-Id']['$ref'] == '#/components/headers/ProjectRequestId'
    contract_validator(entry['content']['application/json']['schema']).validate(response.json())
    assert response.headers['X-Request-Id']
    assert response.headers['Cache-Control'] == 'no-store'
    if status >= 400:
        assert response.json()['error']['requestId'] == response.headers['X-Request-Id']
    return response.json()


def test_model_detail_matches_strict_contract(settings):
    from admin_support import AdminTestClient as TestClient
    from jit_baseline.api import create_app

    with TestClient(create_app(**settings)) as client:
        model = register(client)
        detail = validate_response(
            client.get(f"/api/v1/models/{model['modelId']}"),
            '/api/v1/models/{modelId}',
        )
        assert detail['modelId'] == model['modelId']
        assert detail['artifactDatasetVersion'] == model['artifactDatasetVersion']
        assert detail['metrics']['averagePrecision']['value'] is not None
        assert detail['source']['files']
        assert detail['split']
        validator = contract_validator({'$ref': '#/components/schemas/ModelDetail'})
        assert not validator.is_valid(dict(detail, artifactPath='/private/model'))


@pytest.fixture
def project_api(settings, monkeypatch):
    """复用临时模型副本，禁用后台计时，GitHub与worker均由测试显式推进。"""
    from types import SimpleNamespace
    from uuid import uuid4
    from fastapi.testclient import TestClient
    from test_pr_updates import Clock, GitHub, Worker
    from jit_baseline.api import create_app
    from jit_baseline.catalog_storage import utc_now
    from jit_baseline.pr_updates import PullRequestUpdates
    from jit_baseline.repository_updates import RepositoryUpdates

    monkeypatch.setattr(PullRequestUpdates, 'start', lambda *_: None)
    monkeypatch.setattr(RepositoryUpdates, 'start', lambda *_: None)
    app = create_app(**settings)
    service, watcher = app.state.sync, app.state.pr_updates
    model = app.state.catalog.register_key('baseline')['model']
    monkeypatch.setattr(service, '_execute', lambda *_: None)
    github, worker = GitHub(), Worker()
    app.state.pr_review.request = github
    watcher.executor.shutdown(wait=True)
    watcher.executor, watcher.clock = worker, Clock()
    repo = service.create_repository({'repositoryUrl': 'https://github.com/example/project'})[0]['repositoryId']

    def source(count=20, *, kind='branch', conflict=False):
        sync_id = str(uuid4())
        service.sync.create(dict(id=sync_id, repository_id=repo, repository_url='https://github.com/example/project',
            branch='main', since='2026-10-01T00:00:00Z', until='2026-11-01T00:00:00Z', commit_limit=500,
            requested_strategy='generic-model', source_kind=kind, status='scoring', stage='scoring',
            created_at=utc_now(), updated_at=utc_now()))
        service.sync.complete(sync_id, repo, [dict(id=f'{i:040x}', epoch=1793188800+i,
            risk=.9 if conflict else (.4 if i % 2 else .1), addedLines=1, deletedLines=1, files=1,
            features={}, subject=f'测试提交 {i}', label=0) for i in range(count)],
            head_commit='f'*40, dataset_version='data-'+sync_id, model_id=model['modelId'],
            run_id=model['runId'], analysis_branch='main', feature_schema_version=model['featureSchemaVersion'])
        return sync_id

    with TestClient(app) as client:
        yield SimpleNamespace(client=client, app=app, service=service, watcher=watcher, github=github,
                              worker=worker, repo=repo, model=model, source=source)


PROJECT_OPERATIONS = {
    '/api/v1/project-events': ['get'],
    '/api/v1/repositories/{repositoryId}/events': ['get'],
    '/api/v1/repositories/{repositoryId}/pull-requests': ['get'],
    '/api/v1/repositories/{repositoryId}/pull-requests/refresh': ['post'],
    '/api/v1/repositories/{repositoryId}/pr-tracking': ['get', 'patch'],
    '/api/v1/repositories/{repositoryId}/pr-tracking/check': ['post'],
    '/api/v1/repositories/{repositoryId}/trend-groups': ['get'],
    '/api/v1/repositories/{repositoryId}/trend-views': ['post'],
    '/api/v1/repositories/{repositoryId}/trend-views/{viewId}': ['get'],
    '/api/v1/repositories/{repositoryId}/trend-views/{viewId}/commits': ['get'],
}


def test_project_contracts_are_public_resolved_and_do_not_allow_arbitrary_objects():
    data = document()
    for path, methods in PROJECT_OPERATIONS.items():
        for method in methods:
            operation = data['paths'][path][method]
            assert operation['security'] == []
            assert {'404', '503'} <= operation['responses'].keys() or path == '/api/v1/project-events'
    names = ['ProjectEvent', 'ProjectEventPage', 'ProjectPullRequest', 'ProjectPullRequestPage',
             'PRTrackingState', 'PRTrackingUpdate', 'ProjectTrendCreate', 'ProjectTrendGroup',
             'ProjectTrendGroups', 'ProjectTrendSource', 'ProjectTrendSummary', 'ProjectTrendBucket',
             'ProjectTrendView', 'ProjectTrendCommitPage', 'PRSummary', 'PRPrepared', 'PRSourceSnapshot',
             'PRDiscovery', 'PRAnalyses', 'RepositorySyncView', 'AnalysisContext']
    for name in names:
        schema = data['components']['schemas'][name]
        jsonschema.Draft202012Validator.check_schema(schema)
        assert schema['additionalProperties'] is False

    def resolve_refs(value):
        if isinstance(value, dict):
            if '$ref' in value:
                current = data
                for part in value['$ref'].removeprefix('#/').split('/'):
                    current = current[part]
            for child in value.values():
                resolve_refs(child)
        elif isinstance(value, list):
            for child in value:
                resolve_refs(child)

    resolve_refs(data)
    operations = [operation for item in data['paths'].values() for method, operation in item.items()
                  if method in {'get', 'post', 'patch', 'put', 'delete'}]
    identities = [operation['operationId'] for operation in operations]
    assert len(identities) == len(set(identities))

    class UniqueKeysLoader(yaml.SafeLoader):
        pass

    def unique_mapping(loader, node):
        keys = [loader.construct_object(key) for key, _ in node.value]
        assert len(keys) == len(set(keys)), f'YAML 存在重复字段：{keys}'
        return loader.construct_mapping(node)

    UniqueKeysLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)
    yaml.load(DOCUMENT.read_text(encoding='utf-8'), Loader=UniqueKeysLoader)


def test_project_request_contracts_reject_unknown_fields_and_invalid_types():
    schemas = document()['components']['schemas']
    for name, invalid in [
        ('ProjectTrendCreate', {'groupId': 'g', 'sourceSyncId': 's'}),
        ('ProjectTrendCreate', {'start': '2026-1-1'}),
        ('ProjectTrendCreate', {'grain': 'year'}),
        ('ProjectTrendCreate', {'privateNotes': '个人记录'}),
        ('PRTrackingUpdate', {'enabled': 1}),
        ('PRTrackingUpdate', {'confirmExisting': 'true'}),
        ('PRTrackingUpdate', {'intervalSeconds': 299}),
        ('PRTrackingUpdate', {'modelId': ''}),
        ('PRTrackingUpdate', {}),
    ]:
        assert not contract_validator(schemas[name]).is_valid(invalid), (name, invalid)
    refresh = document()['paths']['/api/v1/pr-sources/{owner}/{name}/{number}/refresh']['post']
    assert refresh['requestBody']['required'] is False
    body = refresh['requestBody']['content']['application/json']['schema']
    assert not contract_validator(body).is_valid({'repositoryId': 1})
    assert not contract_validator(body).is_valid({'notes': '不上传'})
    analyze = document()['paths']['/api/v1/pr-snapshots/{snapshotId}/analyses']['post']
    body = analyze['requestBody']['content']['application/json']['schema']
    assert contract_validator(body).is_valid({'retry': True})
    assert not contract_validator(body).is_valid({'retry': 1})


def test_project_trend_api_fixed_views_pagination_conflicts_and_unavailable_schema(project_api):
    ctx = project_api
    ctx.source()
    base = f'/api/v1/repositories/{ctx.repo}'
    template = '/api/v1/repositories/{repositoryId}'
    group_path = template+'/trend-groups'
    groups = validate_response(ctx.client.get(base+'/trend-groups'), group_path)
    group = groups['groups'][0]
    query = dict(groupId=group['groupId'], start='2026-10-25', end='2026-10-30', grain='day')
    path = template+'/trend-views'
    view = validate_response(ctx.client.post(base+'/trend-views', json=query), path, 'post')
    assert view['mode'] == 'group'
    assert view['summary']['commitCount'] == 20 and view['summary']['highRate'] == .5
    assert any(bucket['coverage'] == 'unknown' for bucket in view['buckets'])
    pinned = base+'/trend-views/'+view['viewId']
    get_path = path+'/{viewId}'
    assert validate_response(ctx.client.get(pinned), get_path) == view
    commits_path = get_path+'/commits'
    commits = validate_response(ctx.client.get(pinned+'/commits', params={'limit': 5, 'offset': 5}), commits_path)
    assert commits['total'] == 20 and len(commits['commits']) == 5
    ctx.source(21)
    old = validate_response(ctx.client.get(pinned), get_path)
    assert old == dict(view, hasNewSources=True)
    ctx.source(conflict=True)
    failure = validate_response(ctx.client.post(base+'/trend-views', json=query), path, 'post', 409)
    assert failure['error']['code'] == 'TREND_SOURCE_CONFLICT'
    assert len(failure['error']['details'][0]['sourceSyncIds']) == 2
    invalid = validate_response(ctx.client.get(pinned+'/commits', params={'limit': 201}), commits_path, status=422)
    assert invalid['error']['code'] == 'INPUT_INVALID'
    ctx.service.sync.sync_delete(view['sourceSyncIds'][0])
    missing = validate_response(ctx.client.get(pinned), get_path, status=409)
    assert missing['error']['code'] == 'TREND_SOURCE_UNAVAILABLE'
    foreign = ctx.service.create_repository({'repositoryUrl': 'https://github.com/example/foreign'})[0]['repositoryId']
    validate_response(ctx.client.get(pinned.replace(ctx.repo, foreign)), get_path, status=404)


def test_legacy_trend_nulls_and_repository_context_match_strict_contract(project_api):
    ctx = project_api
    source = ctx.source(1, kind='unknown')
    with ctx.service.sync.storage.connection(write=True) as db:
        db.execute('UPDATE repository_sync SET feature_schema_version=NULL,distribution_rule=NULL,model_id=NULL,run_id=NULL WHERE id=?', (source,))
    base = f'/api/v1/repositories/{ctx.repo}'
    path = '/api/v1/repositories/{repositoryId}/trend-views'
    view = validate_response(ctx.client.post(base+'/trend-views', json=dict(sourceSyncId=source,
        start='2026-10-25', end='2026-10-30')), path, 'post')
    assert view['mode'] == 'single'
    assert view['group']['groupId'] is view['summary']['highCount'] is view['summary']['highRate'] is None
    ctx.source()
    repository = validate_response(ctx.client.get(base), '/api/v1/repositories/{repositoryId}')
    assert repository['viewContext']['sourceKind'] == 'branch'
    assert repository['viewContext']['featureSchemaVersion'] == ctx.model['featureSchemaVersion']
    contract_validator({'$ref': '#/components/schemas/ProjectTrendView'}).validate(view)
    corrupted = json.loads(json.dumps(view))
    corrupted['sources'][0]['artifactPath'] = '/private/model'
    assert not contract_validator({'$ref': '#/components/schemas/ProjectTrendView'}).is_valid(corrupted)
    invalid_bucket = dict(view['buckets'][0], coverage='unknown', commitCount=0)
    assert not contract_validator({'$ref': '#/components/schemas/ProjectTrendBucket'}).is_valid(invalid_bucket)


def test_project_pr_list_tracking_refresh_and_fixed_analyses_match_contract(project_api):
    ctx = project_api
    pr = ctx.github.add(fork=True)
    ctx.github.add(number=2, draft=True)
    base = f'/api/v1/repositories/{ctx.repo}'
    template = '/api/v1/repositories/{repositoryId}'
    listing_path, tracking_path = template+'/pull-requests', template+'/pr-tracking'
    empty = validate_response(ctx.client.get(base+'/pull-requests'), listing_path)
    assert empty['checkedAt'] is None and empty['pullRequests'] == []
    validate_response(ctx.client.get(base+'/pr-tracking'), tracking_path)
    validate_response(ctx.client.patch(base+'/pr-tracking', json={'enabled': True}), tracking_path, 'patch', 422)
    listing = validate_response(ctx.client.post(base+'/pull-requests/refresh'), listing_path+'/refresh', 'post')
    assert listing['pullRequests'][1]['draft'] is True
    refreshed = validate_response(ctx.client.post('/api/v1/pr-sources/example/project/1/refresh',
        json={'repositoryId': ctx.repo}), '/api/v1/pr-sources/{owner}/{name}/{number}/refresh', 'post')
    snapshot_id = refreshed['snapshot']['snapshotId']
    pr['draft'] = True
    latest = validate_response(ctx.client.post('/api/v1/pr-sources/example/project/1/refresh'),
        '/api/v1/pr-sources/{owner}/{name}/{number}/refresh', 'post')
    assert latest['draft'] is True and latest['snapshot']['draft'] is False
    pr['draft'] = False
    old = json.loads(json.dumps(latest))
    for key in ('draft', 'pullRequest'):
        old.pop(key)
    old['snapshot'].pop('draft')
    contract_validator({'$ref': '#/components/schemas/PRPrepared'}).validate(old)
    discovery = validate_response(ctx.client.post('/api/v1/review-sources', json={'url': 'https://github.com/example/project'}),
        '/api/v1/review-sources', 'post')
    assert discovery['supported'] is True
    validate_response(ctx.client.patch(base+'/pr-tracking', json=dict(enabled=True,
        modelId=ctx.model['modelId'], confirmExisting=True)), tracking_path, 'patch')
    validate_response(ctx.client.post(base+'/pr-tracking/check'), tracking_path+'/check', 'post', 202)
    ctx.worker.run()
    validate_response(ctx.client.get(base+'/pr-tracking'), tracking_path)
    listed = validate_response(ctx.client.get(base+'/pull-requests'), listing_path)
    assert listed['pullRequests'][0]['analysisStatus'] == 'queued'
    analyses_path = '/api/v1/pr-snapshots/{snapshotId}/analyses'
    analyses_url = f'/api/v1/pr-snapshots/{snapshot_id}/analyses'
    queued = validate_response(ctx.client.post(analyses_url, json={'modelId': ctx.model['modelId'], 'retry': False}), analyses_path, 'post')
    job = queued['analyses'][0]['sync']
    assert job['sourceKind'] == 'pr' and job['origin'] == 'automatic'
    assert queued['analyses'][0]['bindingKind'] == 'snapshot-model-v1'
    assert queued['analyses'][0]['bindingLimitations'] == []
    ctx.service.sync.complete(job['syncId'], ctx.repo, [dict(id=pr['head']['sha'], epoch=1793232000,
        risk=.4, addedLines=1, deletedLines=1, files=1, features={}, label=0)],
        head_commit=pr['head']['sha'], dataset_version='pr-data', model_id=ctx.model['modelId'],
        run_id=ctx.model['runId'], feature_schema_version=ctx.model['featureSchemaVersion'])
    completed = validate_response(ctx.client.get(analyses_url), analyses_path)
    assert completed['analyses'][0]['bindingKind'] == 'snapshot-model-v1'
    assert completed['analyses'][0]['bindingLimitations'] == []
    binding_validator = contract_validator({'$ref': '#/components/schemas/PRAnalyses'})
    for key, value in [('bindingKind', 'unverified'), ('bindingLimitations', '历史限制')]:
        invalid = json.loads(json.dumps(completed))
        invalid['analyses'][0][key] = value
        assert not binding_validator.is_valid(invalid)
        invalid['analyses'][0].pop(key)
        assert not binding_validator.is_valid(invalid)
    assert completed['analyses'][0]['coverageComplete'] is True
    assert completed['analyses'][0]['scoredCommits'] == completed['analyses'][0]['totalCommits'] == 1
    ctx.watcher._observe()
    events_path = template+'/events'
    events = validate_response(ctx.client.get(base+'/events'), events_path)
    assert {item['kind'] for item in events['events']} == {'pr-initial-summary', 'pr-analysis-ready'}
    validate_response(ctx.client.get('/api/v1/project-events', params={'limit': 1, 'offset': 1}), '/api/v1/project-events')
    paused = validate_response(ctx.client.patch(base+'/pr-tracking', json={'enabled': False}), tracking_path, 'patch')
    assert paused['nextCheckAt'] is None
    non_github = ctx.service.create_repository({'repositoryUrl': 'https://gitlab.com/example/project'})[0]['repositoryId']
    unsupported = validate_response(ctx.client.get(base.replace(ctx.repo, non_github)+'/pull-requests'), listing_path)
    assert unsupported['supported'] is False
    validate_response(ctx.client.post(base.replace(ctx.repo, non_github)+'/pr-tracking/check'), tracking_path+'/check', 'post', 202)


def test_legacy_analysis_binding_response_documents_saved_head_limitations(project_api):
    from jit_baseline.catalog_storage import utc_now

    ctx = project_api
    pr = ctx.github.add()
    prepared = validate_response(ctx.client.post('/api/v1/pr-sources/example/project/1/refresh',
        json={'repositoryId': ctx.repo}), '/api/v1/pr-sources/{owner}/{name}/{number}/refresh', 'post')
    snapshot_id = prepared['snapshot']['snapshotId']
    sync_id = ctx.source(2, kind='pr')
    # 仅在一次性库内布置013升级后的旧关联状态，不替代迁移服务自身的验证。
    with ctx.service.sync.storage.connection(write=True) as db:
        db.execute('UPDATE repository_sync SET head_commit=?,source_snapshot_id=NULL,resolved_model_id=NULL,feature_schema_version=NULL WHERE id=?',
                   (pr['head']['sha'], sync_id))
        db.execute('INSERT INTO pr_analysis VALUES (?,?,?)', (snapshot_id, sync_id, utc_now()))
        db.execute('INSERT INTO pr_legacy_analysis_binding VALUES (?,?)', (snapshot_id, sync_id))
    url = f'/api/v1/pr-snapshots/{snapshot_id}/analyses'
    path = '/api/v1/pr-snapshots/{snapshotId}/analyses'
    legacy = validate_response(ctx.client.get(url), path)['analyses'][0]
    assert legacy['bindingKind'] == 'legacy-head-v1'
    assert len(legacy['bindingLimitations']) == 2
    assert legacy['contextValid'] is True
    assert legacy['scores'] == [{'commitId': pr['head']['sha'], 'risk': .4, 'files': [], 'addedLines': 1, 'deletedLines': 1, 'fileCount': 1}]
    assert legacy['coverageComplete'] is True
    with ctx.service.sync.storage.connection(write=True) as db:
        db.execute('DELETE FROM repository_commit WHERE sync_id=? AND commit_id=?', (sync_id, pr['head']['sha']))
    partial = validate_response(ctx.client.get(url), path)['analyses'][0]
    assert partial['bindingKind'] == 'legacy-head-v1'
    assert partial['scores'] == [] and partial['scoredCommits'] == 0
    assert partial['coverageComplete'] is False
    with ctx.service.sync.storage.connection(write=True) as db:
        db.execute('DELETE FROM pr_legacy_analysis_binding WHERE snapshot_id=? AND sync_id=?', (snapshot_id, sync_id))
    strict = validate_response(ctx.client.get(url), path)['analyses'][0]
    assert strict['bindingKind'] == 'snapshot-model-v1' and strict['bindingLimitations'] == []
    assert strict['contextValid'] is False and strict['scores'] == []


def test_project_events_all_kinds_and_degraded_cache_match_contract(project_api):
    from jit_baseline.errors import BaselineError

    ctx = project_api
    first = ctx.github.add()
    second = ctx.github.add(number=2, draft=True)
    base = f'/api/v1/repositories/{ctx.repo}'
    template = '/api/v1/repositories/{repositoryId}'
    validate_response(ctx.client.patch(base+'/pr-tracking', json=dict(enabled=True,
        modelId=ctx.model['modelId'], confirmExisting=True)), template+'/pr-tracking', 'patch')

    def check():
        validate_response(ctx.client.post(base+'/pr-tracking/check'), template+'/pr-tracking/check', 'post', 202)
        ctx.worker.run()
        validate_response(ctx.client.get(base+'/pr-tracking'), template+'/pr-tracking')

    check()
    job = ctx.service.repository_syncs(ctx.repo)['syncs'][0]
    ctx.service.sync.complete(job['syncId'], ctx.repo, [dict(id=first['head']['sha'], epoch=1793232000,
        risk=.4, addedLines=1, deletedLines=1, files=1, features={}, label=0)],
        head_commit=first['head']['sha'], dataset_version='event-data', model_id=ctx.model['modelId'],
        run_id=ctx.model['runId'], feature_schema_version=ctx.model['featureSchemaVersion'])
    ctx.watcher._observe()
    ctx.github.add(number=3)
    first['head']['sha'] = 'e'*40
    check()
    newest = ctx.app.state.pr_review.refresh('example', 'project', 1, ctx.repo)['snapshot']['snapshotId']
    job = ctx.app.state.pr_review.analyses(newest)['analyses'][0]['sync']
    ctx.service.sync.update(job['syncId'], status='failed', error_code='INFERENCE_ERROR', error_message='测试推理故障')
    ctx.watcher._observe()
    first['state'] = second['state'] = 'closed'
    second['merged'] = True
    check()
    page = validate_response(ctx.client.get(base+'/events', params={'limit': 100}), template+'/events')
    assert {event['kind'] for event in page['events']} == {
        'pr-initial-summary', 'pr-discovered', 'pr-updated', 'pr-closed', 'pr-merged',
        'pr-analysis-ready', 'pr-analysis-failed'}
    global_events = validate_response(ctx.client.get('/api/v1/project-events', params={'limit': 100}), '/api/v1/project-events')
    assert global_events == page
    validator = contract_validator({'$ref': '#/components/schemas/ProjectEvent'})
    for event in page['events']:
        assert not validator.is_valid(dict(event, personalConclusion='不会上传'))
        if event['kind'] == 'pr-analysis-ready':
            assert event['isCurrent'] is False
            missing_fact = dict(event)
            missing_fact.pop('coverageComplete')
            assert not validator.is_valid(missing_fact)
        if event['kind'] == 'pr-initial-summary':
            missing_count = dict(event)
            missing_count.pop('discoveredCount')
            assert not validator.is_valid(missing_count)
    listing = validate_response(ctx.client.get(base+'/pull-requests'), template+'/pull-requests')
    ctx.github.failure = BaselineError('PR_RATE_LIMITED', '测试限流')
    degraded = validate_response(ctx.client.post(base+'/pull-requests/refresh'), template+'/pull-requests/refresh', 'post')
    assert degraded == dict(listing, errorCode='PR_RATE_LIMITED')


def test_project_error_responses_validate_request_ids_and_standard_envelope(project_api, monkeypatch):
    ctx = project_api
    template = '/api/v1/repositories/{repositoryId}'
    for suffix in ('/events', '/pull-requests', '/pr-tracking', '/trend-groups'):
        validate_response(ctx.client.get('/api/v1/repositories/missing'+suffix), template+suffix, status=404)
    for path, params in [('/api/v1/project-events', {'offset': -1}),
                         (template+'/events', {'limit': 101}),
                         (template+'/pull-requests', {'state': 'private'}),
                         (template+'/pull-requests', {'page': 0})]:
        actual = path.replace('{repositoryId}', ctx.repo)
        validate_response(ctx.client.get(actual, params=params), path, status=422)
    from jit_baseline.errors import BaselineError

    def unavailable(*_args, **_kwargs):
        raise BaselineError('STORAGE_UNAVAILABLE', '测试存储故障')

    monkeypatch.setattr(ctx.watcher, 'events', unavailable)
    validate_response(ctx.client.get('/api/v1/project-events'), '/api/v1/project-events', status=503)


def test_pr_batch_contract_documents_fixed_model_and_real_progress():
    document_ = document()
    schema = document_['components']['schemas']['PRBatchAnalyze']
    assert {'batchId', 'modelId', 'status', 'discoveryComplete', 'counts', 'submission', 'items'} <= set(schema['properties'])
    assert schema['properties']['status']['enum'] == ['discovering', 'running', 'completed', 'partial', 'failed', 'interrupted']
    assert set(schema['properties']['counts']['required']) == {
        'pending', 'queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted', 'skipped'}
    assert set(schema['properties']['submission']['required']) == {
        'pending', 'submitted', 'reused', 'failed', 'skipped'}
    paths = document_['paths']
    assert '202' in paths['/api/v1/repositories/{repositoryId}/pull-requests/analyze']['post']['responses']
    for path in ('/api/v1/repositories/{repositoryId}/pull-request-batches/latest',
                 '/api/v1/repositories/{repositoryId}/pull-request-batches/{batchId}'):
        assert path in paths
    retry = paths['/api/v1/repositories/{repositoryId}/pull-request-batches/{batchId}/retry']['post']
    assert '202' in retry['responses']


def test_multi_project_report_contract_requires_admin_and_controlled_ids():
    document_ = document()
    paths = document_['paths']
    listing = paths['/api/admin/multi-project-reports']['get']
    detail = paths['/api/admin/multi-project-reports/{reportId}']['get']
    assert listing['responses']['401']['$ref'] == '#/components/responses/AdminRequired'
    assert detail['responses']['401']['$ref'] == '#/components/responses/AdminRequired'
    assert detail['responses']['404']['$ref'] == '#/components/responses/NotFound'
    summary = document_['components']['schemas']['MultiProjectReportSummary']
    assert summary['properties']['status']['enum'] == ['complete', 'partial', 'failed', 'invalid']
    assert summary['properties']['reportId']
    assert 'report' in document_['components']['schemas']['MultiProjectReportDetail']['allOf'][1]['properties']


def test_model_benefit_contract_documents_read_only_evaluation():
    document_ = document()
    path = document_['paths']['/api/v1/models/{modelId}/benefit']['get']
    assert path['responses']['401']['$ref'] == '#/components/responses/AdminRequired'
    assert path['responses']['422']['$ref'] == '#/components/responses/ReportInvalid'
    benefit = document_['components']['schemas']['ModelBenefit']
    assert {'modelId', 'runId', 'available', 'reason', 'report'} <= set(benefit['properties'])
    report = document_['components']['schemas']['BenefitReport']
    assert {'kind', 'artifact', 'test', 'strategies', 'conclusion', 'limitations', 'boundary'} <= set(report['required'])
