CREATE TABLE model_package_import (
    id TEXT PRIMARY KEY,
    package_sha256 TEXT NOT NULL,
    package_version INTEGER NOT NULL,
    package_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('completed','partial','failed')),
    model_count INTEGER NOT NULL,
    registered_count INTEGER NOT NULL DEFAULT 0,
    reused_count INTEGER NOT NULL DEFAULT 0,
    already_registered_count INTEGER NOT NULL DEFAULT 0,
    conflict_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE model_package_import_item (
    import_id TEXT NOT NULL REFERENCES model_package_import(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    artifact_run_id TEXT,
    source_model_id TEXT,
    artifact_key TEXT,
    status TEXT NOT NULL CHECK(status IN (
        'registered','reused','already-registered','conflict','failed'
    )),
    model_id TEXT REFERENCES model_version(id),
    run_id TEXT REFERENCES experiment_run(id),
    code TEXT,
    message TEXT,
    PRIMARY KEY (import_id, ordinal)
);

CREATE INDEX model_package_import_created
ON model_package_import(created_at DESC, id DESC);

CREATE INDEX model_package_import_item_status
ON model_package_import_item(import_id, status);
