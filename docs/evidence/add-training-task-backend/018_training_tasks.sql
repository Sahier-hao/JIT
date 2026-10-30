CREATE TABLE registration_event_next(
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('http-local','http-admin','local-cli','repository-sync','training-task')),
    result TEXT NOT NULL CHECK(result IN ('created','reused','failed')),
    error_code TEXT,
    created_at TEXT NOT NULL,
    run_id TEXT REFERENCES experiment_run(id),
    model_id TEXT REFERENCES model_version(id)
);
INSERT INTO registration_event_next SELECT * FROM registration_event;
DROP TABLE registration_event;
ALTER TABLE registration_event_next RENAME TO registration_event;
CREATE INDEX registration_request ON registration_event(request_id);

CREATE TABLE training_task (
    id TEXT PRIMARY KEY,
    dataset_version TEXT NOT NULL,
    dataset_manifest TEXT NOT NULL,
    manifest_sha256 TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    metric_set TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','interrupted')),
    stage TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    parent_task_id TEXT REFERENCES training_task(id),
    created_by TEXT NOT NULL,
    request_id TEXT,
    artifact_key TEXT,
    artifact_run_id TEXT,
    run_id TEXT,
    model_id TEXT,
    feature_schema_version TEXT,
    metrics_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    deadline_at TEXT,
    cancel_requested_at TEXT,
    completed_at TEXT
);
CREATE INDEX training_task_created ON training_task(created_at DESC, id DESC);
CREATE INDEX training_task_active ON training_task(dataset_version, algorithm, metric_set, status);
CREATE INDEX training_task_parent ON training_task(parent_task_id, created_at);
