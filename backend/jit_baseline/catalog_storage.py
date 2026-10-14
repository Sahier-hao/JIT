"""Explicitly migrated catalog. Every connection is local to one operation."""
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .config import BACKEND
from .errors import BaselineError

DEFAULT_DATABASE = BACKEND / 'storage/catalog.sqlite3'
MIGRATION = Path(__file__).parent / 'migrations/001_catalog.sql'
VERSION = 1


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def storage_error():
    return BaselineError('STORAGE_UNAVAILABLE', '目录存储不可用，请检查初始化、版本或存储权限')


class CatalogStorage:
    def __init__(self, path=DEFAULT_DATABASE, *, timeout=5.0):
        self.path = Path(path).resolve()
        self.timeout = timeout

    def _connect(self, *, create=False):
        db = sqlite3.connect(self.path.as_uri() + ('?mode=rwc' if create else '?mode=rw'),
                             uri=True, timeout=self.timeout, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        if db.execute('PRAGMA foreign_keys').fetchone()[0] != 1:
            db.close()
            raise storage_error()
        return db

    @staticmethod
    def _version(db):
        versions = db.execute('SELECT version FROM schema_migration').fetchall()
        if len(versions) != 1 or versions[0][0] != VERSION:
            raise storage_error()

    def initialize(self, *, migration=MIGRATION):
        db = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            db = self._connect(create=True)
            db.execute('BEGIN IMMEDIATE')
            tables = db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            if tables:
                self._version(db)
            else:
                for statement in Path(migration).read_text(encoding='utf-8').split(';'):
                    if statement.strip():
                        db.execute(statement)
                db.execute('INSERT INTO schema_migration VALUES (?,?)', (VERSION, utc_now()))
            db.commit()
        except (sqlite3.Error, OSError) as exc:
            raise storage_error() from exc
        finally:
            if db is not None:
                db.rollback()
                db.close()

    @contextmanager
    def connection(self, *, write=False):
        db = None
        try:
            db = self._connect()
            self._version(db)
            db.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            yield db
            db.commit()
        except (sqlite3.Error, OSError) as exc:
            raise storage_error() from exc
        finally:
            if db is not None:
                db.rollback()
                db.close()
