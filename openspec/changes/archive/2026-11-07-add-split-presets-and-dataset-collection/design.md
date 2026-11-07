## Context

See `proposal.md`. `temporal_split` currently fixes boundaries at 70% and 85% of distinct timestamp groups. Administrator training and repository sync share the training executor. Project analysis can score recent commits outside a repository-trained model's training cutoff, while generic external models have no relationship to the current project's commit split.

## Goals / Non-Goals

**Goals:**

- Make split selection explicit, previewable and part of run lineage.
- Add collection-only dataset creation without producing model scores.
- Render project partition coverage only when identity and membership can be proven.

**Non-Goals:**

- No arbitrary user-defined boundaries, random splits or overlapping partitions.
- No auto-training after a dataset build.
- No partition labels for external generic models.

## Decisions

### D1. Registry of three time presets

Register exactly `temporal-70-15-15`, `temporal-80-10-10` and `temporal-60-20-20`. Ratios apply to distinct sorted timestamp-group counts, preserving the current no-leakage rule that one timestamp cannot cross a boundary. Omitted input resolves to `temporal-70-15-15`.

Unknown or custom rules are rejected rather than approximated.

### D2. Preview before task creation

Preview returns policy identity, ratios, timezone, boundaries, partition dates/counts/positives and reasons for invalid train/test membership. Preview is read-only and creates no run directory, model or task.

Training tasks, repository sync training and CLI runs persist the selected preset. The split profile and member digest join the run identity, so a different preset cannot reuse an existing run accidentally.

### D3. Test members are immutable

Validation may inform policy choices, but test members and labels are never used for fitting, fusion or threshold selection. The completed run exposes its frozen membership digest; changing split requires a new run.

### D4. Collection-only jobs have separate ownership

Create a dataset-build task with its own lifecycle rather than adding a fake strategy to `repository_sync`. It reuses source validation, collection, SZZ labeling, registration and idempotent version naming, but finishes after registration and never touches project current-result or model selection fields.

This avoids presenting a data-only job as an analysis and keeps retry/cancel semantics clear.

### D5. Provenance-gated trend annotation

The trend service reads split metadata only when the selected model run was trained on the same project dataset and the commit belongs to the recorded membership. Recent commits after the training cutoff are `recent-unseen`; unresolved identities are `unknown`. Generic/external models are explicitly marked as having no project split.

Partition bands and labels are descriptive coverage, not additional risk estimates.

## Risks / Trade-offs

- **Run identity changes for newly reproduced runs** → expected because split policy is now recorded; old artifacts remain valid under legacy semantics.
- **Small validation sets** → preview warnings and per-metric reasons; do not force balanced classes.
- **Duplicate collection pipelines** → share collection/registration primitives but keep task identities separate.
- **Misleading chart labels** → provenance-gated membership and explicit external/unknown states.
- **Resource cost** → collection-only jobs still use the single worker and existing limits; no model training is scheduled.

## Migration Plan

1. Deploy preset readers with missing input mapped to the legacy 70/15/15 policy.
2. Route new training through the policy-aware split function.
3. Add collection-only tasks and UI.
4. Enable trend annotations only for newly complete split provenance; old runs remain unknown.
5. Roll back UI and task creation while preserving registered datasets and completed artifacts.
