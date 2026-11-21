"""导入发布者提供的 Kamei 2013 项目数据。"""
import io
import json
import os
import re
import stat
import tempfile
import zipfile
import zlib
from pathlib import Path, PurePosixPath

from .. import datasets
from ..config import USER_DATASET_LIMIT
from ..data import BaselineError, sha256
from ..schemas import KAMEI_2013_SCHEMA

MAX_UPLOAD_BYTES = 64 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 128
MAX_BATCH_ROWS = 300_000
CITATION = "Kamei et al. (2013), A Large-Scale Empirical Study of Just-in-Time Quality Assurance"


class PublishedImportError(BaselineError):
    def __init__(self, message):
        super().__init__("DATASET_IMPORT_INVALID", message)
        self.details = [{"field": "数据文件", "reason": message}]


def _project(filename):
    project = PurePosixPath(filename).stem.lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,39}", project):
        raise PublishedImportError("项目文件名须由字母、数字、连字符或下划线组成")
    return project


def archive_projects(blob, report=None):
    """只读取 CSV 成员，限制实际解压量，并且不解压到磁盘。"""
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_ARCHIVE_ENTRIES:
                raise BaselineError("DATASET_IMPORT_TOO_LARGE", "ZIP 中的文件和目录过多")
            members = {}
            for info in infos:
                name = info.orig_filename
                parts = name.rstrip("/").split("/")
                if (any(part in ("", ".", "..") for part in parts)
                        or any(char in name for char in ("\\", ":", "\0"))
                        or stat.S_ISLNK(info.external_attr >> 16)):
                    raise PublishedImportError("ZIP 包含无效路径或链接")
                if info.is_dir() or not name.lower().endswith(".csv"):
                    continue
                if len(parts) != 1 and not (len(parts) == 2 and parts[0].lower() == "input"):
                    raise PublishedImportError("项目 CSV 必须放在 ZIP 根目录或 input/ 下")
                project = _project(parts[-1])
                if project in members:
                    raise PublishedImportError(f"ZIP 中有多个同名项目 CSV：{project}")
                if info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise PublishedImportError(f"{name} 使用了加密或不支持的压缩方式")
                members[project] = info
            if not members:
                raise PublishedImportError("ZIP 中没有项目 CSV")
            if len(members) > USER_DATASET_LIMIT or sum(i.file_size for i in members.values()) > MAX_UPLOAD_BYTES:
                raise BaselineError("DATASET_IMPORT_TOO_LARGE", "项目数量或 CSV 解压总大小超出上限")
            if report:
                report(total=len(members))
            remaining = MAX_UPLOAD_BYTES
            for project, info in sorted(members.items()):
                with archive.open(info) as stream:
                    content = stream.read(remaining + 1)
                remaining -= len(content)
                if remaining < 0:
                    raise BaselineError("DATASET_IMPORT_TOO_LARGE", "CSV 解压总大小超过 64 MiB")
                yield project, info.filename, content
    except BaselineError:
        raise
    except (zipfile.BadZipFile, EOFError, RuntimeError, ValueError, zlib.error) as exc:
        raise PublishedImportError("ZIP 无法读取或内容已损坏") from exc


def _publish(staging, files):
    published = []
    try:
        for index, (target, content) in enumerate(files):
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = staging / str(index)
            temporary.write_bytes(content)
            try:
                os.link(temporary, target)
                published.append(target)
            except FileExistsError:
                if target.read_bytes() != content:
                    raise BaselineError("DATASET_EXISTS", "现有版本文件内容不同")
            finally:
                temporary.unlink()
    except (OSError, BaselineError):
        for target in reversed(published):
            target.unlink(missing_ok=True)
        raise


