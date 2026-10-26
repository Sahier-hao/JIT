# Tasks

## 1. 后端

- [x] 1.1 `SyncService.select_view`：校验项目/归属/完成状态，调用 `repository_refresh`；核对所选记录、计数及 `latestSyncId` 不变。
- [x] 1.2 `PATCH /api/v1/repositories/{id}` 按 `viewSyncId` 分流；核对切换响应及原重命名行为。
- [x] 1.3 测试：切换成功、失败 409、跨项目 404、空值 422、未知项目 404

## 2. 前端数据层

- [x] 2.1 `selectRepositoryView(repositoryId, syncId)` 与请求层测试

## 3. 项目页与列表页

- [x] 3.1 记录行「设为当前结果」，成功后刷新详情与记录；核对请求身份、结果计数和记录选中状态。
- [x] 3.2 项目列表卡片「管理」菜单：重命名、带确认的删除；核对确认、取消及成功后的列表更新。
- [x] 3.3 项目页移除重命名/删除，增加返回项目列表链接；核对控件位置和返回地址。
- [x] 3.4 审查页增加返回项目链接；核对返回该分析所属项目。
- [x] 3.5 分析选项常显并补充默认值说明；核对字段可见、默认值与提交参数一致。

## 4. 验证

- [x] 4.1 `pytest backend/tests/test_repository_management.py -q` 13 passed
- [x] 4.2 `npm run typecheck` / `npm test`（227 用例）/ `npm run lint`
- [x] 4.3 真实后端验证 `PATCH {viewSyncId}` 生效且 `latestSyncId` 不变
- [x] 4.4 截图核对卡片菜单、重命名、切换当前结果与移动端

## Workflow follow-up

- 同步规格并归档；核对归档目录与主规格。
