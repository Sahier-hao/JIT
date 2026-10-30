"""项目自身保存分析的固定趋势：只聚合提交观测，不读取标签或模型产物。"""
import hashlib
import json
import math
import re
import uuid
from bisect import bisect_right
from datetime import date, datetime, timedelta

from .api_errors import RequestError
from .catalog_storage import utc_now
from .sync import DISTRIBUTION_RULE, distribution_of
from .trends import DEFAULT_MIN_SAMPLE, LOCAL, TIMEZONE

GRAINS = ('day', 'week', 'month')
MAX_BUCKETS = 3660
FORMAT = 'project-trend-view-v1'
LIMITATIONS = (
    '数量仅代表所选来源已保存分析覆盖的去重提交，不代表全仓库或当前 HEAD 的全部历史。',
    '高分占比以已评分提交为分母，仅用于审查排序，不是真实缺陷率或模型质量结论。',
    '没有冻结的完整采集覆盖证明；非空桶为已观测，空桶为未知，不能据此断言没有提交。',
    '分支可能发生变基或强推；保留来源中的历史观测，不推断其当前可达性。',
    '重叠提交按完成时间、来源标识升序保留首条观测；时间、特征或分数冲突时拒绝整组拼接。',
)


def _dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _digest(value):
    return hashlib.sha256(_dump(value).encode('utf-8')).hexdigest()


def _date(value, field):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise RequestError('INPUT_INVALID', field=field)
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise RequestError('INPUT_INVALID', field=field) from exc


def _epoch(day):
    return datetime(day.year, day.month, day.day, tzinfo=LOCAL).timestamp()


def _buckets(start, end, grain):
    """自然日、周一和月初分桶，首尾裁剪到查询的左闭右开范围。"""
    cursor = start
    while cursor < end:
        if grain == 'day':
            following = cursor + timedelta(days=1)
        elif grain == 'week':
            following = cursor + timedelta(days=7-cursor.weekday())
        else:
            following = date(cursor.year+1, 1, 1) if cursor.month == 12 else date(cursor.year, cursor.month+1, 1)
        following = min(following, end)
        yield cursor, following
        cursor = following


def _query(payload):
    grain = payload.get('grain', 'week')
    if grain not in GRAINS:
        raise RequestError('INPUT_INVALID', field='grain')
    try:
        end = _date(payload['end'], 'end') if 'end' in payload else datetime.now(LOCAL).date()+timedelta(days=1)
        start = _date(payload['start'], 'start') if 'start' in payload else end-timedelta(days=90)
        if start >= end:
            raise RequestError('INPUT_INVALID', field='start/end')
        for count, _ in enumerate(_buckets(start, end, grain), 1):
            if count > MAX_BUCKETS:
                raise RequestError('INPUT_INVALID', field='start/end')
    except (ValueError, OverflowError) as exc:
        raise RequestError('INPUT_INVALID', field='start/end') from exc
    return dict(start=start.isoformat(), end=end.isoformat(), grain=grain,
                timezone=TIMEZONE, minSample=DEFAULT_MIN_SAMPLE)


def _text(value):
    return isinstance(value, str) and bool(value.strip())


def _source(row):
    """仅列出公开来源事实，不连接产物位置、数据内容或管理员验证信息。"""
    return dict(syncId=row['id'], sourceKind=row['source_kind'],
                branch=row['analysis_branch'] or row['branch'], since=row['since'], until=row['until'],
                commitLimit=row['commit_limit'], createdAt=row['created_at'], completedAt=row['completed_at'],
                headCommit=row['head_commit'], datasetVersion=row['dataset_version'],
                modelId=row['model_id'], runId=row['run_id'],
                featureSchemaVersion=row['feature_schema_version'], distributionRule=row['distribution_rule'])


def _comparable(row):
    source = _source(row)
    return row['status'] == 'completed' and source['sourceKind'] == 'branch' and all(
        _text(source[key]) for key in ('branch', 'modelId', 'runId', 'featureSchemaVersion',
                                       'distributionRule', 'datasetVersion', 'completedAt', 'headCommit'))


def _group(repository_id, source):
    identity = {key: source[key] for key in ('branch', 'modelId', 'runId', 'featureSchemaVersion', 'distributionRule')}
    return dict(groupId=_digest(dict(repositoryId=repository_id, **identity)), **identity, sourceSyncIds=[])


