"""Compare saved analysis snapshots without loading model artifacts or labels."""
import json
import math

from .api_errors import RequestError

KINDS = ('added', 'removed', 'changed', 'unchanged')
LIMITATIONS = [
    '仅对照两次分析保存的分数与度量，不重新推理；分数变化不表示缺陷修复或模型效果改善。',
    '仅一侧出现的提交表示分析覆盖不同，不代表代码新增或删除；需核对分支、日期、上限与模型来源。',
]


class AnalysisComparisonService:
    def __init__(self, sync_service):
        self.storage = sync_service.sync.storage

    @staticmethod
    def _source(row, db):
        model_name = None
        model = db.execute('SELECT payload_json FROM model_version WHERE id=?', (row['model_id'],)).fetchone()
        if model:
            try:
                name = json.loads(model['payload_json']).get('name')
                if isinstance(name, str) and name:
                    model_name = name
            except (ValueError, TypeError, AttributeError):
                pass
        return dict(syncId=row['id'], branch=row['analysis_branch'] or row['branch'],
                    since=row['since'], until=row['until'], commitLimit=row['commit_limit'],
                    completedAt=row['completed_at'], headCommit=row['head_commit'],
                    datasetVersion=row['dataset_version'], modelId=row['model_id'], runId=row['run_id'], modelName=model_name)

    def get(self, repository_id, base_id, target_id, *, limit=20, offset=0, change='all'):
        if base_id == target_id or not 1 <= limit <= 200 or offset < 0 or change not in ('all', *KINDS):
            raise RequestError('INPUT_INVALID')
        with self.storage.connection() as db:
            if not db.execute('SELECT 1 FROM repository WHERE id=?', (repository_id,)).fetchone():
                raise RequestError('REPOSITORY_UNKNOWN')
            sources, commits = [], []
            for sync_id in (base_id, target_id):
                row = db.execute('SELECT * FROM repository_sync WHERE id=? AND repository_id=?', (sync_id, repository_id)).fetchone()
                if row is None:
                    raise RequestError('REPOSITORY_ANALYSIS_UNKNOWN')
                if row['status'] != 'completed':
                    raise RequestError('REPOSITORY_ANALYSIS_UNAVAILABLE')
                sources.append(self._source(row, db))
                commits.append({item['commit_id']: dict(item) for item in db.execute(
                    'SELECT commit_id,epoch,risk,added_lines,deleted_lines,files,features_json,subject,author_name '
                    'FROM repository_commit WHERE sync_id=?', (sync_id,))})
        base, target = commits
        rows = []
        counts = dict.fromkeys(KINDS, 0)
        for commit_id in base.keys() | target.keys():
            old, new = base.get(commit_id), target.get(commit_id)
            old_risk = old['risk'] if old else None
            new_risk = new['risk'] if new else None
            delta = new_risk-old_risk if old and new else None
            features_changed = bool(old and new and (
                json.loads(old['features_json']) != json.loads(new['features_json']) or
                any(old[key] != new[key] for key in ('added_lines', 'deleted_lines', 'files'))))
            kind = 'added' if old is None else 'removed' if new is None else (
                'changed' if features_changed or not math.isclose(old_risk, new_risk, rel_tol=0, abs_tol=1e-10) else 'unchanged')
            counts[kind] += 1
            current = new or old
            rows.append(dict(commitId=commit_id, status=kind, subject=current['subject'], authorName=current['author_name'],
                             epoch=current['epoch'], baseRisk=old_risk, targetRisk=new_risk,
                             riskDelta=delta, featuresChanged=features_changed))
        priority = dict(changed=0, added=1, removed=2, unchanged=3)
        rows.sort(key=lambda item: (priority[item['status']], -abs(item['riskDelta'] or 0), item['commitId']))
        selected = rows if change == 'all' else [item for item in rows if item['status'] == change]
        old, new = sources
        same = bool(old['modelId'] and old['runId'] and old['modelId'] == new['modelId'] and old['runId'] == new['runId'])
        return dict(repositoryId=repository_id, base=old, target=new, sameModel=same, counts=counts,
                    total=len(selected), limit=limit, offset=offset, change=change,
                    commits=selected[offset:offset+limit], limitations=list(LIMITATIONS))
