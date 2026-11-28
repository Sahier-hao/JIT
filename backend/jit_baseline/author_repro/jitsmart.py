"""JIT-Smart joint commit/line multi-task reproduction."""
from __future__ import annotations

import hashlib
import random
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as functional
from sklearn import preprocessing

from ..errors import BaselineError
from .catalog import verify_material
from .common import finite_probability, seed_everything, write_json, write_jsonl
from .data import jitsmart_line_labels, load_jit_defect4j_split, material_path
from .jitfine import MANUAL_FEATURES, MAX_SEQUENCE, codebert_directory, load_codebert
from .metrics import commit_metrics, line_metrics
from .runner import append_log, new_run

MAX_LINES = 256
MAX_LINE_TOKENS = 64


class FocalLoss(nn.Module):
    def __init__(self, alpha=0.25, gamma=2.0):
        super().__init__()
        self.alpha = alpha
        self.gamma = gamma

    def forward(self, logits, target):
        logits = logits.reshape(-1, 2)
        target = target.reshape(-1).long()
        probability = functional.softmax(logits, dim=1)
        chosen = probability.gather(1, target.view(-1, 1)).squeeze(1).clamp_min(1e-8)
        alpha = torch.full_like(chosen, self.alpha)
        return (-alpha * (1.0 - chosen).pow(self.gamma) * chosen.log()).mean()


class Attention(nn.Module):
    def __init__(self, hidden_size, aggregate):
        super().__init__()
        self.aggregate = aggregate
        self.w = nn.Parameter(torch.empty(hidden_size * 2, hidden_size * 2))
        self.u = nn.Parameter(torch.empty(hidden_size * 2, 1))
        nn.init.uniform_(self.w, -0.1, 0.1)
        nn.init.uniform_(self.u, -0.1, 0.1)

    def forward(self, value):
        score = torch.matmul(torch.tanh(torch.matmul(value, self.w)), self.u)
        weights = functional.softmax(score, dim=1)
        scored = value * weights
        return scored.sum(dim=1) if self.aggregate else scored


class HANLocator(nn.Module):
    def __init__(self, embedding):
        super().__init__()
        self.embedding = embedding
        self.hidden_size = 256
        self.lstm1 = nn.LSTM(embedding.embedding_dim, self.hidden_size, batch_first=True,
                             bidirectional=True)
        self.att1 = Attention(self.hidden_size, aggregate=True)
        self.lstm2 = nn.LSTM(self.hidden_size * 2, self.hidden_size, batch_first=True,
                             bidirectional=True)
        self.att2 = Attention(self.hidden_size, aggregate=False)
        self.fc1 = nn.Linear(512, 128)
        self.fc2 = nn.Linear(128, 2)
        self.dropout = nn.Dropout(0.5)

    @staticmethod
    def _initial(batch, hidden, device):
        # The author code uses unseeded randn. Zeros preserve the same shape and
        # bidirectional recurrence while making the reproduction rerunnable.
        return (torch.zeros(2, batch, hidden, device=device),
                torch.zeros(2, batch, hidden, device=device))

    def forward(self, line_ids):
        device = line_ids.device
        value = self.dropout(self.embedding(line_ids))
        batch, lines, words, dim = value.shape
        value = value.reshape(batch * lines, words, dim)
        value, _ = self.lstm1(value, self._initial(batch * lines, self.hidden_size, device))
        value = self.att1(value).reshape(batch, lines, self.hidden_size * 2)
        value, _ = self.lstm2(value, self._initial(batch, self.hidden_size, device))
        value = self.att2(value)
        return self.fc2(torch.tanh(self.fc1(value)))


class JITSmartClassifier(nn.Module):
    def __init__(self, encoder, feature_size=14, dp_loss_weight=0.3, dl_loss_weight=0.7):
        super().__init__()
        self.encoder = encoder
        self.hidden = encoder.config.hidden_size
        self.manual_dense = nn.Linear(feature_size, self.hidden)
        self.dropout = nn.Dropout(encoder.config.hidden_dropout_prob)
        self.table_head = nn.Linear(self.hidden * 2, 2)
        self.locator = HANLocator(encoder.embeddings.word_embeddings)
        self.dp_loss_weight = dp_loss_weight
        self.dl_loss_weight = dl_loss_weight
        self.dp_loss = FocalLoss(alpha=0.25, gamma=2.0)
        self.dl_loss = FocalLoss(alpha=0.25, gamma=2.0)

    def forward(self, input_ids, attention_mask, manual_features, labels,
                line_ids, line_labels, output_attentions=False):
        outputs = self.encoder(input_ids=input_ids, attention_mask=attention_mask,
                               output_attentions=output_attentions)
        cls = outputs.last_hidden_state[:, 0, :]
        manual = torch.tanh(self.manual_dense(manual_features.float()))
        table_logits = self.table_head(self.dropout(torch.cat((cls, manual), dim=-1)))
        line_logits = self.locator(line_ids)
        commit_logits = (table_logits + line_logits.mean(dim=1)) / 2
        loss = (self.dp_loss(commit_logits, labels) * self.dp_loss_weight +
                self.dl_loss(line_logits, line_labels) * self.dl_loss_weight)
        attention = (outputs.attentions[-1][:, :, 0].detach()
                     if output_attentions else None)
        commit_probability = torch.softmax(commit_logits, dim=1)[:, 1]
        line_probability = torch.softmax(line_logits, dim=-1)[:, :, 1]
        return loss, commit_probability, line_probability, attention


