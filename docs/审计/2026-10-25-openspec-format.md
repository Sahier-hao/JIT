# OpenSpec 文档格式检查

## 范围与依据

检查 2026-10-22、2026-10-23 的六份归档：`add-project-management`、`rebuild-project-workspace`、`select-current-analysis`、`model-selection-policy`、`modernize-workspace-surface`、`project-admin-model-workflow`。

依据项目 `openspec/config.yaml` 指定的 `spec-driven` schema、原版 `openspec-update-change` / `openspec-propose` skill，以及 CLI `openspec instructions` 返回的 proposal、specs、design、tasks 指令和模板。

## 调整内容

- `modernize-workspace-surface` 增加缺失的 `.openspec.yaml`，声明 `schema: spec-driven`，不推定缺失的创建日期。
- 统一 proposal 标题及 Capabilities 子节，能力清单与对应 delta 文件一一对应。
- `rebuild-project-workspace`、`select-current-analysis`、`modernize-workspace-surface` 的 design 使用 Context、Goals / Non-Goals、Decisions、Risks / Trade-offs 章节，并明确部署与回退边界。
- 为四份任务清单中的实现项明确核验方式；保留原完成状态和历史测试结果。`select-current-analysis` 的归档事项移至 Workflow follow-up 普通列表，实施任务由 14 项变为 13 项。
- 管理员工作流 design 中的验证计数改为引用既有实施审计，验证记录继续保存在 `docs/`。
- 在 OpenSpec 配置增加按 artifact 的写作规则，要求标准结构、完整 MODIFIED 场景、任务核验方式与事实一致的验证记录。

未改变能力 delta、主规格、业务代码、数据库及模型产物。

## 2026-10-25 检查结果

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| 六份归档文件完整性、proposal/design 章节、能力映射、任务编号和本地 Markdown 链接 | 6/6 通过 | 覆盖 15 份能力 delta、100 项实施任务；为文档结构检查 |
| `openspec validate --all --strict --no-interactive --json` | 15/15 主规格通过 | 当前无活动 change，不包含归档的重新应用 |
| `openspec validate --archived --strict --no-interactive --json` | 29/31 通过 | 此命令检查归档任务完成状态；本次范围内六份均通过 |
| `git diff --check -- openspec docs/审计/2026-10-25-openspec-format.md` | 通过 | 不代表业务回归或浏览器验收 |

全量归档检查的两项失败为 `2026-10-19-add-repository-workspace` 的 3 项未完成任务，以及 `2026-10-19-restyle-review-workbench` 的 17 项未完成任务。两者已按部分完成、后续替代收尾，依据见 [2026-10-19 收尾审计](2026-10-19-change-closeout.md)。未将其改为已完成。

在临时项目中将历史 delta 当作活动变更并与当前主规格比较时，两份 2026-10-22 delta 会缺少后续变更新增的场景，管理员工作流的已同步新增要求也会提示重复。该结果反映历史变更不能直接重新应用到最新主规格；未据此把后续行为写入早期历史 delta。

本次没有执行后端、前端或浏览器业务回归；原任务中的历史测试数量不作为 2026-10-25 的新验证结果。
