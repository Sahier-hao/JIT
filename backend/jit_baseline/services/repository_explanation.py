"""Explicit, immutable explanations for one saved repository score."""
import json
import math
import threading

from ..api_errors import RequestError
from ..errors import BaselineError
from ..ml import attribution, explanations
from ..ml.model import predict_risks
from ..storage.catalog_storage import utc_now

LIMITATION = '归因描述原模型的单特征敏感度，不是缺陷结论、因果解释或代码定位；原分数未经概率校准。'


class _MethodRejected(RequestError):
    pass


class RepositoryExplanationService:
    def __init__(self, sync_service, catalog):
        self.sync = sync_service
        self.catalog = catalog
        self.storage = sync_service.sync.storage
        self._lock = threading.Lock()

    def _context(self, repository_id, commit_id, view_sync_id):
        record = self.sync.repository_commit(repository_id, commit_id, view_sync_id=view_sync_id)
        source = self.sync.get(view_sync_id)
        return record, dict(
            repositoryId=repository_id,
            viewSyncId=view_sync_id,
            commitId=commit_id,
            modelId=source['modelId'],
            runId=source['runId'],
            datasetVersion=source['datasetVersion'],
            risk=record['risk'],
        )

    @staticmethod
    def _context_view(context):
        return {
            key: context[key]
            for key in (
                'repositoryId',
                'viewSyncId',
                'commitId',
                'modelId',
                'runId',
                'datasetVersion',
            )
        }

    @staticmethod
    def _resolve_method(method_id):
        try:
            return explanations.method(method_id or explanations.DEFAULT_METHOD)
        except BaselineError as exc:
            raise _MethodRejected(exc.code, field='method') from exc

    @staticmethod
    def _empty(context, declaration):
        return dict(
            context,
            explanationStatus='not-generated',
            explanation=[],
            explanationMethod=declaration['method'],
            explanationUnit=declaration['unit'],
            explanationSummary=None,
            featureSummary=None,
            explanationReason=None,
            reasonCode=None,
            contributionTotal=None,
            baselineSource=None,
            baselineDatasetVersion=None,
            missingBaselineFeatures=[],
            featureSchemaVersion=None,
            modelSha256=None,
            generatedAt=None,
            limitations=[LIMITATION, *declaration['limitations']],
        )

    @staticmethod
    def _hydrate_legacy(payload, method_id):
        """Add read-time method identity without rewriting stored legacy payloads."""
        result = dict(payload)
        declaration = explanations.method(method_id)
        result.setdefault('explanationMethod', method_id)
        result.setdefault('explanationUnit', declaration['unit'])
        result.setdefault('contributionTotal', None)
        result.setdefault('limitations', [LIMITATION, *declaration['limitations']])
        return result

    def _saved(self, context, method_id):
        with self.storage.connection() as db:
            row = db.execute(
                'SELECT payload_json FROM repository_explanation '
                'WHERE sync_id=? AND commit_id=? AND method=?',
                (context['viewSyncId'], context['commitId'], method_id),
            ).fetchone()
        if row is None:
            return None
        try:
            payload = self._hydrate_legacy(json.loads(row[0]), method_id)
            if any(payload[key] != value for key, value in context.items()):
                raise ValueError('saved explanation context changed')
            if payload['explanationStatus'] not in ('supported', 'not-supported'):
                raise ValueError('saved explanation status invalid')
            return payload
        except (ValueError, KeyError, TypeError) as exc:
            raise RequestError('STORAGE_UNAVAILABLE') from exc

    def _saved_methods(self, context):
        with self.storage.connection() as db:
            rows = db.execute(
                'SELECT method, payload_json FROM repository_explanation '
                'WHERE sync_id=? AND commit_id=?',
                (context['viewSyncId'], context['commitId']),
            ).fetchall()
        saved = []
        for row in rows:
            try:
                payload = self._hydrate_legacy(json.loads(row['payload_json']), row['method'])
                if any(payload[key] != value for key, value in context.items()):
                    raise ValueError('saved explanation context changed')
                saved.append(payload)
            except (ValueError, KeyError, TypeError) as exc:
                raise RequestError('STORAGE_UNAVAILABLE') from exc
        order = {value: index for index, value in enumerate(explanations.METHODS)}
        return sorted(
            saved,
            key=lambda item: (
                order.get(item['explanationMethod'], len(order)),
                item['explanationMethod'],
            ),
        )

    def get(self, repository_id, commit_id, view_sync_id, method=None):
        declaration = self._resolve_method(method)
        _, context = self._context(repository_id, commit_id, view_sync_id)
        return self._saved(context, declaration['method']) or self._empty(context, declaration)

    def list_saved(self, repository_id, commit_id, view_sync_id):
        _, context = self._context(repository_id, commit_id, view_sync_id)
        return dict(self._context_view(context), explanations=self._saved_methods(context))

    def methods(self, repository_id, commit_id, view_sync_id):
        _, context = self._context(repository_id, commit_id, view_sync_id)
        saved = self._saved_methods(context)
        result = dict(
            self._context_view(context),
            defaultMethod=explanations.DEFAULT_METHOD,
            modelAvailable=False,
            reasonCode=None,
            methods=[],
            savedMethods=[
                {
                    'method': item['explanationMethod'],
                    'status': item['explanationStatus'],
                    'generatedAt': item.get('generatedAt'),
                }
                for item in saved
            ],
        )
        try:
            snapshot, model = self._load_model(context)
            result.update(
                modelAvailable=True,
                methods=explanations.applicable_methods(snapshot.schema.name, snapshot.model),
                modelSha256=model['sha256'],
            )
        except RequestError as exc:
            result['reasonCode'] = exc.code
        except BaselineError as exc:
            result['reasonCode'] = exc.code
        return result

    def generate(self, repository_id, commit_id, view_sync_id, method=None):
        declaration = self._resolve_method(method)
        method_id = declaration['method']
        # Serialize bounded single-record work; duplicate requests share the first successful fact.
        with self._lock:
            record, context = self._context(repository_id, commit_id, view_sync_id)
            saved = self._saved(context, method_id)
            if saved and saved['explanationStatus'] == 'supported':
                return saved
            result = self._empty(context, declaration)
            try:
                snapshot, model = self._load_model(context)
                try:
                    declaration = explanations.require_applicable(
                        method_id,
                        snapshot.schema.name,
                        snapshot.model,
                    )
                except BaselineError as exc:
                    raise _MethodRejected(exc.code, field='method') from exc
                names = snapshot.schema.in_model_names()
                values = self._feature_values(record, names)

                def predict(vector):
                    return predict_risks(
                        snapshot.model,
                        [{'features': vector}],
                        snapshot.schema,
                    )

                current = predict(values)[0]
                if not math.isclose(current, context['risk'], rel_tol=1e-7, abs_tol=1e-8):
                    raise BaselineError(
                        'SCORE_MISMATCH',
                        '原模型重算与保存分数不一致，保留旧分数且未生成解释',
                    )
                partition_ids = attribution.training_partition_ids(
                    self.catalog.model_directory(context['modelId']),
                )
                baseline = attribution.feature_baseline(
                    self.storage,
                    model['artifactDatasetVersion'],
                    names,
                    partition_ids,
                )
                missing = [name for name in names if name not in baseline]
                if method_id == explanations.LINEAR_METHOD:
                    explained = explanations.linear_logodds(
                        snapshot.model,
                        values,
                        baseline,
                        names,
                    )
                    stable = explanations.linear_stability(
                        snapshot.model,
                        values,
                        baseline,
                        names,
                    )
                else:
                    explained = attribution.explain(
                        predict,
                        values,
                        baseline,
                        names,
                    )
                    stable = attribution.stability(
                        predict,
                        values,
                        baseline,
                        names,
                    )
                items = [item for item in explained['items'] if item['delta'] != 0]
                summary = explained['summary']
                if method_id == explanations.DEFAULT_METHOD and not items:
                    summary = '本次没有达到显示精度的单特征影响，不表示该提交不存在缺陷。'
                result.update(
                    explanationStatus='supported',
                    explanation=items,
                    explanationMethod=method_id,
                    explanationUnit=declaration['unit'],
                    explanationSummary=summary,
                    featureSummary=explanations.feature_summary(
                        items, declaration['unit'], stable,
                    ),
                    contributionTotal=explained.get('contributionTotal'),
                    featureSchemaVersion=snapshot.schema.name,
                    modelSha256=model['sha256'],
                    baselineSource=(
                        'training-partition-mean'
                        if partition_ids and not missing
                        else 'zero'
                        if len(missing) == len(names)
                        else 'mixed'
                    ),
                    baselineDatasetVersion=model['artifactDatasetVersion'],
                    missingBaselineFeatures=missing,
                    baselineHash=attribution.baseline_hash(baseline),
                    trainingPartitionSize=len(partition_ids) if partition_ids else 0,
                    stability=stable,
                    limitations=[LIMITATION, *declaration['limitations']],
                )
                if missing:
                    result['limitations'].append(
                        '训练分区背景的部分字段均值不可用，所列缺失字段明确使用零基线。',
                    )
                if not partition_ids:
                    result['limitations'].append(
                        '训练分区背景不可用，本次归因按零基线计算。',
                    )
                if stable['status'] != 'stable':
                    result['limitations'].append(
                        '合法扰动下主要贡献特征排序不稳定，不把该解释表述为稳健原因。',
                    )
            except _MethodRejected:
                raise
            except BaselineError as exc:
                result.update(
                    explanationStatus='not-supported',
                    explanationReason=self._reason(exc),
                    reasonCode=exc.code,
                )
            except Exception:
                result.update(
                    explanationStatus='not-supported',
                    explanationReason='本次归因计算失败，原分数和已保存的分析保持不变，可稍后重试。',
                    reasonCode='EXPLANATION_FAILED',
                )
            result['generatedAt'] = utc_now()
            with self.storage.connection(write=True) as db:
                # Parent deletion must not leave an orphan explanation or resurrect an analysis.
                if not db.execute(
                    'SELECT 1 FROM repository_commit WHERE sync_id=? AND commit_id=?',
                    (view_sync_id, commit_id),
                ).fetchone():
                    raise RequestError('NOT_FOUND')
                db.execute(
                    'INSERT INTO repository_explanation(sync_id,commit_id,method,payload_json) '
                    'VALUES (?,?,?,?) ON CONFLICT(sync_id,commit_id,method) '
                    'DO UPDATE SET payload_json=excluded.payload_json',
                    (
                        view_sync_id,
                        commit_id,
                        method_id,
                        json.dumps(result, ensure_ascii=False, allow_nan=False),
                    ),
                )
            return result

    def _load_model(self, context):
        if not context['modelId'] or not context['runId']:
            raise BaselineError(
                'MODEL_REFERENCE_MISSING',
                '旧分析未保存完整模型与运行身份，无法核对原解释',
            )
        snapshot, model = self.catalog.load_model(context['modelId'])
        if context['runId'] not in (model['runId'], model['artifactRunId']):
            raise BaselineError(
                'MODEL_CONTEXT_MISMATCH',
                '原分析与模型运行身份不一致，未生成解释',
            )
        return snapshot, model

    @staticmethod
    def _feature_values(record, names):
        values = []
        for name in names:
            value = record['features'].get('entropy' if name == 'ent' else name)
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or value < 0
            ):
                raise BaselineError(
                    'FEATURES_INVALID',
                    '原提交缺少有效的入模字段，无法生成解释',
                )
            values.append(value)
        return values

    @staticmethod
    def _reason(error):
        if error.code in (
            'MODEL_REFERENCE_MISSING',
            'MODEL_CONTEXT_MISMATCH',
            'SCORE_MISMATCH',
            'FEATURES_INVALID',
            'INPUT_SCHEMA_MISMATCH',
        ):
            return str(error)
        return (
            '原分析模型不可用或未通过完整性校验，未切换其他模型；'
            '原分数保持不变，请联系管理员恢复产物后重试。'
        )
