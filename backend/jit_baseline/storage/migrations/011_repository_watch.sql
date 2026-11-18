CREATE TABLE repository_watch (
    repository_id TEXT PRIMARY KEY REFERENCES repository(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
    branch TEXT NOT NULL DEFAULT 'HEAD',
    model_id TEXT,
    interval_seconds INTEGER NOT NULL DEFAULT 300 CHECK(interval_seconds BETWEEN 300 AND 86400),
    status TEXT NOT NULL DEFAULT 'idle',
    last_attempt_at TEXT,
    last_checked_at TEXT,
    next_check_at TEXT,
    remote_head TEXT,
    resolved_branch TEXT,
    sync_id TEXT,
    error_code TEXT,
    check_token TEXT,
    lease_until TEXT
);
CREATE INDEX repository_watch_due ON repository_watch(enabled, next_check_at);
