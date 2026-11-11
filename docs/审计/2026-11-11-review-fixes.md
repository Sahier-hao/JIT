# 本轮改动的独立审查与修复（2026-11-11）

对 `e8435a9..HEAD` 做了一次独立代码审查，以下问题已复现并修复；每条都补了回归测试或直接接口验证。

## 安全与授权

- `/api/admin/evaluation-evidence` 与详情接口未纳入管理员鉴权白名单，任何本机客户端可读取证据。
  已将前缀加入 `protected()`；用真实 TestClient 验证未登录返回 401（列表与详情均如此）。

## 批处理

- 运行中取消会被运行进程的整文件写回覆盖。写盘前先读取并采纳 `cancelledAt`；CLI 运行传入
  会重新读取取消状态的 `cancel_check`。测试：采集中途由另一“进程”取消，批次停止且不覆盖取消。
- 已取消批次无法恢复。`--retry-failed` 现在显式清除取消意图并把被取消项重新排队；不带该参数
  时保持取消。测试覆盖“先取消、再显式恢复”。
- 任务里的 `dataset` 未校验，含 `../` 时可在登记校验前写出批次工作目录。现在拒绝分隔符、
  `..`、隐藏名与控制字符。

## 评价矩阵

- 留一仓库只按路径字符串分组，同一仓库的另一版本或别名可被当作“其他仓库”参与训练。
  现在按 manifest URL（去 `.git`/尾斜杠、小写）与数据集名去重，重复即拒绝。
- 数据集加载或切分失败只写入 `splitFailures`，报告仍可能显示 `complete`。状态现在把切分失败
  计入 `partial`，没有成功单元格时为 `failed`。
- 单元格出现非 `BaselineError` 异常会中止整个矩阵。现在单元格级异常也记录为失败格，矩阵继续。

## 完整候选集

- 构建产物（`dist/`、`build/`、`vendor/`、`node_modules/`、`coverage/`、`*.min.js`、`*.bundle.js`）
  进入候选总体，axios 中占 33%。现在用 git pathspec 在 diff 阶段排除，评价阶段再次过滤，
  不可覆盖原因单独记 `generated-path`；axios 重导后候选 121,804 行、可覆盖正例 4,063。
- 重命名证据同时挂在新路径与 `oldPath`，同一证据行既算正例又算不可覆盖。证据改为按条目
  保留路径别名，覆盖判定按条目只算一次。
- 证据核对在提交循环结束后仍使用最后一次的重命名表；空 CSV 时还可能未绑定。改为按提交
  建立路径索引，提交为空时不再引用未定义变量。
- `line-candidates` 省略 `--repo` 时以 `Path(None)` 崩溃，且空仓库路径会退化为当前目录。
  `_repo_path` 现在要求非空路径并以领域错误失败；CLI 帮助承诺的回退路径可用。
- 导出前未校验 CSV 与描述文件哈希。现在先核对 `file.sha256`，不一致返回 `DATASET_INVALID`。

## 评价证据

- 陈旧检测只覆盖矩阵，行级评价与候选摘要永远显示可用。现在按行级报告与候选摘要的数据版本
  核对登记；缺失或未登记即标为陈旧。
- 结构畸形的合法 JSON 可使整个证据列表 500。现在逐文件隔离为 `invalid` 并给出原因。

## VS Code 扩展

- `git status` 读取失败被当作“工作树干净”，随后直接跳到报告行号。现在返回未知状态并拒绝定位。

## 环境变量

- `JIT_SZZ_MAX_FIX_COMMITS` 非整数会在导入期崩溃，`0` 会静默禁用修复提交发现。统一通过
  `_env_limit` 解析：非法或小于 1 回退默认值；`JIT_SZZ_MAX_SECONDS` 同样处理。

## 测试

`test_model_packages`、`test_model_policy`、`test_catalog_api`、`test_openapi`、
`test_evaluation_evidence`、`test_batch_collection`、`test_evaluation_matrix`、
`test_line_candidates`、`test_line_dataset`、`test_analysis_scope`、`test_project_trends`、
`test_project_partition_trends`、`test_repository_sync` 共 210 项通过。
