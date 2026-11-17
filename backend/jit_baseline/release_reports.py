"""Read-only lookup of frozen release qualification reports by model run."""
import hashlib
import json
import os
from pathlib import Path

from .config import BACKEND
from .errors import BaselineError
from .release_qualification import (
    APPROVAL_FILE,
    POLICY_ID,
    REPORT_FILE,
    REPORT_KIND,
    REPORT_VERSION,
    release_identity_payload,
)

REPO_ROOT = BACKEND.parent
DEFAULT_LIMIT = 16 * 1024 * 1024


def default_roots():
    configured = os.environ.get("JIT_RELEASE_REPORT_ROOT")
    if configured:
        return [Path(item) for item in configured.split(os.pathsep) if item.strip()]
    roots = [BACKEND / "artifacts"]
    evidence = REPO_ROOT / "docs/evidence"
    if evidence.is_dir():
        roots.append(evidence)
    return roots


def _display_path(path, root):
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return f"{root.name}/{path.resolve().relative_to(root.resolve()).as_posix()}"


def validate_report(report):
    if not isinstance(report, dict):
        raise BaselineError("REPORT_INVALID", "发布报告根节点必须是对象")
    if report.get("kind") != REPORT_KIND or report.get("reportVersion") != REPORT_VERSION:
        raise BaselineError("REPORT_INVALID", "发布报告类型或版本不受支持")
    if not isinstance(report.get("reportId"), str) or len(report["reportId"]) != 64:
        raise BaselineError("REPORT_INVALID", "发布报告标识无效")
    artifact = report.get("artifact")
    if (not isinstance(artifact, dict)
            or not isinstance(artifact.get("runId"), str)
            or not isinstance(artifact.get("modelSha256"), str)):
        raise BaselineError("REPORT_INVALID", "发布报告缺少模型运行或产物身份")
    policy = report.get("assessment", {}).get("policy")
    if not isinstance(policy, dict) or policy.get("id") != POLICY_ID:
        raise BaselineError("REPORT_INVALID", "发布策略不受支持")
    if report.get("status") not in ("qualified", "unqualified"):
        raise BaselineError("REPORT_INVALID", "发布报告结论无效")
    if not isinstance(report.get("projects"), list) or not isinstance(report.get("assessment"), dict):
        raise BaselineError("REPORT_INVALID", "发布报告缺少项目或门槛结果")
    expected_id = hashlib.sha256(json.dumps(
        release_identity_payload(artifact, report["projects"], policy),
        ensure_ascii=False,
        sort_keys=True,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
    if report["reportId"] != expected_id:
        raise BaselineError("REPORT_INVALID", "发布报告身份与其数据、切分或策略不一致")
    return report


class ReleaseReportService:
    def __init__(self, roots=None, *, limit=DEFAULT_LIMIT):
        self.roots = [Path(root) for root in (roots if roots is not None else default_roots())]
        self.limit = limit

    def _files(self):
        found = {}
        for root in self.roots:
            try:
                resolved = root.resolve()
            except OSError:
                continue
            if not resolved.is_dir():
                continue
            for path in sorted(resolved.glob(f"**/{REPORT_FILE}")):
                try:
                    if not path.is_file() or path.stat().st_size > self.limit:
                        continue
                    real = path.resolve()
                    if not real.is_relative_to(resolved):
                        continue
                    blob = real.read_bytes()
                except OSError:
                    continue
                identity = hashlib.sha256(blob).hexdigest()[:24]
                found.setdefault(identity, (real, root, blob))
        return found

    def _load(self, identity, path, root, blob):
        entry = {"sourceId": identity, "source": _display_path(path, root)}
        try:
            report = validate_report(json.loads(blob.decode("utf-8")))
        except (UnicodeError, ValueError) as exc:
            raise BaselineError("REPORT_INVALID", f"发布报告不是有效的 UTF-8 JSON：{exc}") from exc
        if report["reportId"] != report["reportId"].lower():
            raise BaselineError("REPORT_INVALID", "发布报告标识必须为小写十六进制")
        approval_path = path.with_name(APPROVAL_FILE)
        if approval_path.is_file():
            try:
                approval = json.loads(approval_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, ValueError) as exc:
                raise BaselineError("REPORT_INVALID", f"默认候选批准记录无效：{exc}") from exc
            if (not isinstance(approval, dict)
                    or approval.get("releaseReportId") != report["reportId"]
                    or approval.get("artifactRunId") != report["artifact"]["runId"]
                    or approval.get("modelSha256") != report["artifact"]["modelSha256"]
                    or not isinstance(approval.get("modelId"), str)
                    or not isinstance(approval.get("approvedBy"), str)
                    or not isinstance(approval.get("approvedAt"), str)):
                raise BaselineError("REPORT_INVALID", "默认候选批准记录与发布报告不一致")
            report = dict(report, approvedDefault=approval)
        return {
            **entry,
            "reportId": report["reportId"],
            "report": report,
        }

    def for_run(self, run_id, *, model_sha256=None, schema=None):
        candidates, invalid = [], None
        for identity, (path, root, blob) in self._files().items():
            try:
                entry = self._load(identity, path, root, blob)
            except BaselineError as exc:
                try:
                    raw = json.loads(blob.decode("utf-8"))
                except (UnicodeError, ValueError):
                    continue
                if (isinstance(raw, dict)
                        and isinstance(raw.get("artifact"), dict)
                        and raw["artifact"].get("runId") == run_id):
                    invalid = {"code": exc.code, "message": str(exc)}
                continue
            artifact = entry["report"]["artifact"]
            if artifact["runId"] != run_id:
                continue
            if model_sha256 is not None and artifact["modelSha256"] != model_sha256:
                continue
            if schema is not None and artifact.get("schema") != schema:
                continue
            candidates.append(entry)
        if candidates:
            candidates.sort(
                key=lambda item: (item["report"].get("generatedUtc") or "", item["reportId"]),
                reverse=True,
            )
            return candidates[0], None
        return None, invalid
