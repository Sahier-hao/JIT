## Context

See `proposal.md`. The current dataset registry and curation export are administrator-only, while a completed repository sync already stores the opaque `datasetVersion` it produced. Dataset manifests already define quality, provenance, schema, label limitations and file SHA-256.

## Goals / Non-Goals

**Goals:**

- Provide one project-scoped route family that resolves a dataset only through a completed branch analysis.
- Reuse the registered manifest and source bytes rather than create a second dataset description.
- Make canonical and convenience exports independently useful without exposing global registry state.

**Non-Goals:**

- No ordinary-user dataset browsing, editing, pruning, training or upload.
- No new dataset format or replacement of the administrator export.
- No Excel formulas or interpretation of model scores inside the workbook.

## Decisions

### D1. Scope routes by project and analysis

Add project-scoped metadata and download routes under the repository analysis identity. The server resolves the completed branch sync, verifies `repositoryId`, then obtains `datasetVersion` from the sync record; clients cannot supply a dataset name, manifest path or alternate version.

This is preferred over opening `/api/v1/datasets` publicly: the global registry would disclose unrelated projects and cannot enforce an analysis-to-dataset relationship. Opaque UUIDs alone are not treated as authorization or scoping.

### D2. Project the existing manifest

The metadata response is a filtered view of the registered manifest. It includes quality, schema, time range, provenance, label rule, limitations, SHA-256 and byte count. Internal absolute paths, database identifiers and registered-manifest filesystem locations are omitted.

### D3. Two download formats with one integrity source

- Canonical ZIP: original CSV, manifest and `SHA256SUMS`, generated from verified bytes.
- XLSX: one data sheet and one metadata sheet containing version, full SHA-256, schema, time range, label rule, limitations and generated time.

The ZIP remains authoritative. XLSX is a presentation export and cannot replace the manifest/hash evidence. Backend streaming generation avoids loading unbounded files in the browser; workbook generation uses a write-only mode to bound memory.

### D4. Explicit failure semantics

Missing sync, failed sync, project mismatch, missing manifest, absent CSV and hash mismatch are distinct errors. The endpoint never falls back to the repository's latest analysis or another version.

## Risks / Trade-offs

- **Larger public payloads** → expose summaries only through the scoped route; detailed admin registry remains protected.
- **XLSX dependency and memory use** → add a narrow workbook dependency and use write-only streaming; retain ZIP as canonical.
- **Deleted historical version** → keep the analysis visible while explaining that its data export is unavailable; do not silently use a newer version.
- **Sensitive training labels** → scope access to a public project analysis and preserve the existing label/limitation disclosure; do not expose unrelated datasets.
