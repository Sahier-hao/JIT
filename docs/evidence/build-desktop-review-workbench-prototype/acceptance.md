# 桌面评审原型验收证据

Change：`build-desktop-review-workbench-prototype`。本报告只覆盖演示原型，不能作为真实模型、正式实验或课程整体交付的证明。

**视觉返工已实施并复验：** 2026-10-10 用户认为首版界面不好看，并确认采用浅色开发工具风格。原版测试及代表性截图保存在 `iterations/initial/`；当前机器结果和截图对应返工后的源码。新版视觉满意度仍待用户实际评审。

## 实施中的记录

- 2026-10-10：`npm ci --registry=https://registry.npmjs.org/ --fetch-retries=0 --fetch-timeout=30000`、初始 typecheck 和 build 退出0，确认运行基础。
- 2026-10-10：先运行数据查询测试，26个预期断言失败；实现后29个通过。
- 2026-10-10：先运行加载与界面测试，10个测试失败；实现并修正测试等待时序后39个通过。报告见 [unit-results.json](unit-results.json)。
- npm 在沙箱内连接本机代理出现 EACCES，改在主用户环境执行授权安装；没有修改全局 npm 配置。曾将测试和干净安装同时启动，导致测试读取到正在重建的依赖目录；已改为安装结束后顺序执行验证，该失败不作为产品缺陷或通过证据。

## 逐步验证记录

本节保留分阶段检查的实际结果；机器报告文件在最终复验时更新，完整计数与场景映射以“最终综合验收”为准。

数据与查询行为（CRR-01至CRR-06、CRR-11）已由 `frontend/src/domain.test.ts` 验证；异步加载与重试由 `useDataset.test.tsx` 验证；详情、唯一清单和上下文由 `App.test.tsx` 验证。

2026-10-10：`npm run typecheck` 退出0；`npm run test:e2e` 退出0，16个 Chromium 用例通过，分别在1280×720、1440×900覆盖完整链路、查询、键盘及加载异常。实际查看两个尺寸的详情，以及清单和加载错误截图，未发现操作遮挡或页面横向溢出。记录位于 [browser-results.json](browser-results.json)，截图在 [screenshots](screenshots/)。加载故障注入按阶段响应，兼容 React StrictMode 的重复读取，而非依赖“第一次请求”计数。

2026-10-10：清单功能的测试先出现14个预期失败；实现后 `npm test` 退出0，53个行为用例通过。`npm run typecheck` 退出0，`npm run test:e2e` 退出0，30个 Chromium 用例通过，包含刷新与再次打开、版本隔离、损坏内容、不支持格式、未知标识和读写拒绝。CRR-09、CRR-10 的浏览器证据在 `e2e/storage.spec.ts`；保存失败截图为 `screenshots/desktop-1280-save-error.png` 和 `screenshots/desktop-1440-save-error.png`。

## 视觉返工记录

- 用户确认浅色开发工具方向后，先更新design并重新打开布局、证据和综合验收5项任务，再修改界面；核心行为规格仍为12项要求、25个场景。
- 新版采用深色固定导航、白色内容区、无衬线标题、13至14px的提交内容、统一SVG图标与按钮。列表和详情内容分别滚动，详情操作位于内容区外。
- 第一次视觉复验中53个行为测试通过、28个浏览器测试通过、2个键盘测试失败，记录见 `iterations/visual-keyboard-failure/`。在实际浏览器复现Tab停在未命名的详情滚动区，补充区域名称、明确停靠点与可见焦点；新增断言先失败，修正后两个尺寸均通过滚动阅读、加入和返回验证。
- 实际截图检查进一步修正了侧栏滚动位置、窄桌面详情高度和风险条宽度。截图采集前恢复页面顶部，避免全页截图将固定导航的视口位置误呈为顶部空白。
- 首版视觉评审未获认可属于已发生的用户反馈；新版的功能回归通过并不代表用户已认可新版视觉。
- 最终构建预览中按README另行复走 `demo-0001` 搜索、打开详情、加入清单、进入清单、移除、返回并清除筛选：实际界面依次显示1条匹配、1条清单、空清单及恢复12条提交。此项为开发侧浏览器检查，未冒充用户评审。

## 最终综合验收

返工后的开发侧场景自检通过，新版用户视觉评审及课堂验收尚未进行。最终复验时间为 **2026-10-10 20:54:16至20:55:39（Asia/Shanghai）**；机器记录使用UTC。完整输出见 [verification.log](verification.log)，退出码、依赖和源码SHA-256见 [verification.json](verification.json)。后续源码变化需要重新复验，不能复用这份结果宣称新版本通过。

| 检查 | 实际命令（在 frontend 中，OpenSpec 从根目录运行） | 退出码与结果 |
| --- | --- | --- |
| 干净安装 | `npm ci --registry=https://registry.npmjs.org/ --fetch-retries=0 --fetch-timeout=30000` | 0；lockfile安装成功 |
| 类型 | `npm run typecheck` | 0；应用、配置和浏览器测试均纳入检查 |
| 行为测试 | `npm test` | 0；53/53通过，0失败 |
| 静态构建 | `npm run build` | 0；静态产物生成 |
| Chromium | `npm run test:e2e` | 0；30/30通过，0跳过、0意外失败、0重试通过 |
| 规格结构 | `openspec validate build-desktop-review-workbench-prototype --strict --no-interactive` | 0；仅证明change结构有效 |

