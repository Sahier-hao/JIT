## Context

See [proposal](proposal.md). The current training pipeline can collect fourteen-field v2 data and train per-project models, while the distributable nine-model package contains only six-field OpenStack models. Existing multi-project evidence uses real repositories but only classic methods and does not produce a complete service model package. The current collector also assigns `label=0` to immature records while dropping the maturity status from CSV.

## Goals / Non-Goals

**Goals:**

- Produce a reproducible current-schema model baseline from real public repositories.
- Keep model training identity separate from a later release qualification decision.
- Make label maturity explicit and prevent immature negatives from entering formal training and evaluation silently.
- Package validated current-schema models without replacing existing environment policy.

**Non-Goals:**

- No production semantic encoder pipeline, arbitrary CSV upload, automatic best-method selection or automatic default promotion.
- No rewrite of historical datasets, runs, models, metrics or existing defaults.
- No consolidation of the separate delivery-test evidence work into this change.

## Decisions

### D1. Four-project v2 baseline with pooled service candidates

Use the four previously selected public repositories as the fixed source set: `apache/commons-lang`, `vuejs/core`, `redis/redis` and `scikit-learn/scikit-learn`, with their existing immutable revisions and 2022–2024 collection windows. Recollect them as `kamei14-git-v2` because v1 evidence does not prove the current first-parent history rule.

Train nine pooled candidates on the union of the four training partitions and evaluate each candidate separately on every target project's frozen test partition. A release decision requires all four project-level class/AP/AUC checks and the cross-project effort check. Per-target `global+local` results remain research evidence unless a later design explicitly packages per-project models.

Alternative rejected: package the existing JIT-Fine runs. Their schema is benchmark-only and their license/model scope is not the same as service repository analysis.

### D2. Persist maturity as data, not reconstructed UI metadata

New repository CSV files add `label_status`, `observed_through_epoch` and `maturity_days`; the manifest records the same rule and status counts. A positive label is usable immediately. `unobserved` becomes a negative only after the maturity period. `immature` is excluded before split for formal runs.

Training records a maturity policy ID and excluded counts. A sensitivity policy includes immature records as negative for comparison but cannot produce a release-qualified model. Legacy datasets with no maturity columns stay readable with `maturityPolicy=legacy-unrecorded`; new code does not infer maturity or backfill files.

Alternative rejected: infer maturity only from timestamps at training time. The observation endpoint and rule version would be lost, making later evaluation and model cards unable to prove which records were eligible.

### D3. Release qualification is derived and re-evaluable

Introduce a release report identified by `releasePolicy=jit-release-v1`, dataset/hash, split digest, model hash, target projects and baseline definitions. It records:

- training completion and artifact integrity;
- registration and service compatibility;
- per-project test counts, AP, ROC-AUC, Recall@20%LOC, Popt, IFA, accuracy and no-information accuracy;
- time, random and density baseline comparisons;
- pass/fail per gate and an overall qualification decision.

The report is derived from immutable run artifacts. Re-running qualification MUST not retrain or change the model identity; changing a model, dataset, split or policy invalidates prior qualification.

Alternative rejected: store a single mutable `is_good_model` flag on the model row. It cannot explain which policy or project failed and could silently survive changed evidence.

### D4. Fixed release policy

`jit-release-v1` uses `metric-set-v2`, the 70/15/15 temporal split, a 0.5 classification threshold and the existing whole-commit 20% LOC budget. A candidate passes only when:

1. every target project has at least 20 test positives;
2. every target project has AP above its no-information baseline;
3. every target project has ROC-AUC at least `0.65`;
4. macro Recall@20%LOC or macro Popt is no worse than both the fixed-seed random mean and time ordering;
5. every required value is defined.

Raw and majority-class accuracy are reported as diagnostics only. Thresholds are frozen before reading target test labels. If no candidate passes, the release report stops with a quality failure; thresholds are not relaxed after seeing the target test.

Alternative rejected: require raw accuracy ≥80%. On JIT-Fine the all-negative baseline is 95.94%, so this gate cannot distinguish a useful model from a constant classifier.

### D5. One current-schema release package and manual default approval

Publish a versioned current-schema model package containing complete manifests, model files, frozen test inputs, reference predictions, split metadata, dependency declarations, release reports and checksums. The package records an approved-default candidate only after human review. Empty catalogs may initialize from that approved candidate; existing catalogs retain their default and enabled/disabled policy.

The existing six-field package remains available for compatibility. Package import continues to use the existing path, hash, dependency and run-identity validation; the new package cannot bypass it.

Alternative rejected: make every freshly trained experiment importable by default. That would expose unqualified and potentially incompatible models to users.

### D6. Release status is orthogonal to existing catalog state

Expose separate fields for training state, artifact state, registration state, release qualification, service compatibility and default candidacy. A model may be `registered-ready` but `release-unqualified`; a release-qualified run may remain non-selectable if its schema or dependencies are unavailable.

The admin UI shows the release report beside training lineage and the standard model card; the ordinary user selector only consumes the existing service-compatible set and never exposes maintenance controls.

## Risks / Trade-offs

- A strict gate may reject every candidate → Keep the failure visible and improve data/features before rerunning the frozen test; do not lower thresholds post hoc.
- Recollecting v2 data can change sample counts and existing research interpretation → Keep v1 datasets and report both collection rules; publish new immutable versions.
- Maturity filtering shortens the recent window → Require sufficient positive counts and report excluded rows, rather than force-including uncertain negatives.
- Nine deep models increase artifact size and training time → Store one compressed versioned package and run a resource preflight; do not commit unpacked artifacts.
- Pooled models may underperform on one project → Treat the worst-project gate as a release requirement and keep per-project metrics visible.
- Existing default behavior may differ by environment → Package import never overwrites saved defaults; the approved candidate is applied only on an empty catalog.

## Migration Plan

1. Read legacy datasets without new maturity columns and mark maturity as unrecorded.
2. Write maturity fields for new collection versions; apply maturity filtering before temporal split in new training runs.
3. Add release-report persistence and read projections while leaving existing model rows untouched.
4. Recollect and train the current-schema baseline, then generate and qualify release candidates.
5. Publish the current-schema package and enable empty-catalog initialization; preserve existing defaults on upgrade.
6. On rollback, keep new datasets and reports readable, stop exposing unqualified models as release-qualified, and retain the existing six-field package and old model selections.
