CREATE TABLE dataset_share (
    dataset_version TEXT PRIMARY KEY REFERENCES dataset_record(dataset_version) ON DELETE CASCADE,
    shared_by TEXT NOT NULL,
    shared_at TEXT NOT NULL
);
CREATE INDEX dataset_share_time ON dataset_share(shared_at);
