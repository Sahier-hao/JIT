"""Audit migration 043 on a disposable copy of a catalog database.

The audit never writes the source database. It copies the catalog, brings the
copy to schema 42 (or reverses 043 when the source is already current), injects
representative legacy training/explanation/risk/history rows, snapshots every
audited table, applies only migration 043, and compares counts and content
hashes. The JSON report is intended for freeze-evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from jit_baseline.catalog_storage import MIGRATIONS  # noqa: E402

MIGRATION_43 = dict(MIGRATIONS)[43]
AUDITED_TABLES = (
    "training_task",
    "training_experiment",
    "training_experiment_task",
    "repository_sync",
    "repository_commit",
    "experiment_run",
    "model_version",
    "run_location",
    "project_trend_view",
    "prediction",
    "prediction_batch",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _statements(path: Path) -> list[str]:
    return [statement for statement in path.read_text(encoding="utf-8").split(";") if statement.strip()]


def _apply(db: sqlite3.Connection, path: Path) -> None:
    for statement in _statements(path):
        db.execute(statement)


def _version(db: sqlite3.Connection) -> int:
    rows = db.execute("SELECT version FROM schema_migration").fetchall()
    if len(rows) != 1:
        raise RuntimeError("schema_migration 必须恰有一行")
    return int(rows[0][0])


def _set_version(db: sqlite3.Connection, version: int) -> None:
    db.execute("UPDATE schema_migration SET version=?, applied_at=?", (version, _now()))


def _table_snapshot(db: sqlite3.Connection, table: str) -> dict:
    cursor = db.execute('SELECT * FROM "%s"' % table)
    columns = [item[0] for item in cursor.description]
    rows = []
    for row in cursor.fetchall():
        payload = {column: row[index] for index, column in enumerate(columns)}
        rows.append(json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":")))
    rows.sort()
    digest = hashlib.sha256("\n".join(rows).encode("utf-8")).hexdigest()
    return {"count": len(rows), "sha256": digest, "columns": columns}


def _explanation_identity(db: sqlite3.Connection) -> list[dict]:
    return [
        {"syncId": row[0], "commitId": row[1], "payload": row[2]}
        for row in db.execute(
            "SELECT sync_id, commit_id, payload_json FROM repository_explanation "
            "ORDER BY sync_id, commit_id",
        ).fetchall()
    ]


def _snapshot(db: sqlite3.Connection) -> dict:
    return {
        "version": _version(db),
        "tables": {table: _table_snapshot(db, table) for table in AUDITED_TABLES},
        "explanations": _explanation_identity(db),
    }


def _prepare_v42(db: sqlite3.Connection) -> dict:
    version = _version(db)
    applied: list[int] = []
    if version > 43:
        raise RuntimeError(f"未知更高 schema 版本：{version}")
    if version == 43:
        _reverse_43(db)
        version = 42
        applied.append(43)
    if version < 42:
        for number, path in MIGRATIONS:
            if version < number <= 42:
                _apply(db, path)
                applied.append(number)
        _set_version(db, 42)
    return {"sourceVersion": version, "setupMigrations": applied}


def _reverse_43(db: sqlite3.Connection) -> None:
    db.execute(
        "CREATE TABLE repository_explanation_legacy("
        "sync_id TEXT NOT NULL, commit_id TEXT NOT NULL, payload_json TEXT NOT NULL, "
        "PRIMARY KEY(sync_id,commit_id), "
        "FOREIGN KEY(sync_id,commit_id) REFERENCES repository_commit(sync_id,commit_id) ON DELETE CASCADE)",
    )
    rows = db.execute(
        "SELECT sync_id, commit_id, payload_json FROM repository_explanation "
        "ORDER BY sync_id, commit_id, CASE method WHEN 'occlusion-mean-v1' THEN 0 ELSE 1 END, method",
    ).fetchall()
    seen: set[tuple[str, str]] = set()
    for sync_id, commit_id, payload in rows:
        key = (sync_id, commit_id)
        if key in seen:
            continue
        seen.add(key)
        db.execute(
            "INSERT INTO repository_explanation_legacy(sync_id,commit_id,payload_json) VALUES (?,?,?)",
            (sync_id, commit_id, payload),
        )
    db.execute("DROP TABLE repository_explanation")
    db.execute("ALTER TABLE repository_explanation_legacy RENAME TO repository_explanation")
    _set_version(db, 42)


def _inject_legacy_rows(db: sqlite3.Connection) -> dict:
    commit_a, commit_b, commit_c = "a" * 40, "b" * 40, "c" * 40
    db.execute(
        "INSERT INTO training_task(id,dataset_version,dataset_manifest,manifest_sha256,"
        "algorithm,metric_set,status,stage,created_by,created_at,updated_at,"
        "metrics_by_partition_json,history_json,params_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            "audit-task",
            "audit-dataset",
            "{}",
            "d" * 64,
            "logistic-regression-l2-v1",
            "metric-set-v2",
            "succeeded",
            "completed",
            "audit-user",
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:00:00Z",
            '{"train":{"records":3},"validation":{"records":1},"test":{"records":1}}',
            '{"train":[0.5]}',
            '{"C":1.0}',
        ),
    )
    db.execute(
        "INSERT INTO training_experiment(id,dataset_version,dataset_manifest,manifest_sha256,"
        "metric_set,split_preset,seed,signature,created_by,created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        ("audit-experiment", "audit-dataset", "{}", "d" * 64, "metric-set-v2",
         "temporal-70-15-15", 2026, "audit-signature", "audit-user", "2026-01-01T00:00:00Z"),
    )
    db.execute(
        "INSERT INTO training_experiment_task(experiment_id,task_id,created_at) VALUES (?,?,?)",
        ("audit-experiment", "audit-task", "2026-01-01T00:00:00Z"),
    )
    db.execute(
        "INSERT INTO repository_sync(id,repository_url,branch,requested_strategy,status,stage,"
        "created_at,updated_at,dataset_version,model_id,run_id,source_kind,origin,maturity_policy) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("audit-sync", "https://github.com/example/audit", "main", "generic-model", "completed",
         "completed", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "audit-dataset",
         "audit-model", "audit-run", "unknown", "manual", "mature-only"),
    )
    for commit_id, risk in ((commit_a, 0.42), (commit_b, 0.17), (commit_c, 0.88)):
        db.execute(
            "INSERT INTO repository_commit(sync_id,commit_id,epoch,risk,added_lines,deleted_lines,"
            "files,features_json,label,subject) VALUES (?,?,?,?,?,?,?,?,?,?)",
            ("audit-sync", commit_id, 1, risk, 10, 2, 3,
             '{"ns":1,"nd":2,"nf":3,"ent":0.5,"la":10,"ld":2}', 1, "audit commit"),
        )
    legacy_payloads = (
        (commit_a, '{"explanationMethod":"occlusion-mean-v1","explanationStatus":"supported","delta":0.1}'),
        (commit_b, '{"explanationStatus":"not-supported","value":2}'),
        (commit_c, '{"explanationMethod":"linear-logodds-v1","explanationStatus":"supported","delta":1.2}'),
    )
    for commit_id, payload in legacy_payloads:
        db.execute(
            "INSERT INTO repository_explanation(sync_id,commit_id,payload_json) VALUES (?,?,?)",
            ("audit-sync", commit_id, payload),
        )
    return {
        "trainingTasks": 1,
        "trainingExperiments": 1,
        "repositorySyncs": 1,
        "repositoryCommits": 3,
        "legacyExplanations": 3,
    }


def _compare(before: dict, after: dict) -> dict:
    unchanged = {}
    for table in AUDITED_TABLES:
        unchanged[table] = before["tables"][table]["count"] == after["tables"][table]["count"] and \
            before["tables"][table]["sha256"] == after["tables"][table]["sha256"]
    before_explanations = {(item["syncId"], item["commitId"]): item["payload"] for item in before["explanations"]}
    after_explanations = {(item["syncId"], item["commitId"]): item["payload"] for item in after["explanations"]}
    return {
        "tableUnchanged": unchanged,
        "trainingTasksUnchanged": unchanged["training_task"],
        "modelsUnchanged": unchanged["model_version"] and unchanged["experiment_run"] and unchanged["run_location"],
        "risksUnchanged": unchanged["repository_commit"],
        "historyUnchanged": unchanged["repository_sync"] and unchanged["training_experiment"],
        "explanationPayloadsPreserved": before_explanations == after_explanations,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="审计迁移 043 不重写旧数据")
    parser.add_argument("--source", type=Path, default=BACKEND / "storage/catalog.sqlite3")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve()
    source_before = _sha256(source)
    started = _now()
    with tempfile.TemporaryDirectory(prefix="jit-migration-audit-") as temp:
        copy = Path(temp) / "catalog-audit.sqlite3"
        shutil.copy2(source, copy)
        db = sqlite3.connect(copy)
        db.execute("PRAGMA foreign_keys=ON")
        try:
            setup = _prepare_v42(db)
            injected = _inject_legacy_rows(db)
            db.commit()
            before = _snapshot(db)
            _apply(db, MIGRATION_43)
            _set_version(db, 43)
            db.commit()
            after = _snapshot(db)
            comparisons = _compare(before, after)
            methods = {
                row[0]: row[1]
                for row in db.execute(
                    "SELECT commit_id, method FROM repository_explanation WHERE sync_id='audit-sync'",
                ).fetchall()
            }
            foreign_keys = db.execute("PRAGMA foreign_key_check").fetchall()
            db.close()
            # A second initialization at the storage layer must be a no-op.
            from jit_baseline.catalog_storage import CatalogStorage

            storage = CatalogStorage(copy)
            storage.initialize()
            storage.initialize()
            db2 = sqlite3.connect(copy)
            idempotent_version = _version(db2)
            idempotent_foreign_keys = db2.execute("PRAGMA foreign_key_check").fetchall()
            idempotent_explanations = _explanation_identity(db2)
            db2.close()
        finally:
            try:
                db.close()
            except Exception:
                pass
    checks = {
        **comparisons,
        "legacyDefaultMethodBackfilled": methods.get("b" * 40) == "occlusion-mean-v1",
        "explicitMethodPreserved": methods.get("c" * 40) == "linear-logodds-v1",
        "schemaVersion43": after["version"] == 43,
        "foreignKeysValid": not foreign_keys,
        "idempotentInitialize": idempotent_version == 43 and not idempotent_foreign_keys
        and idempotent_explanations == after["explanations"],
        "sourceDatabaseUnchanged": _sha256(source) == source_before,
    }
    report = {
        "kind": "repository-explanation-migration-43-audit",
        "startedUtc": started,
        "finishedUtc": _now(),
        "source": source.relative_to(ROOT).as_posix() if source.is_relative_to(ROOT) else str(source),
        "sourceSha256": source_before,
        "setup": setup,
        "injected": injected,
        "before": before,
        "after": after,
        "checks": checks,
        "passed": all(value for key, value in checks.items() if isinstance(value, bool)),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "checks": checks}, ensure_ascii=False, indent=2))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
