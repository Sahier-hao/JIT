ALTER TABLE repository_watch ADD COLUMN window_days INTEGER NOT NULL DEFAULT 90;
ALTER TABLE repository_watch ADD COLUMN commit_limit INTEGER NOT NULL DEFAULT 500;
CREATE TABLE pr_snapshot (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    number INTEGER NOT NULL,
    base_sha TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(owner,name,number,base_sha,head_sha)
);
CREATE TABLE pr_latest (
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    number INTEGER NOT NULL,
    snapshot_id TEXT NOT NULL REFERENCES pr_snapshot(id) ON DELETE CASCADE,
    remote_state TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    PRIMARY KEY(owner,name,number)
);
CREATE TABLE pr_file_content (
    snapshot_id TEXT NOT NULL REFERENCES pr_snapshot(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    side TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY(snapshot_id,path,side)
);
CREATE TABLE pr_analysis (
    snapshot_id TEXT NOT NULL REFERENCES pr_snapshot(id) ON DELETE CASCADE,
    sync_id TEXT NOT NULL REFERENCES repository_sync(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(snapshot_id,sync_id)
);
