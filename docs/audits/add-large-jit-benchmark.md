# Large JIT 14-dimensional benchmark audit

Audit date: 2026-10-30

## Decision

Select `JIT-Fine / JIT-Defect4J` as the PR 1 benchmark source.

Reject the Kamei replication package `software-rebels/JITMovingTarget` because neither
OpenStack nor Qt provides all 14 required fields. In particular, both files lack `lt`;
the available `rexp` column also cannot be substituted for the Kamei `rexp` semantics
without a separate provenance audit.

Do not combine these sources.

## Candidate A: JIT-Fine / JIT-Defect4J

- Repository: `https://github.com/jacknichao/JIT-Fine`
- Git revision: `584799fdec6095ab75a45fd2a5f8db5b12163aa5`
- Data archive: `data.zip`, Git blob
  `6cd2f45d97a7c430533cde382be6bf42d9ff3649`
- Archive SHA-256:
  `9e5ca1a393b70ee7e87c410b162005958775f3f3732f9f83da9dd24a7dfe2b47`
- Declared license: none (`NOASSERTION`)
- Data unit: one commit per row
- Projects: 21
- Source rows: 27,319
- Source positive rows: 2,332
- Duplicate commit IDs across all source splits: 0

Artifact member hashes:

| Member | SHA-256 |
| --- | --- |
| `data/jitfine/features_train.pkl` | `0b9992d77cd07f45a71bd327a3d408ed3f0ab7a907ffdc10f9916a8f226dc42a` |
| `data/jitfine/features_valid.pkl` | `e2ee48d5cd9e7f59bea726d4f6a71ef58712ae58d3388d8195a798369cf0d2cf` |
| `data/jitfine/features_test.pkl` | `136eebbb1c1719bffbfed8f0d686e3c015c5756a7b3c43d6f700a07687ab58fa` |

The JIT-Fine preprocessing source defines the expert vector as:

```text
["ns", "nd", "nf", "entropy", "la", "ld", "lt", "fix",
 "ndev", "age", "nuc", "exp", "rexp", "sexp"]
```

All 14 columns are present. `commit_hash`, `author_date_unix_timestamp`, `project`,
and binary `is_buggy_commit` supply identity, time, project, and label.

Audit findings:

- `fix` is boolean and can be normalized to 0/1 without deriving a new value.
- `lt` is a nonnegative floating-point value in valid rows; it is not restricted to
  integers by JIT-Fine.
- 1,580 rows have negative `lt`; 74 rows have negative `age`; their union is 1,653 rows.
  These are invalid for a nonnegative Kamei size/age contract and are explicitly
  excluded and counted instead of clipped or filled.
- After removing invalid feature values: 25,666 rows and 2,217 positives.
- The existing cohort rule excludes 64 additional rows with `la == 0`; it excludes no
  further positives.
- Final benchmark population: 25,602 rows, 2,217 positives, 21 projects.

Using the project's deterministic temporal split after normalization:

| Partition | Rows | Positives |
| --- | ---: | ---: |
| train | 17,912 | 1,751 |
| validation | 3,847 | 310 |
| test | 3,843 | 156 |

The source exceeds the required 5,000/500 gate and both train and test contain two
classes.

License boundary: the repository does not declare a license. Raw pickles and the
normalized CSV are therefore not committed or redistributed by this change. The
repository contains only source metadata, hashes, audit counts, model results, and
reproduction instructions. Anyone reproducing the experiment must obtain the pinned
source independently and review its usage terms.

## Candidate B: Kamei replication package

- Repository: `https://github.com/software-rebels/JITMovingTarget`
- Git revision: `184403ad3734894c8417cbec72fdef3da5edc0b9`
- Declared license: none (`NOASSERTION`)
- Projects: OpenStack and Qt

| File | Git blob | Bytes | SHA-256 | Rows | Positive `bugcount` |
| --- | --- | ---: | --- | ---: | ---: |
| `data/openstack.csv` | `634faa74be339f623321287f88d14ad5e78da491` | 4,448,994 | `2b1d2128bee82e905b0233d6646c3fa88eed033e440482e2f89272a3dd436505` | 26,855 | 1,968 |
| `data/qt.csv` | `0c8d1029ab9ee496b9c4d184409175682afb1f92` | 6,546,502 | `656e6c1b3f06f2bab3329ae002bccdbbfd709b15f8b65cd2f070bbaa6713b48c` | 32,155 | 2,265 |

Both files have commit-level identity and time plus binary `bugcount > 0` labels.
Several source columns require explicit aliases (`ent` → `entropy`, `fixcount` →
`fix`, `aexp` → `exp`, `asexp` → `sexp`), but `lt` is absent. The available `rexp`
column is not accepted as the Kamei author recent-experience metric without an
independent definition audit.

Result: rejected for the complete-14 benchmark.

## Reproducibility facts

- The adapter revision will be `jit-fine-v1`.
- The adapter verifies the archive hash and all three member hashes before loading
  pickles.
- The normalized label rule is `is_buggy_commit in {0, 1}`, recorded separately from
  the canonical `bugcount` transport column.
- No value is imputed, clipped, or synthesized.
