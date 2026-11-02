## Why

`openspec validate --specs --strict` 对 `focused-project-review` 的 FPR-02 报出「要求正文超过 500 字符」警告，并据此使严格校验失败。该要求正文超过 500 字符，严格校验要求拆分或压缩；多数细节已在既有场景中有明确验收。

## What Changes

- 压缩 FPR-02 要求正文，把可由既有场景完整表达的细节保留在场景中。
- 全部 13 个原有场景逐项保留，不改变产品行为。
- 仅调整规格组织，便于严格校验和后续变更定位。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `focused-project-review`：压缩超长要求正文，全部场景保留。

## Impact

- 仅修改 OpenSpec 主规格的组织方式；不修改代码、接口、数据或界面。
- 所有原有场景仍保留，验收行为不变。
