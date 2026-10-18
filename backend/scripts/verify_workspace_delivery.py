"""Check documentation links, OpenAPI references and protected baseline bytes."""
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import unquote

import yaml

ROOT = Path(__file__).resolve().parents[2]


def main():
    baseline = json.loads((ROOT / '.cache/redesign-baseline-20261019-0200/manifest.json').read_text(encoding='utf-8'))
    protected = {name: digest for name, digest in baseline['files'].items()
                 if (name.startswith(('docs/evidence/', 'openspec/changes/archive/', 'openspec/specs/', 'backend/data/', 'backend/artifacts/'))
                     and not name.startswith('docs/evidence/_run/'))}
    # Main specs are intentionally synchronized only after implementation. Pin both
    # sides of that explicit merge; frozen evidence and archived changes have no exception.
    synced = json.loads((ROOT / '.cache/redesign-validation/spec-sync.json').read_text(encoding='utf-8'))
    for item in synced:
        name = item['path']
        if not name.startswith('openspec/specs/') or item['before'] != baseline['files'].get(name):
            raise ValueError('Spec sync does not match the saved source baseline')
        protected[name] = item['after']
    changed = [name for name, digest in protected.items()
               if not (ROOT / name).exists() or hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest]
    document = yaml.safe_load((ROOT / 'docs/api/openapi.yaml').read_text(encoding='utf-8'))
    refs = []
    def check_refs(value):
        if isinstance(value, dict):
            if '$ref' in value and value['$ref'].startswith('#/'):
                target = document
                for key in value['$ref'][2:].split('/'):
                    target = target[key]
                refs.append(value['$ref'])
            for child in value.values():
                check_refs(child)
        elif isinstance(value, list):
            for child in value:
                check_refs(child)
    check_refs(document)
    links, broken = [], []
    for name in ('frontend/README.md', 'docs/开发验证.md', 'docs/产品设计文档.md', 'docs/产品需求文档.md',
                 'docs/审计/2026-10-19-redesign-implementation.md', 'docs/审计/2026-10-19-redesign-scenarios.md'):
        file = ROOT / name
        for target in re.findall(r'\]\(([^)]+)\)', file.read_text(encoding='utf-8')):
            target = target.strip('<>').split('#')[0]
            if not target or re.match(r'[a-z]+:', target, re.I):
                continue
            links.append([name, target])
            if not (file.parent / unquote(target)).resolve().exists():
                broken.append([name, target])
    result = {'protectedFiles': len(protected), 'changedProtectedFiles': changed,
              'controlledSpecSync': len(synced),
              'openapiReferences': len(refs), 'documentLinks': len(links), 'brokenLinks': broken,
              'passed': not changed and not broken}
    output = ROOT / '.cache/redesign-validation/delivery-check.json'
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
    if not result['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
