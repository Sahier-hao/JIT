"""标签观察窗口与成熟样本准入（RCL-28、RCL-29、DSP-03、DSR-12）。"""
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from jit_baseline import admission, collect, datasets
from jit_baseline.config import BACKEND
from jit_baseline.data import BaselineError, parse_source
from jit_baseline.schemas import resolve

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="系统缺少 git 命令")

LINES = "\n".join(f"line {index}" for index in range(100)) + "\n"
NAMES = resolve("kamei14-git-v2").in_model_names()


def _git(repo, *args, env=None):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True,
                          text=True, env=env).stdout.strip()


def _repo(path):
    path.mkdir(parents=True, exist_ok=True)
    _git(path, "init", "-q", "-b", "main")
    _git(path, "config", "user.email", "author@example.com")
    _git(path, "config", "user.name", "Author")
    return path


def _commit(repo, subject, files, moment):
    for name, content in files.items():
        target = repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    _git(repo, "add", "-A")
    env = dict(os.environ, GIT_AUTHOR_DATE=moment, GIT_COMMITTER_DATE=moment)
    _git(repo, "commit", "-q", "-m", subject, env=env)
    return _git(repo, "rev-parse", "HEAD")


def _records(count=120, *, start=1_704_067_200, step=86_400):
    base = dict(ns=1, nd=2, nf=3, entropy=0.5, la=10, ld=1, lt=100, fix=0,
                ndev=2, age=3, nuc=2, exp=4, rexp=1, sexp=2)
    return [{"id": f"{index + 1:040x}", "epoch": start + index * step,
             "time": f"time-{index}", "label": index % 2,
             "metrics": dict(base)} for index in range(count)]


def _csv(records):
    return collect._csv_bytes(records, NAMES)


def _register_labeled(tmp_path, records, *, observed_extra_days=120, maturity=90,
                      dataset="demo", root=None):
    from label_fixtures import register_labeled
    root = root if root is not None else tmp_path / "datasets"
    source = tmp_path / f"{dataset}.csv"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(_csv(records))
    observed = max(record["epoch"] for record in records) + observed_extra_days * 86_400
    status = admission.build_status(records, observed, maturity)
    status_bytes = admission.status_bytes(status)
    digest = hashlib.sha256(status_bytes).hexdigest()
    status_path = root / f"{dataset}-label-status-{digest[:16]}.jsonl"
    status_path.parent.mkdir(parents=True, exist_ok=True)
    status_path.write_bytes(status_bytes)
    status_meta = {"path": datasets.manifest_relative(status_path), "sha256": digest,
                   "records": len(status), "rule": admission.STATUS_RULE}
    labeling = admission.declaration(
        label_rule="szz-full-v1",
        sample_window={"since": None, "until": None, "startEpoch": None, "endEpoch": None},
        observation_window={"fromEpoch": None, "throughEpoch": observed, "through": None},
        observed_through=observed, maturity_days=maturity, revision="a" * 40,
        revision_epoch=observed, history_status="complete",
        coverage={"complete": True, "truncated": False, "historyBounded": False,
                  "unresolvedRanges": 0, "reason": None},
        entries=status, status_file=status_meta)
    registered = datasets.register(
        source, schema="kamei14-git-v2", dataset=dataset, root=root,
        cohort=collect.cohort("2020-01-01", "2030-01-01"),
        extra={"labeling": labeling, "labelStatusFile": status_meta})
    manifest_path = root / dataset / f"{registered['version']}.json"
    return registered, manifest_path, records, observed


