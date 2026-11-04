## Context

See `proposal.md` for motivation. Current model artifacts and the SQLite catalog are local runtime data excluded from Git, while the nine standard method artifacts and 49 unique complete runs exist only on the development machine. The existing catalog already verifies complete artifacts, deduplicates by artifact run identity, enforces unique defaults and separates registration from compatibility. The design extends that lifecycle rather than introducing a second registry.

Implementation assumes the selective experiment-promotion work in PR #45 is present, because the coverage matrix consumes the same discovered run inventory and registered run identities.

## Goals / Non-Goals

**Goals:**

- Make a selected set of verified model runs transferable to another environment without committing model binaries or a live SQLite file.
- Preserve model, run, artifact, dataset, schema, dependency and hash identities through export/import.
- Show training coverage and catalog visibility using observable artifact and catalog facts.
- Keep import validation atomic per item and idempotent by original run identity.

**Non-Goals:**

- Automatically publish or promote every discovered experiment.
- Select a “best” model from metrics or copy source-environment default and enable policy.
- Train missing methods during import or invent missing artifacts.
- Add a public model upload endpoint or accept arbitrary filesystem paths from browsers.
- Store large model binaries directly in Git.

## Decisions

### D1. Use a release-style bundle, not a database copy

The portable unit is a versioned archive plus a deterministic package manifest. It contains only explicitly selected model runs, each artifact directory's required files, manifest-derived hashes, provenance, dataset and schema metadata, and declared runtime dependencies. The package manifest records its own format version and content hashes.

Export is a maintenance operation with an explicit catalog database, artifact root and output path. Import is a maintenance operation with an explicit package path. A SQLite file is not a portable interchange format because it couples environment-specific policy, projects, sessions and unrelated model records.

### D2. Reuse the existing admission and identity path

Import extracts to a fresh temporary directory, rejects absolute paths, traversal, hidden control files and links, validates every declared file hash and then invokes the same complete artifact verification and registration path used by CLI/admin promotion. Existing `artifactRunId` remains the idempotency key. A conflicting artifact key or manifest points to a located failure and cannot replace an existing run.

The package is imported per item so one invalid item does not publish a partial model. Re-importing identical items reuses the same model and run identities.

### D3. Package metadata never overwrites target policy

The package carries training and provenance facts needed for verification, not the source environment's default identity or enabled flags. In an empty environment the existing first-compatible-default rule may establish a default. Existing target policy is preserved. The UI must not describe the source default as “best” or automatically copy it.

### D4. Derive the coverage matrix from artifacts, suite indexes and the catalog

The matrix is a read projection, not another source of truth. Dataset versions and methods come from declared suite inventories. A completed run becomes “complete unregistered” or “registered” by joining artifact run identity with the catalog. Failed suite entries show their original failure. Missing entries are shown as “no artifact”. Compatibility comes from the same schema policy as user model selection.

This avoids maintaining a second matrix table that could drift from actual artifacts.

### D5. Separate connectivity, inventory and registration failures

The model page distinguishes:

- API/network unavailable;
- catalog loaded but empty;
- complete artifacts not yet registered or packaged;
- registered artifact unavailable or dependency missing;
- registered but incompatible with user repository analysis;
- registered, ready and selectable.

The frontend uses one shared model/catalog contract for counts and model identities. The public selector still returns only actual registered records, with compatibility flags derived from the same schema policy.

### D6. Deliver packages through deployment infrastructure

The repository documents how to publish the package as a release asset or controlled deployment artifact. Git stores code, package format documentation and checksums, not model binaries. Deployment applies the package through a maintenance command before or during rollout.

## Risks / Trade-offs

- [Large packages make deployment slower] -> Export only selected runs and report compressed and uncompressed sizes before publishing.
- [Archive extraction can escape the target directory] -> Normalize entries, reject traversal, absolute paths and links, and extract to a fresh temporary directory.
- [Dependencies differ between source and target] -> Validate the target can load every model and report missing packages without registering that item.
- [Coverage matrix becomes expensive on large artifact roots] -> Cache manifest-only discovery briefly, while verification and import always re-read complete artifacts.
- [Cached frontend state can hide a new failure] -> Retry surfaces network failures explicitly and never substitutes local sample models for server data.
- [Operators may import exploratory or benchmark models] -> Import preserves registration facts and service compatibility; only compatible models appear in user selection.

## Migration Plan

1. Package the existing nine verified standard models from the development environment into a release-style bundle.
2. Deploy code capable of validating and importing that bundle.
3. Back up the target SQLite catalog, initialize forward migrations, then import the bundle.
4. Verify nine same-run model identities, one default under existing policy and the user-visible selectable count.
5. If rollout fails, stop the new service and restore the pre-import catalog backup and corresponding artifact directory; model packages are immutable and can be re-imported.

No package manifest or policy should be manually edited during migration.
