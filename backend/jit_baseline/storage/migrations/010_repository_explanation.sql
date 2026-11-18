CREATE TABLE repository_explanation(
    sync_id TEXT NOT NULL,
    commit_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY(sync_id,commit_id),
    FOREIGN KEY(sync_id,commit_id) REFERENCES repository_commit(sync_id,commit_id) ON DELETE CASCADE
);