def test_fix_after_sample_cutoff_labels_earlier_commit_without_future_features(tmp_path):
    repo = _repo(tmp_path / "repo")
    first = _commit(repo, "add module", {"pkg/a.py": LINES}, "2024-01-01T00:00:00+00:00")
    fix = _commit(repo, "fix: repair first line",
                  {"pkg/a.py": "line 0 fixed\n" + LINES.split("\n", 1)[1]},
                  "2024-01-10T00:00:00+00:00")
    _commit(repo, "docs: later note", {"README.md": "note\n"}, "2024-01-25T00:00:00+00:00")

    collected = collect.collect(repo, since="2024-01-01", until="2024-01-05",
                                observe_through="2024-01-20")
    by_id = {record["id"]: record for record in collected["records"]}

    assert fix not in by_id
    assert by_id[first]["label"] == 1
    assert by_id[first]["metrics"]["lt"] == 0
    assert by_id[first]["metrics"]["nuc"] == 0
    observation = collected["observation"]
    assert observation["observationWindow"]["throughEpoch"] == collect.parse_time("2024-01-20")


def test_observation_never_extends_past_pinned_revision(tmp_path):
    repo = _repo(tmp_path / "repo")
    _commit(repo, "add module", {"a.py": "a\n"}, "2024-01-01T00:00:00+00:00")
    revision = _commit(repo, "add helper", {"b.py": "b\n"}, "2024-01-02T00:00:00+00:00")

    collected = collect.collect(repo, since="2024-01-01", until="2024-01-05",
                                observe_through="2030-01-01", revision=revision)
    observation = collected["observation"]
    assert observation["revision"] == revision
    assert observation["observedThrough"] == collect.parse_time("2024-01-02")
    assert observation["coverage"]["historyBounded"] is True
    assert observation["historyStatus"] == "complete"


def test_immature_status_is_recomputed_and_invalid_sidecars_are_rejected(tmp_path):
    registered, manifest_path, records, observed = _register_labeled(
        tmp_path, _records(20), observed_extra_days=10, maturity=90)
    manifest = datasets.load_manifest(manifest_path)
    evaluated = admission.evaluate(manifest, records)
    assert evaluated["available"] is True
    assert evaluated["counts"]["eligibleRecords"] == 0
    assert all(entry["maturityStatus"] == "immature" for entry in evaluated["status"].values())
    assert all(entry["reason"] == "immature" for entry in evaluated["status"].values())

    status_path = admission.status_path(manifest)
    status_path.write_bytes(status_path.read_bytes() + b"\n")
    tampered = admission.evaluate(manifest, records)
    assert tampered["available"] is False
    assert tampered["reason"]["code"] == "LABEL_STATUS_INVALID"


def test_unknown_history_and_truncated_evidence_block_formal_evaluation(tmp_path):
    records = _records(20)
    for field, value, code in (
            ("historyStatus", "shallow", "LABEL_OBSERVATION_UNKNOWN"),
            ("coverage", {"complete": False, "truncated": True, "historyBounded": False,
                          "unresolvedRanges": 0, "reason": "szz-budget"},
             "LABEL_EVIDENCE_TRUNCATED")):
        registered, manifest_path, records, _ = _register_labeled(
            tmp_path / field, records, observed_extra_days=200)
        manifest = datasets.load_manifest(manifest_path)
        labeling = manifest["labeling"]
        labeling[field] = value
        labeling.pop("identity")
        labeling["identity"] = admission._identity_from_manifest({"labeling": labeling})
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                 encoding="utf-8")
        evaluated = admission.evaluate(manifest, records)
        assert evaluated["available"] is False
        assert evaluated["reason"]["code"] == code
        restricted = admission.evaluate(manifest, records, allow_restricted=True)
        assert restricted["available"] is True and restricted["restricted"] is True


