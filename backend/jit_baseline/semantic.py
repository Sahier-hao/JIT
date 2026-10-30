"""预训练代码语义编码与嵌入表（CSF-02）。

编码只发生在离线构建阶段：文本 sidecar → 嵌入表 + 元数据；训练只读嵌入表。
"""
import hashlib
import json
import os
from pathlib import Path

import numpy as np

from .errors import BaselineError

DEFAULT_MODEL = "microsoft/codebert-base"
DEFAULT_POOLING = "mean"
DEFAULT_MAX_LENGTH = 256

EMBEDDING_FILE = "embeddings.npy"
IDS_FILE = "ids.json"
META_FILE = "meta.json"


def _read_text(path):
    entries = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            entries.append(json.loads(line))
        except ValueError as exc:
            raise BaselineError("DATA_INVALID", f"文本 sidecar 格式无效：{line[:40]}") from exc
    if not entries:
        raise BaselineError("DATA_INVALID", "文本 sidecar 为空，无法生成嵌入")
    return entries


def _resolve_revision(model_id, revision):
    if revision:
        return revision
    try:
        from huggingface_hub import model_info
        return model_info(model_id).sha
    except Exception as exc:  # 网络或权重源不可用
        raise BaselineError("MODEL_INVALID", f"无法解析编码器 revision：{exc}") from exc


def encode_entries(entries, *, model_id=DEFAULT_MODEL, revision=None, pooling=DEFAULT_POOLING,
                   max_length=DEFAULT_MAX_LENGTH, batch_size=16, hf_home=None, hf_endpoint=None):
    """用固定 revision 的预训练模型编码文本；返回 (embeddings, meta 片段)。"""
    if hf_home:
        os.environ["HF_HOME"] = str(hf_home)
    if hf_endpoint:
        os.environ["HF_ENDPOINT"] = hf_endpoint
    resolved_revision = _resolve_revision(model_id, revision)
    try:
        import torch
        from transformers import AutoModel, AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(model_id, revision=resolved_revision)
        model = AutoModel.from_pretrained(model_id, revision=resolved_revision)
    except BaselineError:
        raise
    except Exception as exc:
        raise BaselineError("MODEL_INVALID", f"无法加载预训练编码器：{exc}") from exc
    model.eval()
    torch.set_num_threads(1)
    texts = [f"{entry.get('subject') or ''}\n{entry.get('diff') or ''}" for entry in entries]
    vectors = []
    try:
        with torch.no_grad():
            for start in range(0, len(texts), batch_size):
                batch = tokenizer(texts[start:start + batch_size], padding=True, truncation=True,
                                  max_length=max_length, return_tensors="pt")
                hidden = model(**batch).last_hidden_state
                if pooling == "cls":
                    pooled = hidden[:, 0]
                elif pooling == "mean":
                    mask = batch["attention_mask"].unsqueeze(-1)
                    pooled = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1)
                else:
                    raise BaselineError("MODEL_INVALID", f"不支持的池化方式：{pooling}")
                vectors.append(pooled.cpu().numpy())
    except BaselineError:
        raise
    except Exception as exc:
        raise BaselineError("MODEL_INVALID", f"编码失败：{exc}") from exc
    embeddings = np.vstack(vectors).astype("float32")
    return embeddings, {"model": model_id, "revision": resolved_revision,
                        "dim": int(embeddings.shape[1]), "pooling": pooling,
                        "maxLength": max_length, "count": len(entries)}


