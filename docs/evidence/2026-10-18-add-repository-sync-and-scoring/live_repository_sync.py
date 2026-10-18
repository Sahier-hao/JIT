"""8.1 运行证据：对真实公开仓库跑一次完整同步并记录耗时与结果。

用法（在 backend 目录下）：
    .venv\\Scripts\\python.exe ..\\docs\\evidence\\_run\\live_repository_sync.py \
        --repo https://github.com/Sahier-hao/JIT.git --output ..\\docs\\evidence\\_run\\repository-sync-live.json

数据集版本写到 ``--dataset-root``（默认与本文件同级的 ``datasets-live``），不写随仓库
提交的 ``backend/data/datasets``，避免真实运行改变公开数据目录。目录库用当前
``backend/storage/catalog.sqlite3``，作业记录与时间戳都是真实的。
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[3] / 'backend'
sys.path.insert(0, str(BACKEND))

from jit_baseline.catalog import ModelCatalog  # noqa: E402
from jit_baseline.catalog_storage import CatalogStorage  # noqa: E402
from jit_baseline.sync import SyncService  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--dataset-root', type=Path, default=None)
    parser.add_argument('--days', type=int, default=90)
    parser.add_argument('--limit', type=int, default=500)
    parser.add_argument('--strategy', default='auto', choices=('auto', 'generic-model', 'force-train'))
    args = parser.parse_args()
    dataset_root = args.dataset_root or args.output.parent / 'datasets-live'
    database = os.environ.get('JIT_CATALOG_DATABASE') or None
    storage = CatalogStorage(database) if database else CatalogStorage()
    catalog = ModelCatalog(storage)
    service = SyncService(storage, catalog, dataset_root=dataset_root)
    until = datetime.now(timezone.utc)
    since = until - timedelta(days=args.days)
    started = time.monotonic()
    view, created = service.create({
        'repositoryUrl': args.repo,
        'since': since.isoformat(),
        'until': until.isoformat(),
        'commitLimit': args.limit,
        'strategy': args.strategy,
    }, request_id='evidence-live-sync')
    stages = []
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        current = service.get(view['syncId'])
        stage = current.get('stage')
        if stages and stages[-1]['stage'] == stage:
            stages[-1]['until'] = round(time.monotonic() - started, 3)
        else:
            stages.append({'stage': stage, 'status': current['status'],
                           'from': round(time.monotonic() - started, 3)})
        if current['status'] in ('completed', 'failed', 'interrupted'):
            view = current
            break
        time.sleep(0.5)
    elapsed = round(time.monotonic() - started, 3)
    page = service.commits(view['syncId'], limit=200, offset=0)
    commits, total = page['commits'], page['total']
    positives = sum(1 for item in commits if item['label'] == 1)
    report = {
        'kind': 'repository-sync-live',
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'request': view,
        'created': created,
        'elapsedSeconds': elapsed,
        'stages': stages,
        'commitsReturned': len(commits),
        'commitsTotal': total,
        'labels': {'positiveInFirstPage': positives, 'returned': len(commits)},
        'datasetRoot': str(dataset_root),
        'topCommits': [
            {'commitId': item['commitId'], 'risk': item['risk'], 'label': item['label'],
             'addedLines': item['addedLines'], 'deletedLines': item['deletedLines'],
             'files': item['files']}
            for item in commits[:5]
        ],
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'syncId': view['syncId'], 'status': view['status'], 'stage': view.get('stage'),
                      'elapsedSeconds': elapsed, 'commitsTotal': total,
                      'modelStrategy': view.get('modelStrategy'),
                      'degradeReason': view.get('degradeReason'),
                      'trainRecords': view.get('trainRecords'),
                      'trainPositives': view.get('trainPositives')}, ensure_ascii=False, indent=2))
    return 0 if view['status'] == 'completed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
