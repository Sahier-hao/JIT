"""评价证据只读服务与数据集观察窗口事实。"""
import hashlib
import json

from jit_baseline import evaluation_evidence, store


def _write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    return path


def _matrix(version, manifest_sha, csv_sha="c" * 64):
    return {"format": "evaluation-matrix-v1", "status": "complete",
            "generatedUtc": "2026-11-11T04:00:00Z",
            "protocol": {"datasets": [{"version": version, "manifestSha256": manifest_sha,
                                       "csvSha256": csv_sha}]},
            "datasets": [{"name": "demo", "version": version, "language": "python"}],
            "withinRepo": [{"status": "succeeded"}], "leaveOneRepoOut": [],
            "baselines": [{"baseline": "churn"}], "failures": [],
            "protocolSha256": "p" * 64}


def _registry(tmp_path, monkeypatch, content=b"{}"):
    manifest = tmp_path / "registry" / "demo.json"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_bytes(content)
    sha = hashlib.sha256(content).hexdigest()

    def load_all(root=None):
        return {"demo-v1": {"manifestPath": str(manifest), "file": {"sha256": "c" * 64}}}

    monkeypatch.setattr(evaluation_evidence.datasets, "load_all", load_all)
    return sha


def test_available_and_stale_evidence(tmp_path, monkeypatch):
    sha = _registry(tmp_path, monkeypatch)
    root = tmp_path / "evidence"
    _write(root / "fresh.json", _matrix("demo-v1", sha))
    _write(root / "changed.json", _matrix("demo-v1", "d" * 64))
    _write(root / "missing.json", _matrix("demo-v2", sha))
    service = evaluation_evidence.EvaluationEvidence([root], registry_root=tmp_path / "registry")
    listing = service.list()
    by_source = {entry["source"]: entry for entry in listing["evidence"]}
    assert by_source["fresh.json"]["status"] == "available"
    assert by_source["changed.json"]["status"] == "stale"
    assert "描述文件已变化" in by_source["changed.json"]["reason"]
    assert by_source["missing.json"]["status"] == "stale"
    assert "未登记" in by_source["missing.json"]["reason"]
    assert by_source["fresh.json"]["summary"]["datasets"] == 1
    detail = service.get(by_source["fresh.json"]["evidenceId"][:12])
    assert detail["report"]["protocolSha256"] == "p" * 64
    assert detail["status"] == "available"


def test_invalid_and_unknown_evidence(tmp_path, monkeypatch):
    _registry(tmp_path, monkeypatch)
    root = tmp_path / "evidence"
    (root).mkdir(parents=True, exist_ok=True)
    (root / "broken.json").write_text("{not json", encoding="utf-8")
    _write(root / "other.json", {"format": "something-else"})
    service = evaluation_evidence.EvaluationEvidence([root], registry_root=tmp_path / "registry")
    listing = service.list()
    assert [entry["status"] for entry in listing["evidence"]] == ["invalid"]
    with_exception = None
    try:
        service.get("deadbeef")
    except Exception as exc:  # noqa: BLE001 - 断言领域错误码
        with_exception = exc
    assert getattr(with_exception, "code", None) == "EVIDENCE_UNKNOWN"


def test_dataset_view_exposes_observation_window():
    manifest = {
        "dataset": "demo", "version": "demo-v1", "schemaName": "kamei14-git-v2",
        "timeRange": {}, "quality": {}, "file": {}, "url": "https://example.com",
        "collection": {
            "label": {"rule": "szz-full-v1", "version": "szz-full-v1",
                      "observedThrough": 1785542400, "maturityDays": 90,
                      "binarizationRule": "label = 1 when introduced by an observed fix commit"},
            "szz": {"rule": "szz-full-v1", "truncated": False},
        },
    }
    listed = store.dataset_list({"demo-v1": manifest})[0]["versions"][0]
    viewed = store.version_view({"demo-v1": manifest}, "demo")["versions"][0]
    for entry in (listed, viewed):
        observations = entry["labelObservations"]
        assert observations["observedThroughIso"] == "2026-08-01T00:00:00+00:00"
        assert observations["maturityDays"] == 90
        assert observations["truncated"] is False
    truncated = dict(manifest, collection=dict(manifest["collection"],
                                               szz={"rule": "szz-full-v1", "truncated": True}))
    assert store.version_view({"demo-v1": truncated}, "demo")["versions"][0][
        "labelObservations"]["truncated"] is True
