# Tasks

## 1. 测试计划文档

- [x] 1.1 编写 `docs/测试计划.md`：按单元（backend pytest、frontend Vitest）／集成（`verify.ps1`、API 契约）／系统（Playwright e2e）／非功能四层写明覆盖目标与执行命令，含缺陷记录规范（现象、复现条件、优先级、处理状态、关联提交）与 Sprint 3（11/16 起）执行安排：完整 NFR-01 协议重测（在线预测接口落地后）、NFR-03 真实用户走查（本 change 待补项）、可靠性作为可选第三项的既有证据沉淀、缺陷记录与测试报告结构约定；验证：文档中列出的每个测试资产文件名与命令在仓库中真实存在且可运行（抽查 `pytest --collect-only` 与 `npm test` 通过）。
- [x] 1.2 在 `docs/测试计划.md` 写入易用性/无障碍检查清单：由 CRR-12 与产品文档 NFR-03 逐条推导，每条含判据、方法与证据形式（两视口无横向溢出、纯键盘链路、焦点返回触发位置、状态不只靠颜色区分等）；并写明性能基线测量方法（样本数、P95 口径、环境记录）；验证：清单条目与主规格场景一一对应，测量方法与 design.md D3 一致且命令可直接执行。

## 2. 易用性/无障碍实测

- [x] 2.1 新增 `frontend/e2e/accessibility.spec.ts`：按 1.2 清单逐项断言（横向溢出、键盘链路、焦点返回、文字化状态等），只新增文件、不修改现有 spec；利用现有 `desktop-1280`／`desktop-1440` 两个 project 自动覆盖两视口；验证：`npx playwright test accessibility --project=desktop-1280 --project=desktop-1440` 全部通过。
- [x] 2.2 运行走查并采集证据：两视口截图、`browser-results.json` 与逐项通过/失败记录写入运行工作区 `docs/evidence/_run/`，不写任何已归档目录；验证：证据文件存在且包含两个视口的截图与逐项结论，`docs/evidence` 下已归档 change 目录的 git 状态无改动。

## 3. 性能基线实测

- [x] 3.1 新增 `backend/scripts/perf_baseline.py`：用已锁定 httpx 对本机 `GET /api/review-batch` 发 30 次顺序请求，逐次计时并计算 nearest-rank P95，记录 Python/CPU/RAM 环境与错误数，原始逐次计时写入 `docs/evidence/_run/`；验证：后端服务运行中脚本执行成功，输出含 30 条逐次计时与 P95。
- [x] 3.2 新增前端首屏测量脚本（`frontend/scripts/` 下）：Playwright 对两视口各跑 10 次，记录导航时间戳与 fetch→解析→渲染完成标记，计算 P95，原始数据写入 `docs/evidence/_run/`；验证：脚本执行产出 2×10 条记录且无失败样本。
- [x] 3.3 编写性能基线报告 `docs/evidence/_run/` 中的 `nfr-performance.md` 草稿：样本数、P95 计算方法（nearest-rank）、环境版本、错误数，并显式标注"本机链路基线，未做阈值判定，NFR-01 完整协议待在线预测后重测"；验证：报告数字与原始数据一致，标注齐全。

## 4. 冻结与集成检查

- [x] 4.1 用 `python -m jit_baseline.cli freeze-evidence` 把选定运行产物（易用性逐项结论记录与两视口截图、性能报告与原始数据摘要）冻结到 `docs/evidence/establish-test-plan-and-nfr-evidence/` 并生成完整性清单；另写一份 `nfr-checklist-mapping.json` 把检查清单条目映射到证据文件（沿用既有 change 先例；`verification.json` 名已被 verify.ps1 的运行摘要占用，映射文件改为此名），随后 `check-evidence` 校验；验证：清单覆盖全部证据文件且校验通过，`nfr-checklist-mapping.json` 的每条引用都能定位到实际文件。
- [x] 4.2 运行 `frontend/scripts/verify.ps1` 全链路：确认后端检查、前端干净安装/类型检查/测试/lint/构建/两视口浏览器检查与 OpenSpec 严格校验整链通过，受保护位置比对通过；验证：脚本退出码 0，运行工作区含本次校验记录。
- [x] 4.3 核对 `git status`：新增文件仅限 `docs/测试计划.md`、两个测量脚本、`accessibility.spec.ts` 与 `docs/evidence/establish-test-plan-and-nfr-evidence/`（另含已获确认的 `frontend/playwright.config.ts` Edge channel 改动，见 design D2；会话开始前就存在的技能文件改动与本 change 无关），`docs/evidence/_run/` 未入库，无任何已归档证据目录改动；验证：git status 输出与上述清单一致。

## Workflow follow-up

- 任务全部完成并核对证据后，按项目评审要求归档本 change（归档前确认每项勾选都有对应证据，冻结清单与规格校验通过）。
