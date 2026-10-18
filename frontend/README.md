# JIT 提交评审工作台 · 公开数据基线

本项目提供提交列表、详情和个人优先审查清单。默认进入项目工作区；公开历史验证和人工演示位于实验室。真实模式当前服务旧六字段固定逻辑回归运行，并已支持按声明解析具名 schema／方法运行（如 `kamei14-v1`，12 字段入模）。仓库按实际采集结果展示标题与作者；历史回放不提供逐条归因，手工预测保留已支持的真实归因，模型分数不表示已确认缺陷。当前是回顾性评价，不宣称真实在线效果或完整课程交付。

## 本地运行

先按 [后端说明](../backend/README.md) 下载、生成并核验固定运行，在 backend 启动本机服务。然后在 `D:/code/jit-defect-prediction/frontend` 执行：

```powershell
npm ci --registry=https://registry.npmjs.org/
npm run dev
```

打开 http://127.0.0.1:4173 。使用 Node.js 24.13.0 与 npm 11.6.2 验证；依赖的实际版本锁定在 `package-lock.json`。开发服务器仅监听本机，端口被占用时会明确失败。

## 检查与构建

```powershell
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

`npm run preview` 可在构建后预览静态产物。运行 preview 前先结束占用相同端口的 dev。测试报告写入**运行工作区** `../docs/evidence/_run/`；该目录可被后续运行覆盖、不进入版本控制，归档证据由显式冻结从运行工作区产生，测试不写任何已归档目录，冻结与校验命令见 [后端说明](../backend/README.md#验证证据的冻结)。浏览器失败轨迹在 `test-results/`；测试代码不进入产品构建。

安装需要 npm registry 与 Playwright 下载站点可访问。若机器配置的镜像无法访问，以上安装命令仅对本次执行指定官方 registry，不修改全局配置。

## 隔离浏览器验收

需要真实登记模型、真实创建预测并重启服务验证结果重开的浏览器检查，跑在**独立环境**里，绝不使用正在运行的默认预览、默认后端或既有开发库：

```powershell
npm run test:e2e:acceptance
```

该入口（`playwright.acceptance.config.ts`）用前端 4273、自有后端 8123，代理目标通过 `JIT_FRONTEND_PORT`／`JIT_API_PROXY_TARGET` 注入 Vite，因此与默认 4173／8000 可以并排运行。启动夹具 `e2e/support/acceptance-setup.ts` 调用 `backend/scripts/acceptance_environment.py`：复制已验证模型到 `backend/.cache/acceptance-<label>/`、显式初始化临时 SQLite、生成只存于该次运行内存的团队凭据、启动自有本机服务；收尾夹具 `e2e/support/acceptance-teardown.ts` 只按 pid 结束自己的进程、核对原开发库与 `artifacts/` 原文件未变、扫描本轮写入 `docs/evidence/_run/` 的文本产物确认没有测试凭据、完整 `Authorization` 头或服务端临时绝对路径，然后删除临时根。受保护请求场景关闭 trace 与视频，不产生请求正文转储。

端口冲突时端口立即失败而不是静默换端口，可用环境变量覆盖：

```powershell
$env:JIT_ACCEPTANCE_FRONTEND_PORT='4373'; $env:JIT_ACCEPTANCE_SERVICE_PORT='8223'; npm run test:e2e:acceptance
```

**资源清理方式**：夹具正常结束即自动清理；若运行被强制中止，临时根可能残留，手工执行
`& backend/.venv/Scripts/python.exe backend/scripts/acceptance_environment.py cleanup --base backend/.cache/acceptance-workbench`
即可删除，然后再确认 `Get-NetTCPConnection -LocalPort 8123 -State Listen` 没有残留进程。默认入口 `npm run test:e2e` 仍使用 4173／8000，并且不会运行只属于隔离环境的 `e2e/acceptance.spec.ts`。

`npm run dev` 与 `npm run preview` 读取 `JIT_FRONTEND_PORT`（默认 4173）与 `JIT_API_PROXY_TARGET`（默认 `http://127.0.0.1:8000`），仅监听本机，端口被占用时明确失败。

