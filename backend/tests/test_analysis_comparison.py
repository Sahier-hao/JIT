"""Two saved successful analyses are compared without recomputing either score."""
from uuid import uuid4

import pytest

from test_review_plan import plan_context  # noqa: F401
from test_artifacts import real_run  # noqa: F401
from jit_baseline.catalog import ModelCatalog
from jit_baseline.catalog_storage import utc_now


@pytest.fixture
def comparison(plan_context):
    client, service, _, params, manifest = plan_context
    repo = manifest['source']['repositoryId']
    target = str(uuid4())
    service.sync.create(dict(id=target, repository_url='https://github.com/example/plans', repository_id=repo,
        branch='release', requested_strategy='generic-model', status='scoring', stage='scoring',
        created_at=utc_now(), updated_at=utc_now()))
    service.sync.complete(target, repo, [dict(id=f'{i:040x}', epoch=1700000010,
        risk=.5 if i==1 else .2, addedLines=1, deletedLines=2, files=1,
        features={'la': 4} if i==2 else {}, label=1) for i in range(1,27)],
        head_commit='b'*40, dataset_version='target-data', model_id=str(uuid4()), run_id=str(uuid4()))
    return client, service, f'/api/v1/repositories/{repo}/comparison', dict(baseSyncId=params['viewSyncId'],targetSyncId=target), repo


def test_comparison_retains_both_sources_and_saved_scores_without_loading_models(comparison, monkeypatch):
    client, service, path, params, repo = comparison
    monkeypatch.setattr(ModelCatalog, 'load_model', lambda *_: pytest.fail('comparison must not infer'))
    before = service.repository(repo)
    response = client.get(path, params=params)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['repositoryId']==repo
    assert body['base']['syncId']==params['baseSyncId'] and body['target']['syncId']==params['targetSyncId']
    assert body['base']['branch']=='main' and body['target']['branch']=='release'
    assert body['base']['modelId']!=body['target']['modelId'] and body['sameModel'] is False
    assert body['counts']==dict(added=1,removed=1,changed=2,unchanged=23)
    assert body['total']==27 and body['limitations']
    changed={row['commitId']:row for row in body['commits'] if row['status']=='changed'}
    score=changed[f'{1:040x}']
    assert score['baseRisk']==.2 and score['targetRisk']==.5 and score['riskDelta']==pytest.approx(.3)
    assert changed[f'{2:040x}']['featuresChanged'] is True
    assert changed[f'{2:040x}']['riskDelta']==0
    assert service.repository(repo)==before
    assert client.get(path,params=params).json()==body


def test_filters_pages_and_stable_order_cover_union_without_dropping_commits(comparison):
    client, _, path, params, _ = comparison
    pages=[client.get(path,params=dict(params,limit=10,offset=offset)).json() for offset in (0,10,20)]
    ids=[row['commitId'] for page in pages for row in page['commits']]
    assert len(ids)==len(set(ids))==27
    changed=client.get(path,params=dict(params,change='changed')).json()
    assert changed['total']==2 and len(changed['commits'])==2
    assert changed['counts']==pages[0]['counts']
    added=client.get(path,params=dict(params,change='added')).json()['commits'][0]
    assert added['baseRisk'] is None and added['targetRisk']==.2 and added['riskDelta'] is None
    removed=client.get(path,params=dict(params,change='removed')).json()['commits'][0]
    assert removed['baseRisk']==.2 and removed['targetRisk'] is None


def test_requires_two_distinct_successful_analyses_from_this_project(comparison):
    client, service, path, params, repo = comparison
    assert client.get(path).status_code==422
    assert client.get(path,params=dict(params,targetSyncId=params['baseSyncId'])).status_code==422
    assert client.get(path,params=dict(params,targetSyncId=str(uuid4()))).status_code==404
    foreign,_=service.create_repository({'repositoryUrl':'https://github.com/example/foreign'})
    assert client.get(path.replace(repo,foreign['repositoryId']),params=params).status_code==404
    with service.sync.storage.connection(write=True) as db:
        db.execute("UPDATE repository_sync SET status='failed' WHERE id=?",(params['targetSyncId'],))
    failure=client.get(path,params=params)
    assert failure.status_code==409 and failure.json()['error']['requestId']


@pytest.mark.parametrize('query',[{'limit':0},{'limit':201},{'offset':-1},{'change':'unknown'}])
def test_invalid_comparison_queries_use_public_error_envelope(comparison,query):
    client, _, path, params, _=comparison
    response=client.get(path,params=dict(params,**query))
    assert response.status_code==422 and response.json()['error']['requestId']


def test_legacy_unknown_models_are_not_claimed_to_be_the_same_model(comparison):
    client, service, path, params, _=comparison
    with service.sync.storage.connection(write=True) as db:
        db.execute('UPDATE repository_sync SET model_id=NULL,run_id=NULL')
    body=client.get(path,params=params).json()
    assert body['sameModel'] is False
    assert body['base']['modelId'] is None and body['target']['runId'] is None


def test_comparison_contract_is_documented(comparison):
    from pathlib import Path
    yaml=pytest.importorskip('yaml'); jsonschema=pytest.importorskip('jsonschema')
    document=yaml.safe_load((Path(__file__).resolve().parents[2]/'docs/api/openapi.yaml').read_text(encoding='utf-8'))
    endpoint=document['paths']['/api/v1/repositories/{repositoryId}/comparison']['get']
    assert endpoint['security']==[]
    client, _, path, params, _=comparison
    validator=jsonschema.Draft202012Validator({'$ref':'#/components/schemas/AnalysisComparison','components':document['components']})
    validator.validate(client.get(path,params=params).json())


def test_cached_registered_names_do_not_require_loading_artifacts(comparison,real_run,tmp_path,monkeypatch):
    import shutil
    client, service, path, params, _=comparison
    root=tmp_path/'metadata-artifacts'
    shutil.copytree(real_run,root/'baseline')
    model=ModelCatalog(service.sync.storage,root).register_key('baseline')['model']
    with service.sync.storage.connection(write=True) as db:
        db.execute('UPDATE repository_sync SET model_id=?,run_id=?',(model['modelId'],model['runId']))
    monkeypatch.setattr(ModelCatalog,'load_model',lambda *_:pytest.fail('cached name must not load artifacts'))
    body=client.get(path,params=params).json()
    assert body['base']['modelName']==body['target']['modelName']==model['name']
    assert body['sameModel'] is True
