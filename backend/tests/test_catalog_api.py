import json
import shutil
import logging

import pytest
from fastapi.testclient import TestClient

from test_artifacts import real_run  # noqa: F401

ADMIN = {'Authorization': 'Bearer fixture-admin'}
MEMBER = {'Authorization': 'Bearer fixture-member'}


@pytest.fixture
def settings(tmp_path, real_run):
    from jit_baseline.catalog_storage import CatalogStorage
    root = tmp_path / 'artifacts'
    shutil.copytree(real_run, root / 'baseline')
    store = CatalogStorage(tmp_path / 'catalog.sqlite3')
    store.initialize()
    return {'directory': real_run, 'database': store.path, 'artifact_root': root,
            'member_token': 'fixture-member', 'admin_token': 'fixture-admin'}


def test_admin_register_member_list_and_cli_share_identity(settings, monkeypatch, capsys, caplog):
    from jit_baseline.api import create_app
    from jit_baseline.cli import main
    caplog.set_level(logging.INFO, logger='jit.catalog')
    with TestClient(create_app(**settings)) as client:
        assert client.get('/api/v1/models', headers=MEMBER).json() == {'models': []}
        candidate = client.get('/api/v1/model-candidates', headers=ADMIN).json()['candidates'][0]
        data = {'candidateId': candidate['candidateId'], 'expectedManifestSha256': candidate['manifestSha256']}
        first = client.post('/api/v1/models/register', headers=ADMIN, json=data)
        assert first.status_code == 201
        assert first.json()['model']['modelId'] in caplog.text
        assert client.post('/api/v1/models/register', headers=ADMIN, json=data).status_code == 200
        models = client.get('/api/v1/models', headers=MEMBER).json()['models']
        assert len(models) == 1 and models[0]['modelId'] == first.json()['model']['modelId']
        assert str(settings['artifact_root']) not in json.dumps(models)
        monkeypatch.setattr('sys.argv', ['jit', 'register-model', '--run-key', 'baseline',
                             '--database', str(settings['database']),
                             '--artifact-root', str(settings['artifact_root'])])
        main()
        assert json.loads(capsys.readouterr().out)['model']['modelId'] == models[0]['modelId']


@pytest.mark.parametrize('change,code', [('unknown','NOT_FOUND'), ('changed','CONTEXT_MISMATCH'),
                                      ('path','INPUT_INVALID'), ('broken','INTEGRITY_ERROR')])
def test_register_errors_never_publish_models(settings, change, code):
    from jit_baseline.api import create_app
    with TestClient(create_app(**settings)) as client:
        candidate = client.get('/api/v1/model-candidates', headers=ADMIN).json()['candidates'][0]
        data = {'candidateId': candidate['candidateId'], 'expectedManifestSha256': candidate['manifestSha256']}
        if change == 'unknown':
            data['candidateId'] = '0' * 64
        elif change == 'changed':
            data['expectedManifestSha256'] = '0' * 64
        elif change == 'path':
            data['path'] = str(settings['artifact_root'])
        else:
            (settings['artifact_root'] / 'baseline/model.joblib').write_bytes(b'broken')
        response = client.post('/api/v1/models/register', headers=ADMIN, json=data)
        assert response.json()['error']['code'] == code
        assert response.status_code == {'NOT_FOUND':404,'CONTEXT_MISMATCH':409,'INPUT_INVALID':422,'INTEGRITY_ERROR':503}[code]
        assert client.get('/api/v1/models', headers=MEMBER).json() == {'models': []}


def test_kamei_schema_reports_unavailable_fields(settings):
    from jit_baseline.api import create_app
    with TestClient(create_app(**settings)) as client:
        info = client.get('/api/v1/feature-schemas/kamei14-v1', headers=MEMBER).json()
        assert len(info['inModel']) == 12 and info['jsonPredictionSupported'] is False
        assert {f['name'] for f in info['fields'] if not f['inModel']} == {'lt','rexp'}
