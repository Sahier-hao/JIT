"""JIT-Fine native CodeBERT + expert-feature reproduction."""
from __future__ import annotations

import math
import random
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from sklearn import preprocessing

from ..errors import BaselineError
from .catalog import verify_material
from .common import finite_probability, seed_everything, write_json, write_jsonl
from .data import (jitfine_line_labels, jitsmart_line_labels, load_jit_defect4j_split,
                   material_path)
from .metrics import commit_metrics, line_metrics
from .runner import append_log, new_run

MANUAL_FEATURES = ["la", "ld", "nf", "ns", "nd", "entropy", "ndev",
                   "lt", "nuc", "age", "exp", "rexp", "sexp", "fix"]
MAX_SEQUENCE = 512


class JITFineClassifier(nn.Module):
    def __init__(self, encoder, feature_size=14):
        super().__init__()
        self.encoder = encoder
        hidden = encoder.config.hidden_size
        self.manual_dense = nn.Linear(feature_size, hidden)
        self.dropout = nn.Dropout(encoder.config.hidden_dropout_prob)
        self.out_proj = nn.Linear(hidden + hidden, 1)

    def forward(self, input_ids, attention_mask, manual_features, labels=None,
                output_attentions=False):
        outputs = self.encoder(input_ids=input_ids, attention_mask=attention_mask,
                               output_attentions=output_attentions)
        cls = outputs.last_hidden_state[:, 0, :]
        manual = torch.tanh(self.manual_dense(manual_features.float()))
        logits = self.out_proj(self.dropout(torch.cat((cls, manual), dim=-1))).squeeze(1)
        probability = torch.sigmoid(logits)
        loss = nn.functional.binary_cross_entropy(probability,
                                                  labels.float()) if labels is not None else None
        attention = (outputs.attentions[-1][:, :, 0].detach()
                     if output_attentions else None)
        return loss, probability, attention


@dataclass
class Example:
    commit_id: str
    input_ids: list[int]
    input_mask: list[int]
    input_tokens: list[str]
    manual_features: list[float]
    label: int
    project: str
    epoch: int
    la: float
    ld: float


def codebert_directory() -> Path:
    result = verify_material("codebert-base")
    if not result["available"]:
        raise BaselineError("AUTHOR_MATERIAL_MISSING",
                            "缺少固定的 CodeBERT 权重：" + "、".join(result.get("missing", [])))
    return material_path("codebert-base")


def load_codebert():
    try:
        from transformers import RobertaModel, RobertaTokenizer
    except Exception as exc:
        raise BaselineError("AUTHOR_DEPENDENCY_MISSING", "无法导入 Transformers") from exc
    path = codebert_directory()
    tokenizer = RobertaTokenizer.from_pretrained(str(path), local_files_only=True)
    encoder = RobertaModel.from_pretrained(
        str(path), local_files_only=True, attn_implementation="eager")
    return tokenizer, encoder


def _normalize_code_line(line):
    value = str(line)
    for char in "(){}[].,:;,":
        value = value.replace(char, " ")
    value = value.replace(" _ ", "_")
    value = re.sub(r"``.*``", "<STR>", value)
    value = re.sub(r"'.*'", "<STR>", value)
    value = re.sub(r'".*"', "<STR>", value)
    value = re.sub(r"\d+", "<NUM>", value)
    return " ".join(value.split())


