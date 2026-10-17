"""表格型深度方法：PyTorch 架构与 sklearn 兼容适配器。

见 add-deep-tabular-methods 的 design D1/D2/D6：
- 四个架构都消费"每提交一行"的表格输入，不做序列建模；
- 适配器作为既有 Pipeline 的末步，保持 `predict_proba`／`classes_`／`n_features_in_` 契约；
- 训练随机性由冻结种子、单线程与固定 epoch 控制；不做早停。
"""
import random

import numpy as np
import torch
from sklearn.base import BaseEstimator, ClassifierMixin
from torch import nn

from .errors import BaselineError

SUPPORTED_ARCHITECTURES = ("mlp", "tabular-resnet", "ft-transformer", "wide-deep")


def _seed_everything(seed, threads):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True, warn_only=True)
    torch.set_num_threads(threads)


class _MLP(nn.Module):
    def __init__(self, width, hidden, dropout):
        super().__init__()
        layers, last = [], width
        for size in hidden:
            layers += [nn.Linear(last, size), nn.ReLU(), nn.Dropout(dropout)]
            last = size
        layers.append(nn.Linear(last, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x).squeeze(-1)


class _TabularResNet(nn.Module):
    def __init__(self, width, hidden, blocks, dropout):
        super().__init__()
        self.input = nn.Linear(width, hidden)
        self.blocks = nn.ModuleList([
            nn.Sequential(nn.LayerNorm(hidden), nn.Linear(hidden, hidden), nn.ReLU(),
                          nn.Dropout(dropout), nn.Linear(hidden, hidden))
            for _ in range(blocks)])
        self.head = nn.Sequential(nn.LayerNorm(hidden), nn.ReLU(), nn.Linear(hidden, 1))

    def forward(self, x):
        h = self.input(x)
        for block in self.blocks:
            h = h + block(h)
        return self.head(h).squeeze(-1)


class _FTTransformer(nn.Module):
    """每个字段一个 token（顺序跟随 schema），不是把提交当作时间序列。"""

    def __init__(self, width, d_token, heads, layers, dropout):
        super().__init__()
        self.weight = nn.Parameter(torch.empty(width, d_token))
        self.bias = nn.Parameter(torch.empty(width, d_token))
        nn.init.xavier_uniform_(self.weight)
        nn.init.zeros_(self.bias)
        self.cls = nn.Parameter(torch.zeros(1, 1, d_token))
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_token, nhead=heads, dropout=dropout, batch_first=True,
            norm_first=True, activation="gelu")
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=layers)
        self.head = nn.Sequential(nn.LayerNorm(d_token), nn.ReLU(), nn.Linear(d_token, 1))

    def forward(self, x):
        tokens = x.unsqueeze(-1) * self.weight + self.bias
        cls = self.cls.expand(tokens.size(0), -1, -1)
        hidden = self.encoder(torch.cat([cls, tokens], dim=1))
        return self.head(hidden[:, 0]).squeeze(-1)


class _WideDeep(nn.Module):
    """线性分量与深层分量并联；与 MLP 是结构差异，不是层宽参数变体。"""

    def __init__(self, width, hidden, dropout):
        super().__init__()
        self.wide = nn.Linear(width, 1)
        layers, last = [], width
        for size in hidden:
            layers += [nn.Linear(last, size), nn.ReLU(), nn.Dropout(dropout)]
            last = size
        layers.append(nn.Linear(last, 1))
        self.deep = nn.Sequential(*layers)

    def forward(self, x):
        return (self.wide(x) + self.deep(x)).squeeze(-1)


def _build_module(architecture, width, params):
    if architecture == "mlp":
        return _MLP(width, tuple(params["hidden"]), params["dropout"])
    if architecture == "tabular-resnet":
        return _TabularResNet(width, params["hidden"], params["blocks"], params["dropout"])
    if architecture == "ft-transformer":
        return _FTTransformer(width, params["d_token"], params["heads"], params["layers"],
                              params["dropout"])
    if architecture == "wide-deep":
        return _WideDeep(width, tuple(params["deep"]), params["dropout"])
    raise BaselineError("ALGORITHM_UNKNOWN",
                        f"不支持的深度架构：{architecture}；只登记表格型架构 {SUPPORTED_ARCHITECTURES}")


class TorchTabularClassifier(ClassifierMixin, BaseEstimator):
    """sklearn 兼容的表格型深度分类器（Pipeline 末步，可 joblib 序列化）。"""

    def __init__(self, architecture, hidden=None, blocks=2, d_token=32, heads=4, layers=1,
                 deep=None, dropout=0.2, lr=1e-3, batch_size=256, epochs=30,
                 weight_decay=0.0, seed=2026, threads=1):
        self.architecture = architecture
        self.params = {"hidden": hidden, "blocks": blocks, "d_token": d_token, "heads": heads,
                       "layers": layers, "deep": deep, "dropout": dropout, "lr": lr,
                       "batch_size": batch_size, "epochs": epochs,
                       "weight_decay": weight_decay, "seed": seed, "threads": threads}
        self.n_features_in_ = None
        self.classes_ = np.array([0, 1])
        self.module_ = None

    def fit(self, X, y):
        features = np.asarray(X, dtype=np.float32)
        labels = np.asarray(y, dtype=np.float32)
        if features.ndim != 2 or len(features) != len(labels):
            raise BaselineError("MODEL_INVALID", "深度方法需要二维输入且与标签数量一致")
        if set(np.unique(labels).tolist()) != {0.0, 1.0}:
            raise BaselineError("MODEL_INVALID", "深度方法训练需要两类发布标签")
        _seed_everything(self.params["seed"], self.params["threads"])
        self.n_features_in_ = features.shape[1]
        self.module_ = _build_module(self.architecture, features.shape[1], self.params)
        optimiser = torch.optim.Adam(self.module_.parameters(), lr=self.params["lr"],
                                     weight_decay=self.params["weight_decay"])
        loss_fn = nn.BCEWithLogitsLoss()
        dataset = torch.utils.data.TensorDataset(torch.from_numpy(features), torch.from_numpy(labels))
        generator = torch.Generator().manual_seed(self.params["seed"])
        loader = torch.utils.data.DataLoader(dataset, batch_size=self.params["batch_size"],
                                             shuffle=True, generator=generator)
        self.module_.train()
        for _ in range(self.params["epochs"]):
            for batch_x, batch_y in loader:
                optimiser.zero_grad()
                loss = loss_fn(self.module_(batch_x), batch_y)
                loss.backward()
                optimiser.step()
        self.module_.eval()
        return self

    def predict_proba(self, X):
        if self.module_ is None or self.n_features_in_ is None:
            raise BaselineError("MODEL_INVALID", "深度模型尚未拟合")
        features = np.asarray(X, dtype=np.float32)
        if features.ndim != 2 or features.shape[1] != self.n_features_in_:
            raise BaselineError("FEATURES_INVALID", "输入列数与深度模型声明不一致")
        with torch.no_grad():
            logits = self.module_(torch.from_numpy(features))
            positive = torch.sigmoid(logits).numpy().astype(np.float64)
        return np.column_stack([1.0 - positive, positive])


def torch_mlp(**kwargs):
    return TorchTabularClassifier("mlp", **kwargs)


def torch_tabular_resnet(**kwargs):
    return TorchTabularClassifier("tabular-resnet", **kwargs)


def torch_ft_transformer(**kwargs):
    return TorchTabularClassifier("ft-transformer", **kwargs)


def torch_wide_deep(**kwargs):
    return TorchTabularClassifier("wide-deep", **kwargs)
