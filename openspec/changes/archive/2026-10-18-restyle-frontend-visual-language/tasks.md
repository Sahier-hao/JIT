# Tasks

## 1. 令牌与基础排版层

- [x] 1.1 新建 `frontend/src/styles/`，拆出 `tokens.css`（语义变量：表面 4、文字 4、线 3、语义色 4、风险 5、阴影 2、字体 3、圆角 2）与 `base.css`（重置、字号阶梯 12/13/15/20/26/28、行高、`tabular-nums`）；验证：`npm run build` 通过，且 `grep -o "#[0-9a-fA-F]\{6\}" frontend/src/styles/base.css` 无输出（基础层不含具体色值）
- [x] 1.2 定义四套主题块 `html[data-theme="concrete|steel|charcoal|paper"]`；验证：写一个 vitest 用例读取每个主题下的令牌，断言 26 个键齐全且风险阶色相互不相同（防止漏项）
- [x] 1.3 把 `App.css` 中硬编码色值逐条替换为令牌引用，删除重复定义（`.primary-button`、`.sr-only`、`.nav-label` 各两处）；验证：`grep -c "#[0-9a-fA-F]\{6\}" frontend/src/App.css` 输出 0，且 `npm test` 通过
- [x] 1.4 落地字体栈（`'Segoe UI Variable Text' → 'Segoe UI' → 'Microsoft YaHei UI'`，等宽 `'Cascadia Mono' → 'Consolas'`），强调统一用 700、正文 400，移除全部 500/600 合成字重；验证：`grep -rn "font-weight: 500\|font-weight: 600" frontend/src/styles frontend/src/App.css` 无输出
- [x] 1.5 增加对比度回归用例：用 jsdom 或浏览器读取代表性文字的 computed color 与背景，断言 ≥ 4.5:1（至少 8 处：页脚、表尾、表单帮助、图表刻度、元信息、风险值、账本标签、禁用语）；验证：`npx vitest run src/contrast.test.ts` 通过，并在改动前的旧样式上运行确认该用例会失败（证明用例有效）

## 2. 图标与材料

- [x] 2.1 重写 `Icon.tsx`：`viewBox="0 0 20 20"`、`stroke-width="1.5"`、`stroke-linecap="square"`、矩形圆角 2；保留既有键名（`logo`/`list`/`shortlist`/`project`/`search`/`arrow`/`chevron`/`check`/`plus`/`close`/`info`/`trend`）；验证：`npm run typecheck` 通过，且 `Icon.test.tsx` 断言每个图标都带上述四个属性
- [x] 2.2 新增图标（`sliders`、`copy`、`external`、`warning`、`collapse`、`filter`、`sort`、`download`）；验证：在 16px 下逐一截图核对网格与描边一致，`npm test` 通过
- [x] 2.3 用令牌实现"材料"组件样式：色块状态标签（6px 方点 + 文字）、账本式指标条（1px 分隔）、抽屉、面板、按钮三档；验证：`npm run build` 通过，且 `grep -n "border-radius: 999px" frontend/src/styles/*.css` 无输出（不再使用胶囊）
- [x] 2.4 标识与头像改为字标 + 细线（去掉彩色方块与填充头像），删除装饰性渐变与投影（仅保留设置面板背板模糊与抽屉一层阴影）；验证：目视核对四个主题，且 `grep -n "linear-gradient|box-shadow" frontend/src/styles/*.css` 的结果仅出现在允许的两处

## 3. 应用外壳与偏好

- [x] 3.1 侧栏改为 52px 图标轨 + 188px 上下文栏，上下文栏可收起（`data-sidebar`），团队凭据输入保留在侧栏；验证：`navigation.test.tsx` 与 `credentials.test.tsx` 通过，键盘可依次到达全部导航项
- [x] 3.2 新增设置面板（role="dialog"、Esc 关闭、scrim 点击关闭、焦点返回），承载主题与密度选择；验证：新增 `settings.test.tsx` 断言打开/关闭/Esc/焦点返回，`npm test` 通过
- [x] 3.3 偏好持久化：`jit.theme`、`jit.density` 写入 `localStorage`，`<head>` 内联脚本先写属性再渲染；验证：浏览器刷新后主题与密度保持，且首帧无浅色闪白（录屏或 `page.screenshot` 对比首帧）
- [x] 3.4 存储不可用时回落默认值；验证：`settings.test.tsx` 中 mock `localStorage` 抛错，断言页面仍渲染且导航/列表可用（对应 IP-05 场景）
- [x] 3.5 动效与减少动态：面板过渡 160–220ms，`prefers-reduced-motion` 下全部禁用；验证：`npm test` 通过，并在 DevTools 中模拟该偏好确认无位移动画（对应 IP-07）
- [x] 3.6 交互反馈按规范落地：hover 只改背景与颜色不改尺寸、按下 1px 下移或 0.96 缩放、过渡 120–220ms 统一缓动、选中项 3px 左锚点条、焦点环 2px + 2px 偏移；验证：逐项在两个主题下核对，且 hover 前后行高与列宽不变（`getBoundingClientRect` 断言）

## 4. 提交工作台（第一批页面）

