"""Explicitly migrated catalog. Every connection is local to one operation."""
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .config import BACKEND
from .data import sha256
from .errors import BaselineError

DEFAULT_DATABASE = BACKEND / 'storage/catalog.sqlite3'
MIGRATIONS = ((1, Path(__file__).parent / 'migrations/001_catalog.sql'),
              (2, Path(__file__).parent / 'migrations/002_commit_data.sql'),
              (3, Path(__file__).parent / 'migrations/003_repository_sync.sql'))
VERSION = MIGRATIONS[-1][0]
LABEL_RULE = 'bugcount > 0; blank = 0'


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def storage_error():
    return BaselineError('STORAGE_UNAVAILABLE', '目录存储不可用，请检查初始化、版本或存储权限')


def _apply(db, path):
    for statement in Path(path).read_text(encoding='utf-8').split(';'):
        if statement.strip():
            db.execute(statement)


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

    def initialize(self, *, migrations=MIGRATIONS, version=VERSION):
        """建库或把旧版本库按序升级到当前版本；已是最新版本时幂等。"""
        db = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            db = self._connect(create=True)
            db.execute('BEGIN IMMEDIATE')
            tables = db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            current = 0
            if tables:
                versions = db.execute('SELECT version FROM schema_migration').fetchall()
                if len(versions) != 1:
                    raise storage_error()
                current = versions[0][0]
            if current > version:
                raise storage_error()
            for number, path in migrations:
                if current < number <= version:
                    _apply(db, path)
            if current == 0:
                db.execute('INSERT INTO schema_migration VALUES (?,?)', (version, utc_now()))
            elif current != version:
                db.execute('UPDATE schema_migration SET version=?, applied_at=? WHERE version=?',
                           (version, utc_now(), current))
            self._version(db)
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

    # --- 提交数据导入（CMP-01..CMP-06） --------------------------------------------------
    @staticmethod
    def _manifest_dump(manifest):
        return json.dumps(manifest, ensure_ascii=False, sort_keys=True, allow_nan=False, indent=2) + '\n'

    def import_dataset(self, manifest, records):
        """单事务导入一个数据集版本；同版本同内容幂等，内容不同拒绝覆盖。"""
        version = manifest['version']
        text = self._manifest_dump(manifest)
        digest = sha256(text.encode('utf-8'))
        started = utc_now()
        with self.connection(write=True) as db:
            row = db.execute('SELECT manifest_sha256 FROM dataset_record WHERE dataset_version=?',
                             (version,)).fetchone()
            if row is not None:
                if row[0] != digest:
                    raise BaselineError('DATASET_EXISTS', f'数据集版本已导入且内容不同，不覆盖：{version}')
                return {'datasetVersion': version, 'created': False,
                        'commits': db.execute('SELECT COUNT(*) FROM commit_record WHERE dataset_version=?',
                                              (version,)).fetchone()[0]}
            db.execute('INSERT INTO dataset_record VALUES (?,?,?,?,?,?,?)',
                       (version, manifest['dataset'], text, digest, manifest['file']['sha256'],
                        len(records), started))
            db.executemany('INSERT INTO commit_record VALUES (?,?,?,?,?)',
                           [(version, record['id'], record['time'], record['label'], LABEL_RULE)
                            for record in records])
            db.executemany('INSERT INTO feature_record VALUES (?,?,?,?)',
                           [(version, record['id'], field, json.dumps(value, allow_nan=False))
                            for record in records for field, value in sorted(record['metrics'].items())])
            db.execute('INSERT INTO import_run VALUES (?,?,?,?,?,?,?)',
                       (uuid.uuid4().hex, version, 'success', len(records), None, started, utc_now()))
        return {'datasetVersion': version, 'created': True, 'commits': len(records)}

    def record_import_failure(self, version, error_code, started):
        """导入失败后单独写入失败记录；存储不可用时不影响原始错误。"""
        try:
            with self.connection(write=True) as db:
                db.execute('INSERT INTO import_run VALUES (?,?,?,?,?,?,?)',
                           (uuid.uuid4().hex, version, 'failed', 0, error_code, started, utc_now()))
        except BaselineError:
            pass

    # --- 只读查询（CMP-05） ---------------------------------------------------------------
    def _features(self, db, version, commit_ids):
        collected = {commit_id: {} for commit_id in commit_ids}
        if not commit_ids:
            return collected
        for row in db.execute('SELECT commit_id, field, value_json FROM feature_record WHERE dataset_version=?',
                              (version,)).fetchall():
            if row['commit_id'] in collected:
                collected[row['commit_id']][row['field']] = json.loads(row['value_json'])
        return collected

    @staticmethod
    def _commit_row(row, features):
        return {'commitId': row['commit_id'], 'datasetVersion': row['dataset_version'],
                'authorTime': row['author_time'], 'label': row['label'],
                'labelRule': row['label_rule'], 'features': features}

    @staticmethod
    def _summary_row(row, module):
        return {'commitId': row['commit_id'], 'authorTime': row['author_time'],
                'label': row['label'], 'module': module}

    def _modules(self, db, version, commit_ids):
        collected = {}
        if not commit_ids:
            return collected
        wanted = set(commit_ids)
        for row in db.execute("SELECT commit_id, entity_value FROM modified_entity "
                              "WHERE dataset_version=? AND entity_type='module' "
                              "ORDER BY entity_value", (version,)).fetchall():
            if row['commit_id'] in wanted:
                collected.setdefault(row['commit_id'], row['entity_value'])
        return collected

    def datasets(self):
        with self.connection() as db:
            rows = db.execute('SELECT * FROM dataset_record ORDER BY dataset_version').fetchall()
        return [{'datasetVersion': row['dataset_version'], 'datasetName': row['dataset_name'],
                 'manifest': json.loads(row['manifest_json']), 'manifestSha256': row['manifest_sha256'],
                 'sourceSha256': row['source_sha256'], 'rowCount': row['row_count'],
                 'importedAt': row['created_at']} for row in rows]

    def dataset(self, version):
        with self.connection() as db:
            row = db.execute('SELECT * FROM dataset_record WHERE dataset_version=?', (version,)).fetchone()
        if row is None:
            return None
        return {'datasetVersion': row['dataset_version'], 'datasetName': row['dataset_name'],
                'manifest': json.loads(row['manifest_json']), 'manifestSha256': row['manifest_sha256'],
                'sourceSha256': row['source_sha256'], 'rowCount': row['row_count'],
                'importedAt': row['created_at']}

    def commits(self, version, limit=None, offset=0, summary=False):
        with self.connection() as db:
            if db.execute('SELECT 1 FROM dataset_record WHERE dataset_version=?', (version,)).fetchone() is None:
                return None
            query = ('SELECT * FROM commit_record WHERE dataset_version=? '
                     'ORDER BY author_time, commit_id')
            params = [version]
            if limit is not None:
                query += ' LIMIT ? OFFSET ?'
                params.extend((limit, offset))
            rows = db.execute(query, params).fetchall()
            if summary:
                modules = self._modules(db, version, [row['commit_id'] for row in rows])
                return [self._summary_row(row, modules.get(row['commit_id'])) for row in rows]
            features = self._features(db, version, [row['commit_id'] for row in rows])
        return [self._commit_row(row, features[row['commit_id']]) for row in rows]

    def count_commits(self, version):
        with self.connection() as db:
            if db.execute('SELECT 1 FROM dataset_record WHERE dataset_version=?', (version,)).fetchone() is None:
                return None
            return db.execute('SELECT COUNT(*) FROM commit_record WHERE dataset_version=?',
                              (version,)).fetchone()[0]

    def commit(self, version, commit_id):
        with self.connection() as db:
            row = db.execute('SELECT * FROM commit_record WHERE dataset_version=? AND commit_id=?',
                             (version, commit_id)).fetchone()
            if row is None:
                return None
            features = self._features(db, version, [commit_id])
        return self._commit_row(row, features[commit_id])

    def commits_by_entity(self, entity_type, entity_value, limit=None, offset=0, summary=False):
        """按已经持久化的文件或模块引用查提交（CMP-03）；测试用查询入口。"""
        with self.connection() as db:
            query = ('SELECT c.* FROM commit_record c JOIN modified_entity e '
                     'ON e.dataset_version = c.dataset_version AND e.commit_id = c.commit_id '
                     'WHERE e.entity_type=? AND e.entity_value=? ORDER BY c.author_time, c.commit_id')
            params = [entity_type, entity_value]
            if limit is not None:
                query += ' LIMIT ? OFFSET ?'
                params.extend((limit, offset))
            rows = db.execute(query, params).fetchall()
            if rows and summary:
                modules = self._modules(db, rows[0]['dataset_version'], [row['commit_id'] for row in rows])
                return [self._summary_row(row, modules.get(row['commit_id'])) for row in rows]
            features = self._features(db, rows[0]['dataset_version'], [row['commit_id'] for row in rows]) if rows else {}
        return [self._commit_row(row, features[row['commit_id']]) for row in rows]

    def count_by_entity(self, entity_type, entity_value):
        with self.connection() as db:
            return db.execute(
                'SELECT COUNT(*) FROM commit_record c JOIN modified_entity e '
                'ON e.dataset_version = c.dataset_version AND e.commit_id = c.commit_id '
                'WHERE e.entity_type=? AND e.entity_value=?',
                (entity_type, entity_value)).fetchone()[0]

    def import_runs(self, version):
        with self.connection() as db:
            rows = db.execute('SELECT * FROM import_run WHERE dataset_version=? ORDER BY started_at',
                              (version,)).fetchall()
        return [dict(row) for row in rows]

    def feature_means(self, version, fields):
        """按数据集版本取字段均值，作为特征归因的基线（PEX-02）。

        只返回真实存在的字段；缺字段不补零，由调用方降级并披露。
        """
        fields = tuple(fields)
        if not fields:
            return {}
        placeholders = ','.join('?' for _ in fields)
        with self.connection() as db:
            rows = db.execute(
                f'SELECT field, AVG(CAST(value_json AS REAL)) AS mean FROM feature_record '
                f'WHERE dataset_version=? AND field IN ({placeholders}) GROUP BY field',
                (version, *fields)).fetchall()
        return {row['field']: row['mean'] for row in rows if row['mean'] is not None}
