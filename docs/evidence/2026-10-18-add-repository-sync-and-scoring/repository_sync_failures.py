"""8.2 运行证据：仓库同步的五类失败与降级路径。

用法（在 backend 目录下）：
    .venv\\Scripts\\python.exe ..\\docs\\evidence\\_run\\repository_sync_failures.py \
        --output ..\\docs\\evidence\\_run\\repository-sync-failures.json

每个场景都真的调用一次 `SyncService`：拒绝类在创建时同步抛错，编排类等作业落到
failed 再记录。全部使用临时目录与一次性目录库，不写真实仓库存储。
"""
import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[3] / 'backend'
sys.path.insert(0, str(BACKEND))

from jit_baseline.catalog import ModelCatalog  # noqa: E402
from jit_baseline.catalog_storage import CatalogStorage  # noqa: E402
from jit_baseline.errors import BaselineError  # noqa: E402
from jit_baseline.sync import SyncService  # noqa: E402


def git(repo, *args, moment=None):
    env = None
    if moment:
        import os
        env = dict(os.environ, GIT_AUTHOR_DATE=moment, GIT_COMMITTER_DATE=moment)
    return subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True,
                          env=env, check=False)


def build_repo(root):
    repo = Path(root) / 'demo-repo'
    repo.mkdir()
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.email', 'evidence@example.com')
    git(repo, 'config', 'user.name', 'Evidence')
    for index, (name, content, moment) in enumerate([
        ('pkg/a.py', 'line\n' * 40, '2024-01-01T00:00:00+00:00'),
        ('pkg/b.py', 'helper\n' * 20, '2024-01-02T00:00:00+00:00'),
        ('pkg/a.py', 'line\n' * 41, '2024-01-03T00:00:00+00:00'),
    ]):
        (repo / name).parent.mkdir(parents=True, exist_ok=True)
        (repo / name).write_text(content, encoding='utf-8')
        git(repo, 'add', '-A')
        git(repo, 'commit', '-q', '-m', f'change {index}', moment=moment)
    return repo


def wait(service, sync_id, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        view = service.get(sync_id)
        if view['status'] in ('completed', 'failed', 'interrupted'):
            return view
        time.sleep(0.2)
    return service.get(sync_id)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = {'kind': 'repository-sync-failures', 'scenarios': []}

    def record(name, stage, error=None, degrade=None, detail=None):
        entry = {'scenario': name, 'stage': stage}
        if error:
            entry['error'] = {'code': error.code, 'message': str(error)}
        if degrade:
            entry['degradeReason'] = degrade
        if detail:
            entry.update(detail)
        report['scenarios'].append(entry)

    with tempfile.TemporaryDirectory(prefix='jit-evidence-') as room:
        root = Path(room)
        repo = build_repo(root)
        datasets = root / 'datasets'
        artifacts = root / 'artifacts'

        def service(database):
            storage = CatalogStorage(database)
            storage.initialize()
            return SyncService(storage, ModelCatalog(storage, artifacts), dataset_root=datasets,
                               artifact_root=artifacts, allow_local=True, timeout=120)

        def create(service, **override):
            payload = {'repositoryUrl': str(repo), 'branch': 'HEAD', 'since': '2024-01-01',
                       'until': '2025-01-01', 'commitLimit': 500, 'strategy': 'auto'}
            payload.update(override)
            return service.create(payload)

        # 1. 非 HTTP(S) 协议：同步拒绝，不建作业。
        empty = service(root / 'empty.sqlite3')
        for name, url in [('non-http-protocol', 'file:///C:/secret/repo'),
                          ('private-host', 'https://127.0.0.1/repo.git')]:
            try:
                create(empty, repositoryUrl=url)
                record(name, 'create', detail={'accepted': True})
            except BaselineError as exc:
                record(name, 'create', error=exc)

        # 2. 空窗口：范围内没有提交。
        try:
            view, _ = create(empty, since='2026-01-01', until='2026-02-01')
            done = wait(empty, view['syncId'])
            record('empty-window', done['status'], detail={'error': done['error']})
        except BaselineError as exc:
            record('empty-window', 'create', error=exc)

        # 3. 超出提交上限：拒绝整次同步而不是截断。
        try:
            view, _ = create(empty, commitLimit=1)
            done = wait(empty, view['syncId'])
            record('over-limit', done['status'], detail={'error': done['error']})
        except BaselineError as exc:
            record('over-limit', 'create', error=exc)

        # 4. 降级：样本不足且目录里有现成六字段模型。
        #    这里只验证"没有兼容模型"这一面，降级成功路径由真实同步证据覆盖。
        try:
            view, _ = create(empty)
            done = wait(empty, view['syncId'])
            record('no-generic-model', done['status'], degrade=done.get('degradeReason'),
                   detail={'error': done['error'], 'modelStrategy': done.get('modelStrategy')})
        except BaselineError as exc:
            record('no-generic-model', 'failed', error=exc,
                   degrade=getattr(exc, 'degrade_reason', None))

        # 5. 强制训练但无法时间切分：整次失败并说明改用现成模型。
        try:
            view, _ = create(empty, strategy='force-train')
            done = wait(empty, view['syncId'])
            record('force-train-unavailable', done['status'], detail={'error': done['error']})
        except BaselineError as exc:
            record('force-train-unavailable', 'create', error=exc)

    report['generatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps([{k: item.get(k) for k in ('scenario', 'stage', 'error', 'degradeReason')}
                      for item in report['scenarios']], ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
