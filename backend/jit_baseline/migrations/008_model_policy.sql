CREATE TABLE model_policy (
    model_id TEXT PRIMARY KEY REFERENCES model_version(id),
    enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
);
CREATE TABLE model_default (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    model_id TEXT REFERENCES model_version(id)
);
INSERT INTO model_default(singleton,model_id)
SELECT 1, (SELECT id FROM model_version WHERE state='ready'
    AND json_extract(payload_json,'$.featureSchemaVersion') IN ('openstack-six-v1','kamei14-git-v1')
    ORDER BY id LIMIT 1);
ALTER TABLE repository_sync ADD COLUMN resolved_model_id TEXT;
