"""Validate a portable selection against saved facts; never store a shared personal plan."""
import json

from .api_errors import RequestError

FORMAT = 'jit-review-plan-v1'
MAX_BYTES = 1024 * 1024
MAX_COMMITS = 5000
SOURCE_KEYS = {'repositoryId', 'viewSyncId', 'datasetVersion', 'modelId', 'runId'}


async def read_plan(request):
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BYTES:
            raise RequestError('REVIEW_PLAN_LIMIT_EXCEEDED')
        body.extend(chunk)
    try:
        return json.loads(body)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise RequestError('INPUT_INVALID') from exc


class ReviewPlanService:
    def __init__(self, sync_service):
        self.storage = sync_service.sync.storage

    def validate(self, repository_id, view_sync_id, manifest):
        if not isinstance(manifest, dict) or set(manifest) != {'format', 'source', 'commitIds'} or manifest['format'] != FORMAT:
            raise RequestError('INPUT_INVALID')
        source, ids = manifest['source'], manifest['commitIds']
        if not isinstance(source, dict) or set(source) != SOURCE_KEYS:
            raise RequestError('INPUT_INVALID', field='source')
        if not isinstance(ids, list):
            raise RequestError('INPUT_INVALID', field='commitIds')
        if len(ids) > MAX_COMMITS:
            raise RequestError('REVIEW_PLAN_LIMIT_EXCEEDED', field='commitIds')
        if any(not isinstance(item, str) or not item or len(item) > 200 for item in ids) or len(set(ids)) != len(ids):
            raise RequestError('INPUT_INVALID', field='commitIds')
        with self.storage.connection() as db:
            # One snapshot keeps parent metadata and membership consistent during deletion.
            if not db.execute('SELECT 1 FROM repository WHERE id=?', (repository_id,)).fetchone():
                raise RequestError('REPOSITORY_UNKNOWN')
            row = db.execute('SELECT status,dataset_version,model_id,run_id FROM repository_sync WHERE id=? AND repository_id=?',
                             (view_sync_id, repository_id)).fetchone()
            if row is None:
                raise RequestError('REPOSITORY_ANALYSIS_UNKNOWN')
            if row['status'] != 'completed':
                raise RequestError('REPOSITORY_ANALYSIS_UNAVAILABLE')
            expected = dict(repositoryId=repository_id, viewSyncId=view_sync_id,
                            datasetVersion=row['dataset_version'], modelId=row['model_id'], runId=row['run_id'])
            if source != expected:
                raise RequestError('REVIEW_PLAN_CONTEXT_MISMATCH', field='source')
            known = {item[0] for item in db.execute('SELECT commit_id FROM repository_commit WHERE sync_id=?', (view_sync_id,))}
            if any(item not in known for item in ids):
                raise RequestError('REVIEW_PLAN_COMMIT_UNKNOWN', field='commitIds')
        return dict(format=FORMAT, source=expected, commitIds=list(ids))