@dataclass
class SmartExample:
    commit_id: str
    input_ids: list[int]
    input_mask: list[int]
    input_tokens: list[str]
    manual_features: list[float]
    label: int
    line_ids: list[list[int]]
    line_labels: list[int]
    lines: list[dict]
    project: str
    epoch: int
    la: float
    ld: float


def _normalize_line(line):
    value = str(line)
    for char in "(){}[].,:;,":
        value = value.replace(char, " ")
    value = value.replace(" _ ", "_")
    value = re.sub(r"``.*``", "<STR>", value)
    value = re.sub(r"'.*'", "<STR>", value)
    value = re.sub(r'".*"', "<STR>", value)
    value = re.sub(r"\d+", "<NUM>", value)
    return " ".join(value.split())


def _features(frame):
    frame = frame.copy()
    frame["fix"] = frame["fix"].map(
        lambda value: 1.0 if str(value).strip().lower() in ("true", "1", "1.0") else 0.0)
    raw = frame[MANUAL_FEATURES].to_numpy(dtype=float)
    scaled = preprocessing.scale(raw)
    return {
        "values": {str(commit): scaled[index].tolist()
                   for index, commit in enumerate(frame["commit_hash"].astype(str))},
        "project": {str(commit): str(project) for commit, project
                    in zip(frame["commit_hash"], frame["project"], strict=True)},
        "epoch": {str(commit): int(epoch) for commit, epoch
                  in zip(frame["commit_hash"], frame["author_date_unix_timestamp"],
                         strict=True)},
        "la": {str(commit): float(value) for commit, value
               in zip(frame["commit_hash"], frame["la"], strict=True)},
        "ld": {str(commit): float(value) for commit, value
               in zip(frame["commit_hash"], frame["ld"], strict=True)},
    }


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


def _line_index(lines):
    grouped = {}
    for _, row in lines.iterrows():
        commit = str(row["commit hash"])
        grouped.setdefault(commit, []).append(row)
    for commit in grouped:
        grouped[commit] = sorted(grouped[commit],
                                 key=lambda row: (str(row["file"]), int(row["idx"])))
    return grouped


