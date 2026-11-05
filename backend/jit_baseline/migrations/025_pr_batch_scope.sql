ALTER TABLE pr_batch ADD COLUMN scope_kind TEXT NOT NULL DEFAULT 'all';
ALTER TABLE pr_batch ADD COLUMN scope_limit INTEGER;
ALTER TABLE pr_batch ADD COLUMN scope_page INTEGER;
ALTER TABLE pr_batch ADD COLUMN cancel_requested_at TEXT;
ALTER TABLE pr_batch ADD COLUMN cancelled_at TEXT;
