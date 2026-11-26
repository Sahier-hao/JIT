import csv
import io
import threading
import time
import zipfile

from fastapi.testclient import TestClient
import pytest

from jit_baseline.api import create_app
from jit_baseline.artifacts import build_run, verify_run
from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.config import USER_DATASET_LIMIT
from jit_baseline.datasets import register


ACCOUNT = {'username': 'reader', 'password': 'reader-password-1'}
ENDPOINT = '/api/v1/user/datasets/import-zip?filename=jit.zip'
HEADERS = {'Content-Type': 'application/zip'}
PROJECTS = ('bugzilla', 'columba', 'jdt', 'mozilla', 'platform', 'postgres')


def project_csv():
    stream = io.StringIO()
    writer = csv.writer(stream, lineterminator='\n')
    writer.writerow('transactionid commitdate ns nm nf entropy la ld lt fix ndev pd npt exp rexp sexp bug'.split())
    for number in range(1, 21):
        writer.writerow((number, f'2001/1/{number} 12:00', 1, 2, 3, 0.4,
                         0.12, 0.2, 123.2, 0, 2, 50, 0.5, 3, 2.2, 1, number % 2))
    return stream.getvalue().encode()


def package(members):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, content in members.items():
            archive.writestr(name, content)
    return stream.getvalue()


@pytest.fixture
def workspace(tmp_path):
    root = tmp_path / 'registry'
    root.mkdir()
    seed = tmp_path / 'seed.csv'
    seed.write_text('commit_id,author_date,bugcount,ns,nd,nf,ent,la,ld\n'
                    + 'a' * 40 + ',1350000000,1,1,1,1,0,1,0\n')
    register(seed, dataset='seed', root=root)
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    with TestClient(create_app(tmp_path / 'missing', database=storage.path,
                               artifact_root=tmp_path / 'artifacts', dataset_root=root)) as client:
        yield client, storage, root


def test_import_six_projects_retry_export_and_training_preview(workspace):
    client, storage, _ = workspace
    blob = package({**{f'input/{name}.csv': project_csv() for name in PROJECTS},
                    'script_r/analysis.r': 'print("reference script")'})
    assert client.post(ENDPOINT, content=blob, headers=HEADERS).status_code == 401
    assert client.post('/api/user/register', json=ACCOUNT).status_code == 201
    result = client.post(ENDPOINT, content=blob, headers=HEADERS)
    assert result.status_code == 201, result.text
    body = result.json()
    assert body['createdCount'] == 6
    assert {item['source']['project'] for item in body['datasets']} == set(PROJECTS)
    first = body['datasets'][0]
    assert first['quality']['includedRows'] == 20
    assert first['quality']['positiveLabels'] == 10
    assert first['timeRange']['start'] == '2001-01-01T12:00:00Z'
    assert first['schema'] == 'kamei14-2013-v1'
    version = first['version']
    assert storage.dataset_owners(version) == ['reader']
    preview = client.get(f'/api/v1/user/datasets/{version}/split-preview')
    assert preview.json()['available'] is True
    assert preview.json()['admission']['protocol'] == 'publisher-labels-v1'
    exported = client.get(f'/api/v1/user/datasets/{version}/export')
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        assert archive.read(next(name for name in archive.namelist() if name.endswith('.csv'))) == project_csv()

    retry = client.post(ENDPOINT, content=blob, headers=HEADERS)
    assert retry.status_code == 200, retry.text
    assert retry.json()['createdCount'] == 0
    assert [item['version'] for item in retry.json()['datasets']] == [item['version'] for item in body['datasets']]
    assert len(client.get('/api/v1/user/datasets?scope=mine').json()['datasets']) == 6

    client.post('/api/user/logout')
    assert client.post('/api/user/register', json={**ACCOUNT, 'username': 'other'}).status_code == 201
    assert client.get(f'/api/v1/user/datasets/{version}').status_code == 403


