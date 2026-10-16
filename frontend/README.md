# JIT 提交评审工作台 · 公开数据基线

本项目提供提交列表、详情和个人优先审查清单。默认读取 OpenStack 固定公开快照上的真实模型历史测试批次；也可明确选择人工演示。真实模式当前服务旧六字段固定逻辑回归运行，并已支持按声明解析具名 schema／方法运行（如 `kamei14-v1`，12 字段入模）。标题与预测解释未提供，风险不表示已确认缺陷。当前是回顾性评价，不宣称真实在线效果或完整课程交付。

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

## 两种模式操作

默认“真实历史回放”，显示测试提交、固定模型和运行标识；左侧“历史数据／示例数据”始终可切换，错误不会自动回退。真实服务不可用时核验产物并重启后端，再点“重新加载”。`/?mode=demo` 是明确选择演示的入口，刷新保留该模式。

真实数据下可以展开“基线记录”，查看三个来源文件地址与校验值、纳入规则、时间分区、完整测试指标和局限。字段展示按运行形态区分：旧六字段运行显示六字段（“尚非完整 Kamei14”）；具名 schema 运行按声明显示特征 schema 名、入模字段、未提供字段及原因、方法与指标集标识。指标不随筛选变化，未定义项显示原因；人工示例模式不显示真实效果。完整标识在详情与按钮名称保留，表格缩略标识可悬停核对。

以下步骤适用于两模式；示例名称和时间来自人工演示：

1. 打开工作台，确认顶部“演示模式”、项目和 `demo-v1` 标识。
2. 搜索 `demo-0001`，或填写 `YYYY-MM-DD` 起止日期；日期按 Asia/Shanghai 解释且包含当天。无效范围会保留最近有效结果，可用“清除筛选”恢复。
3. 点击提交标识打开右侧详情，查看变更概览和人工示例解释。
4. 从列表或详情加入清单，进入左侧“优先审查清单”检查加入顺序；重复加入不会产生第二条记录。
5. 从清单打开同一条详情，或移除记录；关闭详情保留搜索、日期和排序。
6. 使用 Tab 定位提交、Enter 打开；Tab 到“提交详情内容”区域后，用方向键、PageDown或End滚动阅读，再Tab到加入按钮并Enter加入。Escape关闭并返回原触发位置。页面允许纵向滚动，两个验收尺寸无需页面横向滚动。

演示内容定义见 [DEMO-DATA.md](public/DEMO-DATA.md)，审查流程见 [主规格](../openspec/specs/commit-risk-review/spec.md)，公开基线约定见 [基线主规格](../openspec/specs/public-data-baseline/spec.md)，本轮真实增量见 [归档 change 规格](../openspec/changes/archive/2026-10-11-connect-public-data-baseline-review/specs/commit-risk-review/spec.md)，验收记录见 [acceptance.md](../docs/evidence/connect-public-data-baseline-review/acceptance.md)。界面采用浅色开发工具风格，使用本机无衬线字体回退（中文雅黑、英文 Bahnschrift、标识 Consolas/Cascadia）和自行绘制的SVG图标，不打包或请求外部字体与图标资产。列表与详情内容可分别滚动；详情的关闭与加入按钮保持可操作。

## 模型预测工作台操作

左侧新增「模型与预测」导航，与其他工作台视图共用一个应用壳。地址采用 hash 路由：`#/models` 模型中心、`#/predict` 新建预测、`#/predictions` 打开已有结果、`#/predictions/<批次编号>` 直接打开某一条结果。不带 hash 的首页仍是真实历史回放，`?mode=demo` 仍是演示模式；从新页面返回旧工作台时，数据来源与个人清单按原有上下文隔离，单条预测不会混进历史批次或演示数据。导航是普通按钮，可用 Tab 聚焦、Enter 触发，浏览器前进／后退可用；未知 hash 显示可返回的提示页。

### 团队凭据（先做这一步）

六个模型／预测接口都需要团队 Bearer 凭据，凭据只保存在当前页面的内存里：

1. 在左侧「团队凭据」输入凭据，点「使用凭据」。成功显示「已输入凭据，仅保存在本页内存中」。
2. 没有凭据时页面不会自动发请求，只提示「请在左侧输入团队访问凭据」。
3. 点「更换凭据」可换成另一份（例如把成员凭据换成管理员凭据）；点「清除凭据」立即清空受保护内容与预测表单草稿。

刷新或重新打开页面后凭据一定失效，需要重新输入——这是设计行为，不是故障。凭据不进 URL、不进 localStorage／sessionStorage、不进日志与截图，也不写入任何仓库文件。

### 模型中心（成员可看，管理员可登记）

