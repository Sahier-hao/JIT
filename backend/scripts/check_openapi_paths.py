"""Check that every FastAPI path/method exists in the curated OpenAPI contract.

Parameter names differ between the generated schema (`repository_id`) and the
curated contract (`repositoryId`), so paths are compared by shape with all
placeholders normalized to `{}`. Extra curated paths are reported as warnings:
they may be retired or historically documented operations.
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / 'backend'
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

METHODS = {'get', 'post', 'put', 'patch', 'delete'}
PARAM = re.compile(r'\{[^}]+\}')


def normalize(path: str) -> str:
    return PARAM.sub('{}', path)


def operations(document: dict) -> set[tuple[str, str]]:
    found = set()
    for path, item in (document.get('paths') or {}).items():
        if not isinstance(item, dict):
            continue
        for method in item:
            if method.lower() in METHODS:
                found.add((method.upper(), normalize(path)))
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description='检查 OpenAPI 路径漂移')
    parser.add_argument('--curated', type=Path, default=ROOT / 'docs' / 'api' / 'openapi.yaml')
    parser.add_argument('--allowlist', type=Path,
                        default=ROOT / 'docs' / 'api' / 'openapi-undocumented.txt')
    parser.add_argument('--database', type=Path, default=None)
    parser.add_argument('--artifact-root', type=Path, default=None)
    parser.add_argument('--dataset-root', type=Path, default=None)
    options = parser.parse_args()
    try:
        import yaml
    except ImportError:
        print('需要 PyYAML：pip install -r backend/scripts/requirements-contract.txt', file=sys.stderr)
        return 2
    from jit_baseline.api import create_app
    app = create_app(database=options.database, artifact_root=options.artifact_root,
                     dataset_root=options.dataset_root)
    generated = operations(app.openapi())
    curated = operations(yaml.safe_load(options.curated.read_text(encoding='utf-8')))
    allowlisted = set()
    if options.allowlist.is_file():
        for line in options.allowlist.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            method, _, path = line.partition(' ')
            if method and path:
                allowlisted.add((method.upper(), normalize(path)))
    missing = sorted(generated - curated - allowlisted)
    stale = sorted(allowlisted & curated)
    extra = sorted(curated - generated)
    if missing:
        print(f'OpenAPI 漂移：{len(missing)} 个代码路由既未写入人工契约，也不在已知缺口清单：')
        for method, path in missing:
            print(f'- {method} {path}')
    if stale:
        print(f'已知缺口清单中有 {len(stale)} 项已被人工契约覆盖，请从清单移除：')
        for method, path in stale:
            print(f'- {method} {path}')
    if extra:
        print(f'人工契约另有 {len(extra)} 个未在代码中出现的操作（历史或已退役，未计为失败）。')
    if missing or stale:
        return 1
    print(f'OpenAPI 路径检查通过：代码 {len(generated)} 个操作均在人工契约或已知缺口清单中。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