def test_import_history_restores_versions_created_before_background_jobs(workspace):
    client, _, _ = workspace
    assert client.post('/api/user/register', json=ACCOUNT).status_code == 201
    blob = package({'bugzilla.csv': project_csv(), 'jdt.csv': project_csv()})
    imported = client.post(ENDPOINT, content=blob, headers=HEADERS)
    assert imported.status_code == 201, imported.text

    history = client.get('/api/v1/user/dataset-imports').json()['tasks']
    assert len(history) == 1
    task = history[0]
    assert task['legacy'] is True
    assert task['filename'] == 'jit.zip'
    assert task['status'] == 'completed'
    assert {item['version'] for item in task['versions']} == {
        item['version'] for item in imported.json()['datasets']}
    detail = client.get('/api/v1/user/dataset-imports/' + task['taskId'])
    assert detail.status_code == 200
    assert detail.json()['versions'] == task['versions']


@pytest.mark.parametrize('member,content', [
    ('../outside.csv', project_csv()),
    ('input/columba.csv', b'unrelated,columns\n1,2\n'),
], ids=['unsafe-path', 'wrong-schema'])
def test_invalid_member_leaves_no_visible_or_published_versions(workspace, member, content):
    client, storage, root = workspace
    assert client.post('/api/user/register', json=ACCOUNT).status_code == 201
    blob = package({'input/bugzilla.csv': project_csv(), member: content})
    result = client.post(ENDPOINT, content=blob, headers=HEADERS)
    assert result.status_code == 422, result.text
    assert result.json()['error']['code'] == 'DATASET_IMPORT_INVALID'
    assert storage.user_datasets('reader') == []
    assert not list(root.glob('kamei-2013-*/*.json'))


def test_over_quota_rolls_back_and_retry_reuses_versions_at_capacity(workspace):
    client, storage, root = workspace
    assert client.post('/api/user/register', json=ACCOUNT).status_code == 201
    for index in range(USER_DATASET_LIMIT - 1):
        storage.add_dataset_owner(f'previous-{index}', 'reader')
    blob = package({'bugzilla.csv': project_csv(), 'jdt.csv': project_csv()})
    refused = client.post(ENDPOINT, content=blob, headers=HEADERS)
    assert refused.status_code == 429, refused.text
    assert len(storage.user_datasets('reader')) == USER_DATASET_LIMIT - 1
    assert not list(root.glob('kamei-2013-*/*.json'))
    with storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM dataset_record').fetchone()[0] == 0

    single = package({'bugzilla.csv': project_csv()})
    assert client.post(ENDPOINT, content=single, headers=HEADERS).status_code == 201
    replay = client.post(ENDPOINT, content=single, headers=HEADERS)
    assert replay.status_code == 200 and replay.json()['createdCount'] == 0


def test_import_single_published_csv_and_derive(workspace):
    client, _, _ = workspace
    assert client.post('/api/user/register', json=ACCOUNT).status_code == 201
    result = client.post('/api/v1/user/datasets/import?filename=bugzilla.csv&schema=kamei14-2013-v1',
                         content=project_csv(), headers={'Content-Type': 'text/csv'})
    assert result.status_code == 201, result.text
    version = result.json()['version']
    assert result.json()['source']['project'] == 'bugzilla'
    derived = client.post(f'/api/v1/user/datasets/{version}/curation/derive',
                          json={'recipe': {'rules': [{'id': 'max-value', 'field': 'la', 'value': 0.2}]}})
    assert derived.status_code == 200, derived.text
    derived_version = derived.json()['dataset']['version']
    detail = client.get(f'/api/v1/user/datasets/{derived_version}').json()
    assert detail['quality']['includedRows'] == 20
    assert detail['labelRule'] == result.json()['labelRule']


def test_standard_csv_still_accepts_its_own_schema(workspace):
    client, _, _ = workspace
    assert client.post('/api/user/register', json=ACCOUNT).status_code == 201
    blob = ('commit_id,author_date,bugcount,ns,nd,nf,ent,la,ld\n'
            + 'b' * 40 + ',1350000000,1,1,1,1,0,1,0\n').encode()
    result = client.post('/api/v1/user/datasets/import?dataset=ordinary&schema=openstack-six-v1',
                         content=blob, headers={'Content-Type': 'text/csv'})
    assert result.status_code == 201, result.text
    assert result.json()['dataset'] == 'ordinary'
    assert result.json()['quality']['includedRows'] == 1


