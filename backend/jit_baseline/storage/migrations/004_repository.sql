CREATE TABLE IF NOT EXISTS repository(
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    default_branch TEXT,
    latest_sync_id TEXT,
    latest_sync_at TEXT,
    view_sync_id TEXT,
    head_commit TEXT,
    commit_count INTEGER NOT NULL DEFAULT 0 CHECK(commit_count >= 0),
    high_count INTEGER NOT NULL DEFAULT 0 CHECK(high_count >= 0),
    medium_count INTEGER NOT NULL DEFAULT 0 CHECK(medium_count >= 0),
    low_count INTEGER NOT NULL DEFAULT 0 CHECK(low_count >= 0),
    unknown_count INTEGER NOT NULL DEFAULT 0 CHECK(unknown_count >= 0),
    distribution_rule TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
ALTER TABLE repository_sync ADD COLUMN repository_id TEXT;
ALTER TABLE repository_commit ADD COLUMN subject TEXT;
CREATE INDEX IF NOT EXISTS repository_recent ON repository(updated_at DESC);
CREATE INDEX IF NOT EXISTS repository_sync_by_repository ON repository_sync(repository_id, created_at DESC);