def _groups(db, repository_id):
    collected = {}
    for row in db.execute('SELECT * FROM repository_sync WHERE repository_id=? ORDER BY completed_at,id', (repository_id,)):
        if _comparable(row):
            group = _group(repository_id, _source(row))
            entry = collected.setdefault(group['groupId'], group)
            entry['sourceSyncIds'].append(row['id'])
    return sorted(collected.values(), key=lambda item: tuple(item[key] for key in (
        'branch', 'modelId', 'runId', 'featureSchemaVersion', 'distributionRule')))


def _require_repository(db, repository_id):
    if not db.execute('SELECT 1 FROM repository WHERE id=?', (repository_id,)).fetchone():
        raise RequestError('REPOSITORY_UNKNOWN')


def _unavailable(sync_id):
    error = RequestError('TREND_SOURCE_UNAVAILABLE')
    error.details = [dict(field='sourceSyncId', reason='固定来源不存在、未成功完成或保存内容已改变', sourceSyncId=sync_id)]
    return error


def _load_source(db, repository_id, sync_id):
    row = db.execute('SELECT * FROM repository_sync WHERE repository_id=? AND id=?', (repository_id, sync_id)).fetchone()
    if row is None or row['status'] != 'completed':
        raise _unavailable(sync_id)
    commits = []
    try:
        for saved in db.execute(
                'SELECT commit_id,epoch,risk,added_lines,deleted_lines,files,features_json,subject,author_name '
                'FROM repository_commit WHERE sync_id=? ORDER BY commit_id', (sync_id,)):
            item = dict(saved)
            item['features'] = json.loads(item.pop('features_json'))
            risk = item['risk']
            if (not isinstance(item['epoch'], int) or isinstance(item['epoch'], bool)
                    or not isinstance(item['features'], dict)
                    or (risk is not None and (not isinstance(risk, (int, float))
                        or not math.isfinite(risk) or not 0 <= risk <= 1))):
                raise ValueError('保存观测格式不符')
            commits.append(item)
        source = _source(row)
        # 指纹覆盖所有查询用到的元数据及观测，不读取也不冻结 SZZ 标签。
        fingerprint = _digest(dict(source=source, requestedBranch=row['branch'], commits=commits))
    except (ValueError, TypeError, OverflowError) as exc:
        raise _unavailable(sync_id) from exc
    return row, source, commits, fingerprint


def _same_risk(old, new):
    if old is None or new is None:
        return old is new
    # 与保存分析比较服务一致：只忽略绝对误差不超过 1e-10 的评分差异。
    return math.isclose(old, new, rel_tol=0, abs_tol=1e-10)


def _deduplicate(loaded):
    observed, extremes = {}, {}
    for _, source, commits, _ in loaded:
        for item in commits:
            identity, sync_id, risk = item['commit_id'], source['syncId'], item['risk']
            old = observed.get(identity)
            if old is None:
                observed[identity] = dict(item, sourceSyncId=sync_id)
                extremes[identity] = [(risk, sync_id), (risk, sync_id)]
                continue
            fields = [key for key in ('epoch', 'features', 'added_lines', 'deleted_lines', 'files')
                      if old[key] != item[key]]
            conflicting_source = old['sourceSyncId']
            # 误差容忍不具传递性；必须同时核对已见最小/最大分数，不能只对首条观测。
            for saved_risk, saved_source in extremes[identity]:
                if not _same_risk(saved_risk, risk):
                    fields.append('risk')
                    conflicting_source = saved_source
                    break
            if fields:
                error = RequestError('TREND_SOURCE_CONFLICT')
                error.details = [dict(field='sourceSyncIds', reason='同一提交的时间、特征或分数不一致，请显式选择单次分析',
                                      commitId=identity, sourceSyncIds=[conflicting_source, sync_id], conflictingFields=fields)]
                raise error
            if risk is not None:
                if risk < extremes[identity][0][0]:
                    extremes[identity][0] = (risk, sync_id)
                if risk > extremes[identity][1][0]:
                    extremes[identity][1] = (risk, sync_id)
    return list(observed.values())


def _counts(commits, rule, *, empty_unknown=False):
    if not commits and empty_unknown:
        return dict(commitCount=None, scoredCount=None, unknownCount=None, highCount=None,
                    highRate=None, riskMean=None, rateReason='未证明完整覆盖，空桶的提交数量与占比未知')
    risks = [item['risk'] for item in commits]
    distribution = distribution_of(risks)
    scored = len(risks)-distribution['unknown']
    high = distribution['high'] if rule == DISTRIBUTION_RULE else None
    if high is None:
        rate, reason = None, '来源未冻结可识别的分档规则，不能推断高分数量与占比'
    elif scored < DEFAULT_MIN_SAMPLE:
        rate, reason = None, f'已评分提交数 {scored} 少于最小样本 {DEFAULT_MIN_SAMPLE}，高分占比不足以比较'
    else:
        rate, reason = high/scored, None
    scored_risks = [value for value in risks if value is not None]
    return dict(commitCount=len(commits), scoredCount=scored, unknownCount=distribution['unknown'],
                highCount=high, highRate=rate, rateReason=reason,
                riskMean=sum(scored_risks)/len(scored_risks) if scored_risks else None)


