"""用验证集选择阈值，再基于冻结分数进行测试复核。"""

import json

from ..artifacts import check_files
from ..data import BaselineError, sha256
from ..metrics import THRESHOLD, classification, classification_counts
from ..splits import membership_digest


def split_member_sha(task):
    return (task.get("splitPolicy") or {}).get("memberSha256")


def _ratio(value, label):
    if type(value) not in (int, float) or not 0 <= value <= 1:
        raise BaselineError("INPUT_INVALID", f"{label}须为 0 到 1 的数值")
    return value


def _selection(request):
    strategy = request.get("strategy")
    if strategy == "fixed":
        threshold = _ratio(request.get("threshold"), "阈值")
        if round(threshold, 2) != threshold:
            raise BaselineError("INPUT_INVALID", "阈值最多保留两位小数")
        return {"strategy": strategy, "threshold": threshold}
    if strategy == "target-recall":
        target = _ratio(request.get("targetRecall"), "目标召回率")
        if target == 0:
            raise BaselineError("INPUT_INVALID", "目标召回率须大于 0")
        return {"strategy": strategy, "targetRecall": target}
    if strategy == "max-f1":
        return {"strategy": strategy}
    raise BaselineError("INPUT_INVALID", "请选择有效的阈值选择方式")


def _validation_point(task, selection):
    validation = (task.get("metricsByPartition") or {}).get("validation") or {}
    preview = validation.get("thresholdPreview")
    if not isinstance(preview, dict):
        raise BaselineError("INPUT_INVALID", "所选模型未保存验证集阈值数据")
    positives, negatives = preview.get("positives"), preview.get("negatives")
    hits, errors = preview.get("truePositives"), preview.get("falsePositives")
    for count, series in ((positives, hits), (negatives, errors)):
        if (type(count) is not int or count < 0 or not isinstance(series, list)
                or len(series) != 101 or any(type(n) is not int or not 0 <= n <= count for n in series)):
            raise BaselineError("INPUT_INVALID", "验证集阈值数据无效")
    strategy = selection["strategy"]
    if strategy == "fixed":
        tick = round(selection["threshold"] * 100)
    else:
        if not positives:
            raise BaselineError("INPUT_INVALID", "验证集没有正例，无法按 F1 或目标召回率选阈值")
        if strategy == "max-f1":
            tick = max(range(101), key=lambda i: (2 * hits[i] / (positives + hits[i] + errors[i]), -errors[i], i))
        else:
            eligible = [i for i in range(101) if hits[i] / positives >= selection["targetRecall"]]
            if not eligible:
                raise BaselineError("INPUT_INVALID", "验证集未达到目标召回率")
            tick = max(eligible, key=lambda i: (-errors[i], hits[i], i))
    tp, fp = hits[tick], errors[tick]
    return tick / 100, classification_counts(tp, fp, negatives - fp, positives - tp)


def _verified_json(directory, hashes, name):
    try:
        blob = (directory / name).read_bytes()
    except OSError as exc:
        raise BaselineError("ARTIFACT_UNAVAILABLE", f"无法读取测试产物：{name}") from exc
    if sha256(blob) != hashes.get(name):
        raise BaselineError("INTEGRITY_ERROR", f"测试产物校验失败：{name}")
    try:
        return json.loads(blob)
    except ValueError as exc:
        raise BaselineError("ARTIFACT_INVALID", f"测试产物格式无效：{name}") from exc


def _frozen_test(task, artifact_root):
    key = task.get("artifactKey")
    if not key or not task.get("artifactRunId"):
        raise BaselineError("ARTIFACT_UNAVAILABLE", "所选模型缺少冻结测试产物")
    directory = (artifact_root / key).resolve()
    if directory.parent != artifact_root:
        raise BaselineError("ARTIFACT_INVALID", "测试产物路径无效")
    manifest = check_files(directory, ())
    config = manifest["config"]
    if (manifest["runId"] != task["artifactRunId"]
            or (config.get("datasetManifest") or {}).get("sha256") != task["manifestSha256"]):
        raise BaselineError("ARTIFACT_INVALID", "测试产物与训练运行身份不一致")
    files = config["coreFiles"]
    partitions = _verified_json(directory, files, "split.json")["partitions"]
    labels = _verified_json(directory, files, "test-labels.json")
    scores = _verified_json(directory, files, "reference-predictions.json")
    ids = partitions["test"]["ids"]
    if (membership_digest(partitions) != split_member_sha(task)
            or [row["id"] for row in labels] != ids or [row["id"] for row in scores] != ids):
        raise BaselineError("ARTIFACT_INVALID", "测试产物与冻结分区成员不一致")
    return [row["label"] for row in labels], [row["risk"] for row in scores]