复验通过 [verify.ps1](../../../frontend/scripts/verify.ps1) 顺序执行，安装完成后才开始读取依赖的测试。Node.js **24.13.0**、npm **11.6.2**；React/React DOM **19.3.0**、TypeScript **6.0.3**、Vite **8.3.4**、Vitest **5.0.3**、Playwright **1.64.0**，Chromium **156.0.8078.4**。其他依赖及完整lockfile由机器记录提供；此次未修改全局npm配置。

演示版本为 **demo-v1**，12条人工固定记录，来源说明见 [DEMO-DATA.md](../../../frontend/public/DEMO-DATA.md)。机器记录包含31个前端源文件/配置/文档校验和。Git工作区尚无项目提交，新增源码与证据为未跟踪文件；`.agents/`、`.claude/`、`.dsh/` 等原有目录保留。没有生成或声称PR非作者评审、用户调研、真实实验或教师验收记录。

## 25个场景与证据映射

场景名称来自 [归档增量规格](../../../openspec/changes/archive/2026-10-10-build-desktop-review-workbench-prototype/specs/commit-risk-review/spec.md)，当前行为契约见 [主规格](../../../openspec/specs/commit-risk-review/spec.md)。下表的S编号仅用于定位该要求内的场景，行为要求仍以规格为准。所有引用用例均包含在最终成功的机器报告中。

| 要求 / 场景 | 实际验证证据 | 开发侧结果 |
| --- | --- | --- |
| CRR-01-S1 查看演示工作台 | `workbench.spec.ts`“桌面完整评审链路”；列表、详情和清单截图的项目、版本与演示说明 | 通过 |
| CRR-01-S2 来源信息不完整 | `domain.test.ts`“拒绝缺少来源”；`useDataset.test.tsx`“必需来源缺失”；浏览器“缺少来源不显示猜测记录” | 通过 |
| CRR-02-S1 展示可用提交 | `App.test.tsx`“明示来源与边界”；浏览器完整链路12条记录及同一标识详情 | 通过 |
| CRR-02-S2 变更信息缺失 | `domain.test.ts`缺失可选度量；`App.test.tsx`列表“未提供”；截图demo-0011与demo-0012 | 通过 |
| CRR-03-S1 合法风险值包含边界 | `domain.test.ts` 0/1/区间值；浏览器完整链路0%与100%，详情同值 | 通过 |
| CRR-03-S2 缺失或无效风险值 | `domain.test.ts` null/undefined/NaN/Infinity/越界/非数值；浏览器缺失、越界文字及详情 | 通过 |
| CRR-04-S1 搜索并清空 | `domain.test.ts`空白大小写与清空；浏览器“查询、日期、排序与详情上下文” | 通过 |
| CRR-04-S2 没有匹配项 | `App.test.tsx`及浏览器无结果、清除筛选入口，恢复12条提交 | 通过 |
| CRR-05-S1 日期边界与搜索组合 | `domain.test.ts`上海日界线、双侧包含、单侧与组合；浏览器同日和搜索组合 | 通过 |
| CRR-05-S2 日期范围无效 | `domain.test.ts`倒置、非法日、非法文本；浏览器保留最近有效的两条结果并提示 | 通过 |
| CRR-06-S1 风险同分及暂无预测 | `domain.test.ts`风险同分/时间/标识/无效排序；浏览器验证demo-0001/0002与暂无预测最后 | 通过 |
| CRR-06-S2 切换排序 | `domain.test.ts`原记录不改写；浏览器在详情打开时切换排序，详情仍为demo-0010 | 通过 |
| CRR-07-S1 打开并返回 | `App.test.tsx`查询保留；浏览器详情关闭保留时间排序，清单打开正确标识 | 通过 |
| CRR-07-S2 提交或解释不可用 | `App.test.tsx`真实详情组件的不存在标识/返回入口；demo-0010缺失解释与度量“未提供” | 通过 |
| CRR-08-S1 完成优先审查选择 | `App.test.tsx`与浏览器完整链路：列表一条、详情另一条、清单按加入顺序 | 通过 |
| CRR-08-S2 重复加入与移除 | 同一完整链路的禁用加入、数量、跨视图恢复及原风险仍86%；查询不改写记录测试 | 通过 |
| CRR-08-S3 清单为空 | 同一完整链路移除最后一条、空状态与返回选择入口 | 通过 |
| CRR-09-S1 刷新后恢复 | `shortlist.test.ts`顺序与仅标识保存；浏览器刷新、同地址新页面及详情加入状态 | 通过 |
| CRR-09-S2 版本或保存内容不匹配 | `shortlist.test.ts`项目/版本隔离、坏JSON/格式/未知/去重；浏览器切换版本及3种恢复异常 | 通过 |
| CRR-10-S1 保存被拒绝 | `shortlist.test.ts`精确警告；`App.test.tsx`与浏览器内存加入/移除及刷新丢失行为 | 通过 |
| CRR-10-S2 恢复不可用 | `shortlist.test.ts`存储访问及读取抛错；浏览器空清单、列表详情继续使用 | 通过 |
| CRR-11-S1 数据加载成功或为空 | `useDataset.test.tsx`待决读取/成功/空；浏览器门控加载和正常重试后再读空集合 | 通过 |
| CRR-11-S2 加载失败并重试 | 浏览器503后重试恢复12条；重复标识与无效时间拒绝；hook来源错误与重试清除旧错误 | 通过 |
| CRR-12-S1 桌面核心链路 | 1280×720、1440×900完整链路；页面横向溢出断言；实际查看列表、详情、清单与异常截图 | 通过 |
| CRR-12-S2 键盘操作与焦点返回 | 两个尺寸仅键盘完整操作；Tab到具名详情区、End滚动阅读、再Tab加入，Escape返回；焦点与outline断言及截图 | 通过 |

