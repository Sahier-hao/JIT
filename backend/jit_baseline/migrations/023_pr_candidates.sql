CREATE TABLE pr_candidate_run(
    snapshot_id TEXT NOT NULL REFERENCES pr_snapshot(id) ON DELETE CASCADE,
    analyzer_version TEXT NOT NULL,
    status TEXT NOT NULL,
    coverage_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(snapshot_id, analyzer_version)
);
CREATE TABLE pr_candidate(
    snapshot_id TEXT NOT NULL REFERENCES pr_snapshot(id) ON DELETE CASCADE,
    analyzer_version TEXT NOT NULL,
    side TEXT NOT NULL CHECK(side IN ('base','head')),
    path TEXT NOT NULL,
    line INTEGER NOT NULL CHECK(line > 0),
    rule_id TEXT NOT NULL,
    rule_version TEXT NOT NULL,
    message TEXT NOT NULL,
    evidence TEXT NOT NULL,
    PRIMARY KEY(snapshot_id, analyzer_version, side, path, line, rule_id, rule_version)
);
CREATE INDEX pr_candidate_lookup ON pr_candidate(snapshot_id, analyzer_version, side, path);
