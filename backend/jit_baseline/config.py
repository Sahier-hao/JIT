"""Frozen, label-independent protocol for the first baseline."""
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REVISION = "184403ad3734894c8417cbec72fdef3da5edc0b9"
BASE_URL = f"https://raw.githubusercontent.com/software-rebels/JITMovingTarget/{REVISION}/"
# 每个来源：相对 backend 的路径、锁定校验值，以及可选的数据集描述文件（相对 backend）。
# 描述文件存在时，运行声明记录它并按其声明校验；缺失时保留旧运行的常量校验路径。
SOURCES = {
    "openstack.csv": {"path": "data/openstack.csv",
                      "sha256": "2b1d2128bee82e905b0233d6646c3fa88eed033e440482e2f89272a3dd436505",
                      "datasetManifest": "data/datasets/openstack-six-v1/openstack-six-v1-2011-11-29_2014-02-28.json"},
    "load_data.r": {"path": "scripts/load_data.r",
                    "sha256": "4be31b4663f2dfc677594ca278abfcd814d42d04f09b06be1a5b031c1aace475"},
    "experimental_settings.r": {"path": "scripts/experimental_settings.r",
                                "sha256": "2d62ff540dc26ef05864d20862b2966e637eba34b9e66a09a06cdaa2837d3209"},
}
COHORT = {"startEpochInclusive": 1322599384, "endEpochExclusive": 1393590700,
          "addedLinesGreaterThan": 0, "maxChurnInclusive": 10000, "maxFilesInclusive": 100}
MODEL_CONFIG = {"regularization": "L2", "C": 1.0, "solver": "lbfgs", "max_iter": 1000,
                "tol": 1e-4, "class_weight": None, "seed": 2026, "threads": 1}
THRESHOLD = 0.5
LIMITATIONS = [
    "回顾性历史评价，未验证历史当时标签可获得性及在线预测效果。",
    "标签来自发布者历史观测；零或空计数表示未观测到缺陷引入，不是已证实无缺陷。",
    "未逐条复核 SZZ 修复链路，也未重新审计发布者全部特征提取实现。",
    "结果只覆盖固定纳入范围，排除了纯删除和极大变更，不能外推全仓库。",
    "一个固定基线不代表完整课程模型、解释和非功能验收已经完成。",
]
