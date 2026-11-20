# JIT 缺陷预测 · 提交评审

面向评审员的本机课程项目：登记公开仓库、发起分支分析、查看提交风险与模型解释，并在项目内审查 PR、跟进个人工作单。管理员在独立工作区维护模型、数据集、训练任务与验证记录。

模型分数是未经当前仓库概率校准的估计，不等于已确认缺陷；分支分析用于风险分布与复盘，不承担 PR 合并决定。

## 当前默认口径

- 默认入口：`#/`（产品介绍页）；登录页 `#/login?role=user|admin`。
- 默认采集：`kamei14-git-v2`（14 维提交级特征，历史只沿第一父链）与 `szz-full-v1`（issue/PR 优先、关键词兜底的行级 SZZ）。
- 标签成熟：新训练与正式评价默认只用达到成熟期且证据未截断的提交；未成熟、观察未知或证据截断不进入完整可信评价，但仍可被兼容模型评分。
- 数据库迁移：第 41 版（`041_dataset_sharing.sql` 增加管理员显式共享表）。
- 默认模型：由管理员人工批准；训练成功或登记成功不等于发布合格，系统不按测试指标自动替换默认模型。

## 本地启动

```bash
cd backend
./.venv/Scripts/python.exe -m jit_baseline.cli catalog-init
./.venv/Scripts/python.exe -m jit_baseline.cli serve --port 8000
```

```bash
cd frontend
npm ci
npm run dev
```

前端 `127.0.0.1:4173`，API `127.0.0.1:8000`。首次进入管理工作区建立管理员账户；没有默认密码。

## 文档导航

- [项目代码导读](docs/项目代码导读.md) · [项目文件索引](docs/项目文件索引.md)
- [当前产品与开发入口](docs/当前产品.md)
- [入口与端点分层清单](docs/架构/入口与端点分层清单.md)
- [运维与升级](docs/运维与升级.md)
- [数据与训练切分](docs/数据与训练切分.md)
- [模型包部署](docs/模型包部署.md)
- [持续回归](docs/持续回归.md)
- [文档目录索引](docs/README.md)
- [项目交付约定](AGENTS.md)
- [前端运行与操作](frontend/README.md)、[后端安装与命令](backend/README.md)
- [四阶段架构收敛台账](docs/计划/2026-11-19-四阶段架构收敛台账.md)

## 验证

```bash
python backend/scripts/regression_scope.py --layer key
```

```bash
cd frontend
npm run typecheck && npm run lint && npm run check:styles && npm run check:modules
npm test && npm run build
```

完整后端、前端、扩展与浏览器旅程见[持续回归](docs/持续回归.md)。测试使用隔离目录库、临时模型副本和独立端口，不写入开发目录。
