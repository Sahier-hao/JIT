CREATE TABLE pr_batch (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('discovering','running','completed','partial','failed','interrupted')),
    discovery_complete INTEGER NOT NULL DEFAULT 0,
    discovered INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    retry_of TEXT REFERENCES pr_batch(id),
    request_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX pr_batch_repository ON pr_batch(repository_id, created_at DESC, id DESC);
CREATE INDEX pr_batch_active ON pr_batch(repository_id, status);

CREATE TABLE pr_batch_item (
    batch_id TEXT NOT NULL REFERENCES pr_batch(id),
    number INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','submitted','reused','failed','skipped')),
    snapshot_id TEXT,
    sync_id TEXT,
    model_id TEXT,
    error_code TEXT,
    error_message TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (batch_id, number)
);
CREATE INDEX pr_batch_item_sync ON pr_batch_item(sync_id);
