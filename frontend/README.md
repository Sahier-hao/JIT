# JIT Review 前端

普通用户围绕项目完成分支分析和 PR 审查；管理员在独立工作区登录后维护模型、数据和历史验证。当前产品与运行约定见 [当前产品](../docs/当前产品.md)。

## 技术栈

- React 19 + TypeScript + Vite。
- 路由：React Router 7 的 `createHashRouter`；地址继续使用 `#/projects/...`，旧链接由 `src/app/navigation.ts` 的解析器映射。
- 样式：Tailwind CSS 4（启用 preflight）+ `styles/tokens.css` 的设计令牌。`index.css` 的 `@theme inline` 把全部令牌映射为 Tailwind 语义色、字号、间距与圆角，四套主题由 `html[data-theme]` 切换，两档密度由 `html[data-density]` 切换。外观规则见 [界面设计规范](../docs/界面设计规范.md)；`npm run check:styles` 检查样式只从登记的位置产生。样式表只保留 `index.css`、`tokens.css`、`base.css` 与 `content.css` 四个。
- 组件：`src/components/ui/` 由官方 shadcn/ui CLI 4.23.0、`new-york` / Radix registry 添加，配置在 `components.json`。页面直接使用标准组合接口；密码显隐、状态反馈等业务组合独立维护，基础组件不接收旧 `options/title/footer/loading/icon` 兼容参数。
- 图标：直接使用 lucide-react，品牌标志由 `BrandLogo` 保留。
- 代码对比：react-diff-view + refractor；项目概览和风险趋势使用 ECharts 的 SVG 渲染，专用封装位于 `components/shared/`。
- 测试：Vitest + Testing Library（组件）与 Playwright（浏览器验收）。

## 目录边界

```text
src/app/                  入口、路由、Provider 与应用级编排
src/components/ui/        官方 shadcn/ui 基础组件
src/components/layout/    用户区与管理区的布局外壳
src/components/shared/    跨业务共享的展示组合与反馈
src/features/projects/    项目、分析、仓库概览与项目数据
src/features/reviews/     PR 预览、审查工作单与个人审查状态
src/features/datasets/    用户数据与数据集拆分/整理请求
src/features/training/    用户训练工作区
src/features/models/      用户模型、模型卡与模型展示
src/features/account/     入口、登录、账户和个人空间
src/features/admin/       管理工作区、模型、数据、训练和实验
src/features/research/    历史验证、趋势和研究页面
src/lib/                  请求基础设施、领域工具和测试工具
```

业务页面、请求、契约和相邻测试放在对应 `features/<name>/` 下；`components/ui` 不依赖业务模块，`components/shared` 不反向依赖业务模块。新增模块后运行 `npm run check:modules`，不要重新建立 `src/pages`、`src/ui` 或根目录业务转发文件。

## 运行

首次安装执行 `npm ci`。后端先备份并运行 `catalog-init` 升级目录库；该命令同时恢复仓库内置九模型包，再分别启动：

```powershell
cd backend
./.venv/Scripts/python.exe -m jit_baseline.cli serve --port 8000
```

```powershell
cd frontend
npm run dev
```

默认前端 `http://127.0.0.1:4173` 代理 API 到 8000。自定义后端时在启动 Vite 前设置 `JIT_API_PROXY_TARGET`，例如 `http://127.0.0.1:18423`。端口被占用时明确退出，不停止其他服务。

## 用户流程

1. 在项目页选择“新建项目”，登记公开 HTTP(S) 仓库地址；登记不会启动分析。
2. 进入项目，点击“发起分析”，选择分支、真实可用模型或自动策略、训练方法和时间切分预设。
3. 发起分析后自动跟踪执行状态，完成后打开固定分析的提交明细与单条详情。
4. 分析记录支持分页、设置当前结果、恢复失败参数后修改重试；删除记录前确认影响范围。
5. 项目改名、删除和分析完成后，侧栏及项目数据同步更新。表单草稿在同一浏览器会话内保留。

风险是未校准的模型估计，不代表已确认缺陷。分支分析用于风险度量与复盘；PR 的审查进度与结论在 PR 工作单和「我的审查」里。

## 页面

| 页面 | 地址 | 行为 |
|---|---|---|
| 项目 | `#/projects` | 项目总览、新建、重命名与删除 |
| 新建项目 | `#/projects/new` | 只登记仓库 |
| 项目详情 | `#/projects/{id}` | 分析选项、状态、当前结果与历史记录 |
| 提交与详情 | `#/projects/{id}/analyses/{syncId}/commits[/{commitId}]` | 始终绑定指定分析 |
| 旧计划地址 | 同一分析的 `/plan` | 兼容旧链接，显示同一份提交明细 |
| 管理模型 | `#/admin/models` | 登录后校验、登记本机真实模型产物 |
| 模型详情 | `#/admin/models/{modelId}` | 登录后核对训练指标、数据版本、运行谱系和限制 |
| 管理数据 | `#/admin/datasets` | 登录后核对数据、版本、来源与质量 |
| 数据详情 | `#/admin/datasets/{name}/{version}` | 登录后核对固定版本，并可选择方法创建训练任务 |
| 训练任务 | `#/admin/training[/{taskId}]` | 登录后查看活动/终态任务，取消、重试并核对成功指标 |
| 模型比较 | `#/admin/comparisons?models={id},{id}` | 登录后并列指标与口径，不自动选出最佳模型 |
| 实验登记 | `#/admin/experiment-runs[/{candidateId}]` | 登录后盘点实验、筛选兼容性并选择性登记；训练成功不自动上线 |
| 管理验证 | `#/admin/reports[/{runId}/{overview|trends|commits}]` | 登录后核对真实历史运行 |

旧项目/分析地址继续映射到原对象；旧报告地址进入管理员登录保护。已经退役的手工预测/演示页面明确提示。管理员接口在服务端鉴权，隐藏菜单不代替权限校验。

首次打开管理入口创建本机管理员，密码至少 12 位，没有默认密码。会话 8 小时到期，退出撤销；密码和会话不会写入 localStorage。忘记密码可在本机终端运行 `python -m jit_baseline.cli admin-reset-password --username 账户名`，按隐藏输入提示重置。

## 检查

```powershell
npm run typecheck
npm run check:modules
npm test -- --maxWorkers=1 --no-file-parallelism
npm run lint
npm run build
$env:JIT_FRONTEND_PORT='14373'
$env:JIT_SERVICE_PORT='18323'
npm run test:e2e
npm run test:e2e:admin-training
npm run test:e2e:experiments
```

默认浏览器验收使用独立库、9 个真实模型副本和两个本地 Git 夹具，检查 1280/1440 桌面及 390px 窄屏、登录/退出、指定模型的实际结果身份、异步分析、计划刷新及旧链接。大型仓库闭环使用独立 Playwright 配置和新的隔离后端，避免新项目、训练模型和任务污染默认套件；夹具以 300 个固定日期提交采集 `kamei14-git-v1` 数据集，实际完成现有模型、自动训练和强制训练，并从管理员页面创建训练任务、核对指标与谱系。测试不访问生产仓库或重训本机已登记模型。

Windows 临时目录受限时为 TEMP/TMP 指定独立可写目录。运行日志和截图位于忽略的 `.cache/`、`docs/evidence/_run/`，不自动冻结。当前验证范围见 [开发验证](../docs/开发验证.md)。
