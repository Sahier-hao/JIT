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
              (3, Path(__file__).parent / 'migrations/003_repository_sync.sql'),
              (4, Path(__file__).parent / 'migrations/004_repository.sql'),
              (5, Path(__file__).parent / 'migrations/005_analysis_context.sql'),
              (6, Path(__file__).parent / 'migrations/006_local_registration.sql'),
              (7, Path(__file__).parent / 'migrations/007_admin_and_model_selection.sql'),
              (8, Path(__file__).parent / 'migrations/008_model_policy.sql'),
              (9, Path(__file__).parent / 'migrations/009_sync_control.sql'),
              (10, Path(__file__).parent / 'migrations/010_repository_explanation.sql'),
              (11, Path(__file__).parent / 'migrations/011_repository_watch.sql'),
              (12, Path(__file__).parent / 'migrations/012_pr_review_sources.sql'),
              (13, Path(__file__).parent / 'migrations/013_analysis_sources.sql'),
              (14, Path(__file__).parent / 'migrations/014_project_trends.sql'),
              (15, Path(__file__).parent / 'migrations/015_pr_updates.sql'),
              (16, Path(__file__).parent / 'migrations/016_repository_overview.sql'),
              (17, Path(__file__).parent / 'migrations/017_commit_file_paths.sql'),
              (18, Path(__file__).parent / 'migrations/018_training_tasks.sql'),
              (19, Path(__file__).parent / 'migrations/019_pr_batches.sql'),
              (20, Path(__file__).parent / 'migrations/020_experiment_promotion.sql'),
              (21, Path(__file__).parent / 'migrations/021_model_package_imports.sql'),
              (22, Path(__file__).parent / 'migrations/022_label_evidence.sql'),
              (23, Path(__file__).parent / 'migrations/023_training_class_policy.sql'),
              (24, Path(__file__).parent / 'migrations/024_pr_candidates.sql'))
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

    def _backup_before_upgrade(self, version):
        """升级前留存一致的独立副本；只在显式初始化旧库时执行。"""
        if not self.path.exists():
            return
        source = self._connect()
        try:
            tables = source.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            if not tables:
                return
            rows = source.execute('SELECT version FROM schema_migration').fetchall()
            if len(rows) != 1 or not 0 < rows[0][0] < version:
                return
            backup = self.path.with_name(f'{self.path.name}.before-v{rows[0][0]}-{uuid.uuid4().hex}.sqlite3')
            with backup.open('xb'):
                pass
            target = sqlite3.connect(backup)
            try:
                source.backup(target)
            finally:
                target.close()
        finally:
            source.close()

    def initialize(self, *, migrations=MIGRATIONS, version=VERSION):
        """建库或把旧版本库按序升级到当前版本；已是最新版本时幂等。"""
        db = None
        try:
            self._backup_before_upgrade(version)
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
        collection = manifest.get('collection') or {}
        label = collection.get('label') or manifest.get('label') or {}
        szz = collection.get('szz') or {}
        label_origin = label.get('kind') or szz.get('rule') or manifest.get('labelRule') or LABEL_RULE
        label_version = label.get('version') or szz.get('rule') or manifest.get('labelRule')
        label_binarization = label.get('binarizationRule') or LABEL_RULE
        observed_through = label.get('observedThrough')
        maturity_days = label.get('maturityDays')
        with self.connection(write=True) as db:
            row = db.execute('SELECT manifest_sha256 FROM dataset_record WHERE dataset_version=?',
                             (version,)).fetchone()
            if row is not None:
                if row[0] != digest:
                    raise BaselineError('DATASET_EXISTS', f'数据集版本已导入且内容不同，不覆盖：{version}')
                return {'datasetVersion': version, 'created': False,
                        'commits': db.execute('SELECT COUNT(*) FROM commit_record WHERE dataset_version=?',
                                              (version,)).fetchone()[0]}
            db.execute('INSERT INTO dataset_record VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                       (version, manifest['dataset'], text, digest, manifest['file']['sha256'],
                        len(records), started, label_origin, label_version, label_binarization,
                        observed_through, maturity_days))
            db.executemany('INSERT INTO commit_record VALUES (?,?,?,?,?)',
                           [(version, record['id'], record['time'], record['label'], LABEL_RULE)
                            for record in records])
            db.executemany('INSERT INTO feature_record VALUES (?,?,?,?)',
                           [(version, record['id'], field, json.dumps(value, allow_nan=False))
                            for record in records for field, value in sorted(record['metrics'].items())])
            evidence = collection.get('labelEvidence') or []
            db.executemany('INSERT OR IGNORE INTO commit_label_evidence VALUES (?,?,?,?,?,?)',
                           [(version, item['introducedCommit'], item['fixCommit'], item['path'],
                             item['fixTime'], label_version or LABEL_RULE) for item in evidence
                            if item.get('introducedCommit') and item.get('fixCommit') and item.get('path')])
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
    def _label_meta(db, version):
        row = db.execute('SELECT label_origin, label_rule_version, label_binarization_rule, '
                         'observed_through, maturity_days FROM dataset_record WHERE dataset_version=?',
                         (version,)).fetchone()
        return dict(row) if row is not None else None

    @staticmethod
    def _label_status(label, author_time, meta):
        if label == 1:
            return 'positive'
        if not meta or meta.get('observed_through') is None or meta.get('maturity_days') is None:
            return 'unknown'
        try:
            epoch = int(datetime.fromisoformat(author_time.replace('Z', '+00:00')).timestamp())
        except (ValueError, TypeError):
            return 'unknown'
        if int(meta['observed_through']) - epoch < int(meta['maturity_days']) * 86400:
            return 'immature'
        return 'unobserved'

    @classmethod
    def _commit_row(cls, row, features, meta=None, evidence=None):
        return {'commitId': row['commit_id'], 'datasetVersion': row['dataset_version'],
                'authorTime': row['author_time'], 'label': row['label'],
                'labelRule': row['label_rule'],
                'labelOrigin': (meta or {}).get('label_origin'),
                'labelRuleVersion': (meta or {}).get('label_rule_version'),
                'binarizationRule': (meta or {}).get('label_binarization_rule'),
                'labelStatus': cls._label_status(row['label'], row['author_time'], meta),
                'evidence': evidence or [], 'features': features}

    @staticmethod
    def _evidence(db, version, commit_id):
        rows = db.execute('SELECT fix_commit_id, path, fix_time, rule_version FROM commit_label_evidence '
                          'WHERE dataset_version=? AND commit_id=? ORDER BY fix_time, fix_commit_id, path',
                          (version, commit_id)).fetchall()
        return [{'fixCommit': row['fix_commit_id'], 'path': row['path'],
                 'fixTime': row['fix_time'], 'ruleVersion': row['rule_version']} for row in rows]

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
            meta = self._label_meta(db, version)
        return [self._commit_row(row, features[row['commit_id']], meta) for row in rows]

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
            meta = self._label_meta(db, version)
            evidence = self._evidence(db, version, commit_id)
        return self._commit_row(row, features[commit_id], meta, evidence)

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
            meta = self._label_meta(db, rows[0]['dataset_version']) if rows else None
        return [self._commit_row(row, features[row['commit_id']], meta) for row in rows]

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

    def record_model_package_import(self, report):
        """Persist one model-package import and its per-item outcomes atomically."""
        with self.connection(write=True) as db:
            db.execute(
                'INSERT INTO model_package_import VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (report['importId'], report['packageSha256'], report['packageVersion'],
                 report['packageName'], report['status'], report['modelCount'],
                 report['registeredCount'], report['reusedCount'],
                 report['alreadyRegisteredCount'], report['conflictCount'],
                 report['failedCount'], report.get('code'), report.get('message'),
                 report['createdAt']),
            )
            for ordinal, item in enumerate(report['items']):
                db.execute(
                    'INSERT INTO model_package_import_item VALUES (?,?,?,?,?,?,?,?,?,?)',
                    (report['importId'], ordinal, item.get('artifactRunId'),
                     item.get('sourceModelId'), item.get('artifactKey'), item['status'],
                     item.get('modelId'), item.get('runId'), item.get('code'),
                     item.get('message')),
                )
        return self.latest_model_package_import()

    def latest_model_package_import(self):
        with self.connection() as db:
            row = db.execute(
                'SELECT * FROM model_package_import ORDER BY created_at DESC, id DESC LIMIT 1'
            ).fetchone()
            if row is None:
                return None
            items = db.execute(
                'SELECT * FROM model_package_import_item WHERE import_id=? ORDER BY ordinal',
                (row['id'],),
            ).fetchall()
        return {
            'importId': row['id'],
            'packageSha256': row['package_sha256'],
            'packageVersion': row['package_version'],
            'packageName': row['package_name'],
            'status': row['status'],
            'modelCount': row['model_count'],
            'registeredCount': row['registered_count'],
            'reusedCount': row['reused_count'],
            'alreadyRegisteredCount': row['already_registered_count'],
            'conflictCount': row['conflict_count'],
            'failedCount': row['failed_count'],
            'code': row['error_code'],
            'message': row['error_message'],
            'createdAt': row['created_at'],
            'items': [{
                'artifactRunId': item['artifact_run_id'],
                'sourceModelId': item['source_model_id'],
                'artifactKey': item['artifact_key'],
                'status': item['status'],
                'modelId': item['model_id'],
                'runId': item['run_id'],
                'code': item['code'],
                'message': item['message'],
            } for item in items],
        }

    def feature_means(self, version, fields, commit_ids=None):
        """按数据集版本取字段均值，作为特征归因的基线（PEX-02）。

        传入 `commit_ids` 时只统计这些提交（训练分区）；缺字段不补零，由调用方降级并披露。
        """
        fields = tuple(fields)
        if not fields:
            return {}
        placeholders = ','.join('?' for _ in fields)
        with self.connection() as db:
            if commit_ids is None:
                rows = db.execute(
                    f'SELECT field, AVG(CAST(value_json AS REAL)) AS mean FROM feature_record '
                    f'WHERE dataset_version=? AND field IN ({placeholders}) GROUP BY field',
                    (version, *fields)).fetchall()
                return {row['field']: row['mean'] for row in rows if row['mean'] is not None}
            ids = tuple(dict.fromkeys(commit_ids))
            if not ids:
                return {}
            totals = {field: 0.0 for field in fields}
            counts = {field: 0 for field in fields}
            for start in range(0, len(ids), 500):
                chunk = ids[start:start + 500]
                id_placeholders = ','.join('?' for _ in chunk)
                rows = db.execute(
                    f'SELECT field, SUM(CAST(value_json AS REAL)) AS total, COUNT(*) AS n '
                    f'FROM feature_record WHERE dataset_version=? AND field IN ({placeholders}) '
                    f'AND commit_id IN ({id_placeholders}) GROUP BY field',
                    (version, *fields, *chunk)).fetchall()
                for row in rows:
                    if row['field'] in totals and row['total'] is not None:
                        totals[row['field']] += float(row['total'])
                        counts[row['field']] += int(row['n'])
            return {field: totals[field] / counts[field] for field in fields if counts[field]}
