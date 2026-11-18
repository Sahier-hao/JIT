CREATE TABLE IF NOT EXISTS dataset_record(
    dataset_version TEXT PRIMARY KEY,
    dataset_name TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    manifest_sha256 TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    row_count INTEGER NOT NULL CHECK(row_count >= 0),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS commit_record(
    dataset_version TEXT NOT NULL REFERENCES dataset_record(dataset_version),
    commit_id TEXT NOT NULL,
    author_time TEXT NOT NULL,
    label INTEGER NOT NULL CHECK(label IN (0, 1)),
    label_rule TEXT NOT NULL,
    PRIMARY KEY(dataset_version, commit_id)
);
CREATE TABLE IF NOT EXISTS feature_record(
    dataset_version TEXT NOT NULL,
    commit_id TEXT NOT NULL,
    field TEXT NOT NULL,
    value_json TEXT NOT NULL,
    PRIMARY KEY(dataset_version, commit_id, field),
    FOREIGN KEY(dataset_version, commit_id) REFERENCES commit_record(dataset_version, commit_id)
);
CREATE TABLE IF NOT EXISTS modified_entity(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_version TEXT NOT NULL,
    commit_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('file', 'module')),
    entity_value TEXT NOT NULL,
    FOREIGN KEY(dataset_version, commit_id) REFERENCES commit_record(dataset_version, commit_id)
);
CREATE TABLE IF NOT EXISTS import_run(
    id TEXT PRIMARY KEY,
    dataset_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
    row_count INTEGER NOT NULL CHECK(row_count >= 0),
    error_code TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS commit_dataset ON commit_record(dataset_version, author_time);
CREATE INDEX IF NOT EXISTS feature_field ON feature_record(dataset_version, field);
CREATE INDEX IF NOT EXISTS entity_lookup ON modified_entity(entity_type, entity_value);
CREATE INDEX IF NOT EXISTS import_dataset ON import_run(dataset_version, status);