def build_embeddings(text_path, output_dir, **kwargs):
    """读取文本 sidecar 并写出 embeddings.npy / ids.json / meta.json。"""
    text_path = Path(text_path)
    entries = _read_text(text_path)
    embeddings, meta = encode_entries(entries, **kwargs)
    ids = [entry["commit_id"] for entry in entries]
    if len(set(ids)) != len(ids):
        raise BaselineError("DATA_INVALID", "文本 sidecar 含重复 commit_id")
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    embeddings_path = output / EMBEDDING_FILE
    np.save(embeddings_path, embeddings)
    (output / IDS_FILE).write_text(json.dumps(ids, ensure_ascii=False, indent=2) + "\n",
                                   encoding="utf-8")
    meta = dict(meta, textSha256=hashlib.sha256(text_path.read_bytes()).hexdigest(),
                embeddingsSha256=hashlib.sha256(embeddings_path.read_bytes()).hexdigest())
    (output / META_FILE).write_text(json.dumps(meta, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
                                    encoding="utf-8")
    return meta


def load_embeddings(directory):
    """加载并校验嵌入表；缺失、哈希不符或维度不一致一律拒绝。"""
    directory = Path(directory)
    try:
        meta = json.loads((directory / META_FILE).read_text(encoding="utf-8"))
        ids = json.loads((directory / IDS_FILE).read_text(encoding="utf-8"))
        embeddings = np.load(directory / EMBEDDING_FILE)
    except (OSError, ValueError) as exc:
        raise BaselineError("ARTIFACT_UNAVAILABLE", f"嵌入表不可用：{directory.name}") from exc
    if not isinstance(ids, list) or len(ids) != len(set(ids)) or len(ids) != len(embeddings):
        raise BaselineError("ARTIFACT_INVALID", "嵌入表的 ids 与向量数量不一致")
    if meta.get("dim") != int(embeddings.shape[1]) or meta.get("count") != len(ids):
        raise BaselineError("ARTIFACT_INVALID", "嵌入表维度或数量与元数据不一致")
    actual = hashlib.sha256((directory / EMBEDDING_FILE).read_bytes()).hexdigest()
    if meta.get("embeddingsSha256") != actual:
        raise BaselineError("INTEGRITY_ERROR", "嵌入表校验值与元数据不一致")
    return {identity: vector for identity, vector in zip(ids, embeddings)}, meta


def validate_embedding_meta(meta, semantic, dataset_text):
    """核对 schema 声明与数据集登记的文本来源，拒绝任何静默替换。"""
    expected = {
        "model": semantic.get("model"),
        "revision": semantic.get("revision"),
        "dim": semantic.get("dim"),
        "pooling": semantic.get("pooling"),
        "maxLength": semantic.get("maxLength"),
    }
    for key, value in expected.items():
        if meta.get(key) != value:
            raise BaselineError("ARTIFACT_INVALID", f"嵌入表 {key} 与 schema 声明不一致")
    if not isinstance(dataset_text, dict):
        raise BaselineError("DATASET_INVALID", "语义运行的数据集未登记文本 sidecar")
    text_sha256 = dataset_text.get("sha256")
    if not isinstance(text_sha256, str) or len(text_sha256) != 64:
        raise BaselineError("DATASET_INVALID", "数据集文本 sidecar 缺少有效 SHA-256")
    if meta.get("textSha256") != text_sha256:
        raise BaselineError("ARTIFACT_INVALID", "嵌入表的文本 SHA-256 与数据集登记不一致")


def compare_schemes(directories):
    """三种输入方案并列：失败保留，成功运行再按共同口径判断可比性。"""
    if not directories:
        raise BaselineError("EVALUATION_INVALID", "没有可比较的运行")
    entries, successful = [], []
    for directory in directories:
        directory = Path(directory)
        try:
            summary = json.loads((directory / "summary.json").read_text(encoding="utf-8"))
            manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
            split = json.loads((directory / "split.json").read_text(encoding="utf-8"))
            fact = {"runId": manifest["runId"], "schema": summary["featureSchema"]["name"],
                    "datasetVersion": summary["datasetVersion"],
                    "metricSet": manifest["config"].get("metricSet"),
                    "threshold": summary["threshold"],
                    "test": tuple(split["partitions"]["test"]["ids"]),
                    "testCount": split["partitions"]["test"]["count"],
                    "metrics": summary["metrics"],
                    "trainingSeconds": summary.get("trainingSeconds")}
        except (OSError, ValueError, KeyError, TypeError) as exc:
            entries.append({"runId": directory.name, "failed": True,
                            "error": {"code": "ARTIFACT_UNAVAILABLE",
                                      "message": f"运行不可用：{directory.name}"}})
            continue
        entries.append(fact)
        successful.append(fact)
    if not successful:
        return {"kind": "semantic-scheme-comparison", "directlyComparable": False,
                "reasons": ["全部运行均不可用"], "testCount": None, "schemes": entries}
    base = successful[0]
    reasons = []
    labels = {"datasetVersion": "数据版本", "test": "测试成员",
              "metricSet": "指标集", "threshold": "阈值"}
    for fact in successful[1:]:
        for key, label in labels.items():
            if fact[key] != base[key]:
                reasons.append(f"{fact['runId'][:12]} 的{label}与 {base['runId'][:12]} 不同")
    for fact in entries:
        if fact.get("failed"):
            reasons.append(f"{fact['runId']} 运行失败，缺少并列指标")
    return {"kind": "semantic-scheme-comparison", "directlyComparable": not reasons,
            "reasons": sorted(set(reasons)), "testCount": base["testCount"],
            "schemes": entries}