1. 进入模型中心，页面列出 `/api/v1/models` 返回的已登记模型，每张卡区分「已登记 · 可用」与「已登记 · 不可用」，并分别说明可用性与单条预测支持状态。
2. 只有状态为可用、且 `jsonPredictionSupported` 为 true、schema 为 `openstack-six-v1` 的模型才能用于单条预测。十二字段 `kamei14-v1` 模型会如实说明「不支持单条 JSON 预测」及未提供字段（`lt`、`rexp`）的原因。
3. 展开「查看完整来源与局限」可核对模型／运行身份、原产物模型、模型哈希、schema 哈希与局限；目录为空时给出指引，系统不会自动登记本机 baseline。要刷新目录请点「刷新目录」。
4. 管理员在「打开管理登记」后才会请求本机候选（成员凭据会看到「权限不足 · 此操作需要管理员权限」，且不会发起登记）。候选区只允许勾选一个候选，再点「校验并登记所选候选」显式提交所选候选的 `candidateId` 与 `manifestSha256`；第一次登记反馈「已新增登记」，此前登记过的同一产物反馈「该产物此前已登记，本次为复用」。失效候选不可选并给出原因；返回 409 时须点「刷新候选」重新选择，页面不会自动替你采用新哈希。这里没有路径输入、模型上传或新训练入口，候选只能来自本机已校验产物。

### 新建预测（单条，六字段）

1. 先在模型中心登记，再到「新建预测」选择一个可用模型；页面会展示所选模型的 schema 说明（含变换与来源列）。
2. 填写项目与记录编号，以及六项数值：`ns` 涉及子系统数、`nd` 涉及目录数、`nf` 修改文件数、`ent` 修改在文件间的分散程度（熵）、`la` 增加行数、`ld` 删除行数。这些是发布者原生单位，直接按发布者口径填写，不需要预先做 log1p 之类的变换；留空就是留空，不会被当成 0。
3. 也可以把只含这六项的 JSON 粘贴到「粘贴特征 JSON」后导入，例如：

   ```json
   { "ns": 4, "nd": 7, "nf": 12, "ent": 2.25, "la": 120, "ld": 9 }
   ```

   导入要求恰好六项、数值型、非负、计数为整数；重复键、数组、字符串、布尔、标签或完整请求包装都会被拒绝，失败时草稿保持原样且不会发起预测。
4. 可选填提交 SHA（40 位十六进制）与带时区的时间。表单有效且所选模型支持六字段时，「提交并保存预测」才可点。提交只发一次请求，在途期间按钮禁用且不自动重试。
5. 只有收到 201 且正文与本次提交快照一致时才进入结果页；422 会定位到具体字段；503 不展示任何风险。断线、超时或 201 正文不可信时只提示「未能确认保存结果」，并提示可以改用结果链接或批次编号自行核对。

### 预测结果与按编号重开

1. 结果页标注「用户提供特征 · 模型估计」，展示单条风险、原始六字段输入、批次身份与预测身份、模型／运行身份、模型哈希、schema 与输入哈希、创建时刻与局限；真实预测解释尚未接入，页面如实显示原因。
2. 「结果链接」只包含批次身份，不包含凭据、输入或演示查询串，可手动复制。链接打开的是只读 GET，不会重新预测，也不要求所选模型现在仍然可用或目录仍然可读。
3. 共享结果仍需要有效的团队凭据，页面不提供个人隔离；凭据失效时先重新输入，再刷新或重新打开链接。
4. 也可以在「打开已有结果」里直接输入批次编号（标准 UUID，大小写不敏感）：格式不对会在请求前提示，编号不存在显示「指定资源不存在」，存储不可用显示对应的可重试反馈。
5. 这里按编号读取单个已保存批次，不是全量预测历史列表，也不提供列表、搜索或删除。

## 清单保存边界

清单只在同一浏览器、同一应用地址（origin）和同一数据上下文内恢复。人工演示沿用v1项目／版本键；真实使用historical／项目／datasetVersion／runId的独立v2键。相同提交在不同运行不会继承选择，返回原运行可恢复，按加入顺序保存提交标识。清理浏览器数据、隐私模式、换浏览器或换地址可能无法恢复；不提供账号、多标签页实时或跨设备同步。清单表示个人审查计划，不是缺陷标签或评审通过结论。

无法保存时当前操作仍然生效，页面提示“本次清单未能保存，刷新后可能丢失”。无法读取或内容损坏时显示恢复失败，可以继续选择。恢复时去重并排除当前数据中不存在的提交，不清理其他应用或版本的存储。

## 一次复验

结束本项目正在运行的 dev/preview，再执行 `pwsh -File ./scripts/verify.ps1`。脚本先执行后端检查、实际 TCP 恢复检查、固定产物核验与复现比较，再执行前端干净安装、类型检查、行为测试、lint、构建、两个视口的浏览器检查和 OpenSpec 主规格严格校验，遇到失败立即退出。后端产物需事先按固定命令生成；浏览器检查自行启动需要的本机服务，成功链路实际请求真实模型。原始输出、命令退出码、版本与源码校验和保存在运行工作区 `docs/evidence/_run/`；测试自行启动并结束本地服务器。
