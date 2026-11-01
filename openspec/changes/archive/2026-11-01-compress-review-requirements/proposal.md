## Why

归档第一、三阶段变更后，PPT-02 和 RCL-09 的正文超过 500 字符，`openspec validate --specs --strict` 将其计为失败。两段要求都包含大量已由场景明确验收的细节。

## What Changes

- 压缩 PPT-02 正文，保留快照、模型固定、批次复用、进度和重启边界，全部 10 个场景保留。
- 压缩 RCL-09 正文，保留打分模型来源、训练窗口、截止时间和降级规则，全部 8 个场景保留。
- 不改变产品行为、接口或代码。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-pr-tracking`：压缩 PPT-02 正文，场景不变。
- `repository-collection`：压缩 RCL-09 正文，场景不变。

## Impact

- 仅修改主规格组织方式；不修改代码、接口、数据或界面。
- 所有原有场景保留。
