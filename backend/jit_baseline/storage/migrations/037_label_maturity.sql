ALTER TABLE training_task ADD COLUMN maturity_policy TEXT NOT NULL DEFAULT 'mature-only';
ALTER TABLE training_task ADD COLUMN maturity_json TEXT;
ALTER TABLE repository_sync ADD COLUMN maturity_policy TEXT NOT NULL DEFAULT 'mature-only';
ALTER TABLE repository_sync ADD COLUMN maturity_json TEXT;

CREATE INDEX training_task_maturity_active
ON training_task(dataset_version, algorithm, metric_set, maturity_policy, status);
