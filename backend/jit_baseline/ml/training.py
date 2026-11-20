"""Shared training execution used by admin jobs and repository sync."""
from bisect import bisect_left
from pathlib import Path

from . import artifacts

from .algorithms import get_algorithm
from .artifacts import Snapshot, read_json
from .catalog import ModelCatalog
from ..config import BACKEND
from ..data import BaselineError, sha256
from .datasets import load_manifest, manifest_relative
from .metrics import DEFAULT_METRIC_SET, THRESHOLD, get_metric_set
from .label_maturity import resolve_policy


def validation_threshold_preview(records, risks):
    """Exact aggregate counts at the 101 supported thresholds, without per-commit scores."""
    positives, negatives = [], []
    for record, risk in zip(records, risks, strict=True):
        (positives if record["label"] == 1 else negatives).append(risk)
    positives.sort()
    negatives.sort()
    thresholds = [index / 100 for index in range(101)]
    return {
        "positives": len(positives),
        "negatives": len(negatives),
        "defaultThreshold": THRESHOLD,
        "truePositives": [len(positives) - bisect_left(positives, threshold) for threshold in thresholds],
        "falsePositives": [len(negatives) - bisect_left(negatives, threshold) for threshold in thresholds],
    }


class TrainingExecutor:
    """Run one registered dataset/method and publish only a verified model."""

    def __init__(self, catalog=None, artifact_root=None):
        self.catalog = catalog or ModelCatalog()
        self.artifact_root = Path(
            artifact_root if artifact_root is not None else BACKEND / "artifacts").resolve()

    def run(self, dataset_manifest, algorithm, metric_set=None, *, output_key,
            channel="training-task", request_id=None, holdout=None, model_name=None,
              class_policy=None, split_preset=None, maturity_policy=None,
              split_override=None, params=None, register=True, history_callback=None,
              include_threshold_preview=False):
        """执行一次训练并登记模型。

        `holdout` 是 epoch 截止时间：给出时只有早于该时间的记录参与时间切分、
        训练与验证，近期记录仍可由调用方用于评分。管理员普通训练不传，保持
        既有全量切分行为。`params` 是显式参数覆盖，默认保持方法冻结声明。
        `register=False` 只产出并校验运行，不登记模型；多方法实验使用该路径，
        训练成功后仍需管理员显式登记。
        """
        manifest_path = Path(dataset_manifest).resolve()
        dataset = load_manifest(manifest_path)
        get_algorithm(algorithm)
        metric_set = metric_set or DEFAULT_METRIC_SET
        get_metric_set(metric_set)
        maturity_policy = resolve_policy(maturity_policy)
        if (not isinstance(output_key, str) or "/" in output_key or "\\" in output_key
                or not output_key or output_key.startswith(".")):
            raise BaselineError("INPUT_INVALID", "训练产物 key 必须是单级安全名称")
        output = (self.artifact_root / output_key).resolve()
        if not output.is_relative_to(self.artifact_root) or output == self.artifact_root:
            raise BaselineError("INPUT_INVALID", "训练产物路径越界")
        if output.exists():
            raise BaselineError("OUTPUT_EXISTS", "训练产物目录已存在，请为新任务使用新标识")
        preview = None

        def collect_validation(records, risks):
            nonlocal preview
            preview = validation_threshold_preview(records, risks)

        built = artifacts.build_run(
            BACKEND / "data/openstack", output, schema=dataset["schemaName"],
            algorithm=algorithm, metric_set=metric_set, dataset_manifest=manifest_path,
            holdout=holdout, model_name=model_name, class_policy=class_policy,
            split_preset=split_preset, maturity_policy=maturity_policy,
            split_override=split_override, params=params,
            **({"history_callback": history_callback} if history_callback is not None else {}),
            **({"validation_callback": collect_validation} if include_threshold_preview else {}))
        # Catalog registration performs full verification before publishing readiness.
        registered = (self.catalog.register_key(output_key, channel=channel, request_id=request_id)
                      if register else None)
        summary = read_json(output / "summary.json")
        partitions = summary.get("metricsByPartition")
        if preview is not None:
            partitions["validation"]["thresholdPreview"] = preview
        snapshot = Snapshot.load(output)
        return {
            "artifactKey": output_key,
            "artifactRunId": built["runId"],
            "runId": registered["model"]["runId"] if registered else None,
            "modelId": registered["model"]["modelId"] if registered else None,
            "registered": registered is not None,
            "datasetVersion": dataset["version"],
            "datasetManifest": manifest_relative(manifest_path),
            "manifestSha256": sha256(manifest_path.read_bytes()),
            "featureSchemaVersion": snapshot.schema.name,
            "metricSet": metric_set,
            "metrics": summary["metrics"],
            "metricsByPartition": partitions,
            "split": summary.get("split"),
            "splitRule": summary.get("splitRule"),
            "dataScale": summary.get("dataScale"),
            "trainingPerformance": summary.get("trainingPerformance"),
            "trainingSeconds": summary.get("trainingSeconds"),
            "parameters": summary.get("parameters"),
            "parameterContract": summary.get("parameterContract"),
            "trainingHistory": summary.get("trainingHistory"),
            "classPolicy": summary.get("classPolicy"),
            "splitPolicy": summary.get("splitPolicy"),
            "maturity": summary.get("maturity"),
            "snapshot": snapshot,
        }
