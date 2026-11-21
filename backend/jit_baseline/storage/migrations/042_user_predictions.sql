CREATE TABLE user_prediction_batch (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES user_account(username),
    dataset_version TEXT NOT NULL,
    model_id TEXT NOT NULL REFERENCES model_version(id),
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX user_prediction_batch_owner
ON user_prediction_batch(owner_user_id, created_at DESC);

CREATE TABLE user_prediction_record (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES user_prediction_batch(id) ON DELETE CASCADE,
    record_id TEXT NOT NULL,
    author_time TEXT,
    label INTEGER NOT NULL CHECK(label IN (0, 1)),
    label_status TEXT NOT NULL,
    risk REAL NOT NULL CHECK(risk >= 0 AND risk <= 1),
    features_json TEXT NOT NULL,
    explanation_json TEXT
);
CREATE UNIQUE INDEX user_prediction_record_member
ON user_prediction_record(batch_id, record_id);
CREATE INDEX user_prediction_record_risk
ON user_prediction_record(batch_id, risk DESC);
