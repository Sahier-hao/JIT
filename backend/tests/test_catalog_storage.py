import sqlite3

import pytest

from jit_baseline.errors import BaselineError


def test_initialize_is_versioned_idempotent_and_reopens(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage
    store = CatalogStorage(tmp_path / 'catalog.sqlite3')
    store.initialize()
    store.initialize()
    with store.connection() as db:
        assert db.execute('PRAGMA foreign_keys').fetchone()[0] == 1
        assert db.execute('SELECT version FROM schema_migration').fetchone()[0] == 1
        assert db.execute('SELECT count(*) FROM model_version').fetchone()[0] == 0
    with CatalogStorage(store.path).connection() as db:
        assert db.execute('SELECT count(*) FROM prediction').fetchone()[0] == 0


def test_missing_or_wrong_version_never_creates_database(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage
    store = CatalogStorage(tmp_path / 'missing.sqlite3')
    with pytest.raises(BaselineError, match='目录存储') as error:
        with store.connection():
            pass
    assert error.value.code == 'STORAGE_UNAVAILABLE'
    assert not store.path.exists()
    store.initialize()
    with sqlite3.connect(store.path) as db:
        db.execute('UPDATE schema_migration SET version=99')
    with pytest.raises(BaselineError):
        store.initialize()
    with pytest.raises(BaselineError):
        with store.connection():
            pass


def test_transaction_rolls_back_and_constraints_reject_invalid_records(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage
    store = CatalogStorage(tmp_path / 'catalog.sqlite3')
    store.initialize()
    with pytest.raises(BaselineError):
        with store.connection(write=True) as db:
            db.execute("INSERT INTO dataset_version VALUES ('d','original','{}')")
            db.execute("INSERT INTO dataset_version VALUES ('d2','original','{}')")
    with store.connection() as db:
        assert db.execute('SELECT count(*) FROM dataset_version').fetchone()[0] == 0
    with pytest.raises(BaselineError):
        with store.connection(write=True) as db:
            db.execute("INSERT INTO experiment_run VALUES ('r','artifact','missing','{}','{}')")


def test_migration_failure_is_atomic(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage
    store = CatalogStorage(tmp_path / 'broken.sqlite3')
    bad = tmp_path / 'bad.sql'
    bad.write_text('CREATE TABLE partial(id INTEGER); INVALID SQL;', encoding='utf-8')
    with pytest.raises(BaselineError):
        store.initialize(migration=bad)
    with sqlite3.connect(store.path) as db:
        assert db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == []


def test_busy_timeout_is_classified_and_rolls_back(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage
    store = CatalogStorage(tmp_path / 'locked.sqlite3', timeout=0.02)
    store.initialize()
    with sqlite3.connect(store.path) as blocker:
        blocker.execute('BEGIN IMMEDIATE')
        with pytest.raises(BaselineError) as error:
            with store.connection(write=True):
                pass
        assert error.value.code == 'STORAGE_UNAVAILABLE'
        blocker.rollback()


def test_initialize_cli_is_explicit(tmp_path, monkeypatch, capsys):
    import json
    from jit_baseline.cli import main
    database = tmp_path / 'catalog.sqlite3'
    monkeypatch.setattr('sys.argv', ['jit', 'catalog-init', '--database', str(database)])
    main()
    result = json.loads(capsys.readouterr().out)
    assert result == {'kind': 'catalog-initialized', 'version': 1}
    assert database.exists()


def test_initialize_cli_uses_same_database_environment_as_http(tmp_path, monkeypatch, capsys):
    from jit_baseline.cli import main
    database = tmp_path / 'environment.sqlite3'
    monkeypatch.setenv('JIT_CATALOG_DATABASE', str(database))
    monkeypatch.setattr('sys.argv', ['jit', 'catalog-init'])
    main()
    capsys.readouterr()
    assert database.exists()
