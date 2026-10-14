"""产出"跨机器交付的外部产物"这一功能的实际运行证据。

模拟一份经仓库交付的外部产物（产出环境是另一台有加速设备的机器），按声明的口径
走完整校验路径，并记录三种损坏情形的拒绝结果。输出写到运行工作区
`docs/evidence/_run/external-artifact-verification.json`，由显式冻结纳入归档。

在 backend 下运行：`.venv/Scripts/python.exe scripts/external_delivery_evidence.py`
"""
import json
import shutil
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
PROJECT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from jit_baseline.artifacts import (Snapshot, declared_reproducibility, identity, read_json,  # noqa: E402
                                    run_origin, verify_run, write_json)
from jit_baseline.data import BaselineError, sha256  # noqa: E402

CUDA_MACHINE = {
    "python": "3.11.9",
    "platform": "Linux-5.15.0-105-generic-x86_64-with-glibc2.35",
    "packages": {"numpy": "2.5.3", "scikit-learn": "1.9.1", "torch": "2.1.0+cu121"},
}


def delivered_artifact(work, name):
    """复制一份真实运行并改写产出环境，模拟经仓库交付的外部产物。"""
    target = work / name
    shutil.copytree(BACKEND / "artifacts" / "baseline", target)
    manifest = read_json(target / "manifest.json")
    manifest["config"]["trainingEnvironment"] = CUDA_MACHINE
    manifest["runId"] = identity(manifest["config"])
    summary = read_json(target / "summary.json")
    summary["runId"] = manifest["runId"]
    write_json(target / "summary.json", summary)
    manifest["files"]["summary.json"] = sha256((target / "summary.json").read_bytes())
    write_json(target / "manifest.json", manifest)
    return target, manifest


def verdict(target):
    try:
        verify_run(target)
        return {"passed": True, "error": None, "message": None}
    except BaselineError as exc:
        return {"passed": False, "error": exc.code, "message": str(exc)}


def main():
    work = BACKEND / ".cache" / "external-delivery"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    good, manifest = delivered_artifact(work, "delivered")
    report = {
        "kind": "external-artifact-verification",
        "simulatedFor": "在别台（有加速设备的）机器上产生、经仓库交付的运行",
        "runId": manifest["runId"],
        "origin": run_origin(manifest),
        "runIdIsTheProducersAndSelfConsistent": identity(manifest["config"]) == manifest["runId"],
        "trainingEnvironment": manifest["config"]["trainingEnvironment"],
        "declaredReproducibility": declared_reproducibility(manifest)[1],
        "records": len(Snapshot.load(good).batch()["records"]),
        "verdict": verdict(good),
        "rejections": {},
    }

    # 校验不改写交付物本身。
    before = {p.name: p.read_bytes() for p in sorted(good.iterdir())}
    verify_run(good)
    report["artifactUnchangedByVerification"] = {p.name: p.read_bytes() for p in sorted(good.iterdir())} == before

    # 缺必要文件。
    missing, _ = delivered_artifact(work, "missing-file")
    (missing / "source.json").unlink()
    report["rejections"]["missing-needed-file"] = verdict(missing)

    # 哈希不符。
    tampered, _ = delivered_artifact(work, "tampered-model")
    with (tampered / "model.joblib").open("ab") as handle:
        handle.write(b"bad")
    report["rejections"]["hash-mismatch"] = verdict(tampered)

    # 只在加速设备上可加载的形态：清单自洽、声明完整，仍必须被拒绝。
    device_only, manifest = delivered_artifact(work, "device-only")
    (device_only / "model.joblib").write_bytes(b"only loadable where it was serialized")
    manifest["files"]["model.joblib"] = sha256((device_only / "model.joblib").read_bytes())
    manifest["config"]["coreFiles"]["model.joblib"] = manifest["files"]["model.joblib"]
    manifest["config"]["modelSha256"] = manifest["files"]["model.joblib"]
    manifest["runId"] = identity(manifest["config"])
    summary = read_json(device_only / "summary.json")
    summary["runId"] = manifest["runId"]
    summary["modelSha256"] = manifest["files"]["model.joblib"]
    write_json(device_only / "summary.json", summary)
    manifest["files"]["summary.json"] = sha256((device_only / "summary.json").read_bytes())
    write_json(device_only / "manifest.json", manifest)
    report["rejections"]["unloadable-here"] = verdict(device_only)

    write_json(PROJECT / "docs" / "evidence" / "_run" / "external-artifact-verification.json", report)
    print(json.dumps({"kind": report["kind"], "runId": report["runId"], "origin": report["origin"],
                      "passed": report["verdict"]["passed"],
                      "rejections": {k: v["error"] for k, v in report["rejections"].items()}},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
