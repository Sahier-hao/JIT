ALTER TABLE training_task ADD COLUMN split_preset TEXT;
ALTER TABLE training_task ADD COLUMN split_policy_json TEXT;
ALTER TABLE repository_sync ADD COLUMN split_preset TEXT;
ALTER TABLE repository_sync ADD COLUMN split_policy_json TEXT;
CREATE INDEX training_task_split_active
ON training_task(dataset_version, algorithm, metric_set, split_preset, status);
