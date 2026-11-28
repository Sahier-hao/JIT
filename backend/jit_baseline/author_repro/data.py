"""Verified readers for author-reproduction materials."""
from __future__ import annotations

import csv
import json
import pickle
import zipfile
from pathlib import Path

import pandas as pd

from ..config import BACKEND
from ..errors import BaselineError
from .catalog import backend_path, digest, material_entry, verify_material

JIT_DEFECT4J_SPLITS = ("train", "valid", "test")


def material_path(material_id: str) -> Path:
    return backend_path(material_entry(material_id)["path"])


def _safe_extract(archive: Path, target: Path) -> None:
    target = target.resolve()
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as handle:
        for info in handle.infolist():
            destination = (target / info.filename).resolve()
            if target not in destination.parents and destination != target:
                raise BaselineError("AUTHOR_MATERIAL_INVALID", "数据 ZIP 含越界路径")
        handle.extractall(target)


def prepare_jit_defect4j(*, force=False) -> Path:
    verification = verify_material("jit-fine-jit-defect4j")
    if not verification["available"]:
        raise BaselineError("AUTHOR_MATERIAL_MISSING", "缺少已校验的 JIT-Fine data.zip")
    material = material_entry("jit-fine-jit-defect4j")
    archive = backend_path(material["path"])
    target = backend_path(material["extractTo"])
    marker = target / ".ready.json"
    if force or not marker.is_file():
        _safe_extract(archive, target)
        marker.write_text(json.dumps({
            "schema": "author-extracted-data-v1",
            "archiveSha256": material["sha256"],
            "archive": str(archive),
        }, indent=2) + "\n", encoding="utf-8")
    else:
        actual = json.loads(marker.read_text(encoding="utf-8")).get("archiveSha256")
        if actual != material["sha256"]:
            raise BaselineError("AUTHOR_MATERIAL_HASH_MISMATCH", "JIT-Defect4J 解包标记哈希不一致")
    return target / "data" / "jitfine"


def deepjit_files(root: Path | None = None) -> dict:
    root = Path(root) if root is not None else backend_path(
        material_entry("deepjit-openstack-test")["path"]).parent
    paths = {
        "train": root / "openstack_train.pkl",
        "test": root / "openstack_test.pkl",
        "dict": root / "openstack_dict.pkl",
        "model": root / "openstack_model.pt",
    }
    missing = [str(path) for path in paths.values() if not path.is_file()]
    if missing:
        raise BaselineError("AUTHOR_MATERIAL_MISSING",
                            "缺少 DeepJIT 作者材料：" + "、".join(missing))
    return paths


def load_pickle(path: Path):
    try:
        with Path(path).open("rb") as handle:
            return pickle.load(handle)
    except Exception as exc:
        raise BaselineError("AUTHOR_DATA_INVALID", f"pickle 无法读取：{path}") from exc


def load_jit_defect4j_split(split: str) -> tuple[list, pd.DataFrame]:
    if split not in JIT_DEFECT4J_SPLITS:
        raise BaselineError("AUTHOR_DATA_INVALID", f"未知 JIT-Defect4J 分区：{split}")
    root = prepare_jit_defect4j()
    changes = load_pickle(root / f"changes_{split}.pkl")
    features = pd.read_pickle(root / f"features_{split}.pkl")
    if not isinstance(changes, (list, tuple)) or len(changes) != 4:
        raise BaselineError("AUTHOR_DATA_INVALID", f"{split} changes 不是作者四元组")
    if not isinstance(features, pd.DataFrame):
        raise BaselineError("AUTHOR_DATA_INVALID", f"{split} features 不是 DataFrame")
    ids = [str(value) for value in changes[0]]
    if len(ids) != len(changes[1]) or len(ids) != len(changes[2]) or len(ids) != len(changes[3]):
        raise BaselineError("AUTHOR_DATA_INVALID", f"{split} changes 四元组长度不一致")
    if features["commit_hash"].astype(str).duplicated().any():
        raise BaselineError("AUTHOR_DATA_INVALID", f"{split} features 含重复提交")
    return list(changes), features


def load_jitline_baseline_split(split: str) -> tuple[list, pd.DataFrame, dict]:
    if split not in ("train", "test"):
        raise BaselineError("AUTHOR_DATA_INVALID", "JITLine 基线只提供 train/test")
    root = prepare_jit_defect4j().parent / "jitline"
    changes = load_pickle(root / f"changes_{split}.pkl")
    features = pd.read_pickle(root / f"features_{split}.pkl")
    dictionary = load_pickle(root / "dataset_dict.pkl")
    if not isinstance(changes, (list, tuple)) or len(changes) != 4:
        raise BaselineError("AUTHOR_DATA_INVALID", f"JITLine {split} changes 不是作者四元组")
    if not isinstance(features, pd.DataFrame) or not isinstance(dictionary, (list, tuple)):
        raise BaselineError("AUTHOR_DATA_INVALID", "JITLine 特征或词典格式无效")
    return list(changes), features, {"dict": dictionary}


def jitfine_line_labels() -> pd.DataFrame:
    root = prepare_jit_defect4j()
    frame = pd.read_pickle(root / "changes_complete_buggy_line_level.pkl")
    required = {"commit_id", "idx", "changed_type", "label", "raw_changed_line", "changed_line"}
    if not required.issubset(frame.columns):
        raise BaselineError("AUTHOR_DATA_INVALID", "JIT-Fine 行标签缺少必需列")
    return frame


def jitsmart_line_labels(split: str) -> pd.DataFrame:
    if split not in JIT_DEFECT4J_SPLITS:
        raise BaselineError("AUTHOR_DATA_INVALID", f"未知 JIT-Smart 分区：{split}")
    root = material_path("jit-smart-line-labels")
    path = root / f"{split}_buggy_commit_lines_df.pkl"
    if not path.is_file():
        raise BaselineError("AUTHOR_MATERIAL_MISSING", f"缺少 JIT-Smart 行标签：{path}")
    frame = pd.read_pickle(path)
    required = {"project", "file", "change type", "commit hash", "idx", "code line", "label"}
    if not required.issubset(frame.columns):
        raise BaselineError("AUTHOR_DATA_INVALID", "JIT-Smart 行标签缺少必需列")
    return frame


def kamei_sources() -> list[dict]:
    result = []
    for member in material_entry("kamei-published-six")["members"]:
        path = BACKEND / "data" / "datasets" / member["path"]
        name = path.parent.name.split("-")[-1]
        result.append({"project": name, "path": path, "expectedSha256": member["sha256"]})
    return result


def read_kamei(path: Path) -> pd.DataFrame:
    try:
        frame = pd.read_csv(path)
    except Exception as exc:
        raise BaselineError("AUTHOR_DATA_INVALID", f"Kamei 数据不可读：{path}") from exc
    required = {"transactionid", "commitdate", "ns", "nm", "nf", "entropy", "la", "ld",
                "lt", "fix", "ndev", "pd", "npt", "exp", "rexp", "sexp", "bug"}
    if not required.issubset(frame.columns):
        raise BaselineError("AUTHOR_DATA_INVALID", f"Kamei 数据列不完整：{path.name}")
    return frame


def write_predictions_csv(path: Path, rows, fieldnames=None) -> None:
    rows = list(rows)
    if not rows:
        raise BaselineError("AUTHOR_OUTPUT_EMPTY", "预测为空，不能写成功产物")
    fieldnames = fieldnames or list(rows[0])
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