def test_legacy_szz_dataset_is_rejected_but_can_be_replayed_explicitly(tmp_path):
    from jit_baseline.artifacts import build_run
    records = _records(150)
    root = tmp_path / "datasets"
    source = tmp_path / "legacy.csv"
    source.write_bytes(_csv(records))
    registered = datasets.register(source, schema="kamei14-git-v2", dataset="legacy",
                                   root=root, cohort=collect.cohort("2020-01-01", "2030-01-01"))
    manifest = root / "legacy" / f"{registered['version']}.json"
    from jit_baseline.split_preview import dataset_split_preview
    preview = dataset_split_preview(root, registered["version"])
    assert preview["available"] is False
    assert preview["reason"]["code"] == "LABEL_OBSERVATION_UNKNOWN"
    with pytest.raises(BaselineError) as raised:
        build_run(tmp_path / "source", tmp_path / "run", schema="kamei14-git-v2",
                  dataset_manifest=manifest)
    assert raised.value.code == "LABEL_OBSERVATION_UNKNOWN"
    run = tmp_path / "legacy-run"
    built = build_run(tmp_path / "source", run, schema="kamei14-git-v2",
                      dataset_manifest=manifest, allow_legacy_labels=True)
    assert built["runId"]
    saved = json.loads((run / "split.json").read_text(encoding="utf-8"))
    assert saved["admission"]["policy"] == admission.LEGACY_PROTOCOL


def test_split_preview_and_training_use_the_same_mature_members(tmp_path):
    from jit_baseline.artifacts import build_run
    from jit_baseline.split_preview import dataset_split_preview
    root = tmp_path / "datasets"
    records = _records(150)
    registered, manifest_path, records, observed = _register_labeled(
        tmp_path, records, observed_extra_days=200, root=root)
    preview = dataset_split_preview(root, registered["version"])
    assert preview["available"] is True
    assert preview["datasetRecords"] == 150
    assert preview["eligibleRecords"] == 150
    run = tmp_path / "run"
    build_run(tmp_path / "source", run, schema="kamei14-git-v2",
              dataset_manifest=manifest_path)
    split = json.loads((run / "split.json").read_text(encoding="utf-8"))
    assert split["admission"]["counts"]["eligibleRecords"] == 150
    for name, stat in split["partitions"].items():
        assert stat["count"] == preview["partitions"][name]["records"]
        assert stat["positiveCount"] == preview["partitions"][name]["positives"]


def test_same_csv_with_new_labeling_semantics_creates_a_new_version(tmp_path):
    repo = _repo(tmp_path / "repo")
    _commit(repo, "add module", {"a.py": LINES}, "2024-01-01T00:00:00+00:00")
    _commit(repo, "fix: repair", {"a.py": "fixed\n" + LINES.split("\n", 1)[1]},
            "2024-01-02T00:00:00+00:00")
    root = tmp_path / "datasets"
    first = collect.collect_repository(repo, since="2024-01-01", until="2024-01-05",
                                       output=tmp_path / "a.csv", dataset="same",
                                       register=True, root=root, maturity_days=30)
    second = collect.collect_repository(repo, since="2024-01-01", until="2024-01-05",
                                        output=tmp_path / "b.csv", dataset="same",
                                        register=True, root=root, maturity_days=90)
    assert first["dataset"]["version"] != second["dataset"]["version"]
    assert len(list((root / "same").glob("*.json"))) == 2
    manifests = [datasets.load_manifest(path) for path in (root / "same").glob("*.json")]
    assert {manifest["labeling"]["maturityDays"] for manifest in manifests} == {30, 90}
    assert manifests[0]["file"]["sha256"] == manifests[1]["file"]["sha256"]


