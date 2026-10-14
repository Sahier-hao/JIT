"""Bound and validate JSON before any model computation."""
import json
import re
import math
from datetime import datetime, timezone
from uuid import UUID

from .team_access import RequestError

MAX_JSON_BYTES = 64 * 1024


def object_pairs(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise RequestError('INPUT_INVALID')
        value[key] = item
    return value


def reject_constant(_):
    raise RequestError('INPUT_INVALID')


async def read_object(request):
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_JSON_BYTES:
            raise RequestError('INPUT_LIMIT_EXCEEDED')
    try:
        result = json.loads(body, object_pairs_hook=object_pairs, parse_constant=reject_constant)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise RequestError('INPUT_INVALID') from exc
    if not isinstance(result, dict):
        raise RequestError('INPUT_INVALID')
    return result


def exact_fields(value, required, optional=(), *, field='request', code='INPUT_INVALID'):
    if not isinstance(value, dict) or not set(required) <= set(value) or set(value) - set(required) - set(optional):
        raise RequestError(code, field=field)


def registration_input(value):
    exact_fields(value, ('candidateId', 'expectedManifestSha256'))
    for key in ('candidateId', 'expectedManifestSha256'):
        if not isinstance(value[key], str) or not re.fullmatch('[0-9a-f]{64}', value[key]):
            raise RequestError('INPUT_INVALID', field=key)
    return value


def uuid_text(value, field):
    try:
        if not isinstance(value, str) or str(UUID(value)) != value.lower():
            raise ValueError('UUID')
        return value.lower()
    except ValueError as exc:
        raise RequestError('INPUT_INVALID', field=field) from exc


def prediction_input(value):
    from .schemas import get_schema
    exact_fields(value, ('modelId', 'featureSchemaVersion', 'project', 'record'))
    model_id = uuid_text(value['modelId'], 'modelId')
    if value['featureSchemaVersion'] != 'openstack-six-v1':
        raise RequestError('INPUT_SCHEMA_MISMATCH', field='featureSchemaVersion')
    record = value['record']
    exact_fields(record, ('recordId', 'features'), ('commitId', 'time'), field='record')
    for text, field in ((value['project'], 'project'), (record['recordId'], 'record.recordId')):
        if not isinstance(text, str) or not text.strip() or len(text) > 128:
            raise RequestError('INPUT_INVALID', field=field)
    schema = get_schema('openstack-six-v1')
    exact_fields(record['features'], schema.in_model_names(), field='record.features', code='INPUT_SCHEMA_MISMATCH')
    features = {}
    for field in schema.in_model_fields():
        number = record['features'][field.name]
        try:
            valid = (type(number) is int if field.integer else type(number) in (int, float))
            valid = valid and math.isfinite(float(number)) and number >= 0
        except (OverflowError, ValueError):
            valid = False
        if not valid:
            raise RequestError('INPUT_INVALID', field='record.features.' + field.name)
        features[field.name] = int(number) if field.integer else float(number)
    commit = record.get('commitId')
    if commit is not None and (not isinstance(commit, str) or not re.fullmatch('[0-9a-fA-F]{40}', commit)):
        raise RequestError('INPUT_INVALID', field='record.commitId')
    time = record.get('time')
    if time is not None:
        try:
            parsed = datetime.fromisoformat(time) if isinstance(time, str) else None
            if parsed is None or parsed.tzinfo is None or parsed.utcoffset() is None:
                raise ValueError('timezone')
            time = parsed.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
        except (ValueError, OverflowError) as exc:
            raise RequestError('INPUT_INVALID', field='record.time') from exc
    return {'modelId': model_id, 'featureSchemaVersion': schema.name, 'project': value['project'].strip(),
            'record': {'recordId': record['recordId'].strip(), 'features': features,
                       'commitId': commit.lower() if commit else None, 'time': time}}
