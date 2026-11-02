"""Retrospective benefit evaluation on a frozen model's test partition.

The evaluation answers one question only: when the same 20% LOC budget is
spent in model-score order, newest-first order or a seeded random order, how
many historical positive labels are covered? It does not select models,
tune parameters on the test partition, or turn risk scores into defect
probabilities.
"""
import hashlib
import statistics
from datetime import datetime, timezone
from pathlib import Path

from .artifacts import Snapshot, check_reference_predictions, environment, read_json, write_json
from .config import BACKEND
from .data import BaselineError, sha256
from .metrics import normalized_effort_area
from .model import predict_risks

REPORT_KIND = "model-benefit-evaluation"
REPORT_VERSION = 1
BENEFIT_FILE = "benefit-report.json"
DEFAULT_RANDOM_RUNS = 200
DEFAULT_SEED = 2026
BUDGET_FRACTION = 0.2
LIMITATIONS = (
    "这是冻结测试分区上的回顾性评估，不代表在线效果或缺陷概率。",
    "标签来自发布者历史观测或简化 SZZ；未观测到缺陷引入不等于已证实无缺陷。",
    "只比较同一测试分区、同一预算和同一标签口径下的检查顺序，不据此宣布最佳模型。",
    "模型分数策略按原始风险降序，不按风险/成本密度；既有密度排序 Popt 仅作对照。",
    "模型、阈值和策略在评估前已固定；没有使用测试分区调参。",
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


def _time_order(records):
    return sorted(range(len(records)),
                  key=lambda i: (-records[i]['epoch'], records[i]['id']))


def _random_order(records, seed, run):
    return sorted(range(len(records)),
                  key=lambda i: hashlib.sha256(f'{seed}:{run}:{records[i]["id"]}'.encode()).digest())


def _recall20(records, order, *, total, budget, positives):
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
            break
        selected += 1
        used += cost
        covered += records[index]['label']
    precision = _metric(covered / selected) if selected else _metric(reason='预算内没有可检查提交')
    return _metric(covered / positives), {'selectedCount': selected, 'usedLoc': used,
                                          'issuesCovered': covered,
                                          'precisionAtBudget': precision}


def _strategy(records, order, *, ordering, total, budget, positives):
    recall, coverage = _recall20(records, order, total=total, budget=budget, positives=positives)
    first_positive = next((position for position, index in enumerate(order)
                           if records[index]['label'] == 1), None)
    ifa = (_metric(reason='没有正标签提交') if first_positive is None
           else _metric(first_positive))
    popt, detail = normalized_effort_area(records, order, ordering=ordering)
    return {
        'ordering': ordering,
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


def _sentence(model, time, random, *, budget, total, positives):
    model_recall, time_recall = model['recall20Loc'], time['recall20Loc']
    random_recall = random['recall20Loc']
    if None in (model_recall.get('value'), time_recall.get('value'), random_recall.get('mean')):
        return '测试分区缺少可用正例或工作量，无法比较三种检查顺序。'
    def part(result):
        return (f"{result['value'] * 100:.1f}%"
                f"（{result['value'] * positives:.1f}/{positives} 个历史标记）")
    random_mean = random_recall['mean']
    return (f"同样检查 20% 代码改动量（预算 {budget:g} 行，共 {total:g} 行）："
            f"模型排序覆盖 {part(model_recall)}，"
            f"时间顺序覆盖 {part(time_recall)}，"
            f"随机平均覆盖 {random_mean * 100:.1f}%"
            f"（约 {random_mean * positives:.1f}/{positives} 个历史标记）。")


def evaluate_run(run_dir, *, random_runs=DEFAULT_RANDOM_RUNS, seed=DEFAULT_SEED):
    if (isinstance(random_runs, bool) or not isinstance(random_runs, int)
            or not 1 <= random_runs <= 10000):
        raise BaselineError('INPUT_INVALID', '随机重复次数必须是 1 到 10000 的整数')
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise BaselineError('INPUT_INVALID', '随机种子必须是非负整数')
    snapshot, records, positives, total = _load(run_dir)
    budget = BUDGET_FRACTION * total
    model = _strategy(records, _model_order(records), ordering='score-desc,time-desc,id-asc',
                      total=total, budget=budget, positives=positives)
    time = _strategy(records, _time_order(records), ordering='time-desc,id-asc',
                     total=total, budget=budget, positives=positives)
    random_results = [
        _strategy(records, _random_order(records, seed, run), ordering=f'random(seed={seed},run={run})',
                  total=total, budget=budget, positives=positives)
        for run in range(random_runs)
    ]
    random = _random_summary(random_results, random_runs, seed)
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
        'strategies': {'model': model, 'time': time, 'random': random},
        'comparisons': {
            'modelVsTime': {
                'recall20Loc': _delta(model['recall20Loc'].get('value'), time['recall20Loc'].get('value')),
                'ifa': _delta(model['ifa'].get('value'), time['ifa'].get('value')),
                'popt': _delta(model['popt'].get('value'), time['popt'].get('value')),
            },
            'modelVsRandomMean': {
                'recall20Loc': _delta(model['recall20Loc'].get('value'), random['recall20Loc'].get('mean')),
                'ifa': _delta(model['ifa'].get('value'), random['ifa'].get('mean')),
                'popt': _delta(model['popt'].get('value'), random['popt'].get('mean')),
            },
        },
        'conclusion': {
            'sentence': _sentence(model, time, random, budget=budget, total=total, positives=positives),
            'recall20': {
                'model': model['recall20Loc'],
                'time': time['recall20Loc'],
                'randomMean': random['recall20Loc'],
                'modelVsTime': _delta(model['recall20Loc'].get('value'), time['recall20Loc'].get('value')),
                'modelVsRandomMean': _delta(model['recall20Loc'].get('value'), random['recall20Loc'].get('mean')),
            },
        },
        'existingMetrics': summary.get('metrics'),
        'parameterSelection': 'none; frozen artifact; test partition used only for evaluation',
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
