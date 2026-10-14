import logging

import pytest
from fastapi.testclient import TestClient


def app(tmp_path, **tokens):
    from jit_baseline.api import create_app
    return create_app(tmp_path / 'missing-run', database=tmp_path / 'missing.sqlite3',
                      artifact_root=tmp_path / 'artifacts', **tokens)


@pytest.mark.parametrize('tokens', [dict(member_token='', admin_token=''),
                                    dict(member_token='same-fixture', admin_token='same-fixture')])
def test_invalid_config_closes_new_routes_not_legacy(tmp_path, tokens):
    with TestClient(app(tmp_path, **tokens)) as client:
        response = client.get('/api/v1/models')
        assert response.status_code == 503
        assert response.json()['error']['code'] == 'ACCESS_CONFIG_INVALID'
        assert client.get('/api/review-batch').json()['error']['code'] == 'ARTIFACT_UNAVAILABLE'
        assert client.post('/api/review-batch').status_code == 405


@pytest.mark.parametrize('authorization', [None, 'Bearer invalid-fixture', 'Basic fixture',
                                           'Bearer fixture-member extra'])
def test_invalid_credentials_are_401_before_business(tmp_path, authorization):
    with TestClient(app(tmp_path, member_token='fixture-member', admin_token='fixture-admin')) as client:
        headers = {} if authorization is None else {'Authorization': authorization}
        response = client.post('/api/v1/models/register', content='invalid JSON', headers=headers)
        assert response.status_code == 401
        assert response.json()['error']['code'] == 'AUTH_REQUIRED'
        assert response.headers['X-Request-Id'] == response.json()['error']['requestId']


def test_member_cannot_discover_or_register_even_with_forged_role(tmp_path, caplog):
    with TestClient(app(tmp_path, member_token='fixture-member', admin_token='fixture-admin')) as client:
        headers = {'Authorization': 'Bearer fixture-member', 'X-Role': 'admin'}
        with caplog.at_level(logging.INFO, logger='jit.catalog'):
            assert client.get('/api/v1/model-candidates', headers=headers).status_code == 403
            response = client.post('/api/v1/models/register', content='not-json', headers=headers)
        assert response.status_code == 403
        assert not (tmp_path / 'missing.sqlite3').exists()
        assert not (tmp_path / 'artifacts').exists()
        assert 'fixture-member' not in caplog.text + response.text
        assert 'Authorization' not in caplog.text
        assert str(tmp_path) not in caplog.text + response.text
        assert 'role=member' in caplog.text


@pytest.mark.parametrize('token', ['fixture-member', 'fixture-admin'])
def test_both_roles_can_query_authoritative_schema(tmp_path, token):
    with TestClient(app(tmp_path, member_token='fixture-member', admin_token='fixture-admin')) as client:
        response = client.get('/api/v1/feature-schemas/openstack-six-v1',
                              headers={'Authorization': 'Bearer ' + token})
        assert response.status_code == 200
        assert response.headers['Cache-Control'] == 'no-store'
        assert response.json()['inModel'] == ['ns', 'nd', 'nf', 'ent', 'la', 'ld']
        missing = client.get('/api/v1/feature-schemas/not-known',
                             headers={'Authorization': 'Bearer ' + token})
        assert missing.status_code == 404
