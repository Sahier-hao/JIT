# bundle-trained-models-in-repository 证据

本目录记录仓库内置九模型发布包的标准初始化与可见性验收。

## 发布包

- 包名：`jit-nine-models-v1.zip`
- 包版本：`1`
- SHA-256：`3c15b7d9453291ba5c106e09b93403e234c0c1c67c0413b2d3654820f3377d76`
- 压缩大小：`6,213,040` 字节
- 解压大小：`18,881,077` 字节
- 模型数：`9`；模型运行文件数：`81`；ZIP 条目数：`82`（另含内层 `model-package.json`）

`package/model-package.json` 是从受控 ZIP 中提取的完整包清单；`package/jit-nine-models-v1.zip.sha256`
是仓库提交的 sidecar。实际 ZIP 字节哈希与 sidecar 一致。

## 空目录初始化

`bootstrap/initialization.json` 来自空数据库和空产物根的标准 `catalog-init`。内置包状态为
`completed`，九个运行均逐项登记成功，冲突和失败均为零。数据库、产物根和解包运行目录留在
Git 忽略的运行区，不进入本次证据。

`bootstrap/coverage.json` 是该空目录服务实际返回的数据集与方法覆盖矩阵：九种方法均为
`registered-ready`，且矩阵中的模型身份与包清单一致。

## 浏览器验收

`browser/` 保存最终 Playwright JSON：

- `default-results.json`：默认桌面回归；
- `admin-training-results.json`：大型仓库现成模型、自动训练、强制训练和管理员回看；
- `experiment-results.json`：实验运行登记；
- `package-recovery-results.json`：模型包恢复及部分冲突；
- `bundled-model-results.json`：空仓只依赖仓库 ZIP 恢复九模型；
- `preview-results.json`：隔离预览的项目持续审查、报告和趋势流程。

`screenshots/` 保存九模型可见性及大型仓库训练的管理端三视口截图。

## 回归边界

最终回归同时修正了两处既有链路问题：

1. “使用默认模型”请求不再携带只适用于训练方法的 `algorithm`，避免服务端返回 422；
2. 数据集接口在请求时重新读取描述文件，使服务运行后新登记的仓库数据集可立即查询和训练。

包内模型仍按实际依赖逐项加载；目标环境的默认模型、启停策略和历史结果不被包内声明覆盖。
本次没有按指标自动选择或推荐“最佳模型”。
