CREATE TABLE user_prediction_batch_next (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES user_account(username),
    dataset_version TEXT,
    mode TEXT NOT NULL CHECK(mode IN ('single', 'batch')),
    source_kind TEXT NOT NULL,
    source_ref TEXT,
    split_preset TEXT,
    partition TEXT CHECK(partition IS NULL OR partition IN ('train', 'validation', 'test')),
    member_sha256 TEXT,
    model_id TEXT NOT NULL REFERENCES model_version(id),
    model_name TEXT,
    model_method TEXT,
    run_id TEXT,
    feature_schema_version TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
INSERT INTO user_prediction_batch_next (
    id, owner_user_id, dataset_version, mode, source_kind, source_ref,
    split_preset, partition, member_sha256, model_id, model_name, model_method,
    run_id, feature_schema_version, payload_json, created_at
)
SELECT id, owner_user_id, dataset_version, 'batch', 'dataset', NULL,
       NULL, NULL, NULL, model_id,
       json_extract(payload_json, '$.model.name'),
       json_extract(payload_json, '$.model.method'),
       json_extract(payload_json, '$.model.runId'),
       COALESCE(json_extract(payload_json, '$.model.featureSchemaVersion'), 'unknown'),
       payload_json, created_at
FROM user_prediction_batch;

CREATE TABLE user_prediction_record_next (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES user_prediction_batch_next(id) ON DELETE CASCADE,
    record_id TEXT NOT NULL,
    author_time TEXT,
    label INTEGER CHECK(label IS NULL OR label IN (0, 1)),
    label_status TEXT NOT NULL,
    label_availability TEXT NOT NULL CHECK(label_availability IN ('available', 'unavailable')),
    source_kind TEXT NOT NULL,
    source_ref TEXT,
    risk REAL NOT NULL CHECK(risk >= 0 AND risk <= 1),
    features_json TEXT NOT NULL,
    explanation_json TEXT
);
INSERT INTO user_prediction_record_next (
    id, batch_id, record_id, author_time, label, label_status, label_availability,
    source_kind, source_ref, risk, features_json, explanation_json
)
SELECT id, batch_id, record_id, author_time,
       CASE WHEN label_status IN ('positive', 'unobserved') THEN label ELSE NULL END,
       label_status,
       CASE WHEN label_status IN ('positive', 'unobserved') THEN 'available' ELSE 'unavailable' END,
       'dataset', NULL, risk, features_json, explanation_json
FROM user_prediction_record;

DROP TABLE user_prediction_record;
DROP TABLE user_prediction_batch;
ALTER TABLE user_prediction_batch_next RENAME TO user_prediction_batch;
ALTER TABLE user_prediction_record_next RENAME TO user_prediction_record;

CREATE INDEX user_prediction_batch_owner
ON user_prediction_batch(owner_user_id, created_at DESC);
CREATE INDEX user_prediction_batch_model
ON user_prediction_batch(model_id, created_at DESC);
CREATE UNIQUE INDEX user_prediction_record_member
ON user_prediction_record(batch_id, record_id);
CREATE INDEX user_prediction_record_risk
ON user_prediction_record(batch_id, risk DESC);
