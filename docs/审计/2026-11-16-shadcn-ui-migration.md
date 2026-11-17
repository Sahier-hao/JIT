# shadcn/ui 前端迁移审计

日期：2026-11-16

对应 OpenSpec change：`standardize-frontend-on-shadcn-ui`

## 实施范围

- 在 `frontend/components.json` 登记官方 shadcn/ui 配置：`new-york`、Radix、Tailwind v4 的 `src/index.css`、Lucide 图标和 `@/components/ui`、`@/lib/utils`、`@/hooks` 别名。
- 接入阶段使用 `shadcn@4.23.0` 官方 CLI/registry 生成组件；配置文件的 schema 来源为 `https://ui.shadcn.com/schema.json`。
- `frontend/src/components/ui/` 现有 26 个标准组件文件，覆盖按钮、输入、标签、选择、表格、卡片、Tabs、ToggleGroup、Popover、Dialog、AlertDialog、Sheet、Sidebar、状态反馈和加载骨架等页面实际使用范围。
- 将品牌标志、密码输入、代码差异和 ECharts 画布放入 `frontend/src/components/shared/`。ECharts 和 `react-diff-view` 保留为第三方展示能力，不作为基础控件替代品。
- 用户登录、项目、分析、PR 预览和工作单、个人数据/训练/模型、管理员模型/数据集/训练/实验/报告页面均已改用标准组合 API。
- 删除旧的 `frontend/src/ui/` 基础控件层及其测试、旧图标入口；样式来源守卫仍保留对旧路径回流的检查。
- 保留四套主题、两档密度、风险色语义、账户隔离、浏览器草稿存储、固定分析结果和 PR 快照行为。Dialog、Sheet、AlertDialog 的受控使用接入了弹层关闭后的焦点恢复。

## 验证结果

以下命令均在当前工作树执行，结果由退出码和命令输出确认：

| 检查 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过，退出码 0 |
| `npm.cmd run check:styles` | 通过，4 个样式表、3 个入口导入、0 个待迁移 Mantine 引用 |
| `npm.cmd test -- --maxWorkers=1 --no-file-parallelism` | 60 个测试文件、436 个测试全部通过，退出码 0 |
| `npm.cmd run lint` | 通过，退出码 0；有现存 React effect、fast-refresh、ref 和冗余布尔转换等 warning |
| `npm.cmd run build` | 通过，退出码 0 |
| `npm.cmd exec -- playwright test --config=playwright.shadcn.config.ts` | 2 个测试全部通过：双账户 PR 续审隔离；四主题、390px 窄屏、分析草稿、用户工作区、PR 预览和管理员工作区 |

迁移过程中发现 `ProjectPage.test.tsx` 仍按旧数据集弹层的 `alertdialog` 角色查找；数据集详情已经按语义迁移为标准 `Dialog`，因此同步修正测试为 `dialog`，该文件随后 20/20 通过。

浏览器验收使用 `playwright.shadcn.config.ts` 的独立后端端口 18860、前端端口 18861，以及测试脚本创建的临时数据库、仓库、数据集和模型副本。受限执行环境第一次启动夹具时因 Windows hard link 返回 `WinError 5`，后端无法发布临时 CSV；在提升权限仅用于该次隔离测试后，同一套浏览器旅程通过。该环境故障没有改变产品代码或测试数据。

## 已知 warning 与边界

- 生产构建报告 ECharts 相关 chunk 大于 500 kB。
- 生产构建报告 `ProjectActivity.tsx` 同时被静态和动态导入，动态导入不会形成独立 chunk。
- lint warning 主要来自现有页面的 effect 状态同步、Fast Refresh 同文件导出、渲染期 ref 读取、`no-extra-boolean-cast` 和 `no-constant-binary-expression`；本次未扩大到与 shadcn 接入无关的行为重构。
- 本轮重复执行 `npx shadcn@4.23.0 info` 时，npm registry 代理连接返回 `EACCES 127.0.0.1:7897`；官方 CLI 版本、组件来源和配置已在接入阶段记录，当前源码与 `components.json`、类型检查、样式守卫和构建结果一致。
- 本 change 未修改后端 API、数据库、认证协议、模型产物或已保存业务数据。

