CREATE TABLE repository_explanation_by_method(
    sync_id TEXT NOT NULL,
    commit_id TEXT NOT NULL,
    method TEXT NOT NULL CHECK(length(method) > 0),
    payload_json TEXT NOT NULL,
    PRIMARY KEY(sync_id,commit_id,method),
    FOREIGN KEY(sync_id,commit_id) REFERENCES repository_commit(sync_id,commit_id) ON DELETE CASCADE
);

INSERT INTO repository_explanation_by_method(sync_id,commit_id,method,payload_json)
SELECT sync_id,
       commit_id,
       CASE
           WHEN json_valid(payload_json)
           THEN COALESCE(NULLIF(json_extract(payload_json,'$.explanationMethod'),''),
                         'occlusion-mean-v1')
           ELSE 'occlusion-mean-v1'
       END,
       payload_json
FROM repository_explanation;

DROP TABLE repository_explanation;
ALTER TABLE repository_explanation_by_method RENAME TO repository_explanation;