def evaluate_thresholds(view, request, artifact_root):
    task_ids = request.get("taskIds")
    if (not isinstance(task_ids, list) or not 1 <= len(task_ids) <= 2
            or any(not isinstance(key, str) for key in task_ids)
            or len(set(task_ids)) != len(task_ids)):
        raise BaselineError("INPUT_INVALID", "请选择一个或两个不同的训练结果")
    selection = _selection(request)
    successful = {task["taskId"]: task for task in view["tasks"] if task["status"] == "succeeded"}
    if any(key not in successful for key in task_ids):
        raise BaselineError("INPUT_INVALID", "请选择同一实验中已完成的训练结果")
    tasks = [successful[key] for key in task_ids]
    members = split_member_sha(tasks[0])
    if not members or any(split_member_sha(task) != members
                          or task["manifestSha256"] != view["manifestSha256"] for task in tasks):
        raise BaselineError("INPUT_INVALID", "所选模型的冻结分区成员或数据版本不一致")
    points = [_validation_point(task, selection) for task in tasks]
    methods = []
    for task, (threshold, validation) in zip(tasks, points, strict=True):
        labels, risks = _frozen_test(task, artifact_root)
        positives = sum(labels)
        negatives = len(labels) - positives
        maturity = task.get("maturity") or {}
        status_counts = maturity.get("statusCounts") or {}
        effective_policy = maturity.get("effectivePolicy")
        mature_policy = (
            maturity.get("requestedPolicy") == "mature-only"
            and effective_policy in ("mature-only", "mature-observed-v1", "recorded-maturity-v1")
            and maturity.get("releaseEligible") is True
        )
        unavailable_reason = None
        if not mature_policy:
            unavailable_reason = "训练使用了未成熟或成熟状态未记录的标签，不能生成正式测试评估"
        elif positives == 0 or negatives == 0:
            unavailable_reason = "测试分区缺少可靠正例或可靠负例，不能生成正式指标"
        formal = unavailable_reason is None
        methods.append({
            "taskId": task["taskId"],
            "artifactRunId": task["artifactRunId"],
            "runId": task.get("runId"),
            "modelId": task.get("modelId"),
            "method": task["method"],
            "threshold": threshold,
            "validation": validation,
            "test": classification(labels, [risk >= threshold for risk in risks]),
            "defaultThreshold": THRESHOLD,
            "defaultTest": classification(labels, [risk >= THRESHOLD for risk in risks]),
            "evaluation": {
                "format": "model-evaluation-v1",
                "source": "training",
                "mode": "formal" if formal else "exploratory",
                "formalAvailable": formal,
                "formalUnavailableReason": unavailable_reason,
                "partition": {
                    "kind": "test",
                    "memberSha256": members,
                    "labelSnapshot": True,
                },
                "labelPolicy": {
                    "version": "mature-binary-v1",
                    "included": ["positive", "unobserved"],
                    "excludedCounts": {
                        "immature": int(maturity.get("excludedImmature")
                                        or status_counts.get("immature", 0)),
                        "unknown": int(maturity.get("excludedUnknown")
                                       or status_counts.get("unknown", 0)),
                        "unrecorded": status_counts.get("unrecorded", 0),
                    },
                },
                "sampleCounts": {
                    "included": len(labels),
                    "positives": positives,
                    "negatives": negatives,
                    "excluded": int(maturity.get("excludedImmature") or 0),
                },
            },
        })
    return {
        "format": "training-threshold-evaluation-v1",
        "experimentId": view["experimentId"],
        "datasetVersion": view["datasetVersion"],
        "manifestSha256": view["manifestSha256"],
        "splitMemberSha256": members,
        "selection": selection,
        "methods": methods,
    }
