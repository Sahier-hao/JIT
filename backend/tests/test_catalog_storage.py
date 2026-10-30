import sqlite3

import pytest

from jit_baseline.errors import BaselineError
from jit_baseline.catalog_storage import VERSION


def test_initialize_is_versioned_idempotent_and_reopens(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage
    store = CatalogStorage(tmp_path / 'catalog.sqlite3')
    store.initialize()
    store.initialize()
    with store.connection() as db:
        assert db.execute('PRAGMA foreign_keys').fetchone()[0] == 1
        assert db.execute('SELECT version FROM schema_migration').fetchone()[0] == VERSION
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
        store.initialize(migrations=((1, bad),), version=1)
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
    assert result == {'kind': 'catalog-initialized', 'version': VERSION}
    assert database.exists()


def test_upgrade_keeps_consistent_v12_backup_pr_references_and_unknown_sources(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage, MIGRATIONS
    database = tmp_path / 'legacy.sqlite3'
    with sqlite3.connect(database) as db:
        db.execute('PRAGMA foreign_keys=ON')
        for number, path in MIGRATIONS:
            if number <= 12:
                db.executescript(path.read_text(encoding='utf-8'))
        db.execute("INSERT INTO schema_migration VALUES (12,'fixture')")
        db.execute("INSERT INTO repository(id,url,display_name,view_sync_id,created_at,updated_at) "
                   "VALUES ('project','https://github.com/example/project','项目','pr-job','fixture','fixture')")
        for identity in ('pr-job', 'unknown-job'):
            db.execute("INSERT INTO repository_sync(id,repository_id,repository_url,branch,requested_strategy,status,stage,"
                       "model_id,resolved_model_id,created_at,updated_at) VALUES (?, 'project',"
                       "'https://github.com/example/project',?,'generic-model','completed','completed','model','model','fixture','fixture')",
                       (identity, 'a'*40))
        db.execute("INSERT INTO pr_snapshot VALUES ('snapshot','project','Example','Project',12,?,?,?, 'fixture')",
                   ('a'*40, 'b'*40, '{"snapshotId":"snapshot"}'))
        db.execute("INSERT INTO pr_latest VALUES ('Example','Project',12,'snapshot','open','fixture')")
        db.execute("INSERT INTO pr_file_content VALUES ('snapshot','src/file.py','head','{}')")
        db.execute("INSERT INTO pr_analysis VALUES ('snapshot','pr-job','fixture')")
        db.execute("INSERT INTO repository_commit VALUES ('pr-job','commit',1,.4,1,0,1,'{}',0,NULL,'标题','作者')")
    store = CatalogStorage(database)
    store.initialize()
    backups = list(tmp_path.glob('legacy.sqlite3.before-v12-*.sqlite3'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as db:
        assert db.execute('SELECT version FROM schema_migration').fetchone()[0] == 12
        assert db.execute('SELECT count(*) FROM pr_analysis').fetchone()[0] == 1
        assert 'source_kind' not in [row[1] for row in db.execute('PRAGMA table_info(repository_sync)')]
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    store.initialize()
    assert list(tmp_path.glob('legacy.sqlite3.before-v12-*.sqlite3')) == backups
    with store.connection() as db:
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        assert db.execute("SELECT source_kind,source_snapshot_id,resolved_model_id FROM repository_sync WHERE id='pr-job'").fetchone()[:] == ('pr','snapshot','model')
        assert db.execute("SELECT source_kind FROM repository_sync WHERE id='unknown-job'").fetchone()[0] == 'unknown'
        assert db.execute('SELECT repository_id,snapshot_id FROM pr_latest').fetchone()[:] == ('project','snapshot')
        assert db.execute('SELECT count(*) FROM pr_file_content').fetchone()[0] == 1
        assert db.execute('SELECT count(*) FROM pr_analysis').fetchone()[0] == 1
        assert db.execute('SELECT snapshot_id,sync_id FROM pr_legacy_analysis_binding').fetchone()[:] == ('snapshot', 'pr-job')
        assert db.execute('SELECT count(*) FROM repository_commit').fetchone()[0] == 1
        assert db.execute("SELECT view_sync_id FROM repository WHERE id='project'").fetchone()[0] == 'pr-job'
        assert db.execute('SELECT count(*) FROM pr_watch').fetchone()[0] == 0
    with store.connection(write=True) as db:
        db.execute("INSERT INTO pr_analysis VALUES ('snapshot','unknown-job','post-migration')")
    store.initialize()
    with store.connection() as db:
        assert db.execute('SELECT count(*) FROM pr_analysis').fetchone()[0] == 2
        assert db.execute('SELECT snapshot_id,sync_id FROM pr_legacy_analysis_binding').fetchall()[0][:] == ('snapshot', 'pr-job')
        assert db.execute('SELECT count(*) FROM pr_legacy_analysis_binding').fetchone()[0] == 1
    with store.connection(write=True) as db:
        db.execute("DELETE FROM pr_analysis WHERE snapshot_id='snapshot' AND sync_id='pr-job'")
    with store.connection() as db:
        assert db.execute('SELECT count(*) FROM pr_legacy_analysis_binding').fetchone()[0] == 0
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []


def test_failed_upgrade_keeps_original_and_backup(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage, MIGRATIONS
    database = tmp_path / 'failed-upgrade.sqlite3'
    with sqlite3.connect(database) as db:
        for number, path in MIGRATIONS:
            if number <= 12:
                db.executescript(path.read_text(encoding='utf-8'))
        db.execute("INSERT INTO schema_migration VALUES (12,'fixture')")
    broken = tmp_path / 'broken.sql'
    broken.write_text('CREATE TABLE must_rollback(id TEXT); INVALID SQL;', encoding='utf-8')
    with pytest.raises(BaselineError):
        CatalogStorage(database).initialize(migrations=(*MIGRATIONS[:12], (13, broken)))
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT version FROM schema_migration').fetchone()[0] == 12
        assert db.execute("SELECT name FROM sqlite_master WHERE name='must_rollback'").fetchall() == []
    assert len(list(tmp_path.glob('failed-upgrade.sqlite3.before-v12-*.sqlite3'))) == 1


def test_backup_failure_prevents_upgrade(tmp_path, monkeypatch):
    from jit_baseline.catalog_storage import CatalogStorage, MIGRATIONS
    from pathlib import Path
    database = tmp_path / 'backup-failure.sqlite3'
    with sqlite3.connect(database) as db:
        for number, path in MIGRATIONS:
            if number <= 12:
                db.executescript(path.read_text(encoding='utf-8'))
        db.execute("INSERT INTO schema_migration VALUES (12,'fixture')")
    original = Path.open
    def denied(path, *args, **kwargs):
        if '.before-v12-' in path.name:
            raise PermissionError('备份目录不可写')
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, 'open', denied)
    with pytest.raises(BaselineError):
        CatalogStorage(database).initialize()
    with sqlite3.connect(database) as db:
        assert db.execute('SELECT version FROM schema_migration').fetchone()[0] == 12


def test_initialize_cli_uses_same_database_environment_as_http(tmp_path, monkeypatch, capsys):
    from jit_baseline.cli import main
    database = tmp_path / 'environment.sqlite3'
    monkeypatch.setenv('JIT_CATALOG_DATABASE', str(database))
    monkeypatch.setattr('sys.argv', ['jit', 'catalog-init'])
    main()
    capsys.readouterr()
    assert database.exists()


def _seed_commits(store, version='demo-v1', count=3):
    with store.connection(write=True) as db:
        db.execute('INSERT INTO dataset_record VALUES (?,?,?,?,?,?,?)',
                   (version, 'demo', '{}', 'manifest-sha', 'source-sha', count, '2026-01-01T00:00:00Z'))
        for index in range(count):
            commit_id = f'{index:040x}'
            db.execute('INSERT INTO commit_record VALUES (?,?,?,?,?)',
                       (version, commit_id, f'2026-01-0{index + 1}T00:00:00Z', index % 2, 'bugcount > 0'))
            db.execute('INSERT INTO feature_record VALUES (?,?,?,?)', (version, commit_id, 'nf', '1'))


def test_commits_support_limit_offset_and_total(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage
    store = CatalogStorage(tmp_path / 'catalog.sqlite3')
    store.initialize()
    _seed_commits(store)
    first = store.commits('demo-v1', limit=2, offset=0)
    assert [row['commitId'] for row in first] == [f'{index:040x}' for index in range(2)]
    assert store.count_commits('demo-v1') == 3
    second = store.commits('demo-v1', limit=2, offset=2)
    assert [row['commitId'] for row in second] == [f'{2:040x}']
    assert len(store.commits('demo-v1')) == 3
    assert store.commits('missing', limit=2) is None
    assert store.count_commits('missing') is None


def test_commits_by_entity_support_pagination(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage
    store = CatalogStorage(tmp_path / 'catalog.sqlite3')
    store.initialize()
    _seed_commits(store)
    with store.connection(write=True) as db:
        for index in range(3):
            db.execute('INSERT INTO modified_entity (dataset_version, commit_id, entity_type, entity_value) '
                       'VALUES (?,?,?,?)', ('demo-v1', f'{index:040x}', 'module', 'nova'))
    assert len(store.commits_by_entity('module', 'nova', limit=1)) == 1
    assert store.count_by_entity('module', 'nova') == 3
    assert store.commits_by_entity('module', 'absent') == []
    assert store.count_by_entity('module', 'absent') == 0
