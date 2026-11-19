CREATE TABLE repository_overview (
    repository_id TEXT PRIMARY KEY REFERENCES repository(id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
