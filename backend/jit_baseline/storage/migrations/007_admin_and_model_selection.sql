ALTER TABLE repository_sync ADD COLUMN requested_model_id TEXT;
CREATE TABLE admin_account(username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at REAL NOT NULL);
CREATE TABLE admin_session(token_hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES admin_account(username), expires_at REAL NOT NULL);
