"""Serving in an isolated test session must honor its explicitly owned port."""
import sys

import pytest

from jit_baseline.cli import main


def test_serve_uses_explicit_port(monkeypatch):
    calls = []
    monkeypatch.setattr('uvicorn.run', lambda *args, **kwargs: calls.append((args, kwargs)))
    monkeypatch.setattr(sys, 'argv', ['jit', 'serve', '--port', '18223'])
    main()
    assert calls == [(('jit_baseline.api:app',), {'host': '127.0.0.1', 'port': 18223, 'workers': 1})]


@pytest.mark.parametrize('port', ['0', '65536', 'invalid'])
def test_serve_rejects_invalid_port(monkeypatch, port):
    monkeypatch.setattr(sys, 'argv', ['jit', 'serve', '--port', port])
    with pytest.raises(SystemExit) as exc:
        main()
    assert exc.value.code == 2
