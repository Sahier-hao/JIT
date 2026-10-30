# Project working agreement

- Current product and operations: `docs/当前产品.md`. Start with the files relevant to the requested change; check current code before trusting historical notes.
- Follow the current requested scope. Historical stage decisions do not override newer explicit requirements.
- Finish the user's task, including necessary interaction, failure recovery, repeated use, and connections to existing features. A task checkbox or a passing unit test alone does not establish completion.
- Resolve ordinary implementation choices and run affected local checks autonomously. Surface consequential product or permission decisions with a concrete recommendation; do not pause over routine details already covered by the request.
- Keep user project review focused. Administrator model maintenance, dataset records and validation reports belong in the authenticated management workspace. Enforce this boundary on the server.
- Model choices must refer to real registered, compatible artifacts. Preserve the selected model identity through requests, jobs, retries and results. Never substitute a different model silently.
- Protect existing data and model artifacts; use forward migrations and a database backup for local upgrades. Tests use disposable databases, model copies, ports and temporary directories. Do not stop another session's services.
- Verify the behavior that changed, including meaningful state transitions and affected user journeys. Report the actual scope and any unresolved failures.
- UI copy: keep only necessary state, data and action hints. Do not add explanatory, repetitive or decorative small text; if a line does not change what the user can do or understand, remove it.
- Use the configured OpenSpec schema and its artifact instructions for change files and templates. For `spec-driven`, the change contains `.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`, and capability delta files under `specs/`. Keep implementation audits and evidence in the repository’s `docs/` locations. Describe product behavior, technical decisions and actual validation; omit assistant workflow narration and conversation history. Do not invent verification, freeze or review results.
- After `openspec-archive-change` completes, automatically create or update the corresponding GitHub pull request unless the user explicitly opts out or repository authentication prevents it. Keep unrelated working-tree changes out of that PR and report any blocker concretely.
