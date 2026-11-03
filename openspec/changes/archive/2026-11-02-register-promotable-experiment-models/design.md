## Context

See `proposal.md` for motivation. The current artifact root contains 60 complete manifests representing 49 unique run identities, but the catalog contains zero registered models. Top-level artifacts and `external/*` are discoverable; nested suite, semantic, v2 and duplicate run locations are not. Suite execution writes reports and runs but does not register models, while multi-project execution writes aggregate reports without full model artifacts.

Existing registration already provides strong integrity checks, run identity deduplication, atomic model publication, policy handling and unique default selection. The design must extend discovery and administrator workflow without weakening those checks or implying that every experiment is a service-ready model.

## Goals / Non-Goals

**Goals:**

- Discover complete experiment runs under server-controlled artifact roots, including nested suite and semantic outputs.
- Keep immutable experiment artifacts separate from mutable catalog registration state.
- Let administrators promote selected runs with per-item success, duplicate and failure results.
- Expose artifact validity, registration state and user-analysis compatibility as separate facts.
- Register the existing nine standard models as part of deployment verification.

**Non-Goals:**

- Automatically register every successful run.
- Automatically choose a default, best or recommended model from metrics.
- Treat aggregate reports such as `multi-project-report.json` as model artifacts.
- Add semantic encoding to the live repository-analysis path.
- Rewrite or copy experiment artifacts during registration.

## Decisions

### D1. Separate experiment discovery from service candidate addressing

The catalog will maintain two candidate classes:

- `service`: existing top-level and `external/*` service artifact locations.
- `experiment`: complete runs discovered under an allowlisted experiment root such as `suites`, `semantic` and other server-owned nested run roots.

Clients continue to submit opaque candidate IDs, never filesystem paths. The server resolves an experiment ID from its discovered inventory and rechecks the manifest hash before registration. This preserves the existing no-arbitrary-path boundary while allowing nested runs.

Alternative rejected: recursively accept arbitrary artifact-relative paths from admin requests. That would widen the trust boundary and make path traversal and stale-location handling harder to audit.

### D2. Derive registration state; do not mutate experiment artifacts

Experiment manifests, summaries and suite files remain immutable. Registration state is derived by joining discovered `artifactRunId` values with the catalog's `experiment_run` records. Repeated or concurrent promotion uses the existing run identity uniqueness, so multiple artifact locations for one run appear as one model lifecycle.

Duplicate and reproduction locations remain visible as locations of the same run, not additional models. No database migration is required for this distinction because the catalog already stores artifact run identity and run locations.

### D3. Model validity, registration and service compatibility are independent

The experiment API will return separate facts:

- `artifactState`: `complete`, `invalid` or `failed`.
- `registrationState`: `unregistered`, `registered` or `conflict`.
- `serviceCompatibility`: `repository-analysis`, `offline-only`, `input-unsupported` or `schema-incompatible`.
- `enabled` and `isDefault` only for registered models.

An offline benchmark may be retained in the experiment inventory or registered for administrator comparison, but it is not selectable in user repository analysis. A valid semantic-only model that requires live embeddings is `input-unsupported`. Aggregate reports never receive an artifact state or registration action.

Alternative rejected: one boolean `promotable`. It would conflate “has a complete artifact” with “can score a repository”, causing benchmark and semantic runs to look service-ready.

### D4. Suites publish a stable run inventory

Future suite runs will record each successful method's full artifact-relative key, manifest hash, run ID, metrics summary and failure entry in `suite.json`. Discovery also indexes existing runs lacking this newer inventory so historical experiment work is not lost. A suite index is evidence of a run, not proof of registration.

The suite status remains based on training outcomes only. Registration status is added when the management API joins the artifact inventory with the catalog; registration never rewrites `suite.json`.

### D5. Promotion is explicit and per item

The management API will list and inspect experiment runs and accept promotion requests containing explicit candidate IDs and expected manifest hashes. A batch request will process each item independently and return its own result:

- registered model identity;
- reused existing model;
- already registered;
- invalid artifact;
- incompatible service use;
- conflict or storage failure.

Successful items are committed atomically as existing model registrations; one failed item does not roll back unrelated successful items. Promotion never enables a non-default model unless explicitly requested through the existing policy operation and never changes the current default automatically except through the existing first-compatible-model initialization rule.

Alternative rejected: automatic registration after `run-suite`. It would turn offline benchmark suites and exploratory runs into user-visible model choices.

### D6. Admin workflow separates inventory from service policy

The management workspace will add an experiment-run view with filters for unregistered, registered, invalid and compatibility. The row shows dataset, method, schema, metric set, metrics, run identity and artifact locations. Promotion is an explicit confirmation flow; partial batch failures are displayed without discarding successes.

The model page remains the place for enabled/default policy. The experiment page may link to model detail after registration but will not present metric ranking or automatic recommendations.

### D7. Catalog readiness checks are actionable

The admin overview will distinguish:

- no complete artifacts;
- complete but unregistered runs;
- registered models without a default;
- default model unavailable;
- registered models not selectable for user repository analysis.

The readiness response points to the experiment inventory or model policy action that resolves each condition. Candidate counts are never reported as usable model counts.

### D8. Existing standard models are registered explicitly

Deployment verification will register the current nine standard model artifacts:

`baseline`, `decision-tree-v1`, `random-forest-v1`, `gaussian-naive-bayes-v1`, `gradient-boosting-v1`, `mlp-v1`, `tabular-resnet-v1`, `ft-transformer-v1` and `wide-deep-v1`.

Registration reads existing artifacts; it does not copy binaries or retrain. The first compatible model establishes the initial default under the existing rule. A future deployment can use the same explicit promotion/list flow instead of relying on an undocumented manual step.

## Risks / Trade-offs

- [Recursive scanning can include many duplicate and exploratory runs] -> Discover by manifest and group by artifact run identity; expose duplicate locations under one run.
- [Nested artifact registration broadens path handling] -> Accept only opaque IDs from server-built inventory, resolve under declared roots, reject links and recheck manifest hashes before publication.
- [Registration state can become stale after manual file changes] -> Revalidate artifact integrity on every model load and experiment detail read; mark unavailable rather than substituting another location.
- [Administrators may treat metrics as automatic advice] -> Keep explicit selection, show provenance and limitations, and prohibit automatic sorting, defaulting or “best model” conclusions.
- [Offline benchmark models may be mistaken for usable repository models] -> Return separate `serviceCompatibility`; exclude incompatible schemas from user model choices.
- [Scanning and verification add admin latency] -> Cache manifest-only discovery briefly, but always reload and verify full model files during promotion and model use.

## Migration Plan

1. Deploy code and initialize existing catalog version.
2. Discover top-level and nested artifacts without modifying them.
3. Register the nine existing standard models through the explicit promotion path.
4. Verify nine ready service models, exactly one default and user model selection.
5. Verify JIT-Fine benchmark and report-only results are not presented as user-selectable models.

Rollback hides the experiment inventory and promotion UI. Existing registered models, run locations, artifacts and user results remain intact; no artifact rollback is required.
