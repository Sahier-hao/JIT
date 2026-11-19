ALTER TABLE training_task ADD COLUMN release_policy TEXT;
ALTER TABLE training_task ADD COLUMN release_status TEXT NOT NULL DEFAULT 'not-evaluated';
ALTER TABLE training_task ADD COLUMN release_report_id TEXT;
ALTER TABLE training_task ADD COLUMN release_json TEXT;
