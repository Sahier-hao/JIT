"""Author-method catalog and material verification."""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

from ..config import BACKEND
from ..errors import BaselineError

CATALOG_PATH = Path(__file__).with_name("catalog.json")


def catalog() -> dict:
    try:
        value = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BaselineError("AUTHOR_CATALOG_INVALID", f"作者方法目录不可读：{exc}") from exc
    if value.get("schema") != "author-repro-catalog-v1":
        raise BaselineError("AUTHOR_CATALOG_INVALID", "作者方法目录 schema 不受支持")
    return value


def method_ids() -> tuple[str, ...]:
    return tuple(catalog()["methods"])


def method_entry(method: str) -> dict:
    try:
        return catalog()["methods"][method]
    except KeyError:
        raise BaselineError("AUTHOR_METHOD_UNKNOWN", f"未知作者方法：{method}") from None


def material_entry(material_id: str) -> dict:
    try:
        return catalog()["materials"][material_id]
    except KeyError:
        raise BaselineError("AUTHOR_MATERIAL_UNKNOWN", f"未知作者材料：{material_id}") from None


def backend_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else BACKEND / path


def digest(path: Path, algorithm: str = "sha256") -> str:
    hasher = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def _expected(material: dict) -> list[tuple[str, str]]:
    checks = []
    if material.get("sha256"):
        checks.append(("sha256", material["sha256"].lower()))
    if material.get("md5"):
        checks.append(("md5", material["md5"].lower()))
    return checks


def verify_material(material_id: str, *, root: Path | None = None) -> dict:
    material = material_entry(material_id)
    base = Path(root) if root is not None else BACKEND
    result = {
        "id": material_id,
        "kind": material.get("kind"),
        "path": str(base / material["path"]) if material.get("path") else
                str(base / material.get("root", "")),
        "license": material.get("license"),
        "available": False,
        "hashes": {},
        "members": [],
    }
    if material.get("kind") == "local-dataset-group":
        group_root = base / material["root"]
        missing = []
        for member in material.get("members", []):
            member_path = group_root / member["path"]
            item = {"path": str(member_path), "available": member_path.is_file()}
            if member_path.is_file():
                actual = digest(member_path)
                item["sha256"] = actual
                item["valid"] = actual == member["sha256"].lower()
            else:
                item["valid"] = False
                missing.append(str(member_path))
            result["members"].append(item)
        result["available"] = not missing and all(item["valid"] for item in result["members"])
        result["missing"] = missing
        return result
    path = base / material["path"]
    if material.get("kind") == "derived-author-labels":
        missing = []
        for member in material.get("members", []):
            member_path = path / member["name"]
            item = {"path": str(member_path), "available": member_path.is_file()}
            if member_path.is_file():
                item["sha256"] = digest(member_path)
            else:
                missing.append(str(member_path))
            result["members"].append(item)
        result["available"] = not missing
        result["missing"] = missing
    elif material.get("kind") == "huggingface":
        missing = [str(path / name) for name in material.get("files", []) if not (path / name).is_file()]
        result["available"] = not missing
        result["missing"] = missing
        for name, expected in (material.get("fileHashes") or {}).items():
            member = path / name
            if member.is_file():
                actual = digest(member)
                result["hashes"][name] = actual
                if actual != expected.lower():
                    raise BaselineError(
                        "AUTHOR_MATERIAL_HASH_MISMATCH",
                        f"{material_id} 的 {name} 哈希不匹配：期望 {expected}，实际 {actual}",
                    )
    elif material.get("kind") == "git":
        result["available"] = (path / ".git").exists() if path.is_dir() else False
        result["missing"] = [] if result["available"] else [str(path)]
        if result["available"]:
            completed = subprocess.run(
                ["git", "-C", str(path), "rev-parse", "HEAD"],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                check=False,
            )
            actual = completed.stdout.strip().lower()
            expected = material.get("revision", "").lower()
            result["revision"] = actual or None
            if completed.returncode != 0 or actual != expected:
                raise BaselineError(
                    "AUTHOR_MATERIAL_HASH_MISMATCH",
                    f"{material_id} revision 不匹配：期望 {expected}，实际 {actual or 'unknown'}",
                )
    else:
        result["available"] = path.is_file()
        result["missing"] = [] if result["available"] else [str(path)]
        if path.is_file():
            if material.get("size") is not None and path.stat().st_size != material["size"]:
                raise BaselineError(
                    "AUTHOR_MATERIAL_HASH_MISMATCH",
                    f"{material_id} 文件大小不匹配：期望 {material['size']}，实际 {path.stat().st_size}",
                )
            for algorithm, expected in _expected(material):
                actual = digest(path, algorithm)
                result["hashes"][algorithm] = actual
                if actual != expected:
                    raise BaselineError(
                        "AUTHOR_MATERIAL_HASH_MISMATCH",
                        f"{material_id} 的 {algorithm} 不匹配：期望 {expected}，实际 {actual}",
                    )
    return result


def prepare_method(method: str, *, root: Path | None = None) -> dict:
    entry = method_entry(method)
    materials = []
    source_by_method = {
        "deepjit": "deepjit-source",
        "jitline": "jitline-source",
        "jitfine": "jit-fine-source",
        "jitsmart": "jit-smart-source",
    }
    ids = []
    if method in source_by_method:
        ids.append(source_by_method[method])
    for material_id in entry.get("dataMaterials", []):
        if material_id not in ids:
            ids.append(material_id)
    for material_id in ids:
        materials.append(verify_material(material_id, root=root))
    missing = [item["id"] for item in materials if not item["available"]]
    return {
        "schema": "author-material-check-v1",
        "method": method,
        "methodVersion": entry["methodVersion"],
        "available": not missing,
        "missing": missing,
        "materials": materials,
    }
