"""DeepJIT author-code CNN and preprocessing port."""
from __future__ import annotations

import math
import random
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as functional

from ..errors import BaselineError
from .catalog import verify_material
from .common import finite_probability, seed_everything, write_json, write_jsonl
from .data import deepjit_files, load_pickle
from .metrics import commit_metrics
from .runner import append_log, new_run


class DeepJIT(nn.Module):
    def __init__(self, *, vocab_msg, vocab_code, embedding_dim=64, filter_sizes=(1, 2, 3),
                 num_filters=64, hidden_units=512, dropout_keep_prob=0.5, class_num=1):
        super().__init__()
        self.filter_sizes = tuple(filter_sizes)
        self.num_filters = num_filters
        self.embed_msg = nn.Embedding(vocab_msg, embedding_dim)
        self.convs_msg = nn.ModuleList([
            nn.Conv2d(1, num_filters, (size, embedding_dim)) for size in self.filter_sizes
        ])
        self.embed_code = nn.Embedding(vocab_code, embedding_dim)
        self.convs_code_line = nn.ModuleList([
            nn.Conv2d(1, num_filters, (size, embedding_dim)) for size in self.filter_sizes
        ])
        self.convs_code_file = nn.ModuleList([
            nn.Conv2d(1, num_filters, (size, num_filters * len(self.filter_sizes)))
            for size in self.filter_sizes
        ])
        self.dropout = nn.Dropout(dropout_keep_prob)
        self.fc1 = nn.Linear(2 * len(self.filter_sizes) * num_filters, hidden_units)
        self.fc2 = nn.Linear(hidden_units, class_num)
        self.sigmoid = nn.Sigmoid()

    def _forward_msg(self, value, convolutions):
        value = value.unsqueeze(1)
        value = [functional.relu(convolution(value)).squeeze(3)
                 for convolution in convolutions]
        value = [functional.max_pool1d(item, item.size(2)).squeeze(2) for item in value]
        return torch.cat(value, 1)

    def _forward_code(self, value, line_convolutions, hunk_convolutions):
        batches, files = value.shape[0], value.shape[1]
        value = value.reshape(batches * files, value.shape[2], value.shape[3])
        value = self._forward_msg(value, line_convolutions)
        value = value.reshape(batches, files, self.num_filters * len(self.filter_sizes))
        return self._forward_msg(value, hunk_convolutions)

    def forward(self, message, code):
        message = self._forward_msg(self.embed_msg(message), self.convs_msg)
        code = self._forward_code(self.embed_code(code), self.convs_code_line,
                                  self.convs_code_file)
        merged = self.dropout(torch.cat((message, code), 1))
        return self.sigmoid(self.fc2(functional.relu(self.fc1(merged)))).squeeze(1)


def _pad_message(value, max_length):
    words = str(value).split()
    if len(words) < max_length:
        words.extend(["<NULL>"] * (max_length - len(words)))
    return " ".join(words[:max_length])


def _pad_line(value, max_length):
    words = str(value).split()
    if len(words) < max_length:
        words.extend(["<NULL>"] * (max_length - len(words)))
    return " ".join(words[:max_length])


def _map_message(values, dictionary, max_length):
    if "<NULL>" not in dictionary:
        raise BaselineError("AUTHOR_DATA_INVALID", "DeepJIT 消息词典缺少 <NULL>")
    return np.asarray([
        [dictionary.get(word.lower(), dictionary["<NULL>"])
         for word in _pad_message(value, max_length).split(" ")]
        for value in values
    ], dtype=np.int64)


def _map_code(values, dictionary, max_lines, max_length):
    if "<NULL>" not in dictionary:
        raise BaselineError("AUTHOR_DATA_INVALID", "DeepJIT 代码词典缺少 <NULL>")
    result = []
    for commit in values:
        lines = list(commit)[:max_lines]
        padded = [
            [dictionary.get(word.lower(), dictionary["<NULL>"])
             for word in _pad_line(line, max_length).split(" ")]
            for line in lines
        ]
        while len(padded) < max_lines:
            padded.append([dictionary["<NULL>"]] * max_length)
        result.append(padded)
    return np.asarray(result, dtype=np.int64)


