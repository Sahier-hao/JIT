"""SQLite WAL, busy timeout and backup behavior for the catalog storage."""
import sqlite3
import threading


def test_connections_use_wal_synchronous_and_busy_timeout(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage

    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    with storage.connection() as db:
        assert db.execute('PRAGMA journal_mode').fetchone()[0] == 'wal'
        assert db.execute('PRAGMA synchronous').fetchone()[0] == 1
        assert db.execute('PRAGMA busy_timeout').fetchone()[0] == 10000
        assert db.execute('PRAGMA foreign_keys').fetchone()[0] == 1


def test_concurrent_writers_serialize_without_locking_errors(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage

    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    with storage.connection(write=True) as db:
        db.execute('CREATE TABLE wal_probe(value INTEGER NOT NULL)')

    failures: list[BaseException] = []

    def writer(offset: int):
        try:
            for value in range(offset, offset + 50):
                with storage.connection(write=True) as db:
                    db.execute('INSERT INTO wal_probe(value) VALUES (?)', (value,))
        except BaseException as exc:  # pragma: no cover - surfaced below
            failures.append(exc)

    threads = [threading.Thread(target=writer, args=(index * 50,)) for index in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not failures
    with storage.connection() as db:
        assert db.execute('SELECT COUNT(*) FROM wal_probe').fetchone()[0] == 100


def test_backup_under_wal_is_consistent(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage

    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    backup = tmp_path / 'backup.sqlite3'
    source = storage._connect()
    target = sqlite3.connect(backup)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    copied = sqlite3.connect(backup)
    try:
        assert copied.execute('PRAGMA journal_mode').fetchone()[0] == 'wal'
        assert copied.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert copied.execute('SELECT COUNT(*) FROM schema_migration').fetchone()[0] == 1
    finally:
        copied.close()
