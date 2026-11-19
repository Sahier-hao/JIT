CREATE TABLE pr_watch (
    repository_id TEXT PRIMARY KEY REFERENCES repository(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    ever_enabled INTEGER NOT NULL DEFAULT 0 CHECK(ever_enabled IN (0,1)),
    model_id TEXT,
    interval_seconds INTEGER NOT NULL DEFAULT 300 CHECK(interval_seconds >= 300),
    status TEXT NOT NULL DEFAULT 'idle',
    last_attempt_at TEXT,
    last_checked_at TEXT,
    next_check_at TEXT,
    retry_not_before TEXT,
    error_code TEXT,
    check_token TEXT,
    lease_until TEXT,
    discovery_page INTEGER NOT NULL DEFAULT 1,
    discovery_complete INTEGER NOT NULL DEFAULT 0,
    deep_cursor INTEGER NOT NULL DEFAULT 0,
    initial_done INTEGER NOT NULL DEFAULT 0,
    last_scheduled_at TEXT
);
CREATE INDEX pr_watch_due ON pr_watch(enabled,next_check_at,last_scheduled_at);
CREATE TABLE pr_cache (
    repository_id TEXT NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    url TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    remote_state TEXT NOT NULL,
    draft INTEGER NOT NULL DEFAULT 0,
    snapshot_id TEXT REFERENCES pr_snapshot(id) ON DELETE SET NULL,
    checked_at TEXT NOT NULL,
    announced INTEGER NOT NULL DEFAULT 0,
    announced_state TEXT,
    PRIMARY KEY(repository_id,number)
);
CREATE TABLE pr_list_page (
    repository_id TEXT NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    page INTEGER NOT NULL,
    numbers_json TEXT NOT NULL,
    has_more INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT,
    error_code TEXT,
    PRIMARY KEY(repository_id,state,page)
);
CREATE TABLE pr_auto_intent (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    snapshot_id TEXT NOT NULL REFERENCES pr_snapshot(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    scoring_contract TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    sync_id TEXT REFERENCES repository_sync(id) ON DELETE SET NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    retry_at TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(repository_id,number,snapshot_id,model_id,scoring_contract)
);
CREATE INDEX pr_auto_intent_due ON pr_auto_intent(repository_id,status,retry_at,created_at);
CREATE TABLE pr_auto_attempt (
    intent_id TEXT NOT NULL REFERENCES pr_auto_intent(id) ON DELETE CASCADE,
    sync_id TEXT NOT NULL REFERENCES repository_sync(id) ON DELETE CASCADE,
    observed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY(intent_id,sync_id)
);
CREATE TABLE project_event (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    number INTEGER,
    snapshot_id TEXT,
    sync_id TEXT,
    model_id TEXT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX project_event_recent ON project_event(created_at DESC,id DESC);
CREATE INDEX project_event_repository ON project_event(repository_id,created_at DESC,id DESC);
