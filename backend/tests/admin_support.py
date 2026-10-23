"""Explicit authenticated client for maintenance behavior tests; auth tests use TestClient."""
from fastapi.testclient import TestClient


class AdminTestClient(TestClient):
    def __enter__(self):
        client = super().__enter__()
        credentials = {'username': 'test-maintainer', 'password': 'isolated-test-password-2026'}
        response = client.post('/api/admin/setup', json=credentials)
        if response.status_code == 409:
            response = client.post('/api/admin/login', json=credentials)
        assert response.status_code in (200, 201), response.text
        return client
