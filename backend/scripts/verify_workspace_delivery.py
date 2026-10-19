"""Verify an explicit source baseline, current docs and local OpenAPI references."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote

import yaml

ROOT = Path(__file__).resolve().parents[2]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--spec-sync', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    baseline = json.loads(args.baseline.read_text(encoding='utf-8'))
    changed = []
    for name, digest in baseline['protected'].items():
        path = (ROOT / name).resolve()
        if not path.is_relative_to(ROOT) or not path.is_file() or sha(path) != digest:
            changed.append(name)
    specs = json.loads(args.spec_sync.read_text(encoding='utf-8'))
    for spec in specs:
        path = ROOT / spec['path']
        assert path.resolve().is_relative_to(ROOT / 'openspec/specs')
        old = subprocess.run(['git', 'show', baseline['head'] + ':' + spec['path']],
                             cwd=ROOT, capture_output=True)
        candidates = {None} if old.returncode else {hashlib.sha256(old.stdout).hexdigest()}
        if old.returncode == 0:
            filtered = subprocess.run(['git', 'cat-file', '--filters', baseline['head'] + ':' + spec['path']],
                                      cwd=ROOT, capture_output=True)
            if filtered.returncode == 0:
                candidates.add(hashlib.sha256(filtered.stdout).hexdigest())
        # Specs use Git's normal text/EOL filters. Frozen evidence above is always exact bytes.
        assert spec['before'] in candidates, spec['path']
        if (sha(path) if path.is_file() else None) != spec['after']:
            changed.append(spec['path'])
    document = yaml.safe_load((ROOT / 'docs/api/openapi.yaml').read_text(encoding='utf-8'))
    refs = []

    def walk(value):
        if isinstance(value, dict):
            if '$ref' in value and value['$ref'].startswith('#/'):
                target = document
                for key in value['$ref'][2:].split('/'):
                    target = target[key.replace('~1', '/').replace('~0', '~')]
                refs.append(value['$ref'])
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(document)
    links, broken = [], []
    for name in ['frontend/README.md', 'docs/开发验证.md', 'docs/产品需求文档.md',
                 'docs/产品设计文档.md', 'docs/审计/2026-10-19-simplify-implementation.md']:
        file = ROOT / name
        for raw in re.findall(r'\]\(([^)]+)\)', file.read_text(encoding='utf-8')):
            target = raw.strip('<>').split('#')[0]
            if not target or re.match(r'[a-z]+:', target, re.I):
                continue
            links.append([name, target])
            if not (file.parent / unquote(target)).resolve().exists():
                broken.append([name, target])
    result = {'protectedFiles': len(baseline['protected']), 'changedProtectedFiles': changed,
              'controlledSpecChanges': len(specs), 'openapiReferences': len(refs),
              'documentLinks': len(links), 'brokenLinks': broken,
              'passed': not changed and not broken}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
    if not result['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
