CREATE TABLE user_account (
    username TEXT PRIMARY KEY,
    salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE user_session (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES user_account(username),
    expires_at REAL NOT NULL
);
CREATE INDEX user_session_expiry ON user_session(expires_at);
CREATE TABLE dataset_owner (
    dataset_version TEXT NOT NULL,
    username TEXT NOT NULL REFERENCES user_account(username),
    created_at TEXT NOT NULL,
    PRIMARY KEY (dataset_version, username)
);
CREATE INDEX dataset_owner_user ON dataset_owner(username, created_at);
ALTER TABLE training_experiment ADD COLUMN owner_user_id TEXT;
ALTER TABLE training_task ADD COLUMN owner_user_id TEXT;
ALTER TABLE dataset_build_task ADD COLUMN owner_user_id TEXT;
ALTER TABLE model_version ADD COLUMN owner_user_id TEXT;
CREATE INDEX training_experiment_owner ON training_experiment(owner_user_id, created_at);
CREATE INDEX training_task_owner ON training_task(owner_user_id, created_at);
CREATE INDEX dataset_build_task_owner ON dataset_build_task(owner_user_id);
CREATE INDEX model_version_owner ON model_version(owner_user_id);
