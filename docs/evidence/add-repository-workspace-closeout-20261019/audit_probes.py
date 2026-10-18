"""Isolated contract probes, not new production tests or model experiments."""
import json
from pathlib import Path
from uuid import uuid4
from jit_baseline.catalog_storage import CatalogStorage, utc_now
from jit_baseline.sync import SyncStorage, SyncService, REPOSITORY_COLUMNS

out = Path(__file__).resolve().parent
fixture = out.parent.parent/'fixtures'/f'audit-contract-{uuid4()}.sqlite3'
fixture.parent.mkdir(parents=True, exist_ok=True)
catalog = CatalogStorage(fixture)
catalog.initialize()
storage = SyncStorage(catalog)
now = utc_now()
rid, first, second = str(uuid4()), str(uuid4()), str(uuid4())
repo = {name: None for name in REPOSITORY_COLUMNS}
repo.update(id=rid, url='https://example.com/audit/repo', display_name='audit-repo',
            default_branch='main', commit_count=0, high_count=0, medium_count=0,
            low_count=0, unknown_count=0, created_at=now, updated_at=now)
storage.repository_create(repo)
for sid, branch, status in [(first, 'main', 'completed'), (second, 'release', 'failed')]:
    storage.create(dict(id=sid, repository_url=repo['url'], repository_id=rid,
                        branch=branch, requested_strategy='generic-model', status=status,
                        stage='scoring', created_at=now, updated_at=now))
storage.write_commits(first, [dict(id=name*40, epoch=1720000000, risk=risk,
    addedLines=1, deletedLines=0, files=1, features={}, label=0, subject=name)
    for name, risk in [('a', .1), ('z', .9)]])
storage.repository_refresh(rid, first)
storage.repository_update(rid, latest_sync_id=second, latest_sync_at=now, default_branch='release')
service = object.__new__(SyncService)
service.sync = storage
detail = service.repository(rid)
items, _ = storage.commits(first, sort='time')
result = {
    'kind': 'isolated-contract-probes',
    'fixtureOnly': True,
    'timeTieOrder': {'specExpected': ['a'*40, 'z'*40], 'actual': [x['commitId'] for x in items],
                     'matchesDelta': [x['commitId'] for x in items] == ['a'*40, 'z'*40]},
    'failedBranchSwitch': {'successfulViewBranch': storage.get(detail['viewSyncId'])['branch'],
                          'repositoryDefaultBranch': detail['defaultBranch'],
                          'explicitViewBranchFieldPresent': 'viewBranch' in detail,
                          'successfulViewPreserved': detail['viewSyncId'] == first},
    'limitations': 'No network, repository collection, training or model-effect measurement was performed.'}
(out/'contract-probes.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
