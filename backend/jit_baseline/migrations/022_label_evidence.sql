ALTER TABLE dataset_record ADD COLUMN label_origin TEXT;
ALTER TABLE dataset_record ADD COLUMN label_rule_version TEXT;
ALTER TABLE dataset_record ADD COLUMN label_binarization_rule TEXT;
ALTER TABLE dataset_record ADD COLUMN observed_through INTEGER;
ALTER TABLE dataset_record ADD COLUMN maturity_days INTEGER;
CREATE TABLE commit_label_evidence(
    dataset_version TEXT NOT NULL,
    commit_id TEXT NOT NULL,
    fix_commit_id TEXT NOT NULL,
    path TEXT NOT NULL,
    fix_time TEXT NOT NULL,
    rule_version TEXT NOT NULL,
    PRIMARY KEY(dataset_version, commit_id, fix_commit_id, path),
    FOREIGN KEY(dataset_version, commit_id) REFERENCES commit_record(dataset_version, commit_id)
);
CREATE INDEX commit_label_evidence_lookup ON commit_label_evidence(dataset_version, commit_id);
