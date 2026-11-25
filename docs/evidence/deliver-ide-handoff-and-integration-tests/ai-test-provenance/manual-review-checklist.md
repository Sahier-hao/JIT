# 人工复核清单

复核对象：change `deliver-ide-handoff-and-integration-tests` 的 15 个 AI 辅助测试与 10 个只读 GET 的“不适用”场景格。

## A. AI 辅助测试（15 项）

| # | 测试 | 文件 | 核心断言 |
|---:|---|---|---|
| 1 | `test_real_inventory_has_95_business_operations_and_four_admin_auth` | `backend/tests/test_openapi_operation_inventory.py` | 99 个操作、95 项业务、4 个 admin 认证排除，字段与 key 唯一性完整 |
| 2 | `test_high_risk_domains_are_present_and_classified_high` | 同上 | 七个高风险域均存在且风险级别为 high |
| 3 | `test_drift_detection_reports_renamed_and_missing_operations` | 同上 | operationId 改名和操作缺失被漂移检查报告 |
| 4 | `test_valid_matrix_passes` | `backend/tests/test_integration_test_matrix.py` | 完整矩阵通过校验 |
| 5 | `test_missing_cell_fails` | 同上 | 缺少任一场景格校验失败 |
| 6 | `test_high_risk_not_applicable_fails` | 同上 | 高风险接口不得标为不适用 |
| 7 | `test_normal_not_applicable_fails` | 同上 | 正常与异常场景不得标为不适用 |
| 8 | `test_stale_test_node_fails` | 同上 | 引用不存在的测试节点校验失败 |
| 9 | `test_failed_status_fails` | 同上 | 失败状态不计为通过 |
| 10 | `test_pending_human_review_fails` | 同上 | 待复核的不适用格校验失败 |
| 11 | `test_real_sample_report_and_read_only_workflow_pass` | `backend/tests/test_commit_analysis_handoff.py` | 真实样例报告与只读工作流通过交接校验 |
| 12 | `test_report_without_limitations_or_identity_fails` | 同上 | 缺少限制或内容哈希的报告校验失败 |
| 13 | `test_workflow_with_write_permission_or_comment_fails` | 同上 | CI 写权限或 PR 评论被拒绝 |
| 14 | `test_upload_must_fail_when_report_missing` | 同上 | 报告缺失时产物上传必须失败 |
| 15 | `real repository identity handles match, dirty, branch switch, stale, rename and delete` | `vscode-extension/test/real-repository.test.js` | 真实 Git 仓库中的匹配、脏工作树、分支切换、过期、重命名和删除状态正确 |

复核结论请确认：以上测试的断言确实覆盖对应行为，没有放宽既有风险、身份或安全边界。

## B. 只读 GET 的不适用格（10 个操作 × 边界/并发）

以下操作均为只读 GET，边界由 OpenAPI 输入/响应契约校验；没有共享可变写入，因此并发/故障标为不适用。

1. `GET /api/v1/commits`
2. `GET /api/v1/commits/{commitId}`
3. `GET /api/v1/project-events`
4. `GET /api/v1/repositories`
5. `GET /api/v1/repositories/{repositoryId}`
6. `GET /api/v1/repositories/{repositoryId}/commits`
7. `GET /api/v1/repositories/{repositoryId}/commits/{commitId}`
8. `GET /api/v1/repositories/{repositoryId}/events`
9. `GET /api/v1/repositories/{repositoryId}/overview`
10. `GET /api/v1/repositories/{repositoryId}/summary`

复核结论请确认：这些操作没有有意义的并发/边界可测场景，接受“不适用”理由。

## 复核记录格式

确认后记录：审核人、日期、逐项结论。未确认前 `provenance.review.status` 保持 `pending`，矩阵与冻结证据不会标记为通过。
