## Context

See `proposal.md` for motivation. The existing release package contains nine validated models and 81 files, with a compressed size of 5.93 MiB and SHA-256 `3c15b7d9453291ba5c106e09b93403e234c0c1c67c0413b2d3654820f3377d76`. The working repository pack is approximately 24.56 MiB, so this package fits ordinary Git storage without LFS. The existing import path already validates package structure, per-file hashes, embedded manifests, run identity, dependencies and actual model loading.

## Goals / Non-Goals

**Goals:**

- Make a fresh checkout contain the verified nine-model release bytes and recover them during the existing standard catalog initialization.
- Keep raw run directories, SQLite and runtime evidence outside Git.
- Preserve target defaults, enablement and history across repeated initialization.
- Make internal-package import status, failures and user-visible model counts observable.

**Non-Goals:**

- Add browser model uploads or public model-import APIs.
- Automatically retrain models or choose a “best” method from metrics.
- Replace the existing package format or import validation.
- Require Git LFS, a package registry or another network service.

## Decisions

### D1. Commit one compressed release bundle

The repository will contain a versioned package and SHA-256 sidecar in a non-ignored controlled directory, for example `backend/model-packages/jit-nine-models-v1.zip`. It will not contain the nine unpacked run directories or `catalog.sqlite3`.

Direct binary package storage is chosen over Git LFS because the current bundle is below 6 MiB and must work with a normal `git clone`. LFS remains an option if future packages make clone cost unacceptable; that would require a separate packaging/storage change. The package file must be treated as immutable: changed models receive a new version and SHA rather than replacing an applied package in place.

### D2. Bootstrap from `catalog-init`, not an API request

`catalog-init` already is the explicit maintenance boundary for creating or migrating the catalog. After migration succeeds, it will use the same database and artifact root as the application, verify the built-in sidecar, and call the existing safe importer.

Initialization will skip a package only when its exact SHA has a successful import and the expected package run identities are ready. Missing, invalid, conflicted or partially applied packages return structured package results. A maintenance opt-out can suppress built-in import for isolated tooling and tests, but the documented normal installation leaves it enabled.

This avoids automatic catalog mutation on every HTTP startup while ensuring users who follow the documented setup command do not encounter an empty model catalog.

### D3. Reuse identity, compatibility and policy boundaries

The package importer remains the only writer. It deduplicates by original run identity, preserves source model IDs for lineage, and only creates an initial default under the existing first-compatible rule. It never copies source default/enabled flags or enables an already disabled target model.

Package metadata is not trusted for service compatibility. Every artifact is revalidated against its embedded manifest and loaded locally. The importer's per-item results are persisted in the existing package-import tables, so no new migration is required.

### D4. Diagnostic UI projects the import result

The admin model page continues to project catalog readiness and the latest validated package import. The built-in package name and SHA identify the source of the nine models; item failures retain their existing per-item reason display. User-facing model selection remains the existing compatible, enabled, ready catalog projection.

### D5. Verify a real fresh-checkout path

Tests will create disposable databases and artifact roots, run standard initialization against the committed package, and assert that nine original run identities become ready and selectable. Separate tests cover repeated initialization, an existing disabled/default policy, a later package with additional models, checksum corruption, dependency failure and partial conflict.

## Risks / Trade-offs

- **Repository growth** -> Store one compressed immutable bundle per release; set a reviewed size limit and move to a separate distribution mechanism if future bundles materially change clone cost.
- **Pickle/model loading risk** -> Import only the maintainer-approved built-in package; retain package traversal, hash and manifest checks, and never accept arbitrary browser uploads.
- **Automatic package visibility changes first-run behavior** -> Run only from explicit `catalog-init`, preserve existing policy, and provide a maintenance opt-out for isolated tooling.
- **Fresh clone costs verification time** -> Skip only when the exact package and expected run identities are already successfully available; first initialization may load the nine models once.
- **Model dependencies differ by platform** -> Report per-item dependency failures, keep existing models intact, and document installing compatible runtime dependencies before retrying.

## Migration Plan

1. Add the already validated `jit-nine-models-v1.zip` and SHA-256 to the controlled package directory and include them in review.
2. Update `catalog-init` to bootstrap the built-in package after catalog migration and before serving.
3. Back up existing deployment databases as before, install the new code and package, then run `catalog-init`.
4. Existing catalogs reuse matching run identities and retain policies; empty catalogs receive nine ready models and the existing initial-default rule.
5. Roll back by stopping the service, restoring the pre-initialization database and artifact backup, and reverting to the prior code/package. Git history retains published bundles; deployment does not depend on deleting local model data.

## Open Questions

None.