def test_authoritative_export_round_trips_status_and_eligibility(tmp_path):
    import zipfile
    from jit_baseline import project_datasets
    root = tmp_path / "datasets"
    records = _records(150)
    registered, manifest_path, records, observed = _register_labeled(
        tmp_path, records, observed_extra_days=200, root=root)
    manifest_bytes = manifest_path.read_bytes()
    manifest = datasets.load_manifest(manifest_path)
    files = []
    for kind, entry in (("file", manifest["file"]),
                        ("labelStatusFile", manifest["labelStatusFile"])):
        path = Path(entry["path"])
        path = path if path.is_absolute() else BACKEND.parent / "backend" / path
        blob = path.read_bytes()
        files.append({"kind": kind, "path": path, "bytes": blob,
                      "sha256": hashlib.sha256(blob).hexdigest()})
    resolved = {"manifest": manifest, "manifestBytes": manifest_bytes, "files": files}
    output, name = project_datasets.export_zip(resolved)
    try:
        with zipfile.ZipFile(output) as archive:
            names = archive.namelist()
            assert any("label-status" in item for item in names)
            assert "SHA256SUMS" in names
            extracted = tmp_path / "extracted"
            extracted.mkdir()
            archive.extractall(extracted)
        csv_name = next(item for item in names if item.endswith(".csv"))
        status_name = next(item for item in names if "label-status" in item)
        manifest_name = next(item for item in names if item.endswith(".json"))
        extracted_manifest = json.loads((extracted / manifest_name).read_text(encoding="utf-8"))
        assert not Path(extracted_manifest["labelStatusFile"]["path"]).is_absolute()
        rebuilt = dict(extracted_manifest,
                       file=dict(extracted_manifest["file"],
                                 path=str(extracted / csv_name)),
                       labelStatusFile=dict(extracted_manifest["labelStatusFile"],
                                            path=str(extracted / status_name)))
        rebuilt["labeling"] = dict(rebuilt["labeling"])
        rebuilt["labeling"]["statusFile"] = dict(rebuilt["labeling"]["statusFile"],
                                                 path=str(extracted / status_name))
        rebuilt_records, _ = parse_source((extracted / csv_name).read_bytes(),
                                          rebuilt["schemaName"], rebuilt["cohort"])
        assert admission.evaluate(rebuilt, rebuilt_records)["identity"]
    finally:
        output.unlink(missing_ok=True)


def test_training_task_uses_the_previewed_mature_members(tmp_path):
    import time
    from jit_baseline.catalog_storage import CatalogStorage
    from jit_baseline.split_preview import dataset_split_preview
    from jit_baseline.training_tasks import TrainingTaskService
    root = tmp_path / "datasets"
    records = _records(180)
    registered, manifest_path, records, observed = _register_labeled(
        tmp_path, records, observed_extra_days=100, root=root)
    preview = dataset_split_preview(root, registered["version"], "temporal-70-15-15")
    assert preview["available"] is True
    storage = CatalogStorage(tmp_path / "catalog.sqlite3")
    storage.initialize()
    service = TrainingTaskService(storage, dataset_root=root,
                                  artifact_root=tmp_path / "artifacts", timeout=60)
    try:
        task, _ = service.create({"datasetVersion": registered["version"],
                                  "method": "logistic-regression-l2-v1",
                                  "metricSet": "metric-set-v2"}, created_by="admin")
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            current = service.get(task["taskId"])
            if current["status"] in ("succeeded", "failed", "interrupted"):
                break
            time.sleep(0.05)
        assert current["status"] == "succeeded", current
        artifact = tmp_path / "artifacts" / f"training-task-{task['taskId'][:8]}"
        split = json.loads((artifact / "split.json").read_text(encoding="utf-8"))
        assert split["admission"]["counts"] == preview["admission"]["counts"]
        for name, stat in split["partitions"].items():
            assert stat["count"] == preview["partitions"][name]["records"]
    finally:
        service.close()


def test_publisher_dataset_keeps_its_original_label_semantics(tmp_path):
    import csv
    import io
    source = tmp_path / "openstack.csv"
    stream = io.StringIO()
    writer = csv.writer(stream, lineterminator="\n")
    fields = resolve("openstack-six-v1").in_model_names()
    writer.writerow(["commit_id", "author_date", "bugcount", *fields])
    for index in range(150):
        writer.writerow([f"{index + 1:040x}", 1_704_067_200 + index * 86_400, index % 2,
                         1, 2, 3, 0.5, 10, 1])
    source.write_bytes(stream.getvalue().encode("utf-8"))
    root = tmp_path / "datasets"
    registered = datasets.register(source, schema="openstack-six-v1", dataset="published",
                                   root=root, cohort=collect.cohort("2020-01-01", "2030-01-01"))
    from jit_baseline.split_preview import dataset_split_preview
    preview = dataset_split_preview(root, registered["version"])
    assert preview["admission"]["protocol"] == admission.PUBLISHER_PROTOCOL
    assert preview["admission"]["available"] is True
