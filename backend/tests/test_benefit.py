"""审查收益评估：固定测试分区、三种检查顺序、可复现随机与管理员读取。"""
import json

import pytest
from fastapi.testclient import TestClient

from admin_support import AdminTestClient
from jit_baseline.artifacts import write_json
from jit_baseline.api import create_app
from jit_baseline.benefit import _strategy, evaluate_run, run_benefit
from jit_baseline.benefit_reports import BenefitReportService
from jit_baseline.errors import BaselineError
from test_artifacts import real_run  # noqa: F401
from test_catalog_api import settings  # noqa: F401


def register(client):
    candidate = client.get('/api/v1/model-candidates').json()['candidates'][0]
    return client.post('/api/v1/models/register', json={
        'candidateId': candidate['candidateId'],
        'expectedManifestSha256': candidate['manifestSha256'],
    }).json()['model']


def test_benefit_evaluation_is_deterministic_and_reports_negative_results(real_run, tmp_path):  # noqa: F811
    first = evaluate_run(real_run, random_runs=30, seed=2026)
    second = evaluate_run(real_run, random_runs=30, seed=2026)
    assert first['kind'] == 'model-benefit-evaluation'
    assert first['reportVersion'] == 1
    assert first['test']['records'] > 0 and first['test']['positives'] > 0
    assert first['strategies']['model']['ordering'] == 'score-desc,time-desc,id-asc'
    assert first['strategies']['time']['ordering'] == 'time-desc,id-asc'
    assert first['strategies']['random']['runs'] == 30
    assert first['strategies']['random']['seed'] == 2026
    assert first['strategies']['random']['recall20Loc']['validRuns'] == 30
    assert first['strategies'] == second['strategies']
    assert first['conclusion'] == second['conclusion']
    assert first['test'] == second['test']
    assert first['boundary']['defectProbability'] is False
    assert first['boundary']['crossModelRanking'] is False
    assert first['parameterSelection'].startswith('none;')
    assert '历史标记' in first['conclusion']['sentence']
    assert any('缺陷概率' in item for item in first['limitations'])
    # 基线模型在冻结测试分区上并不优于时间或随机顺序；必须如实显示。
    model = first['strategies']['model']['recall20Loc']['value']
    time = first['strategies']['time']['recall20Loc']['value']
    random = first['strategies']['random']['recall20Loc']['mean']
    assert model is not None and time is not None and random is not None
    assert model < time and model < random
    assert first['comparisons']['modelVsTime']['recall20Loc'] < 0
    assert first['comparisons']['modelVsRandomMean']['recall20Loc'] < 0

    output = tmp_path / 'benefit'
    report, path = run_benefit(real_run, output, random_runs=5, seed=7)
    assert path == output / 'benefit-report.json'
    assert path.exists()
    assert json.loads(path.read_text(encoding='utf-8'))['strategies']['random']['seed'] == 7
    with pytest.raises(BaselineError) as error:
        run_benefit(real_run, output, random_runs=5, seed=7)
    assert error.value.code == 'OUTPUT_EXISTS'


def test_benefit_service_finds_latest_report_for_run(tmp_path):
    report = {'kind': 'model-benefit-evaluation', 'reportVersion': 1,
              'generatedUtc': '2026-10-31T00:00:00Z',
              'artifact': {'runId': 'run-1'}, 'test': {}, 'strategies': {},
              'conclusion': {}, 'limitations': [], 'boundary': {}}
    older = {**report, 'generatedUtc': '2026-10-30T00:00:00Z'}
    newer = {**report, 'generatedUtc': '2026-10-31T00:00:00Z'}
    for name, value in (('a', older), ('b', newer)):
        path = tmp_path / name / 'benefit-report.json'
        path.parent.mkdir()
        path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    service = BenefitReportService([tmp_path])
    entry, error = service.for_run('run-1')
    assert error is None
    assert entry['report']['generatedUtc'] == '2026-10-31T00:00:00Z'
    assert service.for_run('missing') == (None, None)


def test_benefit_api_requires_admin_and_reports_unavailable_then_invalid(settings, monkeypatch, tmp_path):  # noqa: F811
    report = evaluate_run(settings['directory'], random_runs=2, seed=2026)
    root = tmp_path / 'benefit' / 'baseline'
    root.mkdir(parents=True)
    path = root / 'benefit-report.json'
    path.write_text(json.dumps(report, ensure_ascii=False), encoding='utf-8')
    monkeypatch.setenv('JIT_BENEFIT_REPORT_ROOT', str(tmp_path / 'benefit'))
    app = create_app(**settings)
    with TestClient(app) as anonymous:
        assert anonymous.get('/api/v1/models/unknown/benefit').status_code == 401
    with AdminTestClient(app) as client:
        model = register(client)
        detail = client.get(f"/api/v1/models/{model['modelId']}").json()
        report['artifact']['runId'] = detail['artifactRunId']
        path.write_text(json.dumps(report, ensure_ascii=False), encoding='utf-8')
        before = app.state.catalog.default_model_id()
        response = client.get(f"/api/v1/models/{model['modelId']}/benefit")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body['available'] is True
        assert body['reportId'] and body['source']
        assert body['report']['artifact']['runId'] == detail['artifactRunId']
        assert body['report']['strategies']['model']['recall20Loc']['value'] is not None
        assert app.state.catalog.default_model_id() == before

        path.unlink()
        missing = client.get(f"/api/v1/models/{model['modelId']}/benefit").json()
        assert missing['available'] is False and missing['reason']
        path.write_text(json.dumps({'kind': 'wrong', 'reportVersion': 1,
                                    'artifact': {'runId': detail['artifactRunId']}},
                                   ensure_ascii=False), encoding='utf-8')
        invalid = client.get(f"/api/v1/models/{model['modelId']}/benefit")
        assert invalid.status_code == 422
        assert invalid.json()['error']['code'] == 'REPORT_INVALID'


def test_strategy_reports_undefined_metrics_without_inventing_values():
    records = [{'id': 'a', 'epoch': 1, 'label': 0, 'risk': 0.1, 'cost': 1,
                'metrics': {'la': 1, 'ld': 0}}]
    result = _strategy(records, [0], ordering='test', total=1, budget=0.2, positives=0)
    assert result['recall20Loc'] == {'value': None, 'reason': '没有正标签提交'}
    assert result['ifa'] == {'value': None, 'reason': '没有正标签提交'}
    assert result['popt']['value'] is None and result['popt']['reason'] == '没有正标签提交'
    zero_cost = [{'id': 'a', 'epoch': 1, 'label': 1, 'risk': 0.1, 'cost': 0,
                  'metrics': {'la': 0, 'ld': 0}}]
    zero = _strategy(zero_cost, [0], ordering='test', total=0, budget=0, positives=1)
    assert zero['recall20Loc']['reason'] == '总工作量为零'
    assert zero['popt']['reason'] == '总工作量为零'