- [x] 4.1 页头改为"元信息行 + 标题 + 2px 粗线"，模式、项目、数据版本仍在页头持续可见（保 `CRR-01`）；验证：`workbench.spec.ts` 中断言模式/项目/版本可见的用例通过
- [x] 4.2 表格重做：行高 71→40、表头 43→31、数字右对齐等宽、风险值一位小数（边界保持 0%/100%，CRR-03）、hover 才显示行内操作；验证：1440×900 ≥ 10 行、1280×720 ≥ 5 行（保留提示条与基线记录后实测为 12/7 演示、9/5 历史），`workbench.spec.ts` 通过
- [x] 4.3 同步更新精确文本断言：`'100%'`→`'100.0%'`、`'86%'`→`'80.0%'` 等；验证：`npm run test:e2e` 全部通过，且失败信息中不含样式相关错误
- [x] 4.4 详情抽屉与清单页套用新材料，分层披露落位（结论常驻、口径一层、来源折叠）；验证：`historical.test.tsx`、`workbench.spec.ts` 通过，键盘可展开"来源与局限"（对应 IP-03）
- [x] 4.5 删除四套横幅实现，合并为单一横幅组件（tone: info/warn/danger/success）；验证：`grep -c "demo-notice\|status-note\|\.notice\b" frontend/src/styles/components.css` 只剩一处定义，`npm test` 通过
- [x] 4.6 风险编码强化：等宽两位小数 + 4px 条 + 60% 刻度 + 分档色（`<60%` 一档、`≥60%` 一档），低风险不使用绿色；验证：`workbench.spec.ts` 断言分档样式随数值切换，`npm test` 通过（对应 `IP-06`/`CRR-03`）
- [x] 4.7 去掉嵌套滚动：工作台改为单视口（页面不滚、仅表格区滚），删除独立顶栏并把信息并入页头；验证：1280×720 与 1440×900 下 `document.documentElement.scrollHeight <= innerHeight`，表格区自有滚动条（对应 `D12`）

## 5. 其余四个页面（第二批）

- [x] 5.1 历史趋势：图表改制图语言（轴外刻度、单向网格、斜线纹理表示"不参与估计"、方块标记），文本视图保持键盘可达；验证：`trends.spec.ts`、`TrendPage.test.tsx` 通过，两个视口无横向滚动（对应 IP-08 与 `DTD-05`/`DTD-06`）
- [x] 5.2 模型中心：卡片列表改表格 + 抽屉，`已登记 · 可用` 状态用色块 + 文字；验证：`ModelsPage.test.tsx` 与 `acceptance.spec.ts` 中 `.model-card`/`.state-badge` 相关断言通过（类名保留）
- [x] 5.3 新建预测：两栏（左表单 / 右实时摘要），字段标签与帮助文字套用新排版，`aria-invalid` 态可见；验证：`PredictPage.test.tsx`、`predictForm.test.ts` 通过
- [x] 5.4 结果页：顶部风险横幅（大号等宽数字 + 区间 + 免责），下方左身份 / 右来源；验证：`PredictionsPage.test.tsx` 与 `acceptance.spec.ts` 中 `.result-section`/`.risk-number` 断言通过
- [x] 5.5 三态（加载/空/错误）统一为骨架 + 单一提示组件，替换旧居中空状态；验证：`useDataset.test.tsx` 与 `accessibility.spec.ts` 中错误/空态用例通过
- [x] 5.6 趋势图双序列分离：提交数柱与比例/风险线拆成上下两张共享 x 轴的图，柱有自己的纵轴刻度，分区带横跨两图；验证：`TrendPage.test.tsx` 断言存在两个绘图区且柱轴刻度可见，1280×720 下仍无横向滚动
- [x] 5.7 分桶明细去重：去掉与提交数重复的分区计数、逐行重复的"未提供"原因（收敛为一条脚注）、把 ISO 时间串改为可读的起止格式；验证：`trends.spec.ts` 断言每行只出现一次计数、未提供原因只出现一次、时间列不折行

## 6. 集成与文档

- [x] 6.1 跨页视口与键盘回归：两个视口逐页截图，确认无横向滚动、焦点可见、Escape 关闭详情并返回触发点；验证：`npm run test:e2e` 与 `npm run test:e2e:acceptance` 通过（对应 IP-08、`CRR-12`、`MPW-11`）
- [x] 6.2 更新 `frontend/README.md` 的界面说明段（现写"浅色开发工具风格"），补充四套主题、设置面板位置、密度开关与字体栈约束；验证：按文档描述逐条核对实际界面一致
- [x] 6.3 在 `docs/evidence/` 下记录本次视觉验证证据（两视口截图、对比度检查结果、可见行数实测）；验证：证据文件存在且内容与当前构建产物一致
- [x] 6.4 嵌套滚动与等宽使用边界回归：确认只有趋势页允许页面级滚动；确认日期、标签与中文均未使用等宽（避免斜杠零把 `2011-11` 读成 `2811-11`）；验证：`grep -rn "var(--mono)" frontend/src/styles` 仅命中标识、KPI 与刻度选择器，两个视口下逐页滚动检查（对应 `D13`）

## Workflow follow-up

- 两批分别合入后运行项目验证链 `pwsh -File ./scripts/verify.ps1`，确认既有证据链仍然成立。
- 归档本变更后，确认 `openspec/specs/interface-presentation/spec.md` 已由增量合并为主规格。
