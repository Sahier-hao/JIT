"""隔离验收环境：复制已验证模型、独立 SQLite、自有本机服务。

本脚本只服务测试验收，不参与业务链路，也不会训练或改写任何模型：

* ``prepare``  把已存在的模型产物复制到独立临时根，显式初始化独立 SQLite，并记录
  原产物在复制前后的文件 hash，供事后核对「原开发库与原产物未被改动」。
* ``serve``    用 ``create_app(run, database=..., artifact_root=...)`` 启动自有本机
  服务，不需要团队凭证配置。
* ``invalidate`` / ``restore``  让副本模型临时失效再恢复，用于验证「模型不可用时
  仍能按批次编号重开结果」。
* ``inspect``  读取临时库的批次数与表计数，并核对原产物 hash 是否不变。
* ``cleanup``  只删除本次验收创建、且带 ``environment.json`` 的临时目录。

安全边界：``serve`` 拒绝把默认开发库 ``backend/storage/catalog.sqlite3`` 当作目标库。
"""
import argparse
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jit_baseline.catalog_storage import DEFAULT_DATABASE, CatalogStorage
from jit_baseline.config import BACKEND
from jit_baseline.data import sha256

SOURCES = ('baseline', 'decision-tree-v1')
ENVIRONMENT_FILE = 'environment.json'
MODEL_FILE = 'model.joblib'
DISABLED_SUFFIX = '.acceptance-disabled'


def directory_hashes(directory):
    directory = Path(directory)
    return {file.name: sha256(file.read_bytes()) for file in sorted(directory.iterdir()) if file.is_file()}


def refuse_default_database(database):
    if Path(database).resolve() == Path(DEFAULT_DATABASE).resolve():
        raise SystemExit(json.dumps({'error': 'REFUSED_DEFAULT_DATABASE',
                                     'message': '拒绝在默认开发库上运行隔离验收'}, ensure_ascii=False))


def refuse_shared_artifacts(root):
    if Path(root).resolve() == (BACKEND / 'artifacts').resolve():
        raise SystemExit(json.dumps({'error': 'REFUSED_SHARED_ARTIFACTS',
                                     'message': '拒绝把开发产物根当作隔离产物根'}, ensure_ascii=False))


def prepare(base):
    base = Path(base).resolve()
    cache = (BACKEND / '.cache').resolve()
    if not str(base).startswith(str(cache)) and 'acceptance-' not in base.name:
        raise SystemExit(json.dumps({'error': 'REFUSED_BASE', 'message': '临时根须位于 backend/.cache 下'},
                                    ensure_ascii=False))
    root = base / 'artifacts'
    if root.exists():
        raise SystemExit(json.dumps({'error': 'BASE_NOT_EMPTY', 'message': '临时根已存在，请先 cleanup'},
                                    ensure_ascii=False))
    root.mkdir(parents=True)
    before = {}
    for name in SOURCES:
        source = BACKEND / 'artifacts' / name
        if not (source / 'manifest.json').is_file():
            raise SystemExit(json.dumps({'error': 'SOURCE_MISSING', 'message': str(source)}, ensure_ascii=False))
        before[name] = directory_hashes(source)
        shutil.copytree(source, root / name)
    database = base / 'catalog.sqlite3'
    refuse_default_database(database)
    refuse_shared_artifacts(root)
    CatalogStorage(database).initialize()
    environment = {'kind': 'acceptance-environment', 'base': str(base), 'run': str(root / 'baseline'),
                   'database': str(database), 'artifactRoot': str(root), 'sources': list(SOURCES),
                   'sourceHashes': before, 'sourceHashesAfterCopy': {name: directory_hashes(BACKEND / 'artifacts' / name)
                                                                    for name in SOURCES}}
    if environment['sourceHashes'] != environment['sourceHashesAfterCopy']:
        shutil.rmtree(base, ignore_errors=True)
        raise SystemExit(json.dumps({'error': 'SOURCE_CHANGED', 'message': '复制前后原产物 hash 不一致'},
                                    ensure_ascii=False))
    (base / ENVIRONMENT_FILE).write_text(json.dumps(environment, ensure_ascii=False, indent=2), encoding='utf-8')
    # 只回显定位信息；完整 hash 清单留在 environment.json，避免刷屏。
    print(json.dumps({'kind': environment['kind'], 'base': environment['base'], 'run': environment['run'],
                      'database': environment['database'], 'artifactRoot': environment['artifactRoot'],
                      'sources': environment['sources'], 'fileCount': {name: len(value) for name, value in before.items()},
                      'temporaryDatabaseIsNotDefault': Path(database).resolve() != Path(DEFAULT_DATABASE).resolve()},
                     ensure_ascii=False, indent=2))


