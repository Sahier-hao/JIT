"""管理区多项目实验报告：固定目录、内容标识、状态归一与管理权限。"""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from admin_support import AdminTestClient
from jit_baseline.api import create_app
from jit_baseline.catalog import ModelCatalog
from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.errors import BaselineError
from jit_baseline.multi_project import REPORT_KIND, REPORT_VERSION
from jit_baseline.multi_project_reports import MultiProjectReportService
from jit_baseline.sync import SyncService

PROTOCOLS = ['local', 'pooled', 'leave-one-project-out', 'global+local']


def _target(project='p1', *, value=0.5, reason=None):
    metrics = {name: {'value': value, 'reason': reason}
               for name in ('averagePrecision', 'rocAuc', 'recall20Loc', 'popt', 'f1', 'ifa')}
    return {'project': project, 'status': 'succeeded', 'trainingProjects': [project],
            'trainingSeconds': 0.1, 'metrics': metrics}


def _summary(value=0.5):
    metrics = {}
    for name in ('averagePrecision', 'rocAuc', 'recall20Loc', 'popt', 'f1', 'ifa'):
        metrics[name] = {'direction': 'maximize', 'definedCount': 1, 'macroMean': value,
                         'populationVariance': 0.0,
                         'worstProject': {'project': 'p1', 'value': value}, 'undefined': []}
    return {'metrics': metrics, 'worstProjectByPrimaryMetric': {'metric': 'averagePrecision',
                                                                'project': 'p1', 'value': value}}


def _report(*, status='complete', protocols=None, failures=None, projects=None, methods=None):
    protocols = protocols or {name: {'status': 'complete', 'targets': [_target()],
                                     'summary': _summary()} for name in PROTOCOLS}
    return {
        'kind': REPORT_KIND, 'reportVersion': REPORT_VERSION,
        'generatedUtc': '2026-10-30T19:13:25+08:00', 'schema': 'kamei14-git-v1',
        'metricSet': 'metric-set-v2', 'protocols': PROTOCOLS,
        'methods': methods or ['logistic-regression-l2-v1'],
        'projects': projects or [{'name': 'p1', 'status': 'succeeded', 'dataset': 'p1',
                                  'version': 'p1-2022-01-01_2025-01-01', 'includedRows': 10,
                                  'positiveLabels': 2, 'partitions': {}, 'url': 'https://example.invalid/p1',
                                  'revision': 'a' * 40, 'schema': 'kamei14-git-v1'}],
        'results': {'logistic-regression-l2-v1': protocols},
        'failures': failures or [],
        'boundary': {'offlineOnly': True, 'automaticModelSelection': False,
                     'defaultModelChanged': False, 'bestMethodDeclared': False,
                     'crossProjectMetricsAreMacroAverages': True},
        'environment': {'python': '3.14.2', 'platform': 'test', 'packages': {}},
        'sourceCode': {'multi_project.py': 'b' * 64},
        'status': status,
    }


def _write(root, name, report):
    path = Path(root) / name / 'multi-project-report.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False), encoding='utf-8')
    return path


