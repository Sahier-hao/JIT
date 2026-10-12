# JIT 提交评审工作台 · 公开数据基线

本项目提供提交列表、详情和个人优先审查清单。默认读取 OpenStack 固定公开快照上的真实模型历史测试批次；也可明确选择人工演示。真实模式使用六项发布者字段的固定逻辑回归，标题与预测解释未提供，风险不表示已确认缺陷。当前是回顾性评价，不宣称真实在线效果或完整课程交付。

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

## 两种模式操作

默认“真实历史回放”，显示测试提交、固定模型和运行标识；左侧“历史数据／示例数据”始终可切换，错误不会自动回退。真实服务不可用时核验产物并重启后端，再点“重新加载”。`/?mode=demo` 是明确选择演示的入口，刷新保留该模式。

真实数据下可以展开“基线记录”，查看三个来源文件地址与校验值、六字段、纳入规则、时间分区、完整测试指标和局限。指标不随筛选变化，未定义项显示原因；人工示例模式不显示真实效果。完整标识在详情与按钮名称保留，表格缩略标识可悬停核对。

以下步骤适用于两模式；示例名称和时间来自人工演示：

1. 打开工作台，确认顶部“演示模式”、项目和 `demo-v1` 标识。
2. 搜索 `demo-0001`，或填写 `YYYY-MM-DD` 起止日期；日期按 Asia/Shanghai 解释且包含当天。无效范围会保留最近有效结果，可用“清除筛选”恢复。
3. 点击提交标识打开右侧详情，查看变更概览和人工示例解释。
4. 从列表或详情加入清单，进入左侧“优先审查清单”检查加入顺序；重复加入不会产生第二条记录。
5. 从清单打开同一条详情，或移除记录；关闭详情保留搜索、日期和排序。
6. 使用 Tab 定位提交、Enter 打开；Tab 到“提交详情内容”区域后，用方向键、PageDown或End滚动阅读，再Tab到加入按钮并Enter加入。Escape关闭并返回原触发位置。页面允许纵向滚动，两个验收尺寸无需页面横向滚动。

演示内容定义见 [DEMO-DATA.md](public/DEMO-DATA.md)，审查流程见 [主规格](../openspec/specs/commit-risk-review/spec.md)，公开基线约定见 [基线主规格](../openspec/specs/public-data-baseline/spec.md)，本轮真实增量见 [归档 change 规格](../openspec/changes/archive/2026-10-11-connect-public-data-baseline-review/specs/commit-risk-review/spec.md)，验收记录见 [acceptance.md](../docs/evidence/connect-public-data-baseline-review/acceptance.md)。界面采用浅色开发工具风格，使用本机无衬线字体回退（中文雅黑、英文 Bahnschrift、标识 Consolas/Cascadia）和自行绘制的SVG图标，不打包或请求外部字体与图标资产。列表与详情内容可分别滚动；详情的关闭与加入按钮保持可操作。

## 清单保存边界

清单只在同一浏览器、同一应用地址（origin）和同一数据上下文内恢复。人工演示沿用v1项目／版本键；真实使用historical／项目／datasetVersion／runId的独立v2键。相同提交在不同运行不会继承选择，返回原运行可恢复，按加入顺序保存提交标识。清理浏览器数据、隐私模式、换浏览器或换地址可能无法恢复；不提供账号、多标签页实时或跨设备同步。清单表示个人审查计划，不是缺陷标签或评审通过结论。

无法保存时当前操作仍然生效，页面提示“本次清单未能保存，刷新后可能丢失”。无法读取或内容损坏时显示恢复失败，可以继续选择。恢复时去重并排除当前数据中不存在的提交，不清理其他应用或版本的存储。

## 一次复验

结束本项目正在运行的 dev/preview，再执行 `pwsh -File ./scripts/verify.ps1`。脚本先执行后端检查、实际 TCP 恢复检查、固定产物核验与复现比较，再执行前端干净安装、类型检查、行为测试、lint、构建、两个视口的浏览器检查和 OpenSpec 主规格严格校验，遇到失败立即退出。后端产物需事先按固定命令生成；浏览器检查自行启动需要的本机服务，成功链路实际请求真实模型。原始输出、命令退出码、版本与源码校验和保存在运行工作区 `docs/evidence/_run/`；测试自行启动并结束本地服务器。
