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


def test_dataset_metadata_batches_analysis_owners_and_sharing(tmp_path):
    from jit_baseline.catalog_storage import CatalogStorage
    from jit_baseline.storage.store import dataset_references

    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    with storage.connection(write=True) as db:
        db.execute("INSERT INTO user_account (username,salt,password_hash,created_at) "
                   "VALUES ('reader','salt','hash','2026-01-01T00:00:00Z')")
        db.execute('INSERT INTO repository_sync (id, repository_url, branch, requested_strategy, status, stage, '
                   'dataset_version, created_at, updated_at) VALUES '
                   "('sync-1','https://example.invalid/repo.git','main','auto','completed','completed',"
                   "'v1','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')")
        db.execute("INSERT INTO dataset_record (dataset_version,dataset_name,manifest_json,manifest_sha256,"
                   "source_sha256,row_count,created_at) VALUES "
                   "('v2','demo','{}','sha','sha',1,'2026-01-01T00:00:00Z')")
        db.execute("INSERT INTO dataset_share VALUES ('v2','admin','2026-01-01T00:00:00Z')")
        db.execute("INSERT INTO dataset_owner VALUES ('v2','reader','2026-01-01T00:00:00Z')")

    metadata = storage.dataset_metadata(['v1', 'v2', 'missing', 'v1'])
    assert set(metadata) == {'v1', 'v2', 'missing'}
    assert metadata['v1']['references'] == ['analysis']
    assert metadata['v1']['owners'] == [] and metadata['v1']['shared'] is False
    assert metadata['v2']['references'] == []
    assert metadata['v2']['owners'] == ['reader'] and metadata['v2']['shared'] is True
    assert metadata['missing'] == {'references': [], 'owners': [], 'shared': False}
    for version in ('v1', 'v2', 'missing'):
        assert metadata[version]['references'] == dataset_references(storage, version)
        assert metadata[version]['owners'] == storage.dataset_owners(version)
        assert metadata[version]['shared'] == storage.dataset_shared(version)


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
