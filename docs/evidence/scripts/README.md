# 隔离验证脚本

这些脚本驱动一个独立后端（默认 `http://127.0.0.1:18830`）与独立目录（默认 `D:/tmp/w8`），
不触碰开发库或其他会话正在使用的服务。

- `w8_journey.py`：管理员建户 → 项目 → 分析（真实采集+训练+评分）→ 口径、分区守恒、趋势 → 取消。
- `w8_accounts.py`：用户 A 派生数据对 B 不可见、管理员可见；退出后会话失效。
- `w8_inject.py`：损坏模型产物后模型卡不可用、显式选择该模型的分析被拒绝。
- `w8_browser.js`：Playwright 真实浏览器登录、打开项目并截图（需隔离前端端口 18831）。

运行前先启动隔离服务：

```bash
cd backend
JIT_CATALOG_DATABASE=D:/tmp/w8/catalog.sqlite3 \
JIT_ARTIFACT_ROOT=D:/tmp/w8/artifacts \
JIT_DATASET_ROOT=D:/code/jit-defect-prediction/backend/data/datasets \
./.venv/Scripts/python.exe -m jit_baseline.cli serve --port 18830
```

脚本中的账户与密码仅用于本机隔离验证。