class ProjectTrendService:
    """固定 manifest 保存查询与来源指纹，读取时校验后再聚合，不复制分数。"""

    def __init__(self, sync_service):
        self.storage = sync_service.sync.storage

    def groups(self, repository_id):
        with self.storage.connection() as db:
            _require_repository(db, repository_id)
            groups = _groups(db, repository_id)
        return dict(repositoryId=repository_id, groups=groups, limitations=[
            '仅列出用途为分支且具有完整冻结口径的成功分析；PR 和元数据不足的记录不参与拼接。',
            '旧用途未知的成功记录只能通过 sourceSyncId 显式查看单一来源。',
            '同组重叠提交仍须在创建视图时通过时间、特征与分数一致性检查。'])

    def create(self, repository_id, payload):
        if not isinstance(payload, dict) or set(payload)-{'groupId', 'sourceSyncId', 'start', 'end', 'grain'}:
            raise RequestError('INPUT_INVALID')
        for field in ('groupId', 'sourceSyncId'):
            if field in payload and not _text(payload[field]):
                raise RequestError('INPUT_INVALID', field=field)
        if 'groupId' in payload and 'sourceSyncId' in payload:
            raise RequestError('INPUT_INVALID', field='groupId/sourceSyncId')
        query = _query(payload)
        with self.storage.connection(write=True) as db:
            _require_repository(db, repository_id)
            groups = _groups(db, repository_id)
            if 'sourceSyncId' in payload:
                sync_id = payload['sourceSyncId']
                row = db.execute('SELECT * FROM repository_sync WHERE id=? AND repository_id=?', (sync_id, repository_id)).fetchone()
                if row is None:
                    raise RequestError('NOT_FOUND')
                if row['status'] != 'completed':
                    raise _unavailable(sync_id)
                if row['source_kind'] not in ('branch', 'unknown'):
                    raise RequestError('INPUT_INVALID', field='sourceSyncId')
                if row['source_kind'] == 'branch' and not _comparable(row):
                    raise _unavailable(sync_id)
                source = _source(row)
                group = dict(_group(repository_id, source), sourceSyncIds=[sync_id])
                if row['source_kind'] == 'unknown':
                    group['groupId'] = None
                selected = [sync_id]
                mode = 'single'
            else:
                if 'groupId' in payload:
                    group = next((item for item in groups if item['groupId'] == payload['groupId']), None)
                    if group is None:
                        raise RequestError('NOT_FOUND')
                elif len(groups) == 1:
                    group = groups[0]
                elif not groups:
                    raise RequestError('NOT_FOUND')
                else:
                    raise RequestError('INPUT_INVALID', field='groupId')
                selected, mode = group['sourceSyncIds'], 'group'
            if group['distributionRule'] not in (None, DISTRIBUTION_RULE):
                raise RequestError('INPUT_SCHEMA_MISMATCH', field='distributionRule')
            loaded = [_load_source(db, repository_id, sync_id) for sync_id in selected]
            commits = _deduplicate(loaded)
            manifest = dict(format=FORMAT, repositoryId=repository_id, mode=mode, group=group, query=query,
                            sources=[dict(syncId=source['syncId'], fingerprint=fingerprint)
                                     for _, source, _, fingerprint in loaded])
            signature = _digest(manifest)
            existing = db.execute('SELECT * FROM project_trend_view WHERE signature=?', (signature,)).fetchone()
            if existing:
                # 相同固定来源与查询复用视图；损坏的旧 manifest 不由新查询静默修复。
                manifest, loaded, commits = self._load(db, repository_id, existing)
                return self._view(db, existing, manifest, loaded, commits)
            view_id, now = str(uuid.uuid4()), utc_now()
            db.execute('INSERT INTO project_trend_view(id,repository_id,signature,payload_json,created_at) VALUES (?,?,?,?,?)',
                       (view_id, repository_id, signature, _dump(manifest), now))
            return self._view(db, dict(id=view_id, created_at=now), manifest, loaded, commits)

    @staticmethod
    def _load(db, repository_id, view):
        try:
            manifest = json.loads(view['payload_json'])
            if (manifest['format'] != FORMAT or manifest['repositoryId'] != repository_id
                    or _digest(manifest) != view['signature']):
                raise ValueError('固定视图声明不符')
            loaded = [_load_source(db, repository_id, item['syncId']) for item in manifest['sources']]
            if not loaded or [item['syncId'] for item in manifest['sources']] != manifest['group']['sourceSyncIds']:
                raise ValueError('固定来源清单不符')
            for recorded, current in zip(manifest['sources'], loaded, strict=True):
                if recorded['fingerprint'] != current[3]:
                    raise _unavailable(recorded['syncId'])
            return manifest, loaded, _deduplicate(loaded)
        except (ValueError, TypeError, KeyError) as exc:
            raise _unavailable(None) from exc

    @staticmethod
    def _view(db, view, manifest, loaded, commits):
        query, group = manifest['query'], manifest['group']
        start, end = date.fromisoformat(query['start']), date.fromisoformat(query['end'])
        boundaries = list(_buckets(start, end, query['grain']))
        starts = [_epoch(left) for left, _ in boundaries]
        end_epoch = _epoch(end)
        selected, bucket_rows = [], [[] for _ in boundaries]
        for item in commits:
            if starts[0] <= item['epoch'] < end_epoch:
                selected.append(item)
                bucket_rows[bisect_right(starts, item['epoch'])-1].append(item)
        buckets = []
        for (left, right), rows in zip(boundaries, bucket_rows, strict=True):
            buckets.append(dict(start=left.isoformat(), end=right.isoformat(),
                                **_counts(rows, group['distributionRule'], empty_unknown=True),
                                coverage='observed' if rows else 'unknown'))
        has_new = False
        if manifest['mode'] == 'group':
            current = next((item for item in _groups(db, manifest['repositoryId']) if item['groupId'] == group['groupId']), None)
            has_new = bool(current and set(current['sourceSyncIds'])-set(group['sourceSyncIds']))
        limitations = list(LIMITATIONS)
        if manifest['mode'] == 'single':
            limitations.append('此视图显式固定单次分析，不拼接其他来源，也不跟踪同组新来源。')
        if any(source['sourceKind'] == 'unknown' for _, source, _, _ in loaded):
            limitations.append('旧分析用途无法证明为分支；仅因显式选择而单独展示，不加入跨分析趋势。')
        if group['distributionRule'] is None:
            limitations.append('旧来源缺少冻结的分档规则，保留提交与评分计数，不推断高分数量或占比。')
        return dict(repositoryId=manifest['repositoryId'], viewId=view['id'], group=group, mode=manifest['mode'],
                    sourceSyncIds=list(group['sourceSyncIds']), createdAt=view['created_at'], **query,
                    hasNewSources=has_new, summary=_counts(selected, group['distributionRule']), buckets=buckets,
                    sources=[source for _, source, _, _ in loaded], limitations=limitations)

    def _find(self, db, repository_id, view_id):
        _require_repository(db, repository_id)
        view = db.execute('SELECT * FROM project_trend_view WHERE repository_id=? AND id=?', (repository_id, view_id)).fetchone()
        if view is None:
            raise RequestError('NOT_FOUND')
        return view

    def get(self, repository_id, view_id):
        with self.storage.connection() as db:
            view = self._find(db, repository_id, view_id)
            manifest, loaded, commits = self._load(db, repository_id, view)
            return self._view(db, view, manifest, loaded, commits)

    def commits(self, repository_id, view_id, limit=50, offset=0, start=None, end=None):
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
            raise RequestError('INPUT_INVALID', field='limit')
        if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
            raise RequestError('INPUT_INVALID', field='offset')
        with self.storage.connection() as db:
            view = self._find(db, repository_id, view_id)
            manifest, _, commits = self._load(db, repository_id, view)
            query = manifest['query']
            left = _date(start if start is not None else query['start'], 'start')
            right = _date(end if end is not None else query['end'], 'end')
            if left >= right or left.isoformat() < query['start'] or right.isoformat() > query['end']:
                raise RequestError('INPUT_INVALID', field='start/end')
            start_epoch, end_epoch = _epoch(left), _epoch(right)
            selected = [item for item in commits if start_epoch <= item['epoch'] < end_epoch]
            selected.sort(key=lambda item: (item['risk'] is None, -(item['risk'] or 0), -item['epoch'], item['commit_id']))
            return dict(repositoryId=repository_id, viewId=view_id, total=len(selected), limit=limit, offset=offset,
                        commits=[dict(commitId=item['commit_id'], epoch=item['epoch'], risk=item['risk'],
                                      subject=item['subject'], sourceSyncId=item['sourceSyncId'])
                                 for item in selected[offset:offset+limit]])
