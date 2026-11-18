PRAGMA defer_foreign_keys=ON;
CREATE TABLE dataset_build_task_new (
    id TEXT PRIMARY KEY,
    repository_id TEXT REFERENCES repository(id) ON DELETE CASCADE,
    repository_url TEXT NOT NULL,
    branch TEXT NOT NULL,
    since TEXT,
    until TEXT,
    commit_limit INTEGER NOT NULL CHECK(commit_limit > 0),
    status TEXT NOT NULL CHECK(status IN
        ('queued','running','completed','failed','cancelled','interrupted')),
    stage TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    parent_task_id TEXT REFERENCES dataset_build_task_new(id),
    created_by TEXT NOT NULL,
    request_id TEXT,
    dataset_name TEXT,
    dataset_version TEXT,
    dataset_manifest TEXT,
    manifest_sha256 TEXT,
    quality_json TEXT,
    collection_json TEXT,
    reused INTEGER NOT NULL DEFAULT 0 CHECK(reused IN (0,1)),
    head_commit TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    deadline_at TEXT,
    cancel_requested_at TEXT,
    completed_at TEXT,
    owner_user_id TEXT
);
INSERT INTO dataset_build_task_new (
    id, repository_id, repository_url, branch, since, until, commit_limit,
    status, stage, error_code, error_message, parent_task_id, created_by,
    request_id, dataset_name, dataset_version, dataset_manifest, manifest_sha256,
    quality_json, collection_json, reused, head_commit, created_at, updated_at,
    started_at, deadline_at, cancel_requested_at, completed_at, owner_user_id
)
SELECT
    id, repository_id, repository_url, branch, since, until, commit_limit,
    status, stage, error_code, error_message, parent_task_id, created_by,
    request_id, dataset_name, dataset_version, dataset_manifest, manifest_sha256,
    quality_json, collection_json, reused, head_commit, created_at, updated_at,
    started_at, deadline_at, cancel_requested_at, completed_at, owner_user_id
FROM dataset_build_task;
DROP TABLE dataset_build_task;
ALTER TABLE dataset_build_task_new RENAME TO dataset_build_task;
CREATE INDEX dataset_build_task_repository
ON dataset_build_task(repository_id, created_at DESC);
CREATE INDEX dataset_build_task_active
ON dataset_build_task(repository_id, branch, since, until, commit_limit, status);
CREATE INDEX dataset_build_task_owner
ON dataset_build_task(owner_user_id, created_at DESC);
