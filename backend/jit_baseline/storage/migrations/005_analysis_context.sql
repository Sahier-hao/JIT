ALTER TABLE repository_sync ADD COLUMN completed_at TEXT;
ALTER TABLE repository_sync ADD COLUMN head_commit TEXT;
ALTER TABLE repository_sync ADD COLUMN analysis_branch TEXT;
ALTER TABLE repository_commit ADD COLUMN author_name TEXT;