def _convert_examples(items, tokenizer, range_spec, features_by_commit):
    examples = []
    for commit_id, label, message, files in items:
        added = sorted(" ".join(str(line).split()) for line in files.get("added_code", ())
                       if str(line).strip())
        removed = sorted(" ".join(str(line).split()) for line in files.get("removed_code", ())
                         if str(line).strip())
        message_tokens = tokenizer.tokenize(str(message))[:range_spec.max_msg_length]
        added_tokens = tokenizer.tokenize("[ADD]".join(added))
        removed_tokens = tokenizer.tokenize("[DEL]".join(removed))
        tokens = message_tokens + ["[ADD]"] + added_tokens + ["[DEL]"] + removed_tokens
        tokens = tokens[:range_spec.max_seq_length - 2]
        tokens = [tokenizer.cls_token, *tokens, tokenizer.sep_token]
        ids = tokenizer.convert_tokens_to_ids(tokens)
        mask = [1] * len(ids)
        padding = range_spec.max_seq_length - len(ids)
        ids += [0] * padding
        mask += [0] * padding
        examples.append(Example(
            commit_id=str(commit_id),
            input_ids=ids,
            input_mask=mask,
            input_tokens=tokens,
            manual_features=features_by_commit[str(commit_id)],
            label=int(label),
            project=str(features_by_commit["_project"][str(commit_id)]),
            epoch=int(features_by_commit["_epoch"][str(commit_id)]),
            la=float(features_by_commit["_la"][str(commit_id)]),
            ld=float(features_by_commit["_ld"][str(commit_id)]),
        ))
    return examples


def _features(frame):
    frame = frame.copy()
    frame["fix"] = frame["fix"].map(
        lambda value: 1.0 if str(value).strip().lower() in ("true", "1", "1.0") else 0.0)
    raw = frame[MANUAL_FEATURES].to_numpy(dtype=float)
    scaled = preprocessing.scale(raw)
    result = {str(commit): scaled[index].tolist()
              for index, commit in enumerate(frame["commit_hash"].astype(str))}
    result["_project"] = {str(commit): str(project) for commit, project
                          in zip(frame["commit_hash"], frame["project"], strict=True)}
    result["_epoch"] = {str(commit): int(epoch) for commit, epoch
                        in zip(frame["commit_hash"], frame["author_date_unix_timestamp"],
                               strict=True)}
    result["_la"] = {str(commit): float(value) for commit, value
                     in zip(frame["commit_hash"], frame["la"], strict=True)}
    result["_ld"] = {str(commit): float(value) for commit, value
                     in zip(frame["commit_hash"], frame["ld"], strict=True)}
    return result