def test_published_training_replays_the_original_effort_scale(workspace):
    client, _, root = workspace
    assert client.post('/api/user/register', json=ACCOUNT).status_code == 201
    response = client.post(ENDPOINT, content=package({'bugzilla.csv': project_csv()}), headers=HEADERS)
    assert response.status_code == 201, response.text
    version = response.json()['datasets'][0]['version']
    manifest = next(root.glob(f'*/{version}.json'))
    output = root.parent / 'published-run'
    build_run(root, output, algorithm='logistic-regression-l2-v1', metric_set='metric-set-v2',
              dataset_manifest=manifest)
    assert verify_run(output)


def test_background_import_progress_is_available_during_catalog_write(workspace, monkeypatch):
    client, storage, _ = workspace
    assert client.post('/api/user/register', json=ACCOUNT).status_code == 201
    original = CatalogStorage.import_dataset
    writing_second = threading.Event()
    finish_write = threading.Event()

    def pause_write(catalog, manifest, records, **kwargs):
        if manifest.get('benchmark', {}).get('project') == 'jdt':
            write_progress = kwargs['progress']

            def report_and_pause(written):
                write_progress(written)
                writing_second.set()
                assert finish_write.wait(12)

            kwargs['progress'] = report_and_pause
        return original(catalog, manifest, records, **kwargs)

    monkeypatch.setattr(CatalogStorage, 'import_dataset', pause_write)
    endpoint = '/api/v1/user/dataset-imports?format=zip&filename=jit.zip'
    blob = package({'bugzilla.csv': project_csv(), 'jdt.csv': project_csv()})
    try:
        response = client.post(endpoint, content=blob, headers=HEADERS)
        assert response.status_code == 202, response.text
        task = response.json()
        detail = '/api/v1/user/dataset-imports/' + task['taskId']
        assert writing_second.wait(8)
        progress = client.get(detail).json()
        assert (progress['status'], progress['stage']) == ('running', 'importing')
        assert (progress['processed'], progress['total'], progress['currentFile']) == (1, 2, 'jdt.csv')
        assert (progress['rowsWritten'], progress['rowsTotal']) == (20, 20)
        assert not storage.user_datasets('reader')
        active = client.get('/api/v1/user/dataset-imports?activeOnly=true').json()
        assert [task['taskId'] for task in active['tasks']] == [progress['taskId']]
        replay = client.post(endpoint, content=blob, headers=HEADERS)
        assert replay.json()['taskId'] == task['taskId']
    finally:
        finish_write.set()
    for _ in range(80):
        completed = client.get(detail).json()
        if completed['status'] != 'running':
            break
        time.sleep(.05)
    assert completed['status'] == 'completed', completed
    assert completed['processed'] == 2 and len(completed['versions']) == 2
    assert client.get('/api/v1/user/dataset-imports?activeOnly=true').json()['tasks'] == []


def test_background_failed_import_keeps_reason_and_allows_another_upload(workspace):
    client, storage, _ = workspace
    assert client.post('/api/user/register', json=ACCOUNT).status_code == 201

    def finish(response):
        assert response.status_code == 202, response.text
        path = '/api/v1/user/dataset-imports/' + response.json()['taskId']
        for _ in range(80):
            result = client.get(path).json()
            if result['status'] in ('completed', 'failed', 'interrupted'):
                return path, result
            time.sleep(.05)
        pytest.fail('import did not finish')

    failed_path, failed = finish(client.post(
        '/api/v1/user/dataset-imports?format=zip&filename=bad.zip',
        content=package({'bugzilla.csv': b'unrelated,columns\n1,2\n'}), headers=HEADERS))
    assert failed['status'] == 'failed'
    assert 'bugzilla.csv' in failed['error']['message']
    assert storage.user_datasets('reader') == []

    standard = ('commit_id,author_date,bugcount,ns,nd,nf,ent,la,ld\n'
                + 'b' * 40 + ',1350000000,1,1,1,1,0,1,0\n').encode()
    _, result = finish(client.post(
        '/api/v1/user/dataset-imports?format=csv&filename=normal.csv&schema=openstack-six-v1',
        content=standard, headers={'Content-Type': 'text/csv'}))
    assert result['status'] == 'completed'
    assert result['versions'][0]['version'] == result['preferredVersion']
    assert len(storage.user_datasets('reader')) == 1

    assert client.post('/api/user/logout').status_code == 204
    assert client.post('/api/user/register', json={**ACCOUNT, 'username': 'different'}).status_code == 201
    assert client.get(failed_path).status_code == 404
    assert client.get('/api/v1/user/dataset-imports').json()['tasks'] == []
