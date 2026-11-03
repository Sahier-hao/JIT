"""Retrospective benefit evaluation on a frozen model's test partition.

The evaluation answers one question only: when the same 20% LOC budget is
spent in model-score order, newest-first order or a seeded random order, how
many historical positive labels are covered? It does not select models,
tune parameters on the test partition, or turn risk scores into defect
probabilities.
"""
import hashlib
import random
import statistics
from datetime import datetime, timezone
from pathlib import Path

from .artifacts import Snapshot, check_reference_predictions, environment, read_json, write_json
from .config import BACKEND
from .data import BaselineError, sha256
from .metrics import normalized_effort_area
from .model import predict_risks

REPORT_KIND = "model-benefit-evaluation"
REPORT_VERSION = 2
BENEFIT_FILE = "benefit-report.json"
DEFAULT_RANDOM_RUNS = 200
DEFAULT_SEED = 2026
BUDGET_FRACTION = 0.2
BOOTSTRAP_RUNS = 1000
BUDGET_RULE = "continue-whole-commit"
SENSITIVITY_RULE = "stop-at-first-overflow"
STRATEGIES = ("model", "density", "loc", "time", "random")
LIMITATIONS = (
    "这是冻结测试分区上的回顾性评估，不代表在线效果或缺陷概率。",
    "标签来自发布者历史观测或简化 SZZ；未观测到缺陷引入不等于已证实无缺陷。",
    "只比较同一测试分区、同一预算和同一标签口径下的检查顺序，不据此宣布最佳模型。",
    "模型分数策略按原始风险降序；风险/成本密度和按改动量升序作为简单基线并列。",
    "模型、阈值和策略在评估前已固定；没有使用测试分区调参。",
    "配对区间来自时间块重采样，不是在线效果或因果结论。",
)


def benefit_path(output):
    output = Path(output)
    return output if output.suffix.lower() == '.json' else output / BENEFIT_FILE


def _metric(value=None, reason=None):
    return {'value': value, 'reason': reason}


def _artifact_label(directory):
    try:
        return directory.resolve().relative_to(BACKEND.resolve()).as_posix()
    except ValueError:
        return directory.name


def _load(run_dir):
    run_dir = Path(run_dir)
    snapshot = Snapshot.load(run_dir)
    labels = read_json(run_dir / 'test-labels.json')
    references = read_json(run_dir / 'reference-predictions.json')
    records = snapshot.records
    ids = [record['id'] for record in records]
    if [item['id'] for item in labels] != ids or [item['id'] for item in references] != ids:
        raise BaselineError('ARTIFACT_INVALID', '收益评估标签或参考预测身份不一致')
    if len(set(ids)) != len(ids):
        raise BaselineError('ARTIFACT_INVALID', '收益评估测试身份重复')
    current = predict_risks(snapshot.model, records, snapshot.schema)
    check_reference_predictions(snapshot.manifest, current, [item['risk'] for item in references])
    evaluation = []
    for record, label, reference in zip(records, labels, references, strict=True):
        value = label.get('label')
        risk = reference.get('risk')
        if value not in (0, 1) or isinstance(value, bool):
            raise BaselineError('ARTIFACT_INVALID', '收益评估标签必须为 0 或 1')
        if (isinstance(risk, bool) or not isinstance(risk, (int, float))
                or not 0 <= risk <= 1):
            raise BaselineError('ARTIFACT_INVALID', '收益评估风险必须为 0 到 1 的有限数')
        cost = record['metrics']['la'] + record['metrics']['ld']
        if not isinstance(cost, (int, float)) or cost < 0:
            raise BaselineError('ARTIFACT_INVALID', '收益评估工作量无效')
        evaluation.append(dict(record, label=value, risk=float(risk), cost=cost))
    positives = sum(record['label'] for record in evaluation)
    total = sum(record['cost'] for record in evaluation)
    return snapshot, evaluation, positives, total


def _model_order(records):
    return sorted(range(len(records)),
                  key=lambda i: (-records[i]['risk'], -records[i]['epoch'], records[i]['id']))


def _density_order(records):
    return sorted(range(len(records)),
                  key=lambda i: (-(records[i]['risk'] / max(records[i]['cost'], 1)),
                                 -records[i]['epoch'], records[i]['id']))


def _loc_order(records):
    return sorted(range(len(records)),
                  key=lambda i: (records[i]['cost'], -records[i]['epoch'], records[i]['id']))


def _time_order(records):
    return sorted(range(len(records)),
                  key=lambda i: (-records[i]['epoch'], records[i]['id']))


def _random_order(records, seed, run):
    return sorted(range(len(records)),
                  key=lambda i: hashlib.sha256(f'{seed}:{run}:{records[i]["id"]}'.encode()).digest())


