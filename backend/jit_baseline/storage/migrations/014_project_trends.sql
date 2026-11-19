-- 固定趋势只保存查询、来源清单和内容指纹，不复制评分或标签。
CREATE TABLE project_trend_view(
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
    signature TEXT NOT NULL UNIQUE,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX project_trend_view_repository ON project_trend_view(repository_id, created_at DESC);
