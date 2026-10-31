"""Shared training execution used by admin jobs and repository sync."""
from pathlib import Path

from . import artifacts
from .algorithms import get_algorithm
from .artifacts import Snapshot, read_json
from .catalog import ModelCatalog
from .config import BACKEND
from .data import BaselineError, sha256
from .datasets import load_manifest, manifest_relative
from .metrics import DEFAULT_METRIC_SET, get_metric_set


class TrainingExecutor:
    """Run one registered dataset/method and publish only a verified model."""

    def __init__(self, catalog=None, artifact_root=None):
        self.catalog = catalog or ModelCatalog()
        self.artifact_root = Path(
            artifact_root if artifact_root is not None else BACKEND / "artifacts").resolve()

    def run(self, dataset_manifest, algorithm, metric_set=None, *, output_key,
            channel="training-task", request_id=None, holdout=None):
        """执行一次训练并登记模型。

        `holdout` 是 epoch 截止时间：给出时只有早于该时间的记录参与时间切分、
        训练与验证，近期记录仍可由调用方用于评分。管理员普通训练不传，保持
        既有全量切分行为。
        """
        manifest_path = Path(dataset_manifest).resolve()
        dataset = load_manifest(manifest_path)
        get_algorithm(algorithm)
        metric_set = metric_set or DEFAULT_METRIC_SET
        get_metric_set(metric_set)
        if (not isinstance(output_key, str) or "/" in output_key or "\\" in output_key
                or not output_key or output_key.startswith(".")):
            raise BaselineError("INPUT_INVALID", "训练产物 key 必须是单级安全名称")
        output = (self.artifact_root / output_key).resolve()
        if not output.is_relative_to(self.artifact_root) or output == self.artifact_root:
            raise BaselineError("INPUT_INVALID", "训练产物路径越界")
        if output.exists():
            raise BaselineError("OUTPUT_EXISTS", "训练产物目录已存在，请为新任务使用新标识")
        built = artifacts.build_run(
            BACKEND / "data/openstack", output, schema=dataset["schemaName"],
            algorithm=algorithm, metric_set=metric_set, dataset_manifest=manifest_path,
            holdout=holdout)
        # Catalog registration performs full verification before publishing readiness.
        registered = self.catalog.register_key(
            output_key, channel=channel, request_id=request_id)
        summary = read_json(output / "summary.json")
        snapshot = Snapshot.load(output)
        return {
            "artifactKey": output_key,
            "artifactRunId": built["runId"],
            "runId": registered["model"]["runId"],
            "modelId": registered["model"]["modelId"],
            "datasetVersion": dataset["version"],
            "datasetManifest": manifest_relative(manifest_path),
            "manifestSha256": sha256(manifest_path.read_bytes()),
            "featureSchemaVersion": snapshot.schema.name,
            "metricSet": metric_set,
            "metrics": summary["metrics"],
            "trainingSeconds": summary.get("trainingSeconds"),
            "snapshot": snapshot,
        }