def build_examples(split, tokenizer, *, limit=None, seed=42, test_project=None):
    changes, frame = load_jit_defect4j_split(split)
    features = _features(frame)
    lines = _line_index(jitsmart_line_labels(split))
    items = list(zip(changes[0], changes[1], changes[2], changes[3], strict=True))
    if test_project:
        if split == "test":
            items = [item for item in items
                     if features["project"].get(str(item[0])) == test_project]
        else:
            items = [item for item in items
                     if features["project"].get(str(item[0])) != test_project]
    items = _sample(items, limit, seed)
    examples, truncation = [], {"lineTruncations": 0, "tokenTruncations": 0}
    pad_id = tokenizer.convert_tokens_to_ids(tokenizer.pad_token)
    for commit, label, message, files in items:
        commit = str(commit)
        selected = lines.get(commit, [])[:MAX_LINES]
        if len(lines.get(commit, [])) > MAX_LINES:
            truncation["lineTruncations"] += 1
        row_lines = []
        for source in selected:
            change_type = str(source["change type"])
            prefix = "[ADD] " if change_type == "added" else "[DEL] "
            text = prefix + _normalize_line(source["code line"])
            tokens = tokenizer.tokenize(text)[:MAX_LINE_TOKENS]
            if len(tokenizer.tokenize(text)) > MAX_LINE_TOKENS:
                truncation["tokenTruncations"] += 1
            if len(tokens) < MAX_LINE_TOKENS:
                tokens += [tokenizer.pad_token] * (MAX_LINE_TOKENS - len(tokens))
            row_lines.append({
                "path": str(source["file"]),
                "idx": int(source["idx"]),
                "text": str(source["code line"]),
                "label": int(source["label"]),
                "type": change_type,
                "ids": tokenizer.convert_tokens_to_ids(tokens),
            })
        while len(row_lines) < MAX_LINES:
            row_lines.append({"path": None, "idx": None, "text": "", "label": 0,
                              "type": "padding", "ids": [pad_id] * MAX_LINE_TOKENS})
        message_tokens = tokenizer.tokenize(str(message))[:64]
        code_tokens = []
        for line in row_lines:
            if line["idx"] is not None:
                code_tokens.extend(tokenizer.tokenize(
                    line["text"] if line["type"] == "added" else line["text"]))
        tokens = [tokenizer.cls_token, *message_tokens, *code_tokens, tokenizer.sep_token]
        tokens = tokens[:MAX_SEQUENCE]
        if len(tokens) < MAX_SEQUENCE:
            tokens += [tokenizer.pad_token] * (MAX_SEQUENCE - len(tokens))
        ids = tokenizer.convert_tokens_to_ids(tokens)
        mask = [1 if token != tokenizer.pad_token else 0 for token in tokens]
        line_ids = [line["ids"] for line in row_lines]
        line_labels = [line["label"] for line in row_lines]
        examples.append(SmartExample(
            commit_id=commit,
            input_ids=ids,
            input_mask=mask,
            input_tokens=tokens,
            manual_features=features["values"][commit],
            label=int(label),
            line_ids=line_ids,
            line_labels=line_labels,
            lines=row_lines,
            project=features["project"][commit],
            epoch=features["epoch"][commit],
            la=features["la"][commit],
            ld=features["ld"][commit],
        ))
    return examples, truncation


def _batch(examples, device):
    return (
        torch.as_tensor([item.input_ids for item in examples], dtype=torch.long, device=device),
        torch.as_tensor([item.input_mask for item in examples], dtype=torch.long, device=device),
        torch.as_tensor([item.manual_features for item in examples], dtype=torch.float32,
                        device=device),
        torch.as_tensor([item.label for item in examples], dtype=torch.long, device=device),
        torch.as_tensor([item.line_ids for item in examples], dtype=torch.long, device=device),
        torch.as_tensor([item.line_labels for item in examples], dtype=torch.long, device=device),
    )


def train_examples(model, examples, *, epochs, batch_size, learning_rate, device, run):
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
    model.to(device)
    for epoch in range(epochs):
        model.train()
        order = np.random.RandomState(42 + epoch).permutation(len(examples))
        losses = []
        for start in range(0, len(order), batch_size):
            chunk = [examples[int(index)] for index in order[start:start + batch_size]]
            values = _batch(chunk, device)
            optimizer.zero_grad()
            loss, _, _, _ = model(*values)
            loss.backward()
            optimizer.step()
            losses.append(float(loss.item()))
        append_log(run, f"JIT-Smart epoch={epoch + 1} loss={np.mean(losses):.6f}")


@torch.no_grad()
def predict_examples(model, examples, *, batch_size, device):
    model.eval()
    commit_scores, line_scores = [], []
    for start in range(0, len(examples), batch_size):
        chunk = examples[start:start + batch_size]
        values = _batch(chunk, device)
        _, commit, lines, _ = model(*values, output_attentions=True)
        commit_scores.extend(commit.cpu().tolist())
        line_scores.extend(lines.cpu().numpy())
    return [finite_probability(value) for value in commit_scores], line_scores


def line_outputs(examples, line_probabilities):
    rows = []
    for example, scores in zip(examples, line_probabilities, strict=True):
        for line, score in zip(example.lines, scores, strict=True):
            if line["idx"] is None:
                continue
            rows.append({
                "commitId": example.commit_id,
                "path": line["path"],
                "idx": line["idx"],
                "gitLine": None,
                "lineNumberReason": "author-table-has-line-index-but-no-git-line-number",
                "text": line["text"],
                "changeType": line["type"],
                "label": line["label"],
                "lineScore": float(score),
            })
    return rows


