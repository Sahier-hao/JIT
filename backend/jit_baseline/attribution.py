"""与模型无关的特征归因：遮挡法（occlusion）。

对一个入模特征逐一用基线值替换后重新推理，用风险变化量衡量该特征的贡献。
选择遮挡法而非 SHAP/LIME：九种方法共用同一口径、无新增依赖、无采样不稳定性，
单条预测只多「特征数」次前向。归因只描述模型对单特征的敏感度，不是因果分解。
"""
import hashlib
import json
import math
from pathlib import Path

METHOD = 'occlusion-mean-v1'
TOP_K = 5
_ZERO = 1e-12


def training_partition_ids(directory):
    """读取训练运行 split.json 的训练分区标识；缺失或为空时返回 None。"""
    if not directory:
        return None
    try:
        split = json.loads((Path(directory) / 'split.json').read_text(encoding='utf-8'))
        ids = split['partitions']['train']['ids']
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return list(dict.fromkeys(ids)) if isinstance(ids, list) and ids else None


def baseline_hash(means):
    payload = json.dumps({name: means[name] for name in sorted(means)},
                         ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def feature_baseline(storage, dataset_version, names, commit_ids=None):
    """按训练分区（或整个数据集版本）取各字段均值作为基线。

    数据集版本未知或某字段缺失时只返回可用的部分，由调用方决定降级；
    这里不补零、不猜测，避免把查询失败伪装成合法基线。
    """
    if not dataset_version or not names:
        return {}
    if commit_ids is None:
        means = storage.feature_means(dataset_version, tuple(names))
    else:
        means = storage.feature_means(dataset_version, tuple(names), commit_ids)
    return {name: means[name] for name in names if name in means}


def _risk(predict_fn, vector):
    value = predict_fn(list(vector))
    if isinstance(value, (list, tuple)):
        value = value[0]
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError('归因推理未返回单个数值风险')
    value = float(value)
    if not math.isfinite(value) or value < 0 or value > 1:
        raise ValueError('归因推理返回的风险不在 [0,1] 内')
    return value


def explain(predict_fn, features, baseline, names, top_k=TOP_K):
    """计算一条预测的特征归因。

    `features` 与 `names` 顺序一致；`baseline` 是 {字段名: 基线值}，缺失字段按 0 处理。
    返回 {"method", "items", "summary"}；某项贡献为零时不列出，不足 top_k 不补位。
    """
    if len(features) != len(names):
        raise ValueError('特征向量与字段名数量不一致')
    if top_k < 1:
        raise ValueError('top_k 必须为正整数')
    vector = [float(value) for value in features]
    base_risk = _risk(predict_fn, vector)
    items = []
    for index, name in enumerate(names):
        replaced = list(vector)
        replaced[index] = float(baseline.get(name, 0.0))
        # 贡献 = 本次风险 − 遮挡后风险：正值表示该特征当前取值把风险推高。
        delta = base_risk - _risk(predict_fn, replaced)
        if abs(delta) <= _ZERO:
            continue
        items.append({'feature': name, 'value': features[index], 'baseline': baseline.get(name, 0.0),
                      'delta': round(delta, 6), 'direction': 'increases' if delta > 0 else 'decreases'})
    items.sort(key=lambda item: abs(item['delta']), reverse=True)
    items = items[:top_k]
    return {'method': METHOD, 'items': items, 'summary': _summary(items, base_risk)}


def _summary(items, base_risk):
    if not items:
        return f'本次预测风险为 {base_risk:.3f}，没有单个特征产生可测的推动。'
    lead = items[0]
    verb = '推高' if lead['direction'] == 'increases' else '拉低'
    rest = len(items) - 1
    tail = f'，另有 {rest} 个特征有可测影响' if rest else ''
    return (f'本次预测风险为 {base_risk:.3f}，影响最大的是 {lead["feature"]}'
            f'（{verb} {abs(lead["delta"]):.3f}）{tail}。归因来自模型推理，不是缺陷结论。')


def stability(predict_fn, features, baseline, names, rounds=3):
    """对数值字段做小幅合法扰动，检查主要贡献特征的排序是否稳定。"""
    base = explain(predict_fn, features, baseline, names)['items']
    base_order = [item['feature'] for item in base[:3]]
    orders = []
    for index in range(rounds):
        factor = 0.9 if index % 2 == 0 else 1.1
        perturbed = []
        for value in features:
            changed = float(value) * factor
            if changed < 0:
                changed = 0.0
            perturbed.append(changed)
        items = explain(predict_fn, perturbed, baseline, names)['items']
        orders.append([item['feature'] for item in items[:3]])
    stable = all(order == base_order for order in orders)
    return {'status': 'stable' if stable else 'unstable',
            'rounds': rounds, 'topFeatures': orders, 'baseOrder': base_order}
