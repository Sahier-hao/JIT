CREATE TABLE model_share (
    model_id TEXT PRIMARY KEY REFERENCES model_version(id) ON DELETE CASCADE,
    shared_by TEXT NOT NULL,
    shared_at TEXT NOT NULL
);
CREATE INDEX model_share_time ON model_share(shared_at);
