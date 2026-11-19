ALTER TABLE dataset_record ADD COLUMN usage TEXT NOT NULL DEFAULT 'branch';
ALTER TABLE dataset_record ADD COLUMN source_sync_id TEXT;
