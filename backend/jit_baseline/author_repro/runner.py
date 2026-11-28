"""Reproducible run directory and manifest envelope."""
from __future__ import annotations

import json
import shlex
import sys
from dataclasses import dataclass
from pathlib import Path

from ..config import BACKEND
from ..errors import BaselineError
from .common import digest_json, environment, utc_now, write_json

ARTIFACT_ROOT = BACKEND / "artifacts" / "author-repro"
RUN_SCHEMA = "author-repro-run-v1"


@dataclass
class AuthorRun:
    method: str
    version: str
    fidelity: str
    directory: Path
    manifest: dict

    @property
    def run_id(self) -> str:
        return self.manifest["runId"]

    def set(self, **values) -> None:
        self.manifest.update(values)
        self.manifest["updatedAt"] = utc_now()
        write_json(self.directory / "run.json", self.manifest)

    def write_metrics(self, metrics: dict) -> None:
        write_json(self.directory / "metrics.json", metrics)
        self.set(metricsWritten=True)

    def complete(self, summary: dict | None = None) -> dict:
        self.manifest.update({
            "status": "completed",
            "completedAt": utc_now(),
            "summary": summary or {},
            "updatedAt": utc_now(),
        })
        write_json(self.directory / "run.json", self.manifest)
        return self.manifest

    def fail(self, code: str, message: str) -> dict:
        self.manifest.update({
            "status": "failed",
            "completedAt": utc_now(),
            "failure": {"code": code, "message": message},
            "updatedAt": utc_now(),
        })
        write_json(self.directory / "run.json", self.manifest)
        return self.manifest


def _command_line(argv) -> list[str]:
    values = list(argv or sys.argv)
    return [str(value) for value in values]


def new_run(method: str, *, version: str, fidelity: str, material_hashes: dict,
            config: dict, split: dict, seed: int, command=None,
            output: Path | None = None, argv=None) -> AuthorRun:
    command_line = _command_line(argv)
    identity = {
        "schema": RUN_SCHEMA,
        "method": method,
        "methodVersion": version,
        "fidelity": fidelity,
        "materialHashes": material_hashes,
        "config": config,
        "split": split,
        "seed": seed,
        "environment": environment(),
        "command": command_line,
    }
    run_id = digest_json(identity)[:20]
    directory = Path(output) if output is not None else ARTIFACT_ROOT / method / run_id
    if directory.exists() and any(directory.iterdir()):
        raise BaselineError("AUTHOR_RUN_EXISTS",
                            f"运行目录已存在且非空，拒绝覆盖：{directory}")
    directory.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema": RUN_SCHEMA,
        "runId": run_id,
        "method": method,
        "methodVersion": version,
        "fidelity": fidelity,
        "status": "running",
        "startedAt": utc_now(),
        "updatedAt": utc_now(),
        "materialHashes": material_hashes,
        "config": config,
        "split": split,
        "seed": seed,
        "command": command_line,
        "environment": identity["environment"],
        "output": str(directory),
    }
    write_json(directory / "run.json", manifest)
    (directory / "command.txt").write_text(
        " ".join(shlex.quote(value) for value in command_line) + "\n", encoding="utf-8")
    (directory / "run.log").touch()
    return AuthorRun(method, version, fidelity, directory, manifest)


def append_log(run: AuthorRun, message: str) -> None:
    with (run.directory / "run.log").open("a", encoding="utf-8") as handle:
        handle.write(f"{utc_now()} {message}\n")


def load_run(path: Path) -> dict:
    path = Path(path)
    target = path / "run.json" if path.is_dir() else path
    try:
        value = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BaselineError("AUTHOR_RUN_INVALID", f"运行清单不可读：{target}") from exc
    if value.get("schema") != RUN_SCHEMA:
        raise BaselineError("AUTHOR_RUN_INVALID", "运行清单 schema 不受支持")
    return value
