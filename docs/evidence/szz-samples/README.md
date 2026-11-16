# 跨仓库 SZZ 证据抽样

由 `jit_baseline.cli szz-sample` 从数据集描述的 `labelEvidence` 自动抽取，每个仓库 10 条，
共 40 条，覆盖 Python（flask、pydantic）与 JS/TS（axios、vite）。

字段：修复提交、候选引入提交、文件路径、引入行区间、父提交行区间、修复时间、修复信号
（`issueRef`/`keyword`）与 issue 编号。

这些抽样用于人工核对 SZZ 链是否成立：修复提交确实修改/删除了这些行，且被 blame 回到候选
引入提交。自动一致性检查不等于人工金标准；结论需由人填写，未复核前不改变任何标签。

复核命令（示例）：

```bash
cd backend
./.venv/Scripts/python.exe -m jit_baseline.cli szz-sample \
  data/datasets/kamei14-git-v2-flask-mature/kamei14-git-v2-flask-mature-2010-04-06_2026-07-30-742c2cc8.json \
  --repo .cache/repositories/bb69cc12b4b06266.git --limit 10 \
  --output ../docs/evidence/szz-samples/flask.csv
```
