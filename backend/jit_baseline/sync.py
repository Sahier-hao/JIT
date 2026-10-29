"""仓库同步作业：采集 → 登记 → 选模型 → 打分（RCL-07..RCL-09、D1..D7）。

作业在单 worker 顺序执行，状态与阶段落 `repository_sync`；提交级风险与特征落
`repository_commit`，按 `risk DESC, epoch DESC, commit_id ASC` 预计算好顺序。
失败只记录 `stage + errorCode`，已登记的数据集保留，用户可基于同一数据集重试。
"""
import hashlib
import json
import os
import re
import sys
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse

from . import artifacts, collect, store
from .artifacts import Snapshot
from .catalog import ModelCatalog
from .catalog_storage import CatalogStorage, utc_now
from .config import BACKEND
from .data import parse_source
from .datasets import DATASETS
from .errors import BaselineError
from .model import predict_risks, temporal_split
from .schemas import resolve
from .task_process import OwnedProcess

SCHEMA_NAME = collect.SCHEMA_NAME
GENERIC_SCHEMA = "openstack-six-v1"
# 14 维采集记录投影到通用模型 6 个入模字段；`ent` 对应采集器的 `entropy`。
GENERIC_PROJECTION = {"ent": "entropy"}
STRATEGIES = ("auto", "generic-model", "force-train")
TRAINED = "repository-trained"
GENERIC = "generic-model"
PROGRESS = ("queued", "collecting", "registering", "training", "scoring")
HOLDOUT_DAYS = 90
DEFAULT_WINDOW_DAYS = 90
MIN_TRAIN_RECORDS = 200
MIN_TRAIN_POSITIVES = 20
MIN_TEST_POSITIVES = 3
DEFAULT_LIMIT = 500
MAX_LIMIT = 5000
SYNC_TIMEOUT = 600
DISTRIBUTION_RULE = "repo-distribution-v1"
HIGH_THRESHOLD = 0.25
MEDIUM_THRESHOLD = 0.10
REPOSITORY_LIMITATIONS = (
    "模型分数用于审查排序，未经当前仓库概率校准，不代表已确认缺陷。",
    "标签由简化 SZZ 按文件级回溯生成，未处理重命名与跨文件传播。",
    "最近一段提交还没有被别人修过，暂时无法验证准不准。",
)

COLUMNS = ("id", "repository_url", "repository_id", "branch", "since", "until", "commit_limit",
           "requested_strategy", "status", "stage", "error_code", "error_message",
           "dataset_version", "run_id", "model_id", "model_strategy", "degrade_reason",
           "train_records", "train_positives", "request_id", "created_at", "updated_at",
           "completed_at", "head_commit", "analysis_branch", "requested_model_id", "resolved_model_id",
           "started_at", "deadline_at", "cancel_requested_at", "source_kind", "source_snapshot_id",
           "origin", "feature_schema_version", "distribution_rule")


def worker_command():
    return [sys.executable, '-m', 'jit_baseline.sync_worker']


def check_control(row):
    if row is None or row['status'] not in PROGRESS:
        raise BaselineError('SYNC_CANCELLED', '该分析已结束，不再执行')
    if row['cancel_requested_at']:
        raise BaselineError('SYNC_CANCELLED', '分析已取消；可用原参数重新分析')
    if row['deadline_at'] and datetime.now(timezone.utc) >= datetime.fromisoformat(row['deadline_at']):
        raise BaselineError('SYNC_TIMEOUT', '分析超过执行时限，已停止；请缩小范围后重试')

REPOSITORY_COLUMNS = ("id", "url", "display_name", "default_branch", "latest_sync_id",
                      "latest_sync_at", "view_sync_id", "head_commit", "commit_count",
                      "high_count", "medium_count", "low_count", "unknown_count",
                      "distribution_rule", "created_at", "updated_at")


def normalize_repository_url(url):
    """把同一仓库的不同写法归成一个地址（D2）：去尾斜杠与 `.git`，协议与主机小写。"""
    text = (url or "").strip()
    if not text:
        raise BaselineError("INPUT_INVALID", "缺少仓库地址")
    parsed = urlparse(text)
    if parsed.scheme and parsed.netloc:
        path = parsed.path.rstrip("/")
        if path.endswith(".git"):
            path = path[:-4]
        normalized = f"{parsed.scheme.lower()}://{parsed.netloc.lower()}{path}"
        return f"{normalized}?{parsed.query}" if parsed.query else normalized
    text = text.rstrip("/")
    return text[:-4] if text.endswith(".git") else text


def repository_id_for(url):
    """仓库标识由规范化地址派生：稳定、可重算，不依赖插入顺序（D1）。"""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, normalize_repository_url(url)))


def original_commit_url(url, commit_id):
    """Only a public GitHub HTTPS identity and full Git object ID can form a link."""
    parsed = urlparse(url or '')
    if (parsed.scheme != 'https' or parsed.netloc.lower() != 'github.com'
            or parsed.query or parsed.fragment or not re.fullmatch(r'[0-9a-fA-F]{40}|[0-9a-fA-F]{64}', commit_id)):
        return None
    path = parsed.path.rstrip('/')
    if path.endswith('.git'):
        path = path[:-4]
    if not re.fullmatch(r'/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', path):
        return None
    if any(part in ('.', '..') for part in path.split('/')[1:]):
        return None
    return f'https://github.com{path}/commit/{commit_id}'


def display_name_for(url):
    """界面展示用仓库名：取地址末段，去掉 `.git`；Windows 本地路径按 `/` 切分。"""
    normalized = normalize_repository_url(url).replace("\\", "/")
    name = normalized.rstrip("/").rsplit("/", 1)[-1]
    return name or "repository"


def distribution_of(risks):
    """风险分档（D5）：高 ≥0.25、中 ≥0.10、低 <0.10；缺失记入 unknown。"""
    counts = {"high": 0, "medium": 0, "low": 0, "unknown": 0}
    for risk in risks:
        if risk is None:
            counts["unknown"] += 1
        elif risk >= HIGH_THRESHOLD:
            counts["high"] += 1
        elif risk >= MEDIUM_THRESHOLD:
            counts["medium"] += 1
        else:
            counts["low"] += 1
    return counts


def _repository_view(row):
    return {"repositoryId": row["id"], "url": row["url"], "displayName": row["display_name"],
            "defaultBranch": row["default_branch"], "latestSyncId": row["latest_sync_id"],
            "latestSyncAt": row["latest_sync_at"], "viewSyncId": row["view_sync_id"],
            "headCommit": row["head_commit"], "commitCount": row["commit_count"],
            "distribution": {"high": row["high_count"], "medium": row["medium_count"],
                             "low": row["low_count"], "unknown": row["unknown_count"]},
            "distributionRule": row["distribution_rule"],
            "createdAt": row["created_at"], "updatedAt": row["updated_at"]}


def _view(row):
    """作业行转接口表示；错误只在这里拼出可读提示。"""
    item = dict(row)
    error = None
    if item["error_code"]:
        error = {"code": item["error_code"], "message": item["error_message"]}
    return {"syncId": item["id"], "repositoryUrl": item["repository_url"],
            "repositoryId": item["repository_id"], "branch": item["branch"],
            "since": item["since"], "until": item["until"], "commitLimit": item["commit_limit"],
            "requestedStrategy": item["requested_strategy"], "status": item["status"],
            "requestedModelId": item.get('requested_model_id'),
            "resolvedModelId": item.get('resolved_model_id'),
            "stage": item["stage"], "datasetVersion": item["dataset_version"],
            "runId": item["run_id"], "modelId": item["model_id"],
            "modelStrategy": item["model_strategy"], "degradeReason": item["degrade_reason"],
            "trainRecords": item["train_records"], "trainPositives": item["train_positives"],
            "createdAt": item["created_at"], "updatedAt": item["updated_at"],
            "completedAt": item.get("completed_at"), "headCommit": item.get("head_commit"),
            "analysisBranch": item.get('analysis_branch'),
            "startedAt": item.get('started_at'), "deadlineAt": item.get('deadline_at'),
            "cancelRequestedAt": item.get('cancel_requested_at'), "queuePosition": None,
            "requestId": item["request_id"], "error": error,
            "sourceKind": item.get('source_kind', 'unknown'), "sourceSnapshotId": item.get('source_snapshot_id'),
            "origin": item.get('origin', 'manual'), "featureSchemaVersion": item.get('feature_schema_version'),
            "distributionRule": item.get('distribution_rule')}