## 验证环境说明（Windows + 中文路径）

完整验证链 `frontend/scripts/verify.ps1` 需要 PowerShell 7（`pwsh`），并且本机若处于中文系统区域（ANSI 代码页 936），直接运行会遇到编码与路径问题。按以下准备：

1. **PowerShell 7**：首选 `winget install Microsoft.PowerShell`；网络受限时可下载官方便携 zip（GitHub releases 的 `PowerShell-<版本>-win-x64.zip`），解压后把目录加入 PATH。Windows PowerShell 5.1 不满足要求（验证链与 guard 测试硬依赖 `pwsh`）。
2. **UTF-8 控制台**：运行验证前先执行 `chcp.com 65001`。否则 pwsh 的管道错误输出按 ANSI 代码页（GBK）编码（如错误格式化里的行首省略号“…”），按 UTF-8 解码的测试会失败。
3. **ASCII 路径**：仓库若位于含中文的路径（如 `D:\Documents\课程相关\...`），guard 测试生成的临时脚本路径含中文，会触发同样问题。用目录联接绕开（无需管理员）：`powershell -NoProfile -Command "New-Item -ItemType Junction -Path 'C:\JIT' -Target '<仓库路径>'"`，之后从 `C:\JIT` 运行验证。

另外，Playwright 官方 chromium 下载在部分网络不可用（CDN 网关返回 400）。当前 `playwright.config.ts` 已声明 `channel: 'msedge'`，使用本机 Edge（chromium 内核）运行浏览器检查，证据记录中如实标注 channel；网络恢复后执行 `npx playwright install chromium` 并移除该 channel 即可回到下载版 chromium。

## 产品空间与来源

默认 `#/projects` 是项目入口；先在设置连接团队，再接入仓库。工作区只组织仓库的成功分析、提交列表/详情和个人审查计划。实验室提供真实已有的历史验证、历史趋势、模型目录、六字段手工预测和保存结果重开；交互演示单独标记人工数据。设置提供运行期凭据与外观偏好。没有训练平台、账户或跨设备计划同步。

| 空间 | 规范地址 | 来源与行为 |
|---|---|---|
| 项目入口 | `#/projects` | 遍历全部仓库页；首次打开不猜第一仓库 |
| 仓库接入 | `#/connect` | 地址优先，高级参数可展开；异步作业真实轮询，失败保留草稿 |
| 仓库定位 | `#/repositories/{repositoryId}` | 核对最新成功分析后 replace 到规范分析地址；没有成功分析则说明状态 |
| 已分析提交 | `#/repositories/{repositoryId}/analyses/{viewSyncId}/commits` | 服务端搜索/日期/排序/分页，所有请求固定 viewSyncId |
| 提交详情 | 上述地址加 `/{commitId}` | 宽屏列表与详情协作，窄屏显示详情并可返回；完整 ID、真实作者、受支持 GitHub 外链 |
| 审查计划 | `#/repositories/{repositoryId}/analyses/{viewSyncId}/plan` | 按分析隔离、去重、加入顺序；未知规模单独计数，失效项保留供移除 |
| 历史验证 | `#/lab/history/{runId}/commits`、`/trends` | 当前服务配置的具名运行；不匹配时拒绝替换，趋势下钻保留 runId 与桶日期 |
| 模型与预测 | `#/lab/models`、`#/lab/predict` | 成员/管理员边界保留；六字段按 schema 校验，支持时显示真实归因 |
| 保存结果 | `#/lab/results`、`#/lab/results/{batchId}` | 只读重开已保存快照，不重新推理，不依赖当前模型可用性 |
| 演示 | `#/lab/demo/commits` | 人工示例，独立数据版本 |
| 设置 | `#/settings/connection`、`#/settings/appearance` | returnTo 保留原目标；凭据不落盘、不入 URL；主题/密度单独持久化 |

