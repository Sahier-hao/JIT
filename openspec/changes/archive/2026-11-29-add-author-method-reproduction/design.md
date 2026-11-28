# Design

## Context

See `proposal.md` for motivation. The repository already has Kamei table ingestion and training, full Git diff candidate export, SZZ evidence, CodeBERT dependencies, and JIT-Fine model-package adapters. None of those establishes the five authors' native training or prediction paths.

Fixed source facts:

- Kamei et al., TSE 2013, DOI `10.1109/TSE.2012.70`; existing six-project Kamei 2013 snapshots in `backend/data/datasets/`; training uses the repository's disposable artifact/database roots and no existing catalog mutation.
- DeepJIT: `https://github.com/soarsmu/DeepJIT.git` at `bb3dd8a10dcfc44383c15734bb18e6a1ddc6ba45`; Zenodo [3965246](https://zenodo.org/records/3965246) data/models, CC BY 4.0.
- JITLine: `https://github.com/awsm-research/JITLine-replication-package.git` at `1e06d33b44c19565301d31fce9984afbb8b3127c`; arXiv 2103.07068; Zenodo records [4433499](https://zenodo.org/records/4433499) and [4596503](https://zenodo.org/records/4596503), CC BY 4.0. The released records do not contain the training/test pickles named by the README.
- JIT-Fine: `https://github.com/jacknichao/JIT-Fine.git` at `584799fdec6095ab75a45fd2a5f8db5b12163aa5`; `data.zip` SHA-256 `9e5ca1a393b70ee7e87c410b162005958775f3f3732f9f83da9dd24a7dfe2b47`; repository reports no declared license.
- JIT-Smart: `https://github.com/JIT-A/JIT-Smart.git` at `e87569c56c8faa4ad236969d4a99074a76da3887`; its `data/data.zip` has the same SHA-256 as JIT-Fine's data; repository declares no license.

The local environment has Python 3.14, CPU PyTorch 2.14.1, Transformers 5.21.1 and no CUDA. Original environments used Python 3.6-3.8 and older PyTorch/Transformers. Compatibility changes must be explicit and must not be described as author-environment reproduction.

## Goals / Non-Goals

**Goals:**

- Make all author materials discoverable from one checked-in catalog with revisions, hashes, licenses, expected paths and acquisition commands.
- Provide one CLI and output contract for five methods while retaining method-specific preprocessing, models and line attribution.
- Run real fixed data through every independently executable path; use author weights for DeepJIT, and real small-sample optimization for methods without released checkpoints.
- Make Kamei's original 12-field experiment, the 14-field control and the independent v3 time-decay schema distinguishable in data, runs and reports.
- Preserve raw predictions, line/token mappings, logs, metrics, environment and blockers for continuation.

**Non-Goals:**

- Do not register these reproduction runs as service defaults, release-qualified models or product line-level models.
- Do not claim original full-protocol success when only a smoke sample or pretrained-model evaluation ran.
- Do not redistribute author data or weights without verified permission.
- Do not implement the seven-language migration matrix or product UI in this first change; those build on this reproduction contract in later serial changes.

## Decisions

### 1. Checked-in catalog, ignored materials

Add an audited JSON catalog under `backend/jit_baseline/author_repro/catalog.json`. It records each repository, DOI/Zenodo/file identity, SHA-256 or MD5, license state, expected cache path, acquisition URL and run command. Large source, data and model files remain under ignored `backend/.cache/author-repro/` and are never committed.

Data preparation verifies bytes before extraction and records the verified file hashes in every run. A missing file is an explicit `MATERIAL_MISSING` error with its acquisition command; no method falls back to another dataset or model.

### 2. Common run envelope, method-local algorithms

Every invocation writes:

`backend/artifacts/author-repro/<method>/<runId>/`

with `run.json`, `command.txt`, `run.log`, `metrics.json`, `predictions.jsonl` and method-specific artifacts such as `model.pt`, `line-predictions.jsonl` or `token-line-map.jsonl`.

The run identity hashes the method version, author configuration, material hashes, split, seed, environment and command. Shared code owns input validation, output identity, commit metrics and run status. It does not own or flatten method-specific padding, tokenization, feature normalization, losses or attention aggregation.

### 3. Reproduction tiers are data, not prose

Use these stable values:

- `interface-only`: fixtures or mocked model outputs; never reported as a real reproduction.
- `real-smoke`: fixed real input, real preprocessing, real model forward/backward and real predictions on a declared sample.
- `author-protocol`: the method's declared data/split/model protocol was run to completion and evaluated.
- `local-migration`: changed language, schema, split, encoder or labels; never counted as author reproduction.

Each run records `implementationFidelity` (`author-code`, compatibility port, or paper-described), `dataFidelity` and the exact deviations. DeepJIT learning-rate handling is a concrete example: author code passes `l2_reg_lambda` to Adam while `learning_rate` is otherwise unused; reports must disclose which value was used.

### 4. Kamei protocol and v3 schema

The Kamei author comparison uses the 12 features retained by the authors after removing `nd` and `rexp`, the published project data, project-wise 10-fold cross-validation, majority-under-sampling inside each training fold and an unpenalized logistic model. The 14-field control uses the same folds and model but includes all published fields. Published table values are consumed as released and are not ratio-normalized a second time.

The paper's recent experience is a decaying sum. For v3:

`rexp_current = sum(1 / (1 + age_days / 365.25))`

over same-author commits earlier on the current first-parent history. Current/future commits, merge commits and parallel branches do not contribute. Negative ages are excluded and counted. `kamei14-git-v2` remains the default old 90-day count; v3 is opt-in and uses independent version naming. Existing v2 metadata, CSV, models, tasks and analyses are immutable.

### 5. DeepJIT source data and training

Implement the author CNN structure and exact message/diff padding: 256 message tokens, at most 10 lines, 512 tokens per line, word lowercasing and `<NULL>` fallback. The primary proof uses the released OpenStack test data and released `openstack_model.pt`, records recomputed AUC and raw probabilities. Training accepts the released train/dictionary files and supports both the author-code optimizer behavior and the paper learning-rate-intent variant as separately named configurations. Differences in tokenization, truncation and missing-file handling are written to a compatibility record.

### 6. JITLine commit and line paths

Use the author preprocessing, `CountVectorizer(min_df=3, ngram_range=(1,1))`, the released change metrics, SMOTE and 300-tree random forest. Because the original train/test pickles are absent from the released records, JITLine gets two named data variants:

- `jit-fine-jitline-baseline-v1`: the JIT-Fine authors' fixed JIT-Defect4J baseline pickles and split, usable for method-code reproduction but not called original JITLine project replication.
- `jitline-released-tables-v1`: reconstructed from released commit metrics and complete line tables with a documented reconstructed split; also not called the missing author split.

Commit output includes probability and class. Line output applies the author's LIME token-attribution path, aggregates token weights per changed line and writes token-to-line-index records. A Git line number is emitted only when a real diff resolver maps the line; otherwise `gitLine: null` and `lineNumberReason` are emitted. The generic mapping contract is shared with the later multi-language change.

### 7. JIT-Fine and JIT-Smart use CodeBERT

Both require `microsoft/codebert-base`, pinned by a resolved Hugging Face commit and local weight hash. JIT-Fine uses the exact commit representation (`msg`, `[ADD]`, added code, `[DEL]`, removed code), manual-feature standardization, CodeBERT `[CLS]` plus a 14-field projection, BCE and last-layer attention-to-token-to-line aggregation. JIT-Smart adds padded per-line inputs, a word/line HAN, focal losses with `dp_loss_weight=0.3`/`dl_loss_weight=0.7`, and a joint commit/line model.

CPU is the only available device. Real smoke training uses frozen author hyperparameters scaled down only in sample count/epoch, and labels the result `real-smoke`, not `author-protocol`. Full 50-epoch training remains a recorded hardware blocker until a suitable GPU is available. No random fallback checkpoint is accepted as a reproduction artifact.

### 8. Evaluation

Commit metrics are computed from one frozen prediction file: Average Precision, ROC-AUC, threshold precision/recall/F1, Recall@20%LOC, Popt and IFA. Line metrics are grouped by commit and report Recall@1/5/10, MRR, first-positive inspection count, fixed line-budget recall, coverage and the random/file-order baselines. Ties use a documented deterministic key. Reports separate positive-only-commit localization from end-to-end commit-screening-plus-localization.

JITLine token attribution is not a defect cause. Line scores remain uncalibrated research ordering and cannot be registered as product line probabilities.

### 9. Evidence and resumability

Real commands write to the ignored artifact root. Evidence is frozen explicitly to `docs/evidence/add-author-method-reproduction/` after checks, with file hashes and source run identities. A status manifest records per method: material readiness, real smoke, author-protocol, metrics and blockers. The main report links all acquisition and rerun commands.

## Risks / Trade-offs

- **Missing JITLine author split** → Run both available data variants, label neither as the original split, and keep the missing pickle as a concrete blocker.
- **No GPU and large CodeBERT models** → Prove real small-sample training and line mapping; defer full 50-epoch protocol with explicit hardware evidence instead of substituting a smaller encoder.
- **Old pickle compatibility** → Load with fixed modern pandas/torch in a compatibility port; record failures and do not rewrite source pickles.
- **Author code defects or inconsistencies** → Preserve separately named author-code and paper-intent configurations; never silently “fix” results into one run.
- **No JIT-Fine/JIT-Smart license** → Store hashes and derived metrics only; require users to obtain data under their own permission decision.
- **Randomness in LIME, SMOTE, DataLoader and HAT/attention models** → Freeze seeds and declare numerical tolerances, not byte equality.
- **v3 timestamp inversions** → Exclude negative ages, count them in metadata and keep first-parent history authoritative.

## Migration Plan

1. Add `kamei14-git-v3` registration without changing v2.
2. Add collector schema selection defaulting to v2; `--schema kamei14-git-v3` writes new filenames, descriptions and version identities.
3. Do not migrate v2 datasets or models. Train any v3 model into a new run and artifact.
4. If rollback is needed, remove v3 from new-request choices; leaving it registered is backward compatible because no existing v2 object refers to it.
5. Create no database migration for author runs; they are filesystem artifacts. A later product-registration change will add catalog identity explicitly.

## Open Questions

None that block this change. The exact size of the full GPU run and later seven-language repository set will be measured after this reproduction contract is executable.
