# 数据集描述文件

本目录存放**已登记**的数据集描述文件，是数据集的事实来源。目录结构固定为：

```
data/datasets/<数据集>/
  <数据集>-<起始日>_<结束日>.json
```

例如 `openstack-six-v1/openstack-six-v1-2011-11-29_2014-02-28.json`。版本名必须与描述文件
内的时间范围一致，登记命令会校验这一点。

## 生成

```powershell
# 在 backend 目录执行；默认登记 openstack.csv、六字段 schema
python -m jit_baseline.cli register-dataset

# 指定原始文件、数据集名或 schema
python -m jit_baseline.cli register-dataset --csv data/openstack/openstack.csv --dataset openstack-six-v1 --schema openstack-six-v1
```

登记时从真实 CSV 重算并写入：原始文件 SHA-256 与字节数、字段定义（取自 `schemas.py` 的具名
schema，不复制字段表）、质量统计（复用 `data.parse_source` 的纳入规则）、时间范围与样本摘录。
同内容重复登记幂等；同一版本内容不同以 `DATASET_EXISTS` 拒绝覆盖，必须换版本名。

## 校验与使用

- 服务启动时加载本目录；目录不存在、没有任何描述文件或校验失败即**拒绝启动**，不退回内置常量。
- 运行 `cli run` 时，若 `config.SOURCES` 为该来源声明了 `datasetManifest`，则按描述文件校验
  SHA-256、纳入规则与质量统计，并沿用描述文件的版本名。
- `cli import-dataset --manifest <路径>` 按描述文件重算质量统计后单事务导入目录库；统计不一致、
  文件校验不符或字段与 schema 不一致都会拒绝。

## 提交规则

描述文件**必须随仓库提交**（`.gitignore` 的 `backend/data/*` 排除原始 CSV，但不排除
`backend/data/datasets/`）。原始 CSV 体积大且可重新取得，不提交；描述文件很小，是跨机器复现
与评审的登记事实，必须提交。
