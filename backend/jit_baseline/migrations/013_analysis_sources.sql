ALTER TABLE repository_sync ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'unknown' CHECK(source_kind IN ('branch','pr','unknown'));
ALTER TABLE repository_sync ADD COLUMN source_snapshot_id TEXT;
ALTER TABLE repository_sync ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual','automatic'));
ALTER TABLE repository_sync ADD COLUMN feature_schema_version TEXT;
ALTER TABLE repository_sync ADD COLUMN distribution_rule TEXT;
UPDATE repository_sync SET source_kind='pr',source_snapshot_id=(SELECT MIN(snapshot_id) FROM pr_analysis WHERE sync_id=repository_sync.id) WHERE EXISTS(SELECT 1 FROM pr_analysis WHERE sync_id=repository_sync.id);
CREATE INDEX repository_sync_source ON repository_sync(repository_id,source_kind,status);
CREATE INDEX repository_sync_pr_source ON repository_sync(source_snapshot_id,resolved_model_id,created_at);
CREATE TABLE migration_pr_snapshots AS SELECT * FROM pr_snapshot;
CREATE TABLE migration_pr_latest AS SELECT * FROM pr_latest;
CREATE TABLE migration_pr_contents AS SELECT * FROM pr_file_content;
CREATE TABLE migration_pr_analyses AS SELECT * FROM pr_analysis;
DROP TABLE pr_latest;
DROP TABLE pr_file_content;
DROP TABLE pr_analysis;
DROP TABLE pr_snapshot;
CREATE TABLE pr_snapshot (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    number INTEGER NOT NULL,
    base_sha TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(repository_id,owner,name,number,base_sha,head_sha)
);
INSERT INTO pr_snapshot SELECT * FROM migration_pr_snapshots;
CREATE TABLE pr_latest (
    repository_id TEXT NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    number INTEGER NOT NULL,
    snapshot_id TEXT NOT NULL REFERENCES pr_snapshot(id) ON DELETE CASCADE,
    remote_state TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    PRIMARY KEY(repository_id,owner,name,number)
);
INSERT INTO pr_latest SELECT s.repository_id,l.owner,l.name,l.number,l.snapshot_id,l.remote_state,l.checked_at FROM migration_pr_latest l JOIN pr_snapshot s ON s.id=l.snapshot_id;
CREATE TABLE pr_file_content (
    snapshot_id TEXT NOT NULL REFERENCES pr_snapshot(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    side TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY(snapshot_id,path,side)
);
INSERT INTO pr_file_content SELECT * FROM migration_pr_contents;
CREATE TABLE pr_analysis (
    snapshot_id TEXT NOT NULL REFERENCES pr_snapshot(id) ON DELETE CASCADE,
    sync_id TEXT NOT NULL REFERENCES repository_sync(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(snapshot_id,sync_id)
);
INSERT INTO pr_analysis SELECT * FROM migration_pr_analyses;
CREATE TABLE pr_legacy_analysis_binding (
    snapshot_id TEXT NOT NULL,
    sync_id TEXT NOT NULL,
    PRIMARY KEY(snapshot_id,sync_id),
    FOREIGN KEY(snapshot_id,sync_id) REFERENCES pr_analysis(snapshot_id,sync_id) ON DELETE CASCADE
);
INSERT INTO pr_legacy_analysis_binding SELECT snapshot_id,sync_id FROM migration_pr_analyses;
DROP TABLE migration_pr_snapshots;
DROP TABLE migration_pr_latest;
DROP TABLE migration_pr_contents;
DROP TABLE migration_pr_analyses;
CREATE TABLE pr_analysis_intent(
    snapshot_id TEXT NOT NULL REFERENCES pr_snapshot(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    sync_id TEXT REFERENCES repository_sync(id) ON DELETE SET NULL,
    PRIMARY KEY(snapshot_id,model_id)
);
