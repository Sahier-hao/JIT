## Context

归档第一、三阶段变更后，PPT-02 和 RCL-09 的正文长度超过严格校验阈值；两段要求都有完整场景覆盖细节。

## Goals / Non-Goals

**Goals**

- 让 `openspec validate --specs --strict` 通过。
- 保留两段要求的全部场景和产品约束。

**Non-Goals**

- 不修改代码、接口、数据或界面。

## Decisions

### D1 压缩正文、保留场景

PPT-02 保留快照、模型固定、批次复用、进度和重启边界；RCL-09 保留打分模型来源、训练窗口、截止时间和降级规则。细节继续由既有场景验收。

## Risks / Trade-offs

- 正文变短后，部分细节依赖场景验收；所有场景均保留。

## Migration Plan

仅归档并同步主规格，无数据库迁移。
