# IDE 报告交接与 Eclipse/Visual Studio 可行性结论

日期：2026-11-25。范围：change `deliver-ide-handoff-and-integration-tests` 的 PR5。结论只覆盖 VS Code 已交付能力与 Eclipse/Visual Studio 的可行性，不表示后两者已有插件。

## 已交付的 VS Code 交接

- CI 的 `commit-analysis.yml` 在固定模型包和固定 base/head 上运行 `pr-check-analyze`，只上传 `commit-analysis-*` 报告产物；工作流保持 `contents: read`，不评论 PR、不阻断合并、不修改分支保护。
- 报告格式为 `jit-commit-analysis-v1`，包含仓库、base/head SHA、模型/运行身份、覆盖、候选和限制；分析失败时不生成替代报告。
- VS Code 扩展 0.2.0 只读导入报告，核对仓库、提交与工作树身份；身份不匹配、分支切换、工作树改动、文件重命名/删除或行号过期时拒绝错误定位。真实仓库回归由 `vscode-extension/test/real-repository.test.js` 覆盖。
- 宿主冒烟仍不是正式 GUI 截图：本机有 VS Code 1.147.0，但 `@vscode/test-electron` 不在扩展依赖中；正式交付以 Node 真实仓库测试和浏览器联调截图为证据，不宣称已完成 GUI 走查。

## 跨 IDE 协议

继续以 `jit-commit-analysis-v1` JSON 作为唯一跨 IDE 协议。各 IDE 只负责：选择文件、解析身份、只读展示、按文件/行定位；CI 负责生成固定报告。这样不需要为每个 IDE 复制分析算法、模型或数据库访问。

## Eclipse 可行性

| 维度 | 结论 |
|---|---|
| 插件 API | Eclipse 使用 OSGi/Extension Point 与 SWT/JFace；与 VS Code 扩展 API 不兼容，不能直接复用 TypeScript 扩展。 |
| 协议复用 | 可复用 `jit-commit-analysis-v1` 与身份核对规则；报告解析、路径越界和行号检查需用 Java 重写。 |
| 成本 | 需要 Java 工程、OSGi 打包、Eclipse 目标平台和 UI 视图；至少一套独立构建与发布链。 |
| 风险 | 用户规模未知；Eclipse 主题/编辑器 API 差异大；与 VS Code 并行维护会增加报告解析漂移风险。 |
| 推荐 | 暂不实现；先收集真实 Eclipse 用户需求，再基于现有协议做一个只读导入原型。 |

## Visual Studio 可行性

| 维度 | 结论 |
|---|---|
| 插件 API | Visual Studio 使用 VSIX/VSSDK（C#/.NET），与 VS Code 扩展模型不同；现有 TypeScript 代码不能直接复用。 |
| 协议复用 | 同样可复用 `jit-commit-analysis-v1`、身份字段和只读定位规则；需要 C# 解析与 UI。 |
| 成本 | 需要 .NET 工程、VSIX 签名/分发、Visual Studio 版本矩阵和独立测试宿主。 |
| 风险 | 版本矩阵和维护成本高；签名与商店分发增加运维负担；当前没有 Visual Studio 用户证据。 |
| 推荐 | 暂不实现；先把 VS Code 与 CI 报告交接稳定，再评估是否有明确需求。 |

## 推荐顺序

1. 保持 VS Code + CI 报告交接为唯一已交付 IDE 路径。
2. 收集 Eclipse/Visual Studio 真实用户与使用频率；没有证据前不新增插件。
3. 若启动，先做只读报告导入/身份核对原型，再决定是否扩展到定位和安装分发。

## 边界

- 本文不声称 Eclipse 或 Visual Studio 已支持。
- 报告仍是提交级模型估计，不是缺陷概率、根因或代码行缺陷结论。
- 跨 IDE 复用只针对报告协议和只读核对，不共享模型推理或训练实现。