def prepare_deepjit_data(ids, labels, messages, codes, dictionary, *,
                         max_lines=10, max_length=512, max_msg_length=256):
    try:
        dict_msg, dict_code = dictionary
    except (TypeError, ValueError) as exc:
        raise BaselineError("AUTHOR_DATA_INVALID", "DeepJIT 词典必须是两个字典") from exc
    if not (len(ids) == len(labels) == len(messages) == len(codes)):
        raise BaselineError("AUTHOR_DATA_INVALID", "DeepJIT 输入四元组长度不一致")
    return {
        "ids": [str(value) for value in ids],
        "labels": np.asarray(labels, dtype=float),
        "message": _map_message(messages, dict_msg, max_msg_length),
        "code": _map_code(codes, dict_code, max_lines, max_length),
        "vocabMsg": len(dict_msg),
        "vocabCode": len(dict_code),
    }


def _balanced_subset(prepared, limit, seed):
    if not limit or limit >= len(prepared["ids"]):
        return prepared
    labels = prepared["labels"]
    positives = np.where(labels == 1)[0]
    negatives = np.where(labels == 0)[0]
    if not len(positives) or not len(negatives):
        raise BaselineError("AUTHOR_DATA_INVALID", "DeepJIT 训练子集缺少一类的样本")
    generator = np.random.RandomState(seed)
    per_class = max(1, limit // 2)
    chosen = np.concatenate([
        generator.choice(positives, min(len(positives), per_class), replace=False),
        generator.choice(negatives, min(len(negatives), per_class), replace=False),
    ])
    chosen.sort()
    return {
        **prepared,
        "ids": [prepared["ids"][index] for index in chosen],
        "labels": prepared["labels"][chosen],
        "message": prepared["message"][chosen],
        "code": prepared["code"][chosen],
    }


def _model_from_prepared(prepared, *, device):
    return DeepJIT(
        vocab_msg=prepared["vocabMsg"],
        vocab_code=prepared["vocabCode"],
    ).to(device)


def _iter_eval(prepared, batch_size=64):
    count = len(prepared["ids"])
    for start in range(0, count, batch_size):
        yield (slice(start, min(start + batch_size, count)),
               prepared["message"][start:start + batch_size],
               prepared["code"][start:start + batch_size],
               prepared["labels"][start:start + batch_size])


@torch.no_grad()
def predict_prepared(prepared, model, *, device="cpu", batch_size=64):
    model.eval()
    values = []
    for _, messages, codes, _ in _iter_eval(prepared, batch_size):
        message_tensor = torch.as_tensor(messages, dtype=torch.long, device=device)
        code_tensor = torch.as_tensor(codes, dtype=torch.long, device=device)
        values.extend(model(message_tensor, code_tensor).cpu().tolist())
    return [finite_probability(value) for value in values]


def _load_source_data(path):
    value = load_pickle(path)
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise BaselineError("AUTHOR_DATA_INVALID", f"DeepJIT 数据不是作者四元组：{path}")
    return value


def run_deepjit(*, mode="evaluate", output=None, seed=42, max_train=None,
                epochs=25, learning_rate_source="author-code", batch_size=64,
                data_dir=None, model_path=None, argv=None) -> dict:
    if mode not in ("evaluate", "train"):
        raise BaselineError("AUTHOR_MODE_UNKNOWN", f"DeepJIT 未知模式：{mode}")
    if learning_rate_source not in ("author-code", "paper-intent"):
        raise BaselineError("AUTHOR_CONFIG_INVALID", "DeepJIT 学习率来源不受支持")
    seed_everything(seed)
    paths = deepjit_files(data_dir)
    dictionary = load_pickle(paths["dict"])
    if mode == "evaluate":
        ids, labels, messages, codes = _load_source_data(paths["test"])
    else:
        ids, labels, messages, codes = _load_source_data(paths["train"])
    prepared = prepare_deepjit_data(ids, labels, messages, codes, dictionary)
    if mode == "train":
        prepared = _balanced_subset(prepared, max_train, seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = _model_from_prepared(prepared, device=device)
    model_file = Path(model_path) if model_path is not None else paths["model"]
    material_hashes = {}
    for material_id in ("deepjit-openstack-train", "deepjit-openstack-test",
                        "deepjit-openstack-dict", "deepjit-openstack-model"):
        material_hashes[material_id] = verify_material(material_id)["hashes"]
    config = {
        "maxMessageLength": 256,
        "maxLines": 10,
        "maxTokensPerLine": 512,
        "embeddingDim": 64,
        "filterSizes": [1, 2, 3],
        "numFilters": 64,
        "hiddenUnits": 512,
        "dropout": 0.5,
        "batchSize": batch_size,
        "epochs": epochs if mode == "train" else 0,
        "seed": seed,
        "learningRateSource": learning_rate_source,
        "authorCodeDifference": (
            "Author train.py passes l2_reg_lambda (default 1e-5) to Adam while learning_rate "
            "is unused. paper-intent instead uses learning_rate=1e-4."),
    }
    run = new_run(
        "deepjit", version="deepjit-author-code-v1",
        fidelity=("author-protocol" if mode == "evaluate" else "real-smoke"),
        material_hashes=material_hashes, config=config,
        split={"kind": "author-openstack-test" if mode == "evaluate"
               else "author-openstack-train-subset"},
        seed=seed, output=output, argv=argv,
    )
    try:
        if mode == "evaluate":
            state = torch.load(model_file, map_location=device, weights_only=True)
            model.load_state_dict(state)
            append_log(run, f"Loaded author state dict from {model_file.name}")
        else:
            counts = np.bincount(prepared["labels"].astype(int), minlength=2)
            if min(counts) < batch_size // 2:
                raise BaselineError("AUTHOR_SAMPLE_INSUFFICIENT",
                                    f"训练子集正负样本不足：{counts.tolist()}")
            learning_rate = 1e-5 if learning_rate_source == "author-code" else 1e-4
            optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)
            criterion = nn.BCELoss()
            positives = np.where(prepared["labels"] == 1)[0].tolist()
            negatives = np.where(prepared["labels"] == 0)[0].tolist()
            for epoch in range(epochs):
                model.train()
                batches = max(1, math.floor(len(prepared["ids"]) / batch_size) + 1)
                total_loss = 0.0
                for _ in range(batches):
                    chosen = random.sample(positives, batch_size // 2)
                    chosen += random.sample(negatives, batch_size // 2)
                    chosen.sort()
                    messages = torch.as_tensor(prepared["message"][chosen], dtype=torch.long,
                                               device=device)
                    codes = torch.as_tensor(prepared["code"][chosen], dtype=torch.long,
                                            device=device)
                    labels_tensor = torch.as_tensor(prepared["labels"][chosen],
                                                    dtype=torch.float32, device=device)
                    optimizer.zero_grad()
                    prediction = model(messages, codes)
                    loss = criterion(prediction, labels_tensor)
                    loss.backward()
                    optimizer.step()
                    total_loss += float(loss.item())
                append_log(run, f"epoch={epoch + 1} loss={total_loss / batches:.6f}")
            torch.save(model.state_dict(), run.directory / "model.pt")
            model_file = run.directory / "model.pt"
        scores = predict_prepared(prepared, model, device=str(device), batch_size=batch_size)
        rows = [{"id": commit_id, "label": int(label), "score": score}
                for commit_id, label, score in zip(prepared["ids"], prepared["labels"],
                                                   scores, strict=True)]
        records = [{"id": row["id"], "label": row["label"], "epoch": 0, "la": 0, "ld": 0}
                   for row in rows]
        metrics = commit_metrics(records, scores)
        write_jsonl(run.directory / "predictions.jsonl", rows)
        write_json(run.directory / "metrics.json", {
            "schema": "author-deepjit-metrics-v1",
            "mode": mode,
            "source": "author Zenodo 3965246 OpenStack",
            "model": "author pretrained state dict" if mode == "evaluate"
                     else "locally trained author architecture",
            "metrics": metrics,
            "limitations": [
                "OpenStack author data stores changed code strings but not per-commit epochs/LOC for all metrics.",
                "Popt and Recall@20%LOC are undefined when no whole-commit work cost is available.",
                "The evaluate mode is a model/data inference reproduction, not a fresh 25-epoch training rerun.",
            ],
        })
        run.set(modelFile=str(model_file), predictionCount=len(rows))
        append_log(run, f"DeepJIT {mode} completed: {len(rows)} predictions")
        return run.complete({"mode": mode, "predictions": len(rows), "metrics": metrics})
    except Exception as exc:
        run.fail(getattr(exc, "code", "AUTHOR_RUN_FAILED"), str(exc))
        raise