def _recall20(records, order, *, total, budget, positives, skip_overflow=True):
    if total <= 0:
        return _metric(reason='总工作量为零'), {'selectedCount': 0, 'usedLoc': 0,
                                               'issuesCovered': 0, 'precisionAtBudget': None}
    if positives <= 0:
        return _metric(reason='没有正标签提交'), {'selectedCount': 0, 'usedLoc': 0,
                                                  'issuesCovered': 0, 'precisionAtBudget': None}
    used = covered = 0
    selected = 0
    for index in order:
        cost = records[index]['cost']
        if used + cost > budget:
            if skip_overflow:
                continue
            break
        selected += 1
        used += cost
        covered += records[index]['label']
    precision = _metric(covered / selected) if selected else _metric(reason='预算内没有可检查提交')
    return _metric(covered / positives), {'selectedCount': selected, 'usedLoc': used,
                                          'issuesCovered': covered,
                                          'precisionAtBudget': precision}


def _strategy(records, order, *, ordering, total, budget, positives, skip_overflow=True):
    recall, coverage = _recall20(records, order, total=total, budget=budget,
                                 positives=positives, skip_overflow=skip_overflow)
    first_positive = next((position for position, index in enumerate(order)
                           if records[index]['label'] == 1), None)
    ifa = (_metric(reason='没有正标签提交') if first_positive is None
           else _metric(first_positive))
    popt, detail = normalized_effort_area(records, order, ordering=ordering)
    return {
        'ordering': ordering,
        'budgetRule': BUDGET_RULE if skip_overflow else SENSITIVITY_RULE,
        'recall20Loc': recall,
        'ifa': ifa,
        'popt': popt,
        'coverage': {
            'positives': positives,
            'totalLoc': total,
            'budgetLoc': budget,
            **coverage,
        },
        'poptEffort': detail,
    }


def _values(results, path):
    values = []
    for result in results:
        current = result
        for key in path:
            current = current.get(key) if isinstance(current, dict) else None
        values.append(current if isinstance(current, (int, float)) and not isinstance(current, bool) else None)
    return values


def _aggregate(values, reason='没有可定义的随机结果'):
    numbers = [value for value in values if value is not None]
    if not numbers:
        return {'mean': None, 'std': None, 'min': None, 'max': None,
                'validRuns': 0, 'reason': reason}
    return {'mean': statistics.fmean(numbers), 'std': statistics.pstdev(numbers),
            'min': min(numbers), 'max': max(numbers), 'validRuns': len(numbers), 'reason': None}


def _random_summary(results, runs, seed):
    return {
        'runs': runs,
        'seed': seed,
        'recall20Loc': _aggregate(_values(results, ('recall20Loc', 'value'))),
        'ifa': _aggregate(_values(results, ('ifa', 'value'))),
        'popt': _aggregate(_values(results, ('popt', 'value'))),
        'precisionAtBudget': _aggregate(_values(results, ('coverage', 'precisionAtBudget', 'value'))),
        'coverage': {
            'issuesCovered': _aggregate(_values(results, ('coverage', 'issuesCovered'))),
            'selectedCount': _aggregate(_values(results, ('coverage', 'selectedCount'))),
            'usedLoc': _aggregate(_values(results, ('coverage', 'usedLoc'))),
        },
    }


def _delta(a, b):
    if a is None or b is None:
        return None
    return a - b


