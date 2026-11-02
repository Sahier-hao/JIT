"""持续审查的隔离浏览器验收服务：真实 Git 采集/推理，可控公开 GitHub 响应。

仅直接运行本脚本才安装测试控制接口。所有数据库、仓库、数据集与模型副本
写入新建临时目录；不启动默认目录库，也不修改原始模型或访问 GitHub。
"""
import argparse
import base64
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from urllib.parse import parse_qs, urlparse

from fastapi import Request
import uvicorn

from jit_baseline.api import create_app
from jit_baseline.catalog import ModelCatalog
from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.collect import collect_repository
from jit_baseline.config import BACKEND
from jit_baseline.sync import SyncService

URL = 'https://github.com/preview/project'


def build_preview(parent):
    room = Path(tempfile.mkdtemp(prefix='project-review-', dir=parent)).resolve()
    repository = room / 'repository'
    repository.mkdir()

    def git(*args, moment=None):
        env = dict(os.environ)
        if moment:
            env.update(GIT_AUTHOR_DATE=moment, GIT_COMMITTER_DATE=moment)
        return subprocess.check_output(['git', '-C', str(repository), *args], env=env).decode('utf-8').strip()

    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Preview')
    git('config', 'user.email', 'preview@example.invalid')
    # 最近一周集中 26 条观测，既能展示有效占比，也保留未知空桶。
    first = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)-timedelta(days=5)
    revisions, dates = [], []
    for index in range(27):
        moment = (first+timedelta(hours=index)).isoformat()
        (repository / 'review.py').write_text(f'value = {index}\n'+'# 验收代码\n'*30, encoding='utf-8')
        git('add', 'review.py')
        git('commit', '-q', '-m', f'调整审查示例 {index}', moment=moment)
        revisions.append(git('rev-parse', 'HEAD'))
        dates.append(moment)
    state = dict(index=25, draft=False, remoteState='open', fail=False)

    root = room / 'artifacts'
    shutil.copytree(BACKEND / 'artifacts' / 'baseline', root / 'baseline')
    # 描述文件登记是服务启动前提：给隔离运行一份只读副本，不引用开发目录。
    shutil.copytree(BACKEND / 'data' / 'datasets', room / 'datasets')
    storage = CatalogStorage(room / 'catalog.sqlite3')
    storage.initialize()
    catalog = ModelCatalog(storage, root)
    model_id = catalog.register_key('baseline')['model']['modelId']

    def collect(source, **kwargs):
        if source not in (URL, 'https://github.com/preview/fork'):
            raise ValueError('验收服务禁止访问夹具之外的仓库')
        kwargs['allow_local'] = True
        return collect_repository(str(repository), **kwargs)

    service = SyncService(storage, catalog, dataset_root=room / 'datasets', artifact_root=root,
                          collect_fn=collect)
    app = create_app(database=storage.path, artifact_root=root, sync_service=service,
                     dataset_root=room / 'datasets')

    def overview_request(path):
        if path.endswith('/languages'):
            return {'Python': 12400, 'TypeScript': 3100}
        if '/commits?' in path:
            return [dict(sha=revisions[i], html_url=f'{URL}/commit/{revisions[i]}',
                         commit=dict(message=f'验收提交 {i}', author=dict(date=dates[i], name='Preview')),
                         author=dict(login='preview-author')) for i in range(len(revisions) - 1, -1, -1)]
        return dict(full_name='preview/project', description='隔离验收项目：真实 Git、SQLite 与模型副本。',
                    default_branch='main', private=False, stargazers_count=12, forks_count=3,
                    open_issues_count=2, subscribers_count=5, pushed_at=dates[-1], created_at=dates[0],
                    topics=['review', 'jit'], license={'spdx_id': 'MIT'}, homepage=None,
                    html_url=URL)

    app.state.repository_overview.request = overview_request

    def public_pr():
        index = state['index']
        return dict(number=1, title=f'修正审查示例 · 版本 {index}', body='检查固定代码来源与作者更新后的私人进度保护。',
            state=state['remoteState'], merged=False, draft=state['draft'], user=dict(login='preview-author'),
            updated_at=dates[index], base=dict(sha=revisions[0], ref='main', repo=dict(full_name='preview/project', private=False)),
            head=dict(sha=revisions[index], ref='review-change', repo=dict(full_name='preview/fork', private=False)),
            changed_files=1, commits=index)

    def request(path):
        from jit_baseline.errors import BaselineError
        if state['fail']:
            raise BaselineError('PR_SOURCE_UNAVAILABLE', '验收模拟：公开来源暂时不可用')
        parsed, index = urlparse(path), state['index']
        query = parse_qs(parsed.query)
        if '/compare/' in path:
            return dict(status='ahead')
        if '/contents/' in path:
            revision = query['ref'][0]
            content = git('show', revision+':review.py')+'\n'
            return dict(type='file', encoding='base64', size=len(content.encode()),
                        content=base64.b64encode(content.encode()).decode())
        if path.startswith('/repos/preview/project/pulls?'):
            wanted = query.get('state', ['open'])[0]
            return [deepcopy(public_pr())] if wanted in ('all', state['remoteState']) and query.get('page', ['1']) == ['1'] else []
        if '/files?' in path:
            return [dict(filename='review.py', sha=git('rev-parse', revisions[index]+':review.py'), status='modified',
                         additions=1, deletions=1, patch=f'@@ -1,1 +1,1 @@\n-value = 0\n+value = {index}')]
        if '/commits?' in path:
            return [dict(sha=revisions[i], commit=dict(message=f'调整审查示例 {i}', author=dict(date=dates[i])))
                    for i in range(1, index+1)]
        if '/pulls/1' == parsed.path[-8:]:
            return deepcopy(public_pr())
        if parsed.path == '/repos/preview/project':
            return dict(private=False, default_branch='main')
        raise ValueError('未定义的验收远端请求：'+path)

    app.state.pr_review.request = request
    # 预置成功分支分析仍走真实采集、登记和模型推理；不伪造完成状态或风险分数。
    job, _ = service.create(dict(repositoryUrl=URL, branch='main', strategy='generic-model', modelId=model_id,
                                 since=(first-timedelta(days=1)).date().isoformat(),
                                 until=(first+timedelta(days=4)).date().isoformat(), commitLimit=100))
    deadline = time.monotonic()+120
    while service.get(job['syncId'])['status'] not in ('completed', 'failed') and time.monotonic() < deadline:
        time.sleep(.05)
    assert service.get(job['syncId'])['status'] == 'completed', service.get(job['syncId'])
    identity = job['repositoryId']
    metadata = dict(repositoryId=identity, modelId=model_id, branchSyncId=job['syncId'],
                    workspace=str(room), headSha=revisions[25], nextHeadSha=revisions[26])
    (room / 'preview.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')

    @app.get('/__test/context')
    def context():
        return dict(metadata, remote=state)

    @app.post('/__test/remote')
    async def change_remote(request: Request):
        payload = await request.json()
        assert set(payload) <= {'index', 'draft', 'remoteState', 'fail'}
        assert payload.get('index', 25) in (25, 26)
        assert payload.get('remoteState', 'open') in ('open', 'closed')
        state.update(payload)
        return dict(state)

    @app.post('/__test/observe')
    def observe():
        # 只推进实际服务的终态观察；不插入事件或修改任务结果。
        app.state.pr_updates.tick()
        return app.state.pr_updates.events(identity)

    print(json.dumps(metadata, ensure_ascii=False), flush=True)
    return app, service


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='启动一次性持续审查验收环境')
    parser.add_argument('--parent', default='D:/tmp')
    parser.add_argument('--port', type=int, default=18769)
    options = parser.parse_args()
    application, sync = build_preview(options.parent)
    try:
        uvicorn.run(application, host='127.0.0.1', port=options.port)
    finally:
        sync.close()
