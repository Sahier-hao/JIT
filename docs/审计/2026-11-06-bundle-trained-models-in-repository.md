# 仓库内置九模型发布包验收（2026-11-06）

## 范围

对应 change `bundle-trained-models-in-repository`：把已校验的九模型 ZIP 和 SHA-256 sidecar 纳入
Git，并让标准 `catalog-init` 在空目录或未完整应用时走既有安全导入器恢复模型。

## 交付

- 发布包：`backend/model-packages/jit-nine-models-v1.zip`
- SHA-256：`3c15b7d9453291ba5c106e09b93403e234c0c1c67c0413b2d3654820f3377d76`
- 压缩大小：6,213,040 字节；解压大小：18,881,077 字节
- 内容：9 个模型、81 个模型运行文件，另有包级清单
- SQLite、`backend/artifacts/`、解包运行目录和测试夹具继续由 Git 忽略
- 当前包低于 6 MiB，使用普通 Git，不需要 LFS

## 行为

`catalog-init` 在目录库迁移后校验 sidecar、包结构、逐文件哈希、运行身份、依赖和实际加载结果，
再调用既有导入器。空目录会得到九个 ready、用户可选的模型；同一 SHA 已完整应用且全部运行可用时
幂等跳过。包不覆盖目标环境的默认模型、启停状态或历史结果，也不按指标自动选择“最佳模型”。

部分冲突、依赖缺失或损坏按项返回原因；失败项不显示为 ready，既有成功模型和目录数据不删除。

## 最终验证

| 检查 | 结果 |
| --- | --- |
| 后端全量 pytest | 732 passed，1 skipped |
| 前端类型检查 / lint / build | 通过；lint 与构建仅有既有警告 |
| 前端 Vitest | 353 passed |
| 默认 Playwright | 16 passed |
| 管理训练专用 Playwright | 1 passed，1 viewport skip |
| 实验登记专用 Playwright | 1 passed，1 viewport skip |
| 模型包恢复专用 Playwright | 1 passed，1 viewport skip |
| 仓库内置模型专用 Playwright | 1 passed，1 viewport skip |
| 隔离预览验收 | 4 passed，2 viewport skip |
| OpenSpec strict | 通过 |
| 证据完整性 | 21 个文件，`check-evidence` 通过 |

空目录初始化结果为 `completed`，新建和已登记均为 9，冲突与失败为 0。覆盖矩阵中九种方法均为
`registered-ready`，模型身份与包清单一致。

## 回归中发现并修正的问题

1. “使用默认模型”曾同时发送训练方法参数，服务端按契约拒绝为 422；现在只发送
   `strategy=generic-model`，默认模型身份由服务端解析。
2. 数据集列表和版本接口曾使用服务启动时的描述文件快照，运行中采集并登记的大型仓库数据集无法
   立刻查询和训练；接口现按请求重新读取当前登记目录。
3. 大型仓库测试仍引用旧的 `kamei14-git-v1` 名称；已更新为当前 `kamei14-git-v2` 实际口径。

## 证据

完整包清单、初始化结果、覆盖矩阵、浏览器 JSON 和三视口截图见
[冻结证据](../evidence/bundle-trained-models-in-repository/README.md)及其
[完整性清单](../evidence/bundle-trained-models-in-repository/冻结清单.json)。
