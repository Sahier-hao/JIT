"""验证证据的运行工作区、归档与冻结约定。

见 `openspec/changes/separate-run-evidence-from-archive/design.md` 的 D1/D3：
运行期输出写入可覆盖、不提交的运行工作区；归档证据只由显式冻结产生，
冻结同时记录每个证据文件的相对路径与 SHA256、冻结时刻及来源运行标识。
测试与验证步骤不写任何已归档 change 的证据目录。
"""
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from .artifacts import write_json
from .data import sha256

BACKEND = Path(__file__).resolve().parents[1]
PROJECT = BACKEND.parent

EVIDENCE_ROOT = PROJECT / "docs" / "evidence"
"""归档证据与运行工作区的共同父目录。"""

RUN = EVIDENCE_ROOT / "_run"
"""运行工作区：测试与验证输出写这里，可被后续运行覆盖，不进入版本控制。"""

FIXTURES = "fixtures"
"""运行期夹具子目录名：跨测试或跨语言交接用，冻结时排除。"""

MANIFEST_NAME = "冻结清单.json"
"""冻结清单文件名；归档目录中存在该文件即表示已冻结。"""

FREEZE_KIND = "verification-evidence-freeze"
CHECK_KIND = "verification-evidence-check"


def run_dir() -> Path:
    """返回运行工作区，必要时创建。"""
    RUN.mkdir(parents=True, exist_ok=True)
    return RUN


def fixtures_dir() -> Path:
    """返回运行期夹具目录，必要时创建。"""
    target = RUN / FIXTURES
    target.mkdir(parents=True, exist_ok=True)
    return target


def _relative(path: Path) -> str:
    return path.relative_to(PROJECT).as_posix()


def _evidence_entries(target: Path) -> list[dict]:
    """登记目标目录中除清单自身以外的全部文件，按路径升序。"""
    entries = []
    for item in sorted(target.rglob("*")):
        if not item.is_file() or item.name == MANIFEST_NAME:
            continue
        entries.append({"path": item.relative_to(target).as_posix(),
                        "sha256": sha256(item.read_bytes())})
    return entries


def _run_identity(entries: list[dict]) -> str:
    """由证据集合内容派生来源运行标识；与既有运行身份一致，时间不影响身份。"""
    payload = json.dumps([{k: e[k] for k in ("path", "sha256")} for e in entries],
                         ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def freeze(target: Path, workspace: Path | None = None) -> dict:
    """把运行工作区中除运行期夹具外的证据冻结到 target。

    只新增或覆盖纳入的条目，不删除 target 中未纳入的文件；重复执行结果一致。
    """
    source = Path(workspace) if workspace else run_dir()
    target = Path(target)
    if not source.is_dir():
        raise FileNotFoundError(f"运行工作区不存在：{source}")
    target.mkdir(parents=True, exist_ok=True)
    copied = []
    for item in sorted(source.rglob("*")):
        if not item.is_file():
            continue
        relative = item.relative_to(source)
        if FIXTURES in relative.parts or relative.name == MANIFEST_NAME:
            continue
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, destination)
        copied.append(relative.as_posix())
    entries = _evidence_entries(target)
    manifest = {
        "kind": FREEZE_KIND,
        "frozenUtc": datetime.now(timezone.utc).isoformat(),
        "sourceRunId": _run_identity(entries),
        "workspace": _relative(source),
        "excluded": [f"{FIXTURES}/"],
        "copiedFromWorkspace": copied,
        "fileCount": len(entries),
        "files": entries,
    }
    write_json(target / MANIFEST_NAME, manifest)
    return manifest


def check(target: Path) -> dict:
    """按冻结清单校验目标目录，报告一致、被修改、缺失与未登记新增。"""
    target = Path(target)
    manifest_path = target / MANIFEST_NAME
    if not manifest_path.is_file():
        raise FileNotFoundError(f"缺少冻结清单：{manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    problems = []
    if not manifest.get("frozenUtc") or not manifest.get("sourceRunId"):
        problems.append({"path": MANIFEST_NAME, "kind": "incomplete-manifest"})
    listed = {entry["path"]: entry["sha256"] for entry in manifest.get("files", [])}
    for path, digest in sorted(listed.items()):
        item = target / path
        if not item.is_file():
            problems.append({"path": path, "kind": "missing"})
        elif sha256(item.read_bytes()) != digest:
            problems.append({"path": path, "kind": "modified"})
    for entry in _evidence_entries(target):
        if entry["path"] not in listed:
            problems.append({"path": entry["path"], "kind": "unlisted"})
    return {"kind": CHECK_KIND, "target": str(target), "frozenUtc": manifest.get("frozenUtc"),
            "sourceRunId": manifest.get("sourceRunId"), "listedCount": len(listed),
            "passed": not problems, "problems": problems}
