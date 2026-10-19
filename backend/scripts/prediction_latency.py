"""单条预测请求的延迟实测（PEX-06），手动运行、不纳入 CI。

同一个真实模型服务上各发 N 次 `POST /api/v1/predictions`：
一组走完整遮挡归因，一组把归因函数替换为直接返回空结果，用来量化解释带来的开销。
逐次计时取 nearest-rank P95；结果写入本 change 的证据目录，同时打印摘要。

用法（在 backend 目录下）：
    .venv\\Scripts\\python.exe scripts\\prediction_latency.py
    .venv\\Scripts\\python.exe scripts\\prediction_latency.py --samples 100
"""

import argparse
import json
import logging
import platform
import shutil
import statistics
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from jit_baseline import attribution
from jit_baseline.api import create_app
from jit_baseline.artifacts import build_run
from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.config import BACKEND

REPO_ROOT = BACKEND.parent
EVIDENCE = REPO_ROOT / 'docs/evidence/explain-predictions-and-verify-service/prediction-latency.json'
FALLBACK_FEATURES = {'ns': 1, 'nd': 2, 'nf': 3, 'ent': 0.8, 'la': 10, 'ld': 2}


def p95(values):
    """nearest-rank P95：升序后取第 ceil(0.95*n) 个。"""
    ordered = sorted(values)
    return ordered[((95 * len(ordered)) + 99) // 100 - 1]


def measure(client, body, label, samples):
    client.post('/api/v1/predictions', json=body)  # 预热，排除首次加载
    elapsed = []
    for _ in range(samples):
        begin = time.perf_counter()
        response = client.post('/api/v1/predictions', json=body)
        elapsed.append((time.perf_counter() - begin) * 1000)
        assert response.status_code == 201, response.text
    return {'label': label, 'samples': samples, 'medianMs': round(statistics.median(elapsed), 1),
            'p95Ms': round(p95(elapsed), 1), 'maxMs': round(max(elapsed), 1)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--samples', type=int, default=50)
    parser.add_argument('--output', type=Path, default=EVIDENCE)
    options = parser.parse_args()
    logging.getLogger('jit.catalog').setLevel(logging.WARNING)

    workdir = Path(tempfile.mkdtemp(prefix='prediction-latency-', dir=BACKEND / '.cache'))
    try:
        build_run(BACKEND / 'data/openstack', workdir / 'baseline')
        store = CatalogStorage(workdir / 'catalog.sqlite3')
        store.initialize()
        settings = {'directory': workdir / 'baseline', 'database': store.path, 'artifact_root': workdir,}
        with TestClient(create_app(**settings)) as client:
            candidate = client.get('/api/v1/model-candidates', ).json()['candidates'][0]
            model = client.post('/api/v1/models/register', json={
                'candidateId': candidate['candidateId'],
                'expectedManifestSha256': candidate['manifestSha256']}).json()['model']
            input_file = workdir / 'baseline' / 'test-input.json'
            features = FALLBACK_FEATURES
            if input_file.exists():
                features = json.loads(input_file.read_text(encoding='utf-8'))['records'][0]['metrics']
            body = {'modelId': model['modelId'], 'featureSchemaVersion': 'openstack-six-v1',
                    'project': 'latency-fixture', 'record': {'recordId': 'latency-1', 'features': features}}

            with_explanation = measure(client, body, 'with-explanation', options.samples)
            original = attribution.explain
            attribution.explain = lambda *args, **kwargs: {
                'method': attribution.METHOD, 'items': [], 'summary': 'latency baseline without occlusion'}
            try:
                without_explanation = measure(client, body, 'without-explanation', options.samples)
            finally:
                attribution.explain = original
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    report = {
        'kind': 'prediction-latency-backend',
        'measuredAt': datetime.now(timezone.utc).isoformat(),
        'method': ('进程内 ASGI 客户端（TestClient）对真实 create_app + 真实模型发 '
                   'POST /api/v1/predictions，含数据库写入与日志，nearest-rank P95；'
                   'without-explanation 仅替换归因函数，其余链路相同'),
        'model': {'schema': 'openstack-six-v1', 'method': model['method'], 'features': features},
        'withExplanation': with_explanation,
        'withoutExplanation': without_explanation,
        'explanationOverheadP95Ms': round(with_explanation['p95Ms'] - without_explanation['p95Ms'], 1),
        'threshold': {'p95Ms': 250},
        'meetsThreshold': with_explanation['p95Ms'] <= 250,
        'environment': {'python': platform.python_version(), 'platform': platform.platform(),
                        'processor': platform.processor()},
        'statement': '本机链路实测，用于说明解释开销；不是跨机器容量承诺。',
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    summary = {key: value for key, value in report.items() if key != 'model'}
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f'written to {options.output}')


if __name__ == '__main__':
    main()
