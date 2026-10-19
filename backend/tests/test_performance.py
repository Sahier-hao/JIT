"""非功能证据：单条预测（含归因）的端到端时延。

阈值可用环境变量 `JIT_LATENCY_P95_MS` 放宽，默认 250 ms；测量走真实
FastAPI 应用与真实模型产物，每次请求包含保存与归因计算。
"""

import os
import statistics
import time

from fastapi.testclient import TestClient

from test_artifacts import real_run  # noqa: F401
from test_catalog_api import HEADERS, settings  # noqa: F401

SAMPLE_SIZE = 100
WARMUP = 5
DEFAULT_P95_MS = 250.0
BODY = {'featureSchemaVersion': 'openstack-six-v1', 'project': 'latency-project',
        'record': {'recordId': 'latency-input',
                   'features': {'ns': 1, 'nd': 2, 'nf': 3, 'ent': 0.8, 'la': 10, 'ld': 2}}}


def percentile(values, share):
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(round(share * len(ordered))) - 1))
    return ordered[index]


def test_prediction_latency_p95_stays_under_budget(settings):  # noqa: F811
    from jit_baseline.api import create_app

    app = create_app(**settings)
    with TestClient(app) as client:
        candidate = client.get('/api/v1/model-candidates', headers=HEADERS).json()['candidates'][0]
        model = client.post('/api/v1/models/register', headers=HEADERS, json={
            'candidateId': candidate['candidateId'],
            'expectedManifestSha256': candidate['manifestSha256']}).json()['model']
        body = dict(BODY, modelId=model['modelId'])
        for _ in range(WARMUP):
            assert client.post('/api/v1/predictions', headers=HEADERS, json=body).status_code == 201
        elapsed = []
        for _ in range(SAMPLE_SIZE):
            started = time.perf_counter()
            response = client.post('/api/v1/predictions', headers=HEADERS, json=body)
            elapsed.append((time.perf_counter() - started) * 1000.0)
            assert response.status_code == 201
            assert response.json()['records'][0]['explanationStatus'] == 'supported'

    p50 = statistics.median(elapsed)
    p95 = percentile(elapsed, 0.95)
    budget = float(os.environ.get('JIT_LATENCY_P95_MS', DEFAULT_P95_MS))
    print(f'prediction latency: n={SAMPLE_SIZE} p50={p50:.1f}ms p95={p95:.1f}ms '
          f'max={max(elapsed):.1f}ms budget={budget:.0f}ms')
    assert p95 < budget, f'P95 {p95:.1f}ms 超过预算 {budget:.0f}ms'