class SyncStorage:
    """作业与提交结果的持久化；不做业务判断。"""

    def __init__(self, storage=None):
        self.storage = storage if storage is not None else CatalogStorage()

    def create(self, row, *, publish=False):
        row = {'source_kind': 'branch', 'origin': 'manual', **row}
        columns = ", ".join(COLUMNS)
        placeholders = ", ".join("?" for _ in COLUMNS)
        with self.storage.connection(write=True) as db:
            db.execute(f"INSERT INTO repository_sync ({columns}) VALUES ({placeholders})",
                       tuple(row.get(name) for name in COLUMNS))
            if row.get('source_snapshot_id'):
                db.execute('INSERT INTO pr_analysis VALUES (?,?,?)',
                           (row['source_snapshot_id'], row['id'], row['created_at']))
                db.execute('INSERT INTO pr_analysis_intent VALUES (?,?,?) ON CONFLICT(snapshot_id,model_id) '
                           'DO UPDATE SET sync_id=excluded.sync_id',
                           (row['source_snapshot_id'], row['resolved_model_id'], row['id']))
            elif publish and row.get('repository_id'):
                db.execute('UPDATE repository SET latest_sync_id=?,latest_sync_at=?,updated_at=? WHERE id=?',
                           (row['id'], row['created_at'], row['created_at'], row['repository_id']))
                if not re.fullmatch(r'[a-f0-9]{40}|[a-f0-9]{64}', row['branch']):
                    db.execute('UPDATE repository SET default_branch=? WHERE id=?', (row['branch'], row['repository_id']))

    def update(self, sync_id, **fields):
        if not fields:
            return
        unknown = set(fields) - set(COLUMNS)
        if unknown:
            raise ValueError(f"未知的作业字段：{sorted(unknown)}")
        fields["updated_at"] = utc_now()
        assignments = ", ".join(f"{name}=?" for name in fields)
        with self.storage.connection(write=True) as db:
            db.execute(f"UPDATE repository_sync SET {assignments} WHERE id=?",
                       (*fields.values(), sync_id))

    def get(self, sync_id):
        with self.storage.connection() as db:
            row = db.execute("SELECT * FROM repository_sync WHERE id=?", (sync_id,)).fetchone()
        return _view(row) if row is not None else None

    def queue_positions(self):
        with self.storage.connection() as db:
            return {row[0]: index for index, row in enumerate(db.execute(
                "SELECT id FROM repository_sync WHERE status='queued' ORDER BY rowid"), 1)}

    def start(self, sync_id, timeout):
        now = datetime.now(timezone.utc)
        with self.storage.connection(write=True) as db:
            return db.execute(
                "UPDATE repository_sync SET status='collecting',stage='collecting',started_at=?,"
                "deadline_at=?,updated_at=? WHERE id=? AND status='queued' AND cancel_requested_at IS NULL",
                (now.isoformat(), (now + timedelta(seconds=timeout)).isoformat(), utc_now(), sync_id)).rowcount == 1

    def cancel(self, sync_id):
        with self.storage.connection(write=True) as db:
            row = db.execute('SELECT * FROM repository_sync WHERE id=?', (sync_id,)).fetchone()
            if row is None:
                raise BaselineError('NOT_FOUND', '分析记录不存在')
            if row['status'] == 'cancelled':
                return
            if row['status'] not in PROGRESS:
                raise BaselineError('SYNC_NOT_ACTIVE', '分析已经结束，请刷新记录')
            if row['cancel_requested_at']:
                return
            now = utc_now()
            db.execute('UPDATE repository_sync SET cancel_requested_at=?,updated_at=? WHERE id=?',
                       (now, now, sync_id))
            if row['status'] == 'queued':
                db.execute("UPDATE repository_sync SET status='cancelled',completed_at=?,"
                           "error_code='SYNC_CANCELLED',error_message='已取消排队，可用原参数重新分析' WHERE id=?",
                           (now, sync_id))

    def finish(self, sync_id, status, code, message, **fields):
        """Late worker responses cannot revive a terminal job."""
        with self.storage.connection(write=True) as db:
            row = db.execute('SELECT * FROM repository_sync WHERE id=?', (sync_id,)).fetchone()
            if row is None or row['status'] not in PROGRESS:
                return
            if row['cancel_requested_at']:
                status, code, message = 'cancelled', 'SYNC_CANCELLED', '分析已取消；可用原参数重新分析'
            now = utc_now()
            fields.update(status=status, error_code=code, error_message=message, completed_at=now, updated_at=now)
            if set(fields) - set(COLUMNS):
                raise ValueError('未知作业字段')
            assignments = ','.join(f'{name}=?' for name in fields)
            db.execute(f'UPDATE repository_sync SET {assignments} WHERE id=?', (*fields.values(), sync_id))

    def advance(self, sync_id, stage):
        with self.storage.connection(write=True) as db:
            row = db.execute('SELECT * FROM repository_sync WHERE id=?', (sync_id,)).fetchone()
            check_control(row)
            db.execute('UPDATE repository_sync SET status=?,stage=?,updated_at=? WHERE id=?',
                       (stage, stage, utc_now(), sync_id))

    def find_active(self, *, repository_url, branch, since, until, commit_limit, requested_strategy, requested_model_id=None, resolved_model_id=None):
        placeholders = ", ".join("?" for _ in PROGRESS)
        with self.storage.connection() as db:
            row = db.execute(
                "SELECT * FROM repository_sync WHERE repository_url=? AND branch=? AND since IS ? "
                "AND until IS ? AND commit_limit IS ? AND requested_strategy=? "
                f"AND requested_model_id IS ? AND resolved_model_id IS ? AND source_kind='branch' AND status IN ({placeholders}) ORDER BY created_at DESC LIMIT 1",
                (repository_url, branch, since, until, commit_limit, requested_strategy, requested_model_id, resolved_model_id, *PROGRESS)).fetchone()
        return _view(row) if row is not None else None

    def pages(self, limit=20, offset=0):
        with self.storage.connection() as db:
            rows = db.execute("SELECT * FROM repository_sync ORDER BY created_at DESC, id DESC "
                              "LIMIT ? OFFSET ?", (limit, offset)).fetchall()
            total = db.execute("SELECT COUNT(*) FROM repository_sync").fetchone()[0]
        return [_view(row) for row in rows], total

    def interrupted(self):
        """服务重启后把未完成的作业标记为中断，不冒充成功（D4）。"""
        placeholders = ", ".join("?" for _ in PROGRESS)
        with self.storage.connection(write=True) as db:
            return db.execute(
                "UPDATE repository_sync SET status=CASE WHEN cancel_requested_at IS NOT NULL THEN 'cancelled' ELSE 'interrupted' END, "
                "error_code=CASE WHEN cancel_requested_at IS NOT NULL THEN 'SYNC_CANCELLED' ELSE 'SYNC_INTERRUPTED' END, "
                "error_message=CASE WHEN cancel_requested_at IS NOT NULL THEN '分析已取消，可重新分析' ELSE '服务重启时同步尚未完成，请重新同步' END, updated_at=?,completed_at=? "
                f"WHERE status IN ({placeholders})", (utc_now(), utc_now(), *PROGRESS)).rowcount

    def write_commits(self, sync_id, rows, *, connection=None):
        if connection is None:
            with self.storage.connection(write=True) as db:
                self.write_commits(sync_id, rows, connection=db)
        else:
            db = connection
            db.execute("DELETE FROM repository_commit WHERE sync_id=?", (sync_id,))
            db.executemany(
                "INSERT INTO repository_commit (sync_id, commit_id, epoch, risk, added_lines, "
                "deleted_lines, files, features_json, file_paths_json, label, label_note, subject, author_name) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [(sync_id, row["id"], int(row["epoch"]), float(row["risk"]), int(row["addedLines"]),
                  int(row["deletedLines"]), int(row["files"]),
                  json.dumps(row["features"], ensure_ascii=False, sort_keys=True),
                  json.dumps(row.get("filePaths") or [], ensure_ascii=False),
                  int(row["label"]), row.get("labelNote"), row.get("subject"), row.get("authorName")) for row in rows])

    def complete(self, sync_id, repository_id, rows, *, head_commit, dataset_version, run_id, model_id,
                 analysis_branch=None, feature_schema_version=None):
        """原子发布结果，只有分支分析能推进项目当前结果。"""
        counts, now = distribution_of([row['risk'] for row in rows]), utc_now()
        with self.storage.connection(write=True) as db:
            source = db.execute('SELECT * FROM repository_sync WHERE id=?', (sync_id,)).fetchone()
            check_control(source)
            self.write_commits(sync_id, rows, connection=db)
            db.execute("UPDATE repository_sync SET status='completed',stage='completed',completed_at=?,"
                       "updated_at=?,head_commit=?,dataset_version=?,run_id=?,model_id=?,analysis_branch=?,"
                       "feature_schema_version=COALESCE(?,feature_schema_version),distribution_rule=? WHERE id=?",
                       (now, now, head_commit, dataset_version, run_id, model_id, analysis_branch,
                        feature_schema_version, DISTRIBUTION_RULE, sync_id))
            if repository_id and source['repository_id'] == repository_id and source['source_kind'] == 'branch':
                db.execute("UPDATE repository SET view_sync_id=?,head_commit=?,commit_count=?,high_count=?,"
                           "medium_count=?,low_count=?,unknown_count=?,distribution_rule=?,updated_at=? WHERE id=?",
                           (sync_id, head_commit, len(rows), counts['high'], counts['medium'], counts['low'],
                            counts['unknown'], DISTRIBUTION_RULE, now, repository_id))

    def commits(self, sync_id, limit=100, offset=0, *, search=None, start=None, end=None,
                sort="risk"):
        """按服务端过滤条件分页读取提交：搜索词、日期区间与排序都在 SQL 里完成。"""
        clauses, params = ["sync_id=?"], [sync_id]
        if search:
            # 与历史回放的标识搜索一致：任意片段都能命中；标题也参与匹配（D6）。
            # 表里只存几百到几千行，LIKE 的扫描代价可以接受；`%` 与 `_` 按字面匹配。
            escaped = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            clauses.append("(commit_id LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\')")
            params.extend((f"%{escaped}%", f"%{escaped}%"))
        if start is not None:
            clauses.append("epoch >= ?")
            params.append(start)
        if end is not None:
            clauses.append("epoch < ?")
            params.append(end)
        where = " AND ".join(clauses)
        order = ("epoch DESC, commit_id ASC" if sort == "time"
                 else "risk DESC, epoch DESC, commit_id ASC")
        with self.storage.connection() as db:
            rows = db.execute(
                "SELECT commit_id,epoch,risk,added_lines,deleted_lines,files,features_json,label,"
                "label_note,subject,author_name "
                f"FROM repository_commit WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
                (*params, limit, offset)).fetchall()
            total = db.execute(f"SELECT COUNT(*) FROM repository_commit WHERE {where}",
                               params).fetchone()[0]
        return [{"commitId": row["commit_id"], "epoch": row["epoch"], "risk": row["risk"],
                 "addedLines": row["added_lines"], "deletedLines": row["deleted_lines"],
                 "files": row["files"], "features": json.loads(row["features_json"]),
                 "label": row["label"], "labelNote": row["label_note"],
                 "subject": row["subject"], "authorName": row["author_name"]}
                for row in rows], total

    def commit(self, sync_id, commit_id):
        with self.storage.connection() as db:
            row = db.execute("SELECT * FROM repository_commit WHERE sync_id=? AND commit_id=?",
                             (sync_id, commit_id)).fetchone()
        if row is None:
            return None
        return {"commitId": row["commit_id"], "epoch": row["epoch"], "risk": row["risk"],
                "addedLines": row["added_lines"], "deletedLines": row["deleted_lines"],
                "files": row["files"], "label": row["label"], "labelNote": row["label_note"],
                "subject": row["subject"], "authorName": row["author_name"],
                "features": json.loads(row["features_json"])}

    def repository_create(self, row):
        columns = ", ".join(REPOSITORY_COLUMNS)
        placeholders = ", ".join("?" for _ in REPOSITORY_COLUMNS)
        with self.storage.connection(write=True) as db:
            db.execute(f"INSERT INTO repository ({columns}) VALUES ({placeholders})",
                       tuple(row.get(name) for name in REPOSITORY_COLUMNS))

    def repository_by_url(self, url):
        with self.storage.connection() as db:
            row = db.execute("SELECT * FROM repository WHERE url=?", (url,)).fetchone()
            parsed = urlparse(url)
            if row is None and parsed.scheme == 'https' and parsed.netloc == 'github.com' and not parsed.query:
                aliases = db.execute('SELECT * FROM repository WHERE lower(url)=lower(?)', (url,)).fetchall()
                if len(aliases) > 1:
                    raise BaselineError('CONTEXT_MISMATCH', '同一 GitHub 来源对应多个已有项目，请从具体项目进入')
                row = aliases[0] if aliases else None
        return _repository_view(row) if row is not None else None

    def repository_get(self, repository_id):
        with self.storage.connection() as db:
            row = db.execute("SELECT * FROM repository WHERE id=?", (repository_id,)).fetchone()
        return _repository_view(row) if row is not None else None

    def repository_update(self, repository_id, **fields):
        """更新仓库汇总字段；`id` 与 `created_at` 不可改（D1）。"""
        if not fields:
            return
        unknown = set(fields) - set(REPOSITORY_COLUMNS) - {"updated_at"}
        if unknown:
            raise ValueError(f"未知的仓库字段：{sorted(unknown)}")
        fields["updated_at"] = utc_now()
        assignments = ", ".join(f"{name}=?" for name in fields)
        with self.storage.connection(write=True) as db:
            db.execute(f"UPDATE repository SET {assignments} WHERE id=?",
                       (*fields.values(), repository_id))

    def repositories(self, limit=50, offset=0):
        with self.storage.connection() as db:
            rows = db.execute("SELECT * FROM repository ORDER BY updated_at DESC, id DESC "
                              "LIMIT ? OFFSET ?", (limit, offset)).fetchall()
            total = db.execute("SELECT COUNT(*) FROM repository").fetchone()[0]
        return [_repository_view(row) for row in rows], total

    def repository_refresh(self, repository_id, sync_id):
        """把一次成功作业的提交汇总成仓库当前视图（D1 的 `view_sync_id` 指向它）。"""
        with self.storage.connection() as db:
            rows = db.execute("SELECT commit_id, risk, epoch FROM repository_commit WHERE sync_id=?",
                              (sync_id,)).fetchall()
        counts = distribution_of([row["risk"] for row in rows])
        head = (self.get(sync_id) or {}).get('headCommit')
        self.repository_update(repository_id, view_sync_id=sync_id, head_commit=head,
                               commit_count=len(rows), high_count=counts["high"],
                               medium_count=counts["medium"], low_count=counts["low"],
                               unknown_count=counts["unknown"],
                               distribution_rule=DISTRIBUTION_RULE)

    def repository_syncs(self, repository_id, limit=20, offset=0):
        with self.storage.connection() as db:
            rows = db.execute(
                "SELECT * FROM repository_sync WHERE repository_id=? "
                "ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                (repository_id, limit, offset)).fetchall()
            total = db.execute("SELECT COUNT(*) FROM repository_sync WHERE repository_id=?",
                               (repository_id,)).fetchone()[0]
        return [_view(row) for row in rows], total

    def repository_latest_sync(self, repository_id):
        with self.storage.connection() as db:
            row = db.execute(
                "SELECT * FROM repository_sync WHERE repository_id=? AND source_kind!='pr' "
                "ORDER BY created_at DESC, id DESC LIMIT 1",
                (repository_id,)).fetchone()
        return _view(row) if row is not None else None

    def repository_active(self, repository_id):
        placeholders = ", ".join("?" for _ in PROGRESS)
        with self.storage.connection() as db:
            return db.execute(
                f"SELECT COUNT(*) FROM repository_sync WHERE repository_id=? AND status IN ({placeholders})",
                (repository_id, *PROGRESS)).fetchone()[0]

    def repository_delete(self, repository_id):
        """硬删仓库及其全部作业与提交；调用方负责确认没有在途作业。"""
        with self.storage.connection(write=True) as db:
            sync_ids = [row[0] for row in db.execute(
                "SELECT id FROM repository_sync WHERE repository_id=?", (repository_id,))]
            commits = 0
            if sync_ids:
                marks = ", ".join("?" for _ in sync_ids)
                commits = db.execute(f"DELETE FROM repository_commit WHERE sync_id IN ({marks})",
                                     sync_ids).rowcount
            syncs = db.execute("DELETE FROM repository_sync WHERE repository_id=?",
                               (repository_id,)).rowcount
            db.execute("DELETE FROM repository WHERE id=?", (repository_id,))
        return {"syncs": syncs, "commits": commits}

    def sync_delete(self, sync_id):
        with self.storage.connection(write=True) as db:
            commits = db.execute("DELETE FROM repository_commit WHERE sync_id=?",
                                 (sync_id,)).rowcount
            db.execute("DELETE FROM repository_sync WHERE id=?", (sync_id,))
        return commits

    def backfill_repositories(self):
        """把迁移前已有的作业补上仓库归属；幂等，重复执行不产生新仓库（D2）。"""
        with self.storage.connection() as db:
            rows = db.execute("SELECT id, repository_url, branch, status, created_at "
                              "FROM repository_sync WHERE repository_id IS NULL "
                              "ORDER BY created_at ASC").fetchall()
        if not rows:
            return 0
        linked = 0
        for row in rows:
            normalized = normalize_repository_url(row["repository_url"])
            repo = self.repository_by_url(normalized)
            if repo is None:
                now = utc_now()
                self.repository_create({"id": repository_id_for(normalized), "url": normalized,
                                        "display_name": display_name_for(normalized),
                                        "default_branch": row["branch"], "latest_sync_id": row["id"],
                                        "latest_sync_at": row["created_at"], "view_sync_id": None,
                                        "head_commit": None, "commit_count": 0, "high_count": 0,
                                        "medium_count": 0, "low_count": 0, "unknown_count": 0,
                                        "distribution_rule": None, "created_at": now,
                                        "updated_at": now})
                repo = self.repository_by_url(normalized)
            self.update(row["id"], repository_id=repo["repositoryId"])
            self.repository_update(repo["repositoryId"], latest_sync_id=row["id"],
                                   latest_sync_at=row["created_at"],
                                   default_branch=row["branch"])
            if row["status"] == "completed":
                self.repository_refresh(repo["repositoryId"], row["id"])
            linked += 1
        return linked


def _holdout(records):
    """训练截止时间：窗口内最新提交往前 90 天，最近一段只打分不训练（D3）。"""
    return max(record["epoch"] for record in records) - HOLDOUT_DAYS * 86400


def _sample_counts(records, holdout):
    """按 holdout 切出训练段并试算时间切分，返回样本量与切分错误。"""
    trainable = [record for record in records if record["epoch"] < holdout]
    positives = sum(1 for record in trainable if record["label"] == 1)
    test_positives, error = None, None
    try:
        split, _ = temporal_split(trainable)
        test_positives = sum(1 for record in split["test"] if record["label"] == 1)
    except BaselineError as exc:
        error = exc
    return {"trainRecords": len(trainable), "trainPositives": positives,
            "testPositives": test_positives, "splitError": error}


def choose_model(records, strategy, holdout):
    """按用户选择与样本量决定训练还是复用现成模型（D3）。

    `auto` 按软门槛给建议：任一条不满足就降级；`force-train` 只受时间切分的物理约束；
    `generic-model` 不训练。降级与失败原因写入 `degradeReason`。
    """
    counts = _sample_counts(records, holdout)
    base = {"holdout": holdout, "trainRecords": counts["trainRecords"],
            "trainPositives": counts["trainPositives"]}
    if strategy == "generic-model":
        return dict(base, modelStrategy=GENERIC, degradeReason=None)
    if strategy == "force-train":
        if counts["splitError"] is not None:
            raise BaselineError("SPLIT_INVALID",
                                f"数据无法完成时间切分，请改用现成模型：{counts['splitError']}")
        return dict(base, modelStrategy=TRAINED, degradeReason=None)
    reason = None
    if counts["trainRecords"] < MIN_TRAIN_RECORDS:
        reason = "fewRecords"
    elif counts["trainPositives"] < MIN_TRAIN_POSITIVES:
        reason = "fewPositives"
    elif counts["testPositives"] is None or counts["testPositives"] < MIN_TEST_POSITIVES:
        reason = "noTestPositive"
    if reason is None:
        return dict(base, modelStrategy=TRAINED, degradeReason=None)
    return dict(base, modelStrategy=GENERIC, degradeReason=reason)


def generic_inputs(records, fields):
    """把 14 维采集记录投影成通用模型的入模特征（仅列名不同：`ent` ← `entropy`）。"""
    return [{"features": [record["metrics"][GENERIC_PROJECTION.get(name, name)] for name in fields]}
            for record in records]


def _absolute(path):
    """描述文件路径可能是相对 backend 的，统一成绝对路径再读。"""
    resolved = Path(path)
    return resolved if resolved.is_absolute() else BACKEND / resolved


def _register_unique(room, dataset, version, blob, *, after=None, **kwargs):
    """登记数据集；同名版本已存在但内容（含采集元信息）不同时追加内容哈希，不覆盖。

    版本名只到日期，而"最近 90 天"的窗口在同一天里是稳定的：两次同步可能采到
    不同的提交集合（例如当天新提交），此时必须成为两个版本，而不是互相覆盖或
    报错让整次同步失败。

    ``after`` 在登记成功后调用（用于按新版本名导入目录库）；它抛出的
    ``DATASET_EXISTS`` 同样视为版本冲突，换带哈希的版本名再试一次——否则
    "描述文件可复用、但目录库里同版本内容已不同"的旧数据会让同步失败。
    """
    digest = hashlib.sha256(blob).hexdigest()
    last = None
    for name in (version, f"{version}-{digest[:8]}"):
        path = Path(room) / f"{name}.csv"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists():
                temporary = path.with_name(f'{path.name}.{uuid.uuid4().hex}.tmp')
                try:
                    temporary.write_bytes(blob)
                    try:
                        os.link(temporary, path)
                    except FileExistsError:
                        pass
                finally:
                    temporary.unlink(missing_ok=True)
            if path.read_bytes() != blob:
                raise BaselineError('DATASET_EXISTS', f'已有 CSV 内容不同，不覆盖：{name}')
            registered = store.register(path, dataset=dataset, version=name, **kwargs)
            if after is not None:
                after(registered, path)
            return registered
        except BaselineError as exc:
            if exc.code != "DATASET_EXISTS":
                raise
            last = exc
        except OSError as exc:
            raise BaselineError('DATASET_UNAVAILABLE', '采集结果写入失败，请检查存储权限') from exc
    raise last


def _day_floor(epoch):
    """把 epoch 对齐到 UTC 当日 00:00，让"最近 90 天"这类默认窗口在同一天内稳定。

    不对齐的话，两次同步的 since/until 相差几秒，既无法复用同参数作业，
    采集到的提交集合也可能不同，却仍落在同一个版本名（只到日期）上，
    登记时会撞 `DATASET_EXISTS`。
    """
    return (int(epoch) // 86400) * 86400


def _day_start(epoch):
    """把 epoch 对齐到 UTC+08:00 当日 00:00：界面显示的日期与筛选边界一致。"""
    return ((int(epoch) + 8 * 3600) // 86400) * 86400 - 8 * 3600


def _date_start(text, *, next_day=False):
    """把 `YYYY-MM-DD` 解析成 UTC+08:00 当日零点的 epoch；`next_day` 给出开区间上界。"""
    moment = _day_start(collect.parse_time(text))
    return moment + 86400 if next_day else moment


def _window(payload, now=None):
    """解析采集窗口：留空按最近 90 天，避免默认拉全历史直接撞上限。"""
    now = now or datetime.now(timezone.utc)
    since, until = payload.get("since"), payload.get("until")
    if since is None:
        start = _day_floor(now.timestamp()) - DEFAULT_WINDOW_DAYS * 86400
    else:
        start = _day_floor(collect.parse_time(since))
    if until is None:
        end = _day_floor(now.timestamp()) + 86400
    else:
        end = _day_floor(collect.parse_time(until)) + 86400
    if start >= end:
        raise BaselineError("INPUT_INVALID", "起始日期必须早于结束日期")
    since = datetime.fromtimestamp(start, timezone.utc).isoformat(timespec="seconds")
    until = datetime.fromtimestamp(end, timezone.utc).isoformat(timespec="seconds")
    return since, until


def sync_input(payload, *, allow_local=False):
    """校验创建作业的输入；返回可直接落库的请求快照。"""
    if not isinstance(payload, dict) or set(payload) - {'repositoryUrl', 'branch', 'since', 'until', 'commitLimit', 'strategy', 'modelId'}:
        raise BaselineError("INPUT_INVALID", "请求体必须只包含公开分析参数")
    url = payload.get("repositoryUrl")
    if not isinstance(url, str) or not url.strip():
        raise BaselineError("INPUT_INVALID", "缺少仓库地址")
    url = collect.validate_source(url.strip(), allow_local=allow_local)
    branch = payload.get("branch") or "HEAD"
    if not isinstance(branch, str) or not branch.strip():
        raise BaselineError("INPUT_INVALID", "分支必须是字符串")
    limit = payload.get("commitLimit", DEFAULT_LIMIT)
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_LIMIT:
        raise BaselineError("INPUT_INVALID", f"提交上限必须是 1 到 {MAX_LIMIT} 之间的整数")
    strategy = payload.get("strategy") or "auto"
    if strategy not in STRATEGIES:
        raise BaselineError("INPUT_INVALID", "打分模型来源只能是 auto、generic-model 或 force-train")
    since, until = _window(payload)
    return {"repositoryUrl": url, "branch": branch.strip(), "since": since, "until": until,
            "commitLimit": limit, "requestedStrategy": strategy}


class SyncService:
    """同步作业编排：单 worker 顺序执行，同参数在途作业直接复用（RCL-08）。"""

    def __init__(self, storage=None, catalog=None, dataset_root=None, artifact_root=None,
                 allow_local=False, timeout=SYNC_TIMEOUT, collect_fn=None):
        self.sync = SyncStorage(storage)
        self.catalog = catalog or ModelCatalog(self.sync.storage)
        self.dataset_root = Path(dataset_root) if dataset_root is not None else DATASETS
        self.artifact_root = Path(artifact_root) if artifact_root is not None else BACKEND / "artifacts"
        self.allow_local = allow_local
        self.timeout = timeout
        self.collect = collect_fn or collect.collect_repository
        self._isolated = collect_fn is None
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._lock = threading.RLock()
        self._closing = threading.Event()

    def close(self):
        with self._lock:
            self._closing.set()
        self._executor.shutdown(wait=True)

    def cancel(self, sync_id):
        self.sync.cancel(sync_id)
        return self.get(sync_id)

    def _positions(self, items):
        positions = self.sync.queue_positions()
        for item in items:
            item['queuePosition'] = positions.get(item['syncId']) if item['status'] == 'queued' else None
        return items

    def _execute(self, sync_id):
        process = None
        try:
            if self._closing.is_set():
                self.sync.finish(sync_id, 'interrupted', 'SYNC_INTERRUPTED', '服务已停止，请重新分析')
                return
            timeout = self.timeout
            if not self.sync.start(sync_id, timeout):
                return
            if not self._isolated:
                self._run(sync_id)
                return
            with tempfile.TemporaryDirectory(prefix='jit-sync-') as work:
                try:
                    process = OwnedProcess(worker_command(), dict(
                        database=str(self.sync.storage.path), artifactRoot=str(self.artifact_root.resolve()),
                        datasetRoot=str(self.dataset_root.resolve()), allowLocal=self.allow_local,
                        timeout=timeout, syncId=sync_id, workRoot=work), cwd=BACKEND)
                    while True:
                        item = self.sync.get(sync_id)
                        if self._closing.is_set():
                            process.close()
                            self.sync.finish(sync_id, 'interrupted', 'SYNC_INTERRUPTED', '服务已停止，请重新分析')
                            return
                        if item['cancelRequestedAt']:
                            process.close()
                            self.sync.finish(sync_id, 'cancelled', 'SYNC_CANCELLED', '分析已取消')
                            return
                        if item['status'] not in PROGRESS:
                            return
                        if datetime.now(timezone.utc) >= datetime.fromisoformat(item['deadlineAt']):
                            process.close()
                            self.sync.finish(sync_id, 'failed', 'SYNC_TIMEOUT', '分析超过执行时限，已停止；请缩小范围后重试')
                            return
                        if process.poll() is not None:
                            self.sync.finish(sync_id, 'failed', 'SYNC_WORKER_EXITED', '分析进程意外退出，请重新分析')
                            return
                        self._closing.wait(.1)
                finally:
                    if process is not None:
                        process.close()
        except Exception:
            self.sync.finish(sync_id, 'failed', 'SYNC_WORKER_EXITED', '分析进程无法继续，请重新分析')

    def recover(self):
        """启动时处理遗留作业；数据库尚未初始化时视为没有遗留作业（D4）。"""
        try:
            self.sync.backfill_repositories()
            return self.sync.interrupted()
        except BaselineError as exc:
            if exc.code == "STORAGE_UNAVAILABLE":
                return 0
            raise

    def _ensure_repository(self, url, branch, now):
        """按规范化地址查或建仓库：同一仓库的多次同步归到同一条（D2）。"""
        normalized = normalize_repository_url(url)
        repo = self.sync.repository_by_url(normalized)
        if repo is not None:
            return repo["repositoryId"]
        repository_id = repository_id_for(normalized)
        self.sync.repository_create({
            "id": repository_id, "url": normalized,
            "display_name": display_name_for(normalized), "default_branch": None if re.fullmatch(r'[a-f0-9]{40}|[a-f0-9]{64}', branch) else branch,
            "latest_sync_id": None, "latest_sync_at": None, "view_sync_id": None,
            "head_commit": None, "commit_count": 0, "high_count": 0, "medium_count": 0,
            "low_count": 0, "unknown_count": 0, "distribution_rule": None,
            "created_at": now, "updated_at": now})
        return repository_id

    def create(self, payload, request_id=None, *, _pr_source=None, _retry=False, _automatic=False):
        data = sync_input(payload, allow_local=self.allow_local)
        model_id = payload.get('modelId')
        schema_version = None
        if model_id is not None:
            if not isinstance(model_id, str) or not model_id.strip() or data['requestedStrategy'] != 'generic-model':
                raise BaselineError('INPUT_INVALID', '指定模型时请选择现成模型策略')
            _, model = self._generic_model(model_id)
            schema_version = model.get('featureSchemaVersion')
        resolved_model_id = model_id
        if not model_id and data['requestedStrategy'] != 'force-train':
            resolved_model_id = self.catalog.default_model_id()
            if data['requestedStrategy'] == 'generic-model':
                if not resolved_model_id:
                    raise BaselineError('DEFAULT_MODEL_REQUIRED', '请管理员先设置默认模型或明确选择模型')
                _, model = self._generic_model(resolved_model_id)
                schema_version = model.get('featureSchemaVersion')
        now = utc_now()
        with self._lock:
            if self._closing.is_set():
                raise BaselineError('SYNC_SERVICE_STOPPING', '服务正在停止，请稍后重试')
            if _pr_source is not None:
                with self.sync.storage.connection() as db:
                    source = db.execute('SELECT * FROM pr_snapshot WHERE id=?', (_pr_source['snapshotId'],)).fetchone()
                    if (source is None or source['repository_id'] != _pr_source['repositoryId']
                            or source['head_sha'] != data['branch']):
                        raise BaselineError('CONTEXT_MISMATCH', 'PR 分析来源不一致')
                    previous = db.execute('SELECT s.* FROM pr_analysis a JOIN repository_sync s ON s.id=a.sync_id '
                                          'WHERE a.snapshot_id=? AND COALESCE(s.resolved_model_id,s.model_id,s.requested_model_id)=? '
                                          'ORDER BY a.created_at DESC,s.rowid DESC LIMIT 1',
                                          (_pr_source['snapshotId'], resolved_model_id)).fetchone()
                if previous is not None and (previous['status'] in (*PROGRESS, 'completed') or not _retry):
                    return self.get(previous['id']), False
                repository_id = source['repository_id']
                if self.sync.repository_get(repository_id) is None:
                    raise BaselineError('REPOSITORY_UNKNOWN', '项目已删除')
            else:
                existing = self.sync.find_active(repository_url=data["repositoryUrl"], branch=data["branch"],
                                                 since=data["since"], until=data["until"],
                                                 commit_limit=data["commitLimit"],
                                                 requested_strategy=data["requestedStrategy"], requested_model_id=model_id,
                                                 resolved_model_id=resolved_model_id)
                if existing is not None:
                    return self.get(existing['syncId']), False
                repository_id = self._ensure_repository(data["repositoryUrl"], data["branch"], now)
            sync_id = str(uuid.uuid4())
            self.sync.create({"id": sync_id, "repository_url": data["repositoryUrl"],
                              "repository_id": repository_id,
                              "branch": data["branch"], "since": data["since"], "until": data["until"],
                              "commit_limit": data["commitLimit"],
                              "requested_strategy": data["requestedStrategy"], "status": "queued",
                              "stage": "queued", "request_id": request_id, "requested_model_id": model_id,
                              "resolved_model_id": resolved_model_id,
                              "source_kind": 'pr' if _pr_source is not None else 'branch',
                              "source_snapshot_id": _pr_source['snapshotId'] if _pr_source is not None else None,
                              "origin": 'automatic' if _automatic else 'manual',
                              "feature_schema_version": schema_version,
                              "created_at": now, "updated_at": now}, publish=True)
            self._executor.submit(self._execute, sync_id)
        return self.get(sync_id), True

    def get(self, sync_id):
        item = self.sync.get(sync_id)
        if item is None:
            raise BaselineError("NOT_FOUND", "同步作业不存在")
        return self._positions([item])[0]

    def pages(self, limit=20, offset=0):
        if not 1 <= limit <= 100:
            raise BaselineError("INPUT_INVALID", "limit 必须在 1 到 100 之间")
        if offset < 0:
            raise BaselineError("INPUT_INVALID", "offset 不能为负")
        items, total = self.sync.pages(limit, offset)
        return {"syncs": self._positions(items), "total": total, "limit": limit, "offset": offset}

    def commits(self, sync_id, limit=100, offset=0, *, search=None, start=None, end=None,
                sort="risk"):
        item = self.get(sync_id)
        if not 1 <= limit <= 200:
            raise BaselineError("INPUT_INVALID", "limit 必须在 1 到 200 之间")
        if offset < 0:
            raise BaselineError("INPUT_INVALID", "offset 不能为负")
        text = (search or "").strip()
        if len(text) > 200:
            raise BaselineError("INPUT_INVALID", "搜索词不能超过 200 个字符")
        if sort not in ("risk", "time"):
            raise BaselineError("INPUT_INVALID", "排序只能是 risk 或 time")
        since = _date_start(start) if start else None
        until = _date_start(end, next_day=True) if end else None
        if since is not None and until is not None and since >= until:
            raise BaselineError("INPUT_INVALID", "起始日期必须早于或等于结束日期")
        rows, total = self.sync.commits(sync_id, limit, offset, search=text or None,
                                        start=since, end=until, sort=sort)
        return {"syncId": sync_id, "status": item["status"], "total": total, "limit": limit,
                "offset": offset, "search": text or None, "start": start, "end": end,
                "sort": sort, "commits": rows}

    def commit(self, sync_id, commit_id):
        self.get(sync_id)
        record = self.sync.commit(sync_id, commit_id)
        if record is None:
            raise BaselineError("NOT_FOUND", "该同步作业里没有这个提交")
        return record

    def repositories(self, limit=50, offset=0):
        if not 1 <= limit <= 100:
            raise BaselineError("INPUT_INVALID", "limit 必须在 1 到 100 之间")
        if offset < 0:
            raise BaselineError("INPUT_INVALID", "offset 不能为负")
        items, total = self.sync.repositories(limit, offset)
        for item in items:
            item['latestSync'] = self.get(item['latestSyncId']) if item.get('latestSyncId') else None
        return {"repositories": items, "total": total, "limit": limit, "offset": offset}

    def create_repository(self, payload):
        """只登记项目：校验地址并建仓库，不产生分析作业（重复地址返回已有项目）。"""
        if not isinstance(payload, dict):
            raise BaselineError("INPUT_INVALID", "请求体必须是 JSON 对象")
        url = payload.get("repositoryUrl")
        if not isinstance(url, str) or not url.strip():
            raise BaselineError("INPUT_INVALID", "缺少仓库地址")
        url = collect.validate_source(url.strip(), allow_local=self.allow_local)
        normalized = normalize_repository_url(url)
        now = utc_now()
        with self._lock:
            existing = self.sync.repository_by_url(normalized)
            if existing is not None:
                return existing, False
            repository_id = repository_id_for(normalized)
            self.sync.repository_create({
                "id": repository_id, "url": normalized,
                "display_name": display_name_for(normalized), "default_branch": None,
                "latest_sync_id": None, "latest_sync_at": None, "view_sync_id": None,
                "head_commit": None, "commit_count": 0, "high_count": 0, "medium_count": 0,
                "low_count": 0, "unknown_count": 0, "distribution_rule": None,
                "created_at": now, "updated_at": now})
        return self.sync.repository_get(repository_id), True

    def rename_repository(self, repository_id, payload):
        """只改显示名；地址与标识保持不变，历史分析仍指向同一项目。"""
        if self.sync.repository_get(repository_id) is None:
            raise BaselineError("REPOSITORY_UNKNOWN", "仓库不存在")
        name = payload.get("displayName") if isinstance(payload, dict) else None
        if not isinstance(name, str) or not name.strip():
            raise BaselineError("INPUT_INVALID", "显示名不能为空")
        name = name.strip()
        if len(name) > 80:
            raise BaselineError("INPUT_INVALID", "显示名不能超过 80 个字符")
        self.sync.repository_update(repository_id, display_name=name)
        return self.sync.repository_get(repository_id)

    def select_view(self, repository_id, payload):
        """把项目里一条已完成的分析设为当前结果；只改视图指向，不删不改历史记录。"""
        if self.sync.repository_get(repository_id) is None:
            raise BaselineError("REPOSITORY_UNKNOWN", "仓库不存在")
        sync_id = payload.get("viewSyncId") if isinstance(payload, dict) else None
        if not isinstance(sync_id, str) or not sync_id.strip():
            raise BaselineError("INPUT_INVALID", "请选择一条已完成的分析")
        sync_id = sync_id.strip()
        item = self.sync.get(sync_id)
        if item is None or item.get("repositoryId") != repository_id:
            raise BaselineError("NOT_FOUND", "该分析不属于当前项目")
        if item['sourceKind'] == 'pr':
            raise BaselineError('CONTEXT_MISMATCH', 'PR 分析不能设为项目分支当前结果')
        if item["status"] != "completed":
            raise BaselineError("CONFLICT_ACTIVE_SYNC", "只有已完成的分析才能设为当前结果")
        self.sync.repository_refresh(repository_id, sync_id)
        return self.sync.repository_get(repository_id)

    def delete_repository(self, repository_id):
        """删除与任务创建共用锁，检查期间不允许新的任务进入。"""
        with self._lock:
            return self._delete_repository(repository_id)

    def _delete_repository(self, repository_id):
        """硬删项目及其全部分析记录与提交；有在途作业时拒绝。"""
        if self.sync.repository_get(repository_id) is None:
            raise BaselineError("REPOSITORY_UNKNOWN", "仓库不存在")
        with self.sync.storage.connection() as db:
            checking = db.execute("SELECT 1 FROM repository_watch WHERE repository_id=? AND status='checking'", (repository_id,)).fetchone()
            pr_checking = db.execute("SELECT 1 FROM pr_watch WHERE repository_id=? AND status='checking'", (repository_id,)).fetchone()
        if self.sync.repository_active(repository_id) or checking or pr_checking:
            raise BaselineError("CONFLICT_ACTIVE_SYNC", "该项目还有进行中的分析，请等待结束后再删除")
        return self.sync.repository_delete(repository_id)

    def repository_syncs(self, repository_id, limit=20, offset=0):
        """项目的分析记录：按创建时间倒序分页，包含失败与中断的历史。"""
        if self.sync.repository_get(repository_id) is None:
            raise BaselineError("REPOSITORY_UNKNOWN", "仓库不存在")
        if not 1 <= limit <= 100:
            raise BaselineError("INPUT_INVALID", "limit 必须在 1 到 100 之间")
        if offset < 0:
            raise BaselineError("INPUT_INVALID", "offset 不能为负")
        items, total = self.sync.repository_syncs(repository_id, limit, offset)
        return {"repositoryId": repository_id, "syncs": self._positions(items), "total": total,
                "limit": limit, "offset": offset}

    def delete_sync(self, sync_id):
        """删除一条已结束的分析记录；删的若是当前结果，项目回到「无结果」而不自动回退。"""
        item = self.sync.get(sync_id)
        if item is None:
            raise BaselineError("NOT_FOUND", "同步作业不存在")
        if item["status"] in PROGRESS:
            raise BaselineError("CONFLICT_ACTIVE_SYNC", "该分析仍在进行中，结束后才能删除")
        repository_id = item.get("repositoryId")
        commits = self.sync.sync_delete(sync_id)
        if repository_id:
            repo = self.sync.repository_get(repository_id)
            if repo is not None:
                if repo["viewSyncId"] == sync_id:
                    self.sync.repository_update(
                        repository_id, view_sync_id=None, head_commit=None, commit_count=0,
                        high_count=0, medium_count=0, low_count=0, unknown_count=0,
                        distribution_rule=None)
                latest = self.sync.repository_latest_sync(repository_id)
                self.sync.repository_update(
                    repository_id, latest_sync_id=(latest or {}).get("syncId"),
                    latest_sync_at=(latest or {}).get("createdAt"))
        return {"syncId": sync_id, "commits": commits}

    def repository(self, repository_id, *, view_sync_id=None):
        repo = self.sync.repository_get(repository_id)
        if repo is None:
            raise BaselineError("REPOSITORY_UNKNOWN", "仓库不存在")
        selected = view_sync_id if view_sync_id is not None else repo['viewSyncId']
        source = self.sync.get(selected) if selected else None
        if view_sync_id is not None:
            if source is None or source['repositoryId'] != repository_id:
                raise BaselineError('REPOSITORY_ANALYSIS_UNKNOWN', '该仓库中不存在指定分析')
            if source['status'] != 'completed':
                raise BaselineError('REPOSITORY_ANALYSIS_UNAVAILABLE', '指定分析尚未成功完成')
        context = None
        if source:
            with self.sync.storage.connection() as db:
                risks = [row[0] for row in db.execute('SELECT risk FROM repository_commit WHERE sync_id=?', (selected,))]
            counts = distribution_of(risks)
            context = {key: source.get(key) for key in ('repositoryId', 'syncId', 'branch', 'completedAt',
                       'headCommit', 'datasetVersion', 'modelId', 'runId', 'modelStrategy', 'degradeReason',
                       'sourceKind', 'sourceSnapshotId', 'featureSchemaVersion')}
            context.update(distributionRule=DISTRIBUTION_RULE, limitations=list(REPOSITORY_LIMITATIONS),
                           missingMetadata=[key for key in ('completedAt', 'headCommit') if not source.get(key)])
            context['branch'] = source.get('analysisBranch') or source['branch']
            repo = dict(repo, viewSyncId=selected, headCommit=source.get('headCommit'),
                        commitCount=len(risks), distribution=counts, distributionRule=DISTRIBUTION_RULE)
        return dict(repo, modelStrategy=(source or {}).get("modelStrategy"),
                    degradeReason=(source or {}).get("degradeReason"),
                    runId=(source or {}).get("runId"), modelId=(source or {}).get("modelId"),
                    datasetVersion=(source or {}).get("datasetVersion"),
                    limitations=list(REPOSITORY_LIMITATIONS), viewContext=context,
                    latestSync=self.get(repo['latestSyncId']) if repo['latestSyncId'] else None)

    def repository_commits(self, repository_id, limit=50, offset=0, *, search=None,
                           start=None, end=None, sort="risk", view_sync_id=None):
        repo = self.repository(repository_id, view_sync_id=view_sync_id)
        if not 1 <= limit <= 200:
            raise BaselineError("INPUT_INVALID", "limit 必须在 1 到 200 之间")
        if offset < 0:
            raise BaselineError("INPUT_INVALID", "offset 不能为负")
        text = (search or "").strip()
        if len(text) > 200:
            raise BaselineError("INPUT_INVALID", "搜索词不能超过 200 个字符")
        if sort not in ("risk", "time"):
            raise BaselineError("INPUT_INVALID", "排序只能是 risk 或 time")
        since = _date_start(start) if start else None
        until = _date_start(end, next_day=True) if end else None
        if since is not None and until is not None and since >= until:
            raise BaselineError("INPUT_INVALID", "起始日期必须早于或等于结束日期")
        if not repo["viewSyncId"]:
            return {"repositoryId": repository_id, "viewSyncId": None, "total": 0,
                    "limit": limit, "offset": offset, "search": text or None,
                    "start": start, "end": end, "sort": sort, "commits": []}
        rows, total = self.sync.commits(repo["viewSyncId"], limit, offset, search=text or None,
                                        start=since, end=until, sort=sort)
        return {"repositoryId": repository_id, "viewSyncId": repo["viewSyncId"], "total": total,
                "limit": limit, "offset": offset, "search": text or None, "start": start,
                "end": end, "sort": sort, "commits": [self._display_commit(repo, row) for row in rows]}

    @staticmethod
    def _display_commit(repo, record):
        return dict(record, repositoryId=repo['repositoryId'], viewSyncId=repo['viewSyncId'],
                    originalCommitUrl=original_commit_url(repo['url'], record['commitId']),
                    explanationStatus='not-supported', explanationReason='仓库分析未提供逐条模型归因')

    def repository_commit(self, repository_id, commit_id, *, view_sync_id=None):
        repo = self.repository(repository_id, view_sync_id=view_sync_id)
        if not repo["viewSyncId"]:
            raise BaselineError("NOT_FOUND", "该仓库还没有可查看的提交")
        record = self.sync.commit(repo["viewSyncId"], commit_id)
        if record is None:
            raise BaselineError("NOT_FOUND", "该仓库里没有这个提交")
        return self._display_commit(repo, record)

    def repository_summary(self, repository_id, *, view_sync_id=None):
        repo = self.repository(repository_id, view_sync_id=view_sync_id)
        dist = repo["distribution"]
        return {"repositoryId": repository_id, "viewSyncId": repo["viewSyncId"],
                "total": repo["commitCount"], "high": dist["high"], "medium": dist["medium"],
                "low": dist["low"], "unknown": dist["unknown"],
                "distributionRule": repo["distributionRule"] or DISTRIBUTION_RULE}

    def _step(self, sync_id, stage, started):
        if time.monotonic() - started > self.timeout:
            raise BaselineError("SYNC_TIMEOUT",
                                f"同步超过 {self.timeout} 秒未完成，请缩小时间范围或提交上限后重试")
        self.sync.advance(sync_id, stage)

    def _generic_model(self, model_id=None):
        model_id = model_id or self.catalog.default_model_id()
        if not model_id:
            raise BaselineError('DEFAULT_MODEL_REQUIRED', '请管理员设置默认模型或明确选择模型')
        if not self.catalog.policy(model_id)['enabled']:
            raise BaselineError('MODEL_DISABLED', '所选模型已停用，请重新选择')
        snapshot, payload = self.catalog.load_model(model_id)
        if payload.get('featureSchemaVersion') not in (GENERIC_SCHEMA, SCHEMA_NAME):
            raise BaselineError('INPUT_SCHEMA_MISMATCH', '所选模型无法读取仓库采集特征，请选择兼容模型')
        return snapshot, payload

    def _persist(self, sync_id, item, collected):
        """写 CSV、登记数据集并入库；返回描述文件绝对路径与版本名（RCL-08）。"""
        records = collected["rawRecords"]
        # 同一仓库共用数据集名，版本由实际时间范围决定，重复同步同窗口即幂等复用。
        dataset = f"{SCHEMA_NAME}-{collect.dataset_name(item['repositoryUrl'])}"
        cohort = collect.cohort(item["since"], item["until"])
        parsed, _ = parse_source(collected["blob"], SCHEMA_NAME, cohort)
        if not parsed:
            raise BaselineError("DATASET_INVALID", "采集结果没有可纳入的记录，请调整时间范围或提交上限")
        start, end = parsed[0]["time"][:10], parsed[-1]["time"][:10]
        version = f"{dataset}-{start}_{end}"
        room = self.dataset_root / dataset
        try:
            room.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise BaselineError("DATASET_UNAVAILABLE", "数据集目录不可写，请检查存储权限") from exc
        registered = _register_unique(
            room, dataset, version, collected["blob"], schema=SCHEMA_NAME,
            cohort=cohort, root=self.dataset_root,
            extra={"collection": collected["collection"]},
            provenance={"publisher": "collected", "revision": collected["collection"]["repository"]["head"],
                        "url": item["repositoryUrl"], "citation": "由仓库同步采集生成（简化 SZZ）"},
            after=lambda entry, csv: store.import_dataset(
                csv, _absolute(entry["path"]), self.sync.storage))
        csv_path = room / f"{registered['version']}.csv"
        manifest_path = _absolute(registered["path"])
        self.sync.update(sync_id, dataset_version=registered["version"])
        return manifest_path, registered["version"]

    def _run(self, sync_id):
        started = time.monotonic()
        item = self.sync.get(sync_id)
        if item is None or item['status'] not in PROGRESS:
            return
        decision, version, run_id = None, None, None
        try:
            self._step(sync_id, "collecting", started)
            collected = self.collect(item["repositoryUrl"], since=item["since"], until=item["until"],
                                     branch=item["branch"], limit=item["commitLimit"],
                                     allow_local=self.allow_local, return_blob=True)
            records = collected["rawRecords"]

            self._step(sync_id, "registering", started)
            manifest_path, version = self._persist(sync_id, item, collected)

            self._step(sync_id, "training", started)
            holdout = _holdout(records)
            decision = choose_model(records, item["requestedStrategy"], holdout)
            self.sync.update(sync_id, model_strategy=decision["modelStrategy"],
                             degrade_reason=decision["degradeReason"],
                             train_records=decision["trainRecords"],
                             train_positives=decision["trainPositives"])
            if decision["modelStrategy"] == TRAINED:
                output = self.artifact_root / f"repository-sync-{sync_id[:8]}"
                built = artifacts.build_run(BACKEND / "data" / "openstack", output, schema=SCHEMA_NAME,
                                            dataset_manifest=manifest_path, holdout=holdout)
                registered = self.catalog.register_key(output.name, channel="repository-sync",
                                                       request_id=item.get("requestId"))
                model_id = registered["model"]["modelId"]
                snapshot = Snapshot.load(output)
                schema = snapshot.schema
                inputs = [{"features": record["features"]} for record in records]
                run_id = built["runId"]
            else:
                model_choice = item.get('resolvedModelId') or item.get('requestedModelId')
                if not model_choice:
                    raise BaselineError('DEFAULT_MODEL_REQUIRED', '提交任务时没有默认模型，请重新发起分析')
                snapshot, payload = self._generic_model(model_choice)
                model_id = payload["modelId"]
                schema = resolve(payload.get('featureSchemaVersion', GENERIC_SCHEMA))
                fields = schema.in_model_names()
                inputs = generic_inputs(records, fields) if schema.name == GENERIC_SCHEMA else [{"features": record["features"]} for record in records]
                run_id = payload.get("runId")
            self.sync.update(sync_id, model_id=model_id, run_id=run_id)

            self._step(sync_id, "scoring", started)
            risks = predict_risks(snapshot.model, inputs, schema)
            self.sync.complete(sync_id, item.get('repositoryId'), [
                {"id": record["id"], "epoch": record["epoch"], "risk": risk,
                 "addedLines": record["metrics"]["la"], "deletedLines": record["metrics"]["ld"],
                 "files": record["metrics"]["nf"], "features": record["metrics"],
                 "filePaths": record.get("filePaths") or [],
                 "label": record["label"], "labelNote": record.get("labelNote"),
                 "subject": record.get("subject"), "authorName": record.get('authorName')}
                for record, risk in zip(records, risks, strict=True)],
                head_commit=collected['collection']['repository']['head'],
                analysis_branch=collected['collection']['repository'].get('resolvedBranch'),
                dataset_version=version, run_id=run_id, model_id=model_id, feature_schema_version=schema.name)
        except BaselineError as exc:
            degrade = (decision or {}).get("degradeReason")
            if exc.code in ("MODEL_NOT_READY", "DEFAULT_MODEL_REQUIRED"):
                degrade = "noGenericModel"
            self.sync.finish(sync_id, 'cancelled' if exc.code == 'SYNC_CANCELLED' else 'failed', exc.code, str(exc),
                             **({"degrade_reason": degrade} if degrade else {}),
                             **({"dataset_version": version} if version else {}))
        except Exception:
            self.sync.finish(sync_id, 'failed', 'INTERNAL_ERROR',
                             '同步过程中出现未预期错误，请重试；如果反复失败请联系维护者')
