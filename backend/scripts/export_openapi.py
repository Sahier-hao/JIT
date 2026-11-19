"""Export the FastAPI application contract to docs/api/openapi.generated.yaml.

The curated docs/api/openapi.yaml remains the strict public response contract.
This generated document is the machine-readable path/method inventory used to
detect drift between code and the curated contract.
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / 'backend'
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def build(database=None, artifact_root=None, dataset_root=None):
    from jit_baseline.api import create_app
    return create_app(database=database, artifact_root=artifact_root, dataset_root=dataset_root)


def main() -> int:
    parser = argparse.ArgumentParser(description='导出 FastAPI OpenAPI 契约')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs' / 'api' / 'openapi.generated.yaml')
    parser.add_argument('--database', type=Path, default=None)
    parser.add_argument('--artifact-root', type=Path, default=None)
    parser.add_argument('--dataset-root', type=Path, default=None)
    options = parser.parse_args()
    try:
        import yaml
    except ImportError:
        print('需要 PyYAML：pip install -r backend/scripts/requirements-contract.txt', file=sys.stderr)
        return 2
    app = build(options.database, options.artifact_root, options.dataset_root)
    schema = app.openapi()
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(
        yaml.safe_dump(schema, allow_unicode=True, sort_keys=False, width=120),
        encoding='utf-8',
    )
    print(f'已导出 {len(schema.get("paths", {}))} 个路径到 {options.output}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
