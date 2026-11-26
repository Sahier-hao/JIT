# Guided model and review evidence verification

Change: `deliver-guided-model-and-review-evidence`

## Delivered

- Training parameter cards show the method-declared explanation, default, range, modified state, restore action and algorithm-library link.
- `#/plugins/vscode` provides a stable IDE usage guide without pretending an unavailable VSIX is downloadable.
- Fixed PR and fixed repository commit details expose server-derived line research evidence with probability score and `log-odds` decomposition kept separate.
- Unsupported language, incomplete patch, missing content, source failure and candidate gaps return explicit states.
- The browser journey verifies a delayed old-file response cannot replace the currently selected file.

## Verification

| Check | Result |
| --- | --- |
| Backend affected pytest set | 91 passed |
| Frontend full Vitest | 82 files, 653 tests passed |
| Frontend typecheck | passed |
| Frontend lint | exit 0, existing/non-blocking warnings retained |
| Style source check | 4 stylesheets, 3 entry imports, 0 pending Mantine references |
| Module boundary check | 302 source files, 1 app entry, no base-layer reverse business dependency |
| Production build | passed, 4,149 modules |
| OpenAPI curated/generated paths | 149 generated operations covered by curated contract or known gap list |
| OpenAPI generated types | committed generated types match curated contract |
| Isolated browser E2E | `guided-evidence` 1 passed in 1.0m |

The E2E uses a real isolated backend, isolated SQLite/datasets, real local Git history and a controlled GitHub-compatible source adapter. Browser route interception only delays one real request to verify stale-response handling; it does not mock the response.

## Evidence

- [IDE plugin guide](screenshots/ide-plugin-guide.png)
- [Fixed commit line evidence](screenshots/commit-line-evidence.png)
- [Fixed PR line evidence](screenshots/pr-line-evidence.png)
- [VS Code Extension Development Host smoke](screenshots/vscode-extension-host-smoke.png)
- [Guided E2E identities](guided-run.json)

The Extension Development Host screenshot proves the host starts in the isolated workspace. It does not claim a complete manual GUI walkthrough of report import and location jumps; the real browser/service journey and extension unit/integration suite cover the product behavior separately.

## Boundaries

- The line evidence is a frozen research preview. It is not a calibrated defect probability, root cause, review priority or replacement for commit risk.
- Commit risk, training algorithms, default model, model catalog and existing saved explanation identities are unchanged.
- Current repository commit details do not have linked rule-run data, so rule hits are shown as unavailable rather than copied from a PR.
