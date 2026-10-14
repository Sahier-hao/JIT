# NFR 性能基线报告（草稿）

> 测量日期：2026-10-13（UTC 13:03–13:20）｜所属 change：`establish-test-plan-and-nfr-evidence`
> **本机链路基线，未做阈值判定。** NFR-01 完整协议（每种模型 ≥200 次单条 JSON 预测、4 个 LAN 客户端加载 1,853 条列表、P95≤2s／列表≤3s 阈值判定、冷启动/排队单列）待在线预测接口落地后重测。

## 环境

| 项 | 值 |
|---|---|
| 操作系统 | Windows 11 10.0.26200 |
| CPU | Intel64 Family 6 Model 186 Stepping 2，16 核 |
| 内存总量 | 16,674,390,016 字节（≈15.5 GiB） |
| Python | 3.14.6（backend/.venv，依赖见 requirements.txt） |
| 浏览器 | Edge channel（msedge，chromium 内核）——官方 chromium 下载在当前网络不可用，config 与记录中已声明 |
| 服务 | 后端 127.0.0.1:8000（每次 GET 实际执行 1,853 条推理）；前端 dev 127.0.0.1:4173 |

## PERF-1 本机推理服务响应

方法：httpx 对 `GET /api/review-batch` 发 30 次顺序请求，逐次计时，nearest-rank P95。

| 指标 | 值 |
|---|---|
| 样本数 | 30（有效 30） |
| 错误数 | 0 |
| P95 | **0.0685 s** |
| 均值 | 0.0528 s |

原始逐次计时：`perf-backend-batch.json`（同目录）。

## PERF-2 前端首屏加载

方法：Playwright（Edge channel）对两视口各 10 次，记录批次接口响应（fetch）与列表渲染完成（1,853 行），nearest-rank P95。

| 视口 | 有效样本 | fetch P95 | 渲染完成 P95 |
|---|---|---|---|
| 1280×720 | 10 | 0.775 s | 2.356 s |
| 1440×900 | 10 | 0.280 s | 1.226 s |

原始逐次数据：`perf-frontend-first-screen.json`（同目录）。渲染完成指 1,853 条提交行全部渲染。

## 说明与限制

- 以上数字是单机单客户端、dev 服务下的本机链路基线；不构成 NFR-01 阈值的判定。
- 两视口 fetch P95 差异明显（775ms vs 280ms），可能与首样本冷启动及本机并发负载有关，原始数据保留；Sprint 3 重测时加大样本并单列冷启动。
- 后端每次 GET 都实际执行推理，P95 68.5ms 是该完整链路的响应基线。