def _sample(items, limit, seed):
    if not limit or limit >= len(items):
        return items
    generator = random.Random(seed)
    positives = [item for item in items if int(item[1]) == 1]
    negatives = [item for item in items if int(item[1]) == 0]
    take_pos = min(len(positives), max(1, limit // 2))
    take_neg = min(len(negatives), limit - take_pos)
    chosen = generator.sample(positives, take_pos) + generator.sample(negatives, take_neg)
    generator.shuffle(chosen)
    return chosen


def build_examples(split, tokenizer, *, limit=None, seed=42):
    changes, frame = load_jit_defect4j_split(split)
    items = list(zip(changes[0], changes[1], changes[2], changes[3], strict=True))
    items = _sample(items, limit, seed)
    features = _features(frame)
    class Spec:
        max_seq_length = MAX_SEQUENCE
        max_msg_length = 64
    return _convert_examples(items, tokenizer, Spec, features)


def _batch(examples, device):
    return (
        torch.as_tensor([item.input_ids for item in examples], dtype=torch.long, device=device),
        torch.as_tensor([item.input_mask for item in examples], dtype=torch.long, device=device),
        torch.as_tensor([item.manual_features for item in examples], dtype=torch.float32,
                        device=device),
        torch.as_tensor([item.label for item in examples], dtype=torch.float32, device=device),
    )


def train_examples(model, examples, *, epochs, batch_size, learning_rate, device, run):
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
    model.to(device)
    for epoch in range(epochs):
        model.train()
        generator = np.random.RandomState(42 + epoch)
        order = generator.permutation(len(examples))
        losses = []
        for start in range(0, len(order), batch_size):
            chunk = [examples[int(index)] for index in order[start:start + batch_size]]
            ids, mask, manual, labels = _batch(chunk, device)
            optimizer.zero_grad()
            loss, _, _ = model(ids, mask, manual, labels)
            loss.backward()
            optimizer.step()
            losses.append(float(loss.item()))
        append_log(run, f"JIT-Fine epoch={epoch + 1} loss={np.mean(losses):.6f}")


@torch.no_grad()
def predict_examples(model, examples, *, batch_size, device):
    model.eval()
    probabilities, attentions = [], []
    for start in range(0, len(examples), batch_size):
        chunk = examples[start:start + batch_size]
        ids, mask, manual, _labels = _batch(chunk, device)
        _, probability, attention = model(ids, mask, manual, output_attentions=True)
        probabilities.extend(probability.cpu().tolist())
        attentions.append(attention.mean(dim=1).cpu().numpy())
    return [finite_probability(value) for value in probabilities], np.concatenate(attentions, 0)


def _line_labels_by_commit():
    frame = jitfine_line_labels()
    path_frame = jitsmart_line_labels("test")
    paths = {
        (str(row["commit hash"]), int(row["idx"])): str(row["file"])
        for _, row in path_frame.iterrows()
    }
    result = {}
    for _, row in frame.iterrows():
        commit = str(row["commit_id"])
        key = (commit, int(row["idx"]))
        result.setdefault(commit, []).append({
            "idx": int(row["idx"]),
            "path": paths.get(key),
            "text": str(row["raw_changed_line"]),
            "modelText": str(row["changed_line"]),
            "label": int(row["label"]),
            "changedType": str(row["changed_type"]),
        })
    return result


def localization_rows(examples, probabilities, attentions, tokenizer):
    labels = _line_labels_by_commit()
    line_rows, token_rows = [], []
    explained_commits = 0
    for example, probability, attention in zip(examples, probabilities, attentions, strict=True):
        if example.label != 1 or probability < 0.5 or "[ADD]" not in example.input_tokens:
            continue
        commit_lines = labels.get(example.commit_id)
        if not commit_lines:
            continue
        explained_commits += 1
        try:
            begin = example.input_tokens.index("[ADD]")
            end = (example.input_tokens.index("[DEL]")
                   if "[DEL]" in example.input_tokens else len(example.input_tokens) - 1)
        except ValueError:
            continue
        token_weights = {}
        for token, weight in zip(example.input_tokens[begin:end],
                                 attention[begin:end], strict=True):
            token = token.replace("\u0120", "")
            token_weights[token] = token_weights.get(token, 0.0) + float(weight)
        for line in commit_lines:
            if line["changedType"] != "added":
                continue
            tokens = [token.replace("\u0120", "")
                      for token in tokenizer.tokenize(line["modelText"])]
            score = sum(token_weights.get(token, 0.0) for token in tokens)
            line_rows.append({
                "commitId": example.commit_id,
                "path": line["path"],
                "idx": line["idx"],
                "gitLine": None,
                "lineNumberReason": "author-table-has-line-index-but-no-git-line-number",
                "text": line["text"],
                "label": line["label"],
                "lineScore": score,
            })
            for position, token in enumerate(tokens):
                if token_weights.get(token):
                    token_rows.append({
                        "commitId": example.commit_id, "idx": line["idx"],
                        "tokenPosition": position, "token": token,
                        "weight": token_weights[token],
                    })
    status = {
        "explainedCommits": explained_commits,
        "lineRows": len(line_rows),
        "tokenLinks": len(token_rows),
        "uncoveredReason": ("no correctly predicted positive commit had author line labels"
                            if not line_rows else None),
    }
    return line_rows, token_rows, status


def run_jitfine(*, output=None, seed=42, max_train=32, max_valid=16, max_test=32,
                epochs=1, batch_size=2, learning_rate=1e-5, argv=None) -> dict:
    seed_everything(seed)
    tokenizer, encoder = load_codebert()
    train = build_examples("train", tokenizer, limit=max_train, seed=seed)
    valid = build_examples("valid", tokenizer, limit=max_valid, seed=seed + 1)
    test = build_examples("test", tokenizer, limit=max_test, seed=seed + 2)
    if not train or not test:
        raise BaselineError("AUTHOR_SAMPLE_INSUFFICIENT", "JIT-Fine 训练或测试样本为空")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = JITFineClassifier(encoder)
    material_hashes = {
        "jit-fine-jit-defect4j": verify_material("jit-fine-jit-defect4j")["hashes"],
        "codebert-base": {
            name: __import__("hashlib").sha256((material_path("codebert-base") / name)
                                               .read_bytes()).hexdigest()
            for name in ("config.json", "pytorch_model.bin", "vocab.json", "merges.txt")
        },
    }
    config = {
        "model": "microsoft/codebert-base",
        "maxSeqLength": MAX_SEQUENCE,
        "maxMessageLength": 64,
        "featureSize": 14,
        "featureColumns": MANUAL_FEATURES,
        "featureScaling": "sklearn preprocessing.scale per split (author behavior)",
        "loss": "BCEWithLogits-equivalent BCE on sigmoid probability",
        "learningRate": learning_rate,
        "epochs": epochs,
        "batchSize": batch_size,
        "device": str(device),
        "sampleLimits": {"train": max_train, "valid": max_valid, "test": max_test},
        "fullProtocol": False,
        "compatibility": "Modern PyTorch/Transformers API; method logic follows author concat model.",
        "hardwareBlocker": ({
            "reason": "CPU-only environment cannot complete the author 50-epoch full JIT-Fine protocol in the available window.",
            "required": "CUDA GPU or a longer dedicated CPU run with the same frozen inputs and 50 epochs.",
        } if not torch.cuda.is_available() else None),
    }
    run = new_run(
        "jitfine", version="jitfine-author-code-v1", fidelity="real-smoke",
        material_hashes=material_hashes, config=config,
        split={"kind": "author-split-sample", "seed": seed},
        seed=seed, output=output, argv=argv,
    )
    try:
        train_examples(model, train, epochs=epochs, batch_size=batch_size,
                       learning_rate=learning_rate, device=device, run=run)
        probabilities, attentions = predict_examples(
            model, test, batch_size=batch_size, device=device)
        torch.save(model.state_dict(), run.directory / "model.pt")
        records = [{"id": item.commit_id, "label": item.label, "epoch": item.epoch,
                    "la": item.la, "ld": item.ld} for item in test]
        metrics = commit_metrics(records, probabilities)
        line_rows, token_rows, line_status = localization_rows(
            test, probabilities, attentions, tokenizer)
        localization = (line_metrics(line_rows) if line_rows
                        else {"samples": 0, "reason": line_status["uncoveredReason"]})
        localization["coverage"] = line_status
        write_jsonl(run.directory / "predictions.jsonl", [{
            "commitId": item.commit_id, "score": score, "label": item.label,
            "project": item.project,
        } for item, score in zip(test, probabilities, strict=True)])
        write_jsonl(run.directory / "line-predictions.jsonl", line_rows)
        write_jsonl(run.directory / "token-line-map.jsonl", token_rows)
        write_json(run.directory / "metrics.json", {
            "schema": "author-jitfine-metrics-v1",
            "commit": metrics,
            "line": localization,
            "samples": {"train": len(train), "valid": len(valid), "test": len(test)},
            "limitations": [
                "This is a real-sample CPU smoke run, not the author 50-epoch full protocol.",
                "Author per-split feature standardization is preserved and is not a clean train-only scaling protocol.",
                "Line labels do not contain Git line numbers; only table index/file identity is available.",
            ],
        })
        append_log(run, f"JIT-Fine smoke completed: train={len(train)} test={len(test)} "
                        f"lines={len(line_rows)}")
        return run.complete({
            "mode": "real-smoke",
            "samples": {"train": len(train), "valid": len(valid), "test": len(test)},
            "commitMetrics": metrics,
            "lineMetrics": localization,
            "lineRows": len(line_rows),
        })
    except Exception as exc:
        run.fail(getattr(exc, "code", "AUTHOR_RUN_FAILED"), str(exc))
        raise
