# JIT Review 前端

普通用户围绕项目完成分支分析和 PR 审查；管理员在独立工作区登录后维护模型、数据和历史验证。当前产品与运行约定见 [当前产品](../docs/当前产品.md)。

## 技术栈

- React 19 + TypeScript + Vite。
- 路由：React Router 7 的 `createHashRouter`；地址继续使用 `#/projects/...`，旧链接由 `navigation.ts` 的解析器映射。
- 样式：Tailwind CSS 4（只取 theme/utilities，不启用 preflight）+ `styles/tokens.css` 的设计令牌。`index.css` 的 `@theme inline` 把令牌映射为 Tailwind 语义色，四套主题由 `html[data-theme]` 切换。
- 组件：Mantine 8（`@mantine/core`）。`src/ui/` 是适配层，把项目既有 API 映射到 Mantine 的 Button、TextInput、Select、Checkbox、Switch、Modal、Drawer、SegmentedControl、Menu、Tooltip、Alert 等组件；颜色、圆角与字体通过 `lib/mantineTheme.ts` 和 `styles/mantine-bridge.css` 指回设计令牌，四套主题继续生效。
- 图标：`Icon.tsx` 的自绘 SVG 与 lucide-react。
- 代码对比：react-diff-view + refractor；图表为手写 SVG。
- 测试：Vitest + Testing Library（组件）与 Playwright（浏览器验收）。

## 运行

首次安装执行 `npm ci`。后端先备份并运行 `catalog-init` 升级目录库，再分别启动：

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
2. 进入项目，展开分析选项，选择分支、日期、上限以及真实可用模型或自动策略。
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
| 管理数据 | `#/admin/datasets` | 登录后核对数据和版本 |
| 管理验证 | `#/admin/reports[/{runId}/{overview|trends|commits}]` | 登录后核对真实历史运行 |

旧项目/分析地址继续映射到原对象；旧报告地址进入管理员登录保护。已经退役的手工预测/演示页面明确提示。管理员接口在服务端鉴权，隐藏菜单不代替权限校验。

首次打开管理入口创建本机管理员，密码至少 12 位，没有默认密码。会话 8 小时到期，退出撤销；密码和会话不会写入 localStorage。忘记密码可在本机终端运行 `python -m jit_baseline.cli admin-reset-password --username 账户名`，按隐藏输入提示重置。

## 检查

```powershell
npm run typecheck
npm test -- --maxWorkers=1 --no-file-parallelism
npm run lint
npm run build
$env:JIT_FRONTEND_PORT='14373'
$env:JIT_SERVICE_PORT='18323'
npm run test:e2e
```

浏览器验收使用独立库、两种真实模型的副本和本地 Git 夹具，检查两个桌面尺寸及 390px 窄屏、登录/退出、指定模型的实际结果身份、异步分析、计划刷新及旧链接。测试不访问生产仓库或重训本机模型。

Windows 临时目录受限时为 TEMP/TMP 指定独立可写目录。运行日志和截图位于忽略的 `.cache/`、`docs/evidence/_run/`，不自动冻结。当前验证范围见 [开发验证](../docs/开发验证.md)。
