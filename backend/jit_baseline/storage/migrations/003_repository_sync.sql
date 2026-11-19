CREATE TABLE IF NOT EXISTS repository_sync(
    id TEXT PRIMARY KEY,
    repository_url TEXT NOT NULL,
    branch TEXT NOT NULL,
    since TEXT,
    until TEXT,
    commit_limit INTEGER CHECK(commit_limit IS NULL OR commit_limit > 0),
    requested_strategy TEXT NOT NULL CHECK(requested_strategy IN ('auto', 'generic-model', 'force-train')),
    status TEXT NOT NULL CHECK(status IN ('queued', 'collecting', 'registering', 'training', 'scoring', 'completed', 'failed', 'interrupted')),
    stage TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    dataset_version TEXT,
    run_id TEXT,
    model_id TEXT,
    model_strategy TEXT CHECK(model_strategy IS NULL OR model_strategy IN ('repository-trained', 'generic-model')),
    degrade_reason TEXT CHECK(degrade_reason IS NULL OR degrade_reason IN ('fewRecords', 'fewPositives', 'noTestPositive', 'noGenericModel')),
    train_records INTEGER CHECK(train_records IS NULL OR train_records >= 0),
    train_positives INTEGER CHECK(train_positives IS NULL OR train_positives >= 0),
    request_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repository_commit(
    sync_id TEXT NOT NULL REFERENCES repository_sync(id),
    commit_id TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    risk REAL NOT NULL,
    added_lines INTEGER NOT NULL CHECK(added_lines >= 0),
    deleted_lines INTEGER NOT NULL CHECK(deleted_lines >= 0),
    files INTEGER NOT NULL CHECK(files >= 0),
    features_json TEXT NOT NULL,
    label INTEGER NOT NULL CHECK(label IN (0, 1)),
    label_note TEXT,
    PRIMARY KEY(sync_id, commit_id)
);
CREATE INDEX IF NOT EXISTS repository_sync_recent ON repository_sync(created_at DESC);
CREATE INDEX IF NOT EXISTS repository_commit_order ON repository_commit(sync_id, risk DESC, epoch DESC, commit_id ASC);
