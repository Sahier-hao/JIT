"""Validate live evidence against the offline OpenAPI (isolated tooling environment)."""
import argparse
import json
import re
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', type=Path, default=Path('../docs/evidence/_run/catalog-system.json'))
    parser.add_argument('--output', type=Path, default=Path('../docs/evidence/_run/catalog-contract.json'))
    args = parser.parse_args()
    document = yaml.safe_load(Path('../docs/api/openapi.yaml').read_text(encoding='utf-8'))
    implemented = {'/api/v1/model-candidates':'get','/api/v1/models/register':'post',
                   '/api/v1/models':'get','/api/v1/feature-schemas/{featureSchemaVersion}':'get',
                   '/api/v1/predictions':'post','/api/v1/prediction-batches/{batchId}':'get'}
    for path, method in implemented.items():
        operation = document['paths'][path][method]
        assert operation['x-implementation-status'] == 'implemented', path
        assert operation['x-auth-status'] == 'implemented', path
    for schema in document['components']['schemas'].values():
        Draft202012Validator.check_schema(schema)
    base = 'https://jit.invalid/openapi'
    registry = Registry().with_resource(base, Resource.from_contents(document, default_specification=DRAFT202012))
    def validate(schema, value):
        def absolute_refs(item):
            if isinstance(item, dict):
                return {key:base+val if key=='$ref' and val.startswith('#') else absolute_refs(val)
                        for key,val in item.items()}
            if isinstance(item, list):
                return [absolute_refs(val) for val in item]
            return item
        Draft202012Validator(absolute_refs(schema), registry=registry,
                             format_checker=FormatChecker()).validate(value)
    evidence = json.loads(args.evidence.read_text(encoding='utf-8'))
    checked = []
    for entry in evidence['http']:
        path = entry['path'].split('?')[0]
        template = next((p for p in implemented if re.fullmatch(re.sub(r'\{[^}]+\}', '[^/]+', p), path)), None)
        if template is None:
            continue
        operation = document['paths'][template][entry['method'].lower()]
        response = operation['responses'][str(entry['status'])]
        if '$ref' in response:
            response = document['components']['responses'][response['$ref'].rsplit('/',1)[1]]
        validate(response['content']['application/json']['schema'], entry['response'])
        if entry['status'] < 300 and 'requestBody' in operation:
            validate(operation['requestBody']['content']['application/json']['schema'], entry['request'])
        checked.append({'operation':operation['operationId'],'status':entry['status']})
    assert checked
    result = {'passed':True,'checked':checked,'schemas':len(document['components']['schemas'])}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'passed':True,'responsesChecked':len(checked)}))


if __name__ == '__main__':
    main()