def load_environment(base):
    path = Path(base).resolve() / ENVIRONMENT_FILE
    if not path.is_file():
        raise SystemExit(json.dumps({'error': 'ENVIRONMENT_MISSING', 'message': str(path)}, ensure_ascii=False))
    return json.loads(path.read_text(encoding='utf-8'))


def serve(run, database, artifact_root, port):
    refuse_default_database(database)
    refuse_shared_artifacts(artifact_root)
    import uvicorn

    from jit_baseline.api import create_app
    app = create_app(Path(run), database=Path(database), artifact_root=Path(artifact_root))
    # 凭据只经环境变量进入 create_app 默认值，命令行里不出现。
    uvicorn.run(app, host='127.0.0.1', port=port, workers=1, log_level='warning')


def model_path(base, key):
    root = Path(load_environment(base)['artifactRoot'])
    key = str(key)
    if '/' in key or '\\' in key or key in ('', '.', '..'):
        raise SystemExit(json.dumps({'error': 'REFUSED_KEY', 'message': key}, ensure_ascii=False))
    return root / key / MODEL_FILE


def set_model_available(base, key, available):
    path = model_path(base, key)
    disabled = path.with_name(MODEL_FILE + DISABLED_SUFFIX)
    if available:
        if disabled.is_file():
            if path.exists():
                raise SystemExit(json.dumps({'error': 'BOTH_PRESENT', 'message': str(path)}, ensure_ascii=False))
            disabled.replace(path)
    elif path.is_file():
        path.replace(disabled)
    print(json.dumps({'kind': 'acceptance-model-availability', 'key': key, 'available': available,
                      'present': path.is_file()}, ensure_ascii=False))


def table_counts(database):
    counts = {}
    with CatalogStorage(database).connection() as db:
        for table in ('model_version', 'run_location', 'registration_event', 'prediction_batch', 'prediction'):
            counts[table] = db.execute('SELECT count(*) FROM ' + table).fetchone()[0]
    return counts


def inspect(base):
    environment = load_environment(base)
    unchanged = {name: directory_hashes(BACKEND / 'artifacts' / name) == environment['sourceHashes'][name]
                 for name in environment['sources']}
    report = {'kind': 'acceptance-inspection', 'database': environment['database'],
              'temporaryDatabaseIsNotDefault': Path(environment['database']).resolve() != Path(DEFAULT_DATABASE).resolve(),
              'artifactRoot': environment['artifactRoot'], 'counts': table_counts(environment['database']),
              'originalArtifactsUnchanged': unchanged,
              'credentialsInRecord': False}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not all(unchanged.values()):
        sys.exit(1)


def cleanup(base):
    base = Path(base).resolve()
    if not (base / ENVIRONMENT_FILE).is_file():
        raise SystemExit(json.dumps({'error': 'REFUSED_CLEANUP', 'message': str(base)}, ensure_ascii=False))
    shutil.rmtree(base)
    print(json.dumps({'kind': 'acceptance-cleanup', 'removed': str(base)}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description='隔离验收环境生命周期')
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('prepare', 'inspect', 'cleanup'):
        commands.add_parser(name).add_argument('--base', type=Path, required=True)
    server = commands.add_parser('serve')
    server.add_argument('--run', type=Path, required=True)
    server.add_argument('--database', type=Path, required=True)
    server.add_argument('--artifact-root', type=Path, required=True)
    server.add_argument('--port', type=int, required=True)
    for name in ('invalidate', 'restore'):
        availability = commands.add_parser(name)
        availability.add_argument('--base', type=Path, required=True)
        availability.add_argument('--key', default='baseline')
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare(args.base)
    elif args.command == 'serve':
        serve(args.run, args.database, args.artifact_root, args.port)
    elif args.command == 'invalidate':
        set_model_available(args.base, args.key, False)
    elif args.command == 'restore':
        set_model_available(args.base, args.key, True)
    elif args.command == 'inspect':
        inspect(args.base)
    else:
        cleanup(args.base)


if __name__ == '__main__':
    main()
