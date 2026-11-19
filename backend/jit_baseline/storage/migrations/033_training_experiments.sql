CREATE TABLE training_experiment (
    id TEXT PRIMARY KEY,
    dataset_version TEXT NOT NULL,
    dataset_manifest TEXT NOT NULL,
    manifest_sha256 TEXT NOT NULL,
    metric_set TEXT NOT NULL,
    split_preset TEXT NOT NULL,
    class_policy_json TEXT,
    seed INTEGER NOT NULL,
    signature TEXT NOT NULL,
    request_id TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);
ALTER TABLE training_task ADD COLUMN experiment_id TEXT REFERENCES training_experiment(id);
ALTER TABLE training_task ADD COLUMN params_json TEXT;
ALTER TABLE training_task ADD COLUMN history_json TEXT;
CREATE INDEX training_task_experiment ON training_task(experiment_id, created_at);
CREATE INDEX training_experiment_signature ON training_experiment(signature);
CREATE TABLE training_experiment_task (
    experiment_id TEXT NOT NULL REFERENCES training_experiment(id),
    task_id TEXT NOT NULL REFERENCES training_task(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (experiment_id, task_id)
);
