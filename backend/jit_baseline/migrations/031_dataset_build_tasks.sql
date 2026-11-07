CREATE TABLE dataset_build_task (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
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
    parent_task_id TEXT REFERENCES dataset_build_task(id),
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
    completed_at TEXT
);
CREATE INDEX dataset_build_task_repository
ON dataset_build_task(repository_id, created_at DESC);
CREATE INDEX dataset_build_task_active
ON dataset_build_task(repository_id, branch, since, until, commit_limit, status);