测试源码：[domain.test.ts](../../../frontend/src/domain.test.ts)、[useDataset.test.tsx](../../../frontend/src/useDataset.test.tsx)、[App.test.tsx](../../../frontend/src/App.test.tsx)、[shortlist.test.ts](../../../frontend/src/shortlist.test.ts)、[workbench.spec.ts](../../../frontend/e2e/workbench.spec.ts)、[storage.spec.ts](../../../frontend/e2e/storage.spec.ts)。

## 可视与质量检查

两个尺寸各有 workbench、detail、shortlist、keyboard-focus、load-error、save-error 六张截图，共12张。实际查看两个尺寸的详情，以及清单、加载错误、保存失败和键盘焦点，未发现关键操作被遮挡或页面横向滚动；页面可纵向滚动。示例性质贯穿三种视图，分数与状态均有文字，清单保存失败的警告不依赖颜色。

- 易用性：仅键盘完成核心动作、滚动阅读并返回触发位置；两个桌面尺寸的实际运行与可视检查通过。新版字号、导航和表格层次按用户选定方向调整，视觉满意度留待用户判断。
- 恢复可靠性：异常读取后重试恢复、存储故障保留本次操作、不匹配内容不当成当前记录；自动化故障注入通过。

这些是原型范围内的质量证据，没有扩大为正式系统的性能、跨浏览器、移动端或最终课程非功能验收。

截图示例：[桌面详情](screenshots/desktop-1280-detail.png)、[审查清单](screenshots/desktop-1440-shortlist.png)、[保存失败](screenshots/desktop-1280-save-error.png)、[键盘焦点](screenshots/desktop-1440-keyboard-focus.png)。

## 限制与后续

- 本轮没有已知未通过的必需行为场景；首版用户视觉评审未获认可，新版视觉评审与课堂验收尚未发生，不能预填满意或完成。
- 全部内容为人工演示；尚未接入公开数据集、真实训练、预测解释或正式评价指标。因此这是可演示的完整前端交互增量，不是课程完整真实数据MVP。
- 只验证Chromium与两个桌面尺寸；本地保存受浏览器数据清理、地址与版本影响，不提供账号或跨设备同步。
- 测试日志中的NO_COLOR/FORCE_COLOR提示来自运行环境，不是应用异常；最终浏览器链路无pageerror，所有检查退出0。
- 用户于2026-10-10明确指示归档，change已完成主规格同步并归档；新版视觉评审及课堂验收仍待进行，归档不将这些事项改写为已验收。

## 归档记录

2026-10-10使用 `openspec-archive-change`，schema为 `spec-driven`。CLI核验18/18项任务及全部规划产物完成。通过 `openspec-sync-specs` 内联同步新能力 `commit-risk-review`：保留原Purpose正文、12项要求和25个场景，严格校验通过。随后执行 `openspec archive build-desktop-review-workbench-prototype --skip-specs --yes --json`；`--skip-specs` 仅避免CLI重复处理已核验的同步，未跳过主规格同步或结构验证。

归档位于 [2026-10-10-build-desktop-review-workbench-prototype](../../../openspec/changes/archive/2026-10-10-build-desktop-review-workbench-prototype/)。归档前后5个规划文件（含 `.openspec.yaml`）的SHA-256一致，活动change目录已移除。

归档前核对最终功能复验的31个文件校验和，均与 `verification.json` 一致。归档过程只更新前端README的规格链接和复验说明，以及 `verify.ps1` 中的OpenSpec命令；应用源码、演示数据、配置、依赖和测试源码未改动。新的 `openspec validate --specs --strict --no-interactive` 命令可在归档后运行，已从PowerShell语法树提取并实际执行校验。此次没有重跑前端测试、重新生成截图或覆盖原功能复验报告；归档校验与这两处变更的校验和另记于 [archive-verification.json](archive-verification.json)。原来的53/53行为测试、30/30浏览器测试属于上文明确时间的开发侧结果。