def run_jitsmart(*, output=None, seed=42, max_train=16, max_valid=8, max_test=16,
                 epochs=1, batch_size=1, learning_rate=1e-5, test_project=None,
                 argv=None) -> dict:
    seed_everything(seed)
    tokenizer, encoder = load_codebert()
    train, train_truncation = build_examples(
        "train", tokenizer, limit=max_train, seed=seed, test_project=test_project)
    valid, valid_truncation = build_examples(
        "valid", tokenizer, limit=max_valid, seed=seed + 1, test_project=test_project)
    test, test_truncation = build_examples(
        "test", tokenizer, limit=max_test, seed=seed + 2, test_project=test_project)
    if not train or not test:
        raise BaselineError("AUTHOR_SAMPLE_INSUFFICIENT", "JIT-Smart 训练或测试样本为空")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = JITSmartClassifier(encoder)
    material_hashes = {
        "jit-fine-jit-defect4j": verify_material("jit-fine-jit-defect4j")["hashes"],
        "jit-smart-line-labels": {
            Path(item["path"]).name: item.get("sha256")
            for item in verify_material("jit-smart-line-labels")["members"]
        },
        "codebert-base": {
            name: hashlib.sha256((material_path("codebert-base") / name).read_bytes()).hexdigest()
            for name in ("config.json", "pytorch_model.bin", "vocab.json", "merges.txt")
        },
    }
    config = {
        "model": "microsoft/codebert-base",
        "maxSeqLength": MAX_SEQUENCE,
        "maxLines": MAX_LINES,
        "maxLineTokens": MAX_LINE_TOKENS,
        "dpLossWeight": 0.3,
        "dlLossWeight": 0.7,
        "focalAlpha": 0.25,
        "focalGamma": 2.0,
        "learningRate": learning_rate,
        "epochs": epochs,
        "batchSize": batch_size,
        "device": str(device),
        "sampleLimits": {"train": max_train, "valid": max_valid, "test": max_test},
        "testProject": test_project,
        "splitKind": "cross-project" if test_project else "project-internal",
        "fullProtocol": False,
        "compatibility": [
            "HAN initial states use zeros instead of unseeded randn for rerunnable runs.",
            "Line ordering comes from the released JIT-Smart line table, preserving file and idx identity.",
        ],
        "hardwareBlocker": ({
            "reason": "CPU-only environment cannot complete the author 50-epoch joint protocol or full cross-project matrix in the available window.",
            "required": "CUDA GPU or a longer dedicated CPU run with the same frozen data and hyperparameters.",
        } if not torch.cuda.is_available() else None),
    }
    run = new_run(
        "jitsmart", version="jitsmart-author-code-v1", fidelity="real-smoke",
        material_hashes=material_hashes, config=config,
        split={"kind": "author-cross-project-sample" if test_project
               else "author-split-sample",
               "testProject": test_project, "seed": seed},
        seed=seed, output=output, argv=argv,
    )
    try:
        train_examples(model, train, epochs=epochs, batch_size=batch_size,
                       learning_rate=learning_rate, device=device, run=run)
        commits, lines = predict_examples(model, test, batch_size=batch_size, device=device)
        torch.save(model.state_dict(), run.directory / "model.pt")
        records = [{"id": item.commit_id, "label": item.label, "epoch": item.epoch,
                    "la": item.la, "ld": item.ld} for item in test]
        commit_result = commit_metrics(records, commits)
        rows = line_outputs(test, lines)
        localization = (line_metrics(rows) if rows
                        else {"samples": 0, "reason": "没有已标注的候选行"})
        localization["coverage"] = {
            "testCommits": len(test),
            "testPositiveCommits": sum(item.label for item in test),
            "testProjects": sorted({item.project for item in test}),
            "trainProjects": sorted({item.project for item in train}),
            "lineRows": len(rows),
            "positiveLines": sum(row["label"] for row in rows),
            "truncation": {**train_truncation, **valid_truncation, **test_truncation},
        }
        write_jsonl(run.directory / "predictions.jsonl", [{
            "commitId": item.commit_id, "score": score, "label": item.label,
            "project": item.project,
        } for item, score in zip(test, commits, strict=True)])
        write_jsonl(run.directory / "line-predictions.jsonl", rows)
        write_json(run.directory / "metrics.json", {
            "schema": "author-jitsmart-metrics-v1",
            "commit": commit_result,
            "line": localization,
            "samples": {"train": len(train), "valid": len(valid), "test": len(test)},
            "limitations": [
                "This is a real-sample CPU smoke run, not the author 50-epoch full protocol.",
                "The line branch is evaluated on the selected test commits, not the full 5,480-commit test split.",
                "Author tables do not provide Git line numbers; file and table idx are preserved.",
            ],
        })
        append_log(run, f"JIT-Smart smoke completed: train={len(train)} test={len(test)} "
                        f"lines={len(rows)}")
        return run.complete({
            "mode": "real-smoke",
            "samples": {"train": len(train), "valid": len(valid), "test": len(test)},
            "commitMetrics": commit_result,
            "lineMetrics": localization,
            "lineRows": len(rows),
        })
    except Exception as exc:
        run.fail(getattr(exc, "code", "AUTHOR_RUN_FAILED"), str(exc))
        raise