def _bootstrap_delta(records, model_order, baseline_order, *, budget_fraction=BUDGET_FRACTION,
                     seed=DEFAULT_SEED, runs=BOOTSTRAP_RUNS):
    """按自然周时间块有放回重采样，给出模型相对基线的 Recall@20%LOC 配对区间。"""
    blocks = {}
    for index, record in enumerate(records):
        blocks.setdefault(record['epoch'] // (7 * 86400), []).append(index)
    block_ids = sorted(blocks)
    if len(block_ids) < 2:
        return {'low': None, 'high': None, 'runs': 0, 'reason': '时间块不足'}
    rng = random.Random(seed)
    deltas = []
    for _ in range(runs):
        sampled = []
        for _ in range(len(block_ids)):
            sampled.extend(blocks[rng.choice(block_ids)])
        indices = sorted(set(sampled))
        subset = [records[index] for index in indices]
        total = sum(record['cost'] for record in subset)
        positives = sum(record['label'] for record in subset)
        if total <= 0 or positives <= 0:
            continue
        position = {original: new for new, original in enumerate(indices)}
        model_sub = [position[index] for index in model_order if index in position]
        base_sub = [position[index] for index in baseline_order if index in position]
        model_recall = _recall20(subset, model_sub, total=total,
                                 budget=budget_fraction * total, positives=positives)[0]['value']
        base_recall = _recall20(subset, base_sub, total=total,
                                budget=budget_fraction * total, positives=positives)[0]['value']
        if model_recall is not None and base_recall is not None:
            deltas.append(model_recall - base_recall)
    if not deltas:
        return {'low': None, 'high': None, 'runs': 0, 'reason': '没有可用的重采样结果'}
    deltas.sort()
    return {'low': deltas[int(0.025 * len(deltas))],
            'high': deltas[min(len(deltas) - 1, int(0.975 * len(deltas)))],
            'runs': len(deltas), 'seed': seed, 'unit': 'recall20Loc-difference'}


def _sentence(model, density, loc, time, random, *, budget, total, positives):
    values = {
        '模型排序': model['recall20Loc'].get('value'),
        '风险/成本密度': density['recall20Loc'].get('value'),
        '改动量升序': loc['recall20Loc'].get('value'),
        '时间顺序': time['recall20Loc'].get('value'),
        '随机平均': random['recall20Loc'].get('mean'),
    }
    if any(value is None for value in values.values()):
        return '测试分区缺少可用正例或工作量，无法比较五种检查顺序。'
    parts = [f"{name}覆盖 {value * 100:.1f}%"
             f"（{value * positives:.1f}/{positives} 个历史标记）"
             for name, value in values.items()]
    return (f"同样检查 20% 代码改动量（预算 {budget:g} 行，共 {total:g} 行）："
            + '；'.join(parts) + '。')


def evaluate_run(run_dir, *, random_runs=DEFAULT_RANDOM_RUNS, seed=DEFAULT_SEED):
    if (isinstance(random_runs, bool) or not isinstance(random_runs, int)
            or not 1 <= random_runs <= 10000):
        raise BaselineError('INPUT_INVALID', '随机重复次数必须是 1 到 10000 的整数')
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise BaselineError('INPUT_INVALID', '随机种子必须是非负整数')
    snapshot, records, positives, total = _load(run_dir)
    budget = BUDGET_FRACTION * total
    orders = {
        'model': _model_order(records),
        'density': _density_order(records),
        'loc': _loc_order(records),
        'time': _time_order(records),
        'random': _random_order(records, seed, 0),
    }
    ordering_labels = {
        'model': 'score-desc,time-desc,id-asc',
        'density': 'risk-per-loc-desc,time-desc,id-asc',
        'loc': 'loc-asc,time-desc,id-asc',
        'time': 'time-desc,id-asc',
    }
    primary = {
        key: _strategy(records, orders[key], ordering=ordering_labels[key],
                       total=total, budget=budget, positives=positives, skip_overflow=True)
        for key in ordering_labels
    }
    sensitivity = {
        key: _strategy(records, orders[key], ordering=ordering_labels[key],
                       total=total, budget=budget, positives=positives, skip_overflow=False)
        for key in ordering_labels
    }
    random_results = [
        _strategy(records, _random_order(records, seed, run), ordering=f'random(seed={seed},run={run})',
                  total=total, budget=budget, positives=positives, skip_overflow=True)
        for run in range(random_runs)
    ]
    random = _random_summary(random_results, random_runs, seed)
    random_sensitivity = _random_summary([
        _strategy(records, _random_order(records, seed, run), ordering=f'random(seed={seed},run={run})',
                  total=total, budget=budget, positives=positives, skip_overflow=False)
        for run in range(random_runs)
    ], random_runs, seed)
    strategies = {
        'model': primary['model'],
        'density': primary['density'],
        'loc': primary['loc'],
        'time': primary['time'],
        'random': random,
        'sensitivity': {**sensitivity, 'random': random_sensitivity},
    }
    comparisons = {}
    for key, label in (('density', 'modelVsDensity'), ('loc', 'modelVsLoc'), ('time', 'modelVsTime')):
        comparisons[label] = {
            'recall20Loc': _delta(primary['model']['recall20Loc'].get('value'),
                                  primary[key]['recall20Loc'].get('value')),
            'ifa': _delta(primary['model']['ifa'].get('value'), primary[key]['ifa'].get('value')),
            'popt': _delta(primary['model']['popt'].get('value'), primary[key]['popt'].get('value')),
            'recall20LocInterval': _bootstrap_delta(records, orders['model'], orders[key], seed=seed),
        }
    comparisons['modelVsRandomMean'] = {
        'recall20Loc': _delta(primary['model']['recall20Loc'].get('value'),
                              random['recall20Loc'].get('mean')),
        'ifa': _delta(primary['model']['ifa'].get('value'), random['ifa'].get('mean')),
        'popt': _delta(primary['model']['popt'].get('value'), random['popt'].get('mean')),
        'recall20LocInterval': _bootstrap_delta(records, orders['model'], orders['random'], seed=seed),
    }
    summary = snapshot.summary
    manifest = snapshot.manifest
    source = summary.get('source') or {}
    model_descriptor = summary.get('model') or {}
    evaluation_environment = environment()
    files = ('test-input.json', 'test-labels.json', 'reference-predictions.json',
             'summary.json', 'metrics.json', 'manifest.json')
    report = {
        'kind': REPORT_KIND,
        'reportVersion': REPORT_VERSION,
        'generatedUtc': datetime.now(timezone.utc).isoformat(),
        'artifact': {
            'artifactPath': _artifact_label(Path(run_dir)),
            'artifactKey': Path(run_dir).name,
            'runId': manifest['runId'],
            'model': {'id': model_descriptor.get('id'), 'name': model_descriptor.get('name')},
            'datasetVersion': summary.get('datasetVersion'),
            'schema': snapshot.schema.name,
            'metricSet': manifest['config'].get('metricSet'),
            'threshold': summary.get('threshold'),
            'modelSha256': summary.get('modelSha256'),
            'referencePredictionsVerified': True,
            'trainingEnvironment': manifest['config'].get('trainingEnvironment'),
            'evaluationEnvironment': evaluation_environment,
        },
        'test': {
            'records': len(records),
            'positives': positives,
            'negatives': len(records) - positives,
            'totalLoc': total,
            'budgetLoc': budget,
            'startEpoch': min(record['epoch'] for record in records),
            'endEpoch': max(record['epoch'] for record in records),
            'split': (summary.get('split') or {}).get('test'),
            'source': {key: source.get(key) for key in
                       ('publisher', 'url', 'revision', 'labelRule', 'quality')},
        },
        'protocol': {
            'strategies': list(STRATEGIES),
            'budgetRule': BUDGET_RULE,
            'sensitivityRule': SENSITIVITY_RULE,
            'bootstrapRuns': BOOTSTRAP_RUNS,
            'bootstrapSeed': seed,
        },
        'strategies': strategies,
        'comparisons': comparisons,
        'conclusion': {
            'sentence': _sentence(primary['model'], primary['density'], primary['loc'],
                                  primary['time'], random, budget=budget, total=total,
                                  positives=positives),
            'recall20': {
                'model': primary['model']['recall20Loc'],
                'density': primary['density']['recall20Loc'],
                'loc': primary['loc']['recall20Loc'],
                'time': primary['time']['recall20Loc'],
                'randomMean': random['recall20Loc'],
                'modelVsDensity': comparisons['modelVsDensity']['recall20Loc'],
                'modelVsLoc': comparisons['modelVsLoc']['recall20Loc'],
                'modelVsTime': comparisons['modelVsTime']['recall20Loc'],
                'modelVsRandomMean': comparisons['modelVsRandomMean']['recall20Loc'],
            },
            'uncertainty': {
                'modelVsDensity': comparisons['modelVsDensity']['recall20LocInterval'],
                'modelVsLoc': comparisons['modelVsLoc']['recall20LocInterval'],
                'modelVsTime': comparisons['modelVsTime']['recall20LocInterval'],
                'modelVsRandomMean': comparisons['modelVsRandomMean']['recall20LocInterval'],
            },
        },
        'existingMetrics': summary.get('metrics'),
        'parameterSelection': ('strategies, budget rule and bootstrap settings fixed before reading '
                               'test labels; no tuning'),
        'limitations': list(LIMITATIONS) + [
            item for item in (summary.get('limitations') or []) if item not in LIMITATIONS
        ],
        'boundary': {
            'retrospective': True,
            'defectProbability': False,
            'crossModelRanking': False,
            'defaultModelChanged': False,
            'randomSeed': seed,
            'randomRuns': random_runs,
            'budgetFraction': BUDGET_FRACTION,
            'budgetRule': BUDGET_RULE,
            'sensitivityRule': SENSITIVITY_RULE,
        },
        'sourceHashes': {name: sha256((Path(run_dir) / name).read_bytes()) for name in files},
    }
    return report


def run_benefit(run_dir, output, *, random_runs=DEFAULT_RANDOM_RUNS, seed=DEFAULT_SEED):
    report = evaluate_run(run_dir, random_runs=random_runs, seed=seed)
    path = benefit_path(output)
    if path.exists():
        raise BaselineError('OUTPUT_EXISTS', '收益评估报告已存在，请使用新输出路径')
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json(path, report)
    return report, path