def test_lists_complete_partial_failed_and_invalid_reports_without_leaking_paths(tmp_path, monkeypatch):
    complete = _report()
    partial = _report(status='complete-with-failures',
                      protocols={'local': {'status': 'complete', 'targets': [_target()], 'summary': _summary()},
                                 'pooled': {'status': 'partial', 'targets': [_target('p1')], 'summary': _summary()},
                                 'leave-one-project-out': {'status': 'failed', 'targets': [], 'summary': _summary()},
                                 'global+local': {'status': 'failed', 'targets': [], 'summary': _summary()}},
                      failures=[{'status': 'failed', 'stage': 'fit', 'code': 'MODEL_INVALID',
                                 'message': '测试失败', 'method': 'logistic-regression-l2-v1',
                                 'protocol': 'pooled', 'project': 'p1'}])
    failed = _report(status='complete-with-failures',
                     protocols={name: {'status': 'failed', 'targets': [], 'summary': _summary()}
                                for name in PROTOCOLS},
                     projects=[{'name': 'p1', 'status': 'failed', 'version': 'v1',
                                'failure': {'stage': 'split', 'code': 'SPLIT_INVALID',
                                            'message': '无法切分'}}],
                     failures=[{'status': 'failed', 'stage': 'split', 'code': 'SPLIT_INVALID',
                                'message': '无法切分', 'project': 'p1'}])
    _write(tmp_path / 'evidence', 'complete', complete)
    _write(tmp_path / 'evidence', 'partial', partial)
    _write(tmp_path / 'evidence', 'failed', failed)
    (tmp_path / 'evidence' / 'bad').mkdir()
    (tmp_path / 'evidence' / 'bad' / 'multi-project-report.json').write_text('{not json', encoding='utf-8')

    service = MultiProjectReportService([tmp_path / 'evidence'])
    listed = service.list()
    by_status = {item['status']: item for item in listed['reports']}
    assert set(by_status) == {'complete', 'partial', 'failed', 'invalid'}
    assert listed['total'] == 4
    assert by_status['complete']['methodCount'] == 1
    assert by_status['complete']['projectCount'] == 1
    assert by_status['partial']['failureCount'] == 1
    assert by_status['partial']['partialProtocolCount'] == 1
    assert by_status['partial']['failedProtocolCount'] == 2
    assert by_status['failed']['failedProjectCount'] == 1
    assert by_status['invalid']['error']['code'] == 'REPORT_INVALID'
    for entry in listed['reports']:
        assert not Path(entry['source']).is_absolute()
        assert ':' not in entry['source']

    detail = service.get(by_status['complete']['reportId'])
    assert detail['report']['schema'] == 'kamei14-git-v1'
    assert detail['report']['results']['logistic-regression-l2-v1']['local']['targets'][0]['project'] == 'p1'
    with pytest.raises(BaselineError) as error:
        service.get(by_status['invalid']['reportId'])
    assert error.value.code == 'REPORT_INVALID'


def test_unknown_and_traversal_ids_do_not_read_arbitrary_files(tmp_path):
    _write(tmp_path / 'evidence', 'complete', _report())
    service = MultiProjectReportService([tmp_path / 'evidence'])
    for identity in ('missing', '../../etc/passwd', str(tmp_path / 'evidence' / 'complete' / 'multi-project-report.json')):
        with pytest.raises(BaselineError) as error:
            service.get(identity)
        assert error.value.code == 'REPORT_NOT_FOUND'


def test_identical_report_content_is_one_report_across_roots(tmp_path):
    report = _report()
    _write(tmp_path / 'evidence', 'one', report)
    _write(tmp_path / 'artifacts', 'two', report)
    service = MultiProjectReportService([tmp_path / 'evidence', tmp_path / 'artifacts'])
    listed = service.list()
    assert listed['total'] == 1


def _app(tmp_path, monkeypatch):
    storage = CatalogStorage(tmp_path / 'reports.sqlite3')
    storage.initialize()
    root = tmp_path / 'artifacts'
    root.mkdir()
    catalog = ModelCatalog(storage, root)
    service = SyncService(storage, catalog, dataset_root=tmp_path / 'datasets',
                          artifact_root=root, allow_local=True,
                          collect_fn=lambda *args, **kwargs: None)
    monkeypatch.setenv('JIT_MULTI_PROJECT_REPORT_ROOT', str(tmp_path / 'reports'))
    app = create_app(database=storage.path, artifact_root=root, sync_service=service)
    return app, service


def test_report_api_requires_admin_and_does_not_change_model_state(tmp_path, monkeypatch):
    _write(tmp_path / 'reports', 'complete', _report())
    app, service = _app(tmp_path, monkeypatch)
    try:
        with TestClient(app) as anonymous:
            response = anonymous.get('/api/admin/multi-project-reports')
            assert response.status_code == 401
            assert response.json()['error']['code'] == 'AUTH_REQUIRED'
            assert response.json()['error']['requestId'] == response.headers['X-Request-Id']
        with AdminTestClient(app) as client:
            before = app.state.catalog.default_model_id()
            listed = client.get('/api/admin/multi-project-reports').json()
            assert listed['total'] == 1
            identity = listed['reports'][0]['reportId']
            detail = client.get(f'/api/admin/multi-project-reports/{identity}')
            assert detail.status_code == 200
            assert detail.json()['report']['boundary']['bestMethodDeclared'] is False
            assert client.get('/api/admin/multi-project-reports/missing').status_code == 404
            assert client.get('/api/admin/multi-project-reports/..%2F..%2Fetc%2Fpasswd').status_code == 404
            assert app.state.catalog.default_model_id() == before
    finally:
        service.close()
