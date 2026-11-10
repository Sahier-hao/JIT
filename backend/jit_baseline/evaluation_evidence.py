"""只读评价证据：评价矩阵、完整候选集与行级定位报告。

证据文件来自固定目录，按内容哈希标识；不训练、不改写、不接受浏览器路径。
报告引用的数据版本与当前登记不一致时标为陈旧，不静默展示旧结论。
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .config import BACKEND
from .data import BaselineError
from . import datasets

REPO = BACKEND.parent
DEFAULT_ROOTS = (
    BACKEND / "artifacts/evaluation-evidence",
    REPO / "docs/evidence/evaluation-matrix",
    REPO / "docs/evidence/line-candidates",
)
MATRIX_FORMAT = "evaluation-matrix-v1"
LINE_FORMAT = "line-candidate-evaluation-v1"
CANDIDATE_SUMMARY_FORMAT = "line-candidates-v1"
MAX_BYTES = 32 * 1024 * 1024


def _digest(blob):
    return hashlib.sha256(blob).hexdigest()


def _matrix_summary(report):
    return {
        "datasets": len(report.get("datasets") or []),
        "withinRepoCells": len(report.get("withinRepo") or []),
        "leaveOneRepoOutCells": len(report.get("leaveOneRepoOut") or []),
        "baselines": len(report.get("baselines") or []),
        "failures": len(report.get("failures") or []),
        "protocolSha256": report.get("protocolSha256"),
        "languages": sorted({item.get("language") for item in report.get("datasets") or []
                             if item.get("language")}),
    }


def _line_summary(report):
    repos = report.get("repos") or []
    return {
        "repos": len(repos),
        "candidates": sum(int(item.get("candidates") or 0) for item in repos),
        "positives": sum(int(item.get("positives") or 0) for item in repos),
        "scorers": sorted({name for item in repos for name in (item.get("scorers") or {})}),
    }


def _candidate_summary(summary):
    return {
        "repo": summary.get("repo"), "candidates": summary.get("candidates"),
        "positives": summary.get("positives"), "uncoverable": summary.get("uncoverable"),
        "uncoverableReasons": summary.get("uncoverableReasons"),
        "exclusions": summary.get("exclusions"),
    }


def _kind(report):
    fmt = report.get("format")
    if fmt == MATRIX_FORMAT:
        return "evaluation-matrix", _matrix_summary(report)
    if fmt == LINE_FORMAT:
        return "line-candidate-evaluation", _line_summary(report)
    if fmt == CANDIDATE_SUMMARY_FORMAT:
        return "line-candidates", _candidate_summary(report)
    return None, None


def _dataset_index(registry_root=None):
    try:
        registered = datasets.load_all(registry_root)
    except BaselineError:
        return {}
    index = {}
    for version, manifest in registered.items():
        path = Path(manifest["manifestPath"])
        path = path if path.is_absolute() else BACKEND / path
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            continue
        index[version] = {"manifestSha256": digest,
                          "csvSha256": (manifest.get("file") or {}).get("sha256")}
    return index


def _staleness(report, registry):
    """评价矩阵引用的数据集版本必须仍以相同内容登记。"""
    if report.get("format") != MATRIX_FORMAT:
        return None
    problems = []
    for item in (report.get("protocol") or {}).get("datasets") or []:
        current = registry.get(item.get("version"))
        if current is None:
            problems.append(f"{item.get('version')} 未登记")
        elif (item.get("manifestSha256") and current.get("manifestSha256")
              and item["manifestSha256"] != current["manifestSha256"]):
            problems.append(f"{item.get('version')} 描述文件已变化")
        elif item.get("csvSha256") and current.get("csvSha256") != item["csvSha256"]:
            problems.append(f"{item.get('version')} CSV 已变化")
    return "; ".join(problems) if problems else None


class EvaluationEvidence:
    """固定目录中的只读证据；每次读取都核对内容哈希与数据版本。"""

    def __init__(self, roots=None, *, registry_root=None):
        self.roots = [Path(root) for root in (roots if roots is not None else DEFAULT_ROOTS)]
        self.registry_root = registry_root

    def _files(self):
        seen = {}
        for root in self.roots:
            try:
                resolved = root.resolve()
            except OSError:
                continue
            if not resolved.is_dir():
                continue
            for path in sorted(resolved.glob("*.json")):
                try:
                    if not path.is_file() or path.stat().st_size > MAX_BYTES:
                        continue
                    blob = path.read_bytes()
                except OSError:
                    continue
                seen.setdefault(_digest(blob), (path, root, blob))
        return seen

    def list(self):
        registry = _dataset_index(self.registry_root)
        entries = []
        for digest, (path, root, blob) in self._files().items():
            try:
                report = json.loads(blob.decode("utf-8"))
            except (UnicodeError, ValueError):
                entries.append({"evidenceId": digest[:24], "kind": "invalid",
                                "status": "invalid", "source": self._display(path, root),
                                "sha256": digest, "summary": None,
                                "reason": "不是有效的 UTF-8 JSON"})
                continue
            kind, summary = _kind(report if isinstance(report, dict) else {})
            if kind is None:
                continue
            stale = _staleness(report, registry)
            entries.append({
                "evidenceId": digest[:24], "kind": kind,
                "status": "stale" if stale else "available",
                "reason": stale, "source": self._display(path, root),
                "sha256": digest, "generatedUtc": report.get("generatedUtc"),
                "summary": summary,
            })
        entries.sort(key=lambda item: (item.get("generatedUtc") or "", item["evidenceId"]), reverse=True)
        return {"evidence": entries, "total": len(entries)}

    def get(self, evidence_id):
        if not isinstance(evidence_id, str) or len(evidence_id) < 8:
            raise BaselineError("INPUT_INVALID", "证据标识无效")
        for digest, (path, root, blob) in self._files().items():
            if not digest.startswith(evidence_id):
                continue
            try:
                report = json.loads(blob.decode("utf-8"))
            except (UnicodeError, ValueError) as exc:
                raise BaselineError("EVIDENCE_INVALID", "证据不是有效的 UTF-8 JSON") from exc
            kind, summary = _kind(report if isinstance(report, dict) else {})
            if kind is None:
                raise BaselineError("EVIDENCE_INVALID", "证据格式不受支持")
            stale = _staleness(report, _dataset_index(self.registry_root))
            return {"evidenceId": digest[:24], "kind": kind, "sha256": digest,
                    "status": "stale" if stale else "available", "reason": stale,
                    "source": self._display(path, root), "summary": summary,
                    "report": report}
        raise BaselineError("EVIDENCE_UNKNOWN", "证据不存在")

    @staticmethod
    def _display(path, root):
        try:
            return path.resolve().relative_to(root.resolve()).as_posix()
        except (OSError, ValueError):
            return path.name