旧 `#/models`、`#/predict`、`#/predictions/{batchId}` 继续定位同一能力/批次。`#/sources` 映射接入，`#/repositories` 映射项目入口；`#/validation` 与 `#/trends` 先读真实历史身份，旧 `?mode=demo#/validation` 映射演示；旧 `?mode=repository&sync=...` 先核对作业归属与成功状态。冲突参数明确报错。旧 `#/shortlist` 在有已核对最近分析时定位该计划，否则提供来源选择，不猜第一仓库。日期只作为进入相应列表时的种子，非法范围整体忽略并说明。

## 团队连接、模型与保存结果

凭据在设置的团队连接中输入并显式确认，仅在当前页面内存保留；更换或清除即隔离旧请求和受保护展示。返回按钮继续原目标。成员可读目录与预测，管理员另可检查候选并受控登记；401、403、网络、配置、存储与模型不可用分别反馈。公开历史验证独立可达。

手工预测只支持声明可用的六字段模型。填写项目/记录编号和 ns、nd、nf、ent、la、ld，可粘贴严格特征 JSON；重复点击不重复提交。返回结果按保存的模型、输入、分数和解释状态展示，真实归因包含方法与基准；旧 batchId 重开不重新推理。目录中的历史摘要仅描述模型训练的原运行，不能作为当前仓库效果。

所有提交列表与结果的模型分数用 0–1 小数显示；观测正标签比例、准确率等有定义的比例仍保留百分比。历史趋势的观测比例与模型分数有各自刻度和文字说明；缺聚合、稀疏桶与近似估计原因保留。运行只由 `/api/review-batch` 配置供给，不造多运行列表或模型排名。

## 审查计划与恢复

v3 键名 `jit-review:plan:v3:<编码来源上下文>`。仓库来源至少为 repositoryId/viewSyncId/datasetVersion；历史为项目/版本/runId；演示为项目/版本。每项只保存 commitId、sourceContext、addedAt，按加入顺序去重，不保存模型分数。跨页恢复逐条核对详情，失效项保留可移除；同 SHA 在不同仓库/分析不继承。

旧 v1/v2 键保留，只读取与已确认当前来源相符的那个键并提供预览，点击明确迁入后只带入核对成功的标识。损坏/无归属不自动迁移，不枚举或清理其他存储。写入失败保留当前操作并提示刷新风险；没有成本分母时不展示预算百分比，没有审查状态时总数称“已分析提交”。

## 视觉与验证入口

统一壳使用 220px 空间导航，主列表无需空计划占位，详情宽屏并列、窄屏单独展示。主要中文/操作 14px 起，次要文字 12px 起；11px 限标识/图表刻度。主题不改变风险语义，绿色用于品牌与选择，低分使用中性灰而非安全绿色。Inter Latin 子集与图标随仓库打包，许可保留，中文系统字体回退，不依赖外部 CDN，尊重 reduced-motion。密度只调整间距。

`product-workspaces.spec.ts` 使用隔离本地 Git、真实采集/打分/API 与浏览器，分别验证仓库审查、历史验证下钻、手工预测/旧结果重开；视口为 1280×720、1440×900，另检查 390px 窄屏。其他测试中 route.fulfill 的响应是明确的行为夹具，不算真实模型效果。最新运行记录见 [开发验证](../docs/开发验证.md)，冻结前报告仍在 `_run`，不是归档证据。

## 一次复验

本次 apply 的逐项复验与独立端口设置见 [开发验证](../docs/开发验证.md)，无需停止默认开发服务。另可在独立验证工作区执行 `pwsh -File ./scripts/verify.ps1`：脚本还包含干净安装、实际 TCP 恢复检查及独立 reproduction 比较；本次没有执行该完整入口，不把逐项通过写成整个脚本通过。后端产物需事先按固定命令生成；浏览器检查自行启动和结束自有服务，端口被占用时应失败，不复用或终止默认服务。运行输出在 `docs/evidence/_run/`，冻结前不作为归档证据。
