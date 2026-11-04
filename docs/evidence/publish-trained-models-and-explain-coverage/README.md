# 模型发布与训练覆盖验证

本目录记录 `publish-trained-models-and-explain-coverage` 的可复核结果。模型 ZIP、SQLite 和运行期夹具不进入本目录或 Git。

## 证据

- `model-package-manifest.json`：从本机九模型发布 ZIP 中提取的版本化包清单，含模型 ID、运行身份、数据集、schema、依赖和逐文件 SHA-256。
- `jit-nine-models.zip.sha256`：实际发布包校验值；包文件位于被忽略的运行目录，不提交。
- `model-package-import-results.json`：隔离空目录导入九模型包后的完整结果，以及“一个成功、一个位置冲突、一个文件损坏”的混合包逐项结果。
- `frontend-unit-results.json`：前端 45 个测试文件、344 项测试全部通过。
- `default-browser-results.json`：默认 Playwright 16 项通过。
- `model-package-browser-results.json`：专用模型包空环境恢复闭环。
- `admin-training-browser-results.json`：大型公开仓库选择现成模型、自动训练和强制训练闭环。
- `experiment-browser-results.json`：实验运行显式登记闭环。
- `preview-browser-results.json`：专用预览下的项目工作台、多项目报告和模型收益闭环。
- `screenshots/`：模型包恢复页在 1280、1440、390 像素下的实际截图。

浏览器专用闭环只在一个桌面项目执行以保持共享目录库串行；跳过的项目不是通过结果。

## 复现

后端和前端命令及结果见 `verification.md`。证据最后由 `freeze-evidence` 生成 `冻结清单.json`，不得手工修改清单或哈希。
