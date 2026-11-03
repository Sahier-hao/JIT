# 验证结果

## 本机九模型发布包

目录库从迁移 20 显式升级至 21；升级前备份由现有机制生成。随后从九个已登记 ready 模型生成发布包：

- 模型数：9
- 文件数：81
- 解压大小：18,881,077 bytes
- ZIP 大小：6,213,040 bytes
- SHA-256：`3c15b7d9453291ba5c106e09b93403e234c0c1c67c0413b2d3654820f3377d76`
- 包格式版本：1

模型 ZIP 与 SQLite 均命中 `.gitignore`；Git 暂存区为空，已跟踪差异不含 `.joblib`、`.zip` 或 `.sqlite3`。

## 隔离空目录恢复

专用浏览器启动器重建源产物、导出九模型包、清空目录库和产物根，再导入包：

- 九模型包导入状态：`completed`
- 新建：9
- 复用、冲突、失败：0
- 九个 `artifactRunId` 与源包一致
- 管理端和用户模型选择使用相同 `modelId` 身份

随后导入混合包，实际得到：

- 新模型成功登记：1
- 相同运行但目标位置冲突：1，`CONTEXT_MISMATCH`
- 新运行模型文件损坏：1，`INTEGRITY_ERROR`
- 整包状态：`partial`
- 成功项保持可用，冲突和失败项未发布

## 自动检查

| 检查 | 结果 |
| --- | --- |
| `pytest tests -q` | 676 passed, 1 skipped |
| `npm run test` | 45 files, 344 passed |
| `npm run typecheck` | passed |
| `npm run lint` | passed；保留项目既有 warning |
| `npm run build` | passed；保留既有大 chunk warning |
| `openspec validate ... --strict` | valid |
| 默认 Playwright | 16 passed |
| 模型包 Playwright | 1 passed, 1 intentional project skip |
| 大型仓库训练 Playwright | 1 passed, 1 intentional project skip |
| 实验登记 Playwright | 1 passed, 1 intentional project skip |
| 专用预览 Playwright | 4 passed, 2 intentional mobile report skips |

模型包、API 和浏览器测试同时覆盖：未知格式、路径穿越、隐藏文件、链接、重复条目、加密标记、超限、哈希错误、依赖缺失、坏模型、重复/并发导入、位置冲突、源策略不复制、唯一默认、匿名 401、空目录、网络失败重试和三档视口无页面横向溢出。