def import_projects(storage, root, username, filename, blob, *, zipped, report=None):
    """项目登记、所有权与提交记录使用同一事务，重传相同项目文件复用版本。"""
    root = root or datasets.DATASETS
    filename = re.sub(r"[^A-Za-z0-9._-]", "-", filename.replace("\\", "/").rsplit("/", 1)[-1])[:120]
    projects = archive_projects(blob, report) if zipped else [(_project(filename), filename, blob)]
    if report and not zipped:
        report(total=1)
    versions, files = [], []
    created = row_budget = 0
    try:
        with tempfile.TemporaryDirectory(prefix=".published-import-", dir=root) as temporary:
            with storage.connection(write=True) as db:
                for project, member, content in projects:
                    if report:
                        report(stage="validating", currentFile=member, rowsTotal=None, rowsWritten=0)
                    row_budget += max(content.count(b"\n"), content.count(b"\r")) + 1
                    if row_budget > MAX_BATCH_ROWS:
                        raise BaselineError("DATASET_IMPORT_TOO_LARGE", "一批最多导入 30 万条记录")
                    digest = sha256(content)
                    name = f"kamei-2013-{sha256(username.encode())[:12]}-{project}"
                    provenance = {"publisher": "Kamei et al. (2013)", "revision": digest,
                                  "url": f"upload://{username}/{filename}", "citation": CITATION}
                    try:
                        candidate, records = datasets.describe_source(
                            content, root / name / f"{project}.csv", dataset=name,
                            schema=KAMEI_2013_SCHEMA, version_stamp=digest[:8], provenance=provenance,
                            extra={"usage": "import",
                                   "benchmark": {"project": project, "upload": filename, "member": member,
                                                 "sourceSha256": digest, "sourceTimeZone": "unknown",
                                                 "interpretedTimeZone": "UTC"},
                                   "label": {"kind": "kamei-2013-publisher",
                                             "rule": "发布者 bug 标签（1：引入缺陷；0：未被标记）",
                                             "limitations": ["特征与标签沿用发布者口径。原始时间无时区，切分按 UTC 解释。"]}},
                        )
                    except BaselineError as exc:
                        raise PublishedImportError(f"{member}：{exc}") from exc
                    version = candidate["version"]
                    csv_path = root / name / f"{version}.csv"
                    manifest_path = csv_path.with_suffix(".json")
                    candidate["file"]["path"] = datasets.manifest_relative(csv_path)
                    owners = {row[0] for row in db.execute(
                        "SELECT username FROM dataset_owner WHERE dataset_version=?", (version,))}
                    if owners and owners != {username}:
                        raise BaselineError("DATASET_FORBIDDEN", "同名版本属于其他用户")
                    stored = db.execute("SELECT manifest_json FROM dataset_record WHERE dataset_version=?",
                                        (version,)).fetchone()
                    if stored:
                        if not owners:
                            raise BaselineError("DATASET_EXISTS", "已有同名登记版本")
                        manifest = json.loads(stored[0])
                    elif manifest_path.exists():
                        # 进程中断可能留下尚未提交归属的文件。只有相同来源的私有导入可恢复。
                        manifest = datasets.load_manifest(manifest_path)
                    else:
                        manifest = candidate
                    if (manifest.get("benchmark", {}).get("project") != project
                            or manifest.get("schemaName") != KAMEI_2013_SCHEMA
                            or manifest.get("usage") != "import"
                            or manifest["file"] != candidate["file"]):
                        raise BaselineError("DATASET_EXISTS", f"{member} 与已有版本内容冲突")
                    if report:
                        report(stage="importing", rowsTotal=len(records))
                    created += storage.add_dataset_owner(version, username, limit=USER_DATASET_LIMIT, connection=db)
                    storage.import_dataset(manifest, records, connection=db,
                                           progress=(lambda written: report(rowsWritten=written)) if report else None)
                    versions.append(manifest)
                    if report:
                        report(processed=len(versions), rowsTotal=None, rowsWritten=0)
                    files.extend(((csv_path, content),
                                  (manifest_path, storage._manifest_dump(manifest).encode("utf-8"))))
                if report:
                    report(stage="registering", currentFile=None)
                _publish(Path(temporary), files)
    except OSError as exc:
        raise BaselineError("DATASET_UNAVAILABLE", "导入文件无法保存，请检查数据目录") from exc
    return versions, created
