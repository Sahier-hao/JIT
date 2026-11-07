## Context

See `proposal.md`. Registered model details currently load the verified artifact and expose test metrics, split counts, training time, source and limitations. Training writes only one metrics object for test evaluation. Existing nine artifacts have complete split membership but no train/validation predictions or metrics.

## Goals / Non-Goals

**Goals:**

- Make one read-only model card the canonical presentation for users and administrators.
- Persist all three partition metrics for future runs.
- Provide independently verifiable diagnostics for existing models without mutating their artifacts or identities.

**Non-Goals:**

- No probability calibration or automatic model selection.
- No retroactive rewrite of model manifests, hashes or current defaults.
- No claim that training metrics measure generalization.

## Decisions

### D1. Add partition diagnostics without changing metric definitions

New summaries record `metricsByPartition` with the same registered metric set and threshold for train, validation and test. Evaluation uses the original unique members of each split; sampled duplicates used only for training are not counted again. The class-policy summary is shown beside metrics when present.

Training metrics are labelled “拟合诊断”, validation metrics “模型选择背景”, and test metrics “冻结泛化评价”. Missing/undefined metrics retain the standard `{value, reason}` shape.

### D2. Store training performance with data scale

The card combines training seconds, partition/total record counts, feature width and the recorded training environment. It shows throughput and avoids comparing runs solely by elapsed time when data size differs.

### D3. Separate frozen diagnostics for legacy models

Generate one versioned diagnostics report per existing `artifactRunId` from the unchanged model artifact, source dataset and split membership. The report records source hashes, metric set, threshold, split digest and generation command. It is loaded read-only by run identity.

An alternative of backfilling `summary.json` was rejected because it would change artifact hashes and falsely imply the original run measured those values.

### D4. Safe public projection, complete admin projection

Add a public model-card endpoint that validates the real model and returns only safe evaluation facts. The protected admin endpoint reuses the same internal card builder and may include lineage, artifact location and maintenance fields.

This keeps the project model selector informed without exposing registry internals or allowing mutation.

### D5. Reuse the existing benefit report

The model card embeds the existing benefit conclusion and named strategies. It shows adverse results and sample limits rather than replacing them with a generic “performance” statement.

## Risks / Trade-offs

- **Training metrics invite over-interpretation** → fixed labels and separate sections; test remains the primary generalization claim.
- **Old reports may not exist for all models** → show “未记录”; never synthesize values from another run.
- **Public report disclosure** → allowlist fields and verify model availability before returning; omit paths, SQLite and admin audit data.
- **Supplementary drift** → bind reports to artifact run identity and source hashes; reject mismatches.

## Migration Plan

1. Deploy readers that tolerate old summaries without `metricsByPartition`.
2. Generate and freeze diagnostics for the nine existing models.
3. Enable new training writes and model-card projections.
4. Roll back presentation readers without deleting diagnostics; existing artifacts remain unchanged.
