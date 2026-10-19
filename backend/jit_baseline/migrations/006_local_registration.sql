CREATE TABLE registration_event_next(id TEXT PRIMARY KEY, request_id TEXT NOT NULL, candidate_id TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('http-local','http-admin','local-cli')), result TEXT NOT NULL CHECK(result IN ('created','reused','failed')), error_code TEXT, created_at TEXT NOT NULL, run_id TEXT REFERENCES experiment_run(id), model_id TEXT REFERENCES model_version(id));
INSERT INTO registration_event_next SELECT * FROM registration_event;
DROP TABLE registration_event;
ALTER TABLE registration_event_next RENAME TO registration_event;
CREATE INDEX registration_request ON registration_event(request_id);
