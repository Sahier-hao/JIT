"""Explicit, immutable successful explanations for one saved repository score."""
import json
import math
import threading

from . import attribution
from .api_errors import RequestError
from .catalog_storage import utc_now
from .errors import BaselineError
from .model import predict_risks

LIMITATION = '归因描述原模型的单特征敏感度，不是缺陷结论、因果解释或代码定位；原分数未经概率校准。'


class RepositoryExplanationService:
    def __init__(self, sync_service, catalog):
        self.sync = sync_service
        self.catalog = catalog
        self.storage = sync_service.sync.storage
        self._lock = threading.Lock()

    def _context(self, repository_id, commit_id, view_sync_id):
        record = self.sync.repository_commit(repository_id, commit_id, view_sync_id=view_sync_id)
        source = self.sync.get(view_sync_id)
        return record, dict(repositoryId=repository_id, viewSyncId=view_sync_id, commitId=commit_id,
            modelId=source['modelId'], runId=source['runId'], datasetVersion=source['datasetVersion'],
            risk=record['risk'])

    @staticmethod
    def _empty(context):
        return dict(context, explanationStatus='not-generated', explanation=[], explanationMethod=None,
                    explanationSummary=None, explanationReason=None, reasonCode=None,
                    baselineSource=None, baselineDatasetVersion=None, missingBaselineFeatures=[],
                    featureSchemaVersion=None, modelSha256=None, generatedAt=None, limitations=[LIMITATION])

    def _saved(self, context):
        with self.storage.connection() as db:
            row = db.execute('SELECT payload_json FROM repository_explanation WHERE sync_id=? AND commit_id=?',
                             (context['viewSyncId'], context['commitId'])).fetchone()
        if row is None:
            return None
        try:
            payload = json.loads(row[0])
            if any(payload[key] != value for key, value in context.items()):
                raise ValueError('saved explanation context changed')
            if payload['explanationStatus'] not in ('supported', 'not-supported'):
                raise ValueError('saved explanation status invalid')
            return payload
        except (ValueError, KeyError, TypeError) as exc:
            raise RequestError('STORAGE_UNAVAILABLE') from exc

    def get(self, repository_id, commit_id, view_sync_id):
        _, context = self._context(repository_id, commit_id, view_sync_id)
        return self._saved(context) or self._empty(context)

    def generate(self, repository_id, commit_id, view_sync_id):
        # Serialize bounded single-record work; duplicate requests share the first successful fact.
        with self._lock:
            record, context = self._context(repository_id, commit_id, view_sync_id)
            saved = self._saved(context)
            if saved and saved['explanationStatus'] == 'supported':
                return saved
            result = self._empty(context)
            try:
                if not context['modelId'] or not context['runId']:
                    raise BaselineError('MODEL_REFERENCE_MISSING', '旧分析未保存完整模型与运行身份，无法核对原解释')
                snapshot, model = self.catalog.load_model(context['modelId'])
                if context['runId'] not in (model['runId'], model['artifactRunId']):
                    raise BaselineError('MODEL_CONTEXT_MISMATCH', '原分析与模型运行身份不一致，未生成解释')
                if snapshot.schema.name not in ('openstack-six-v1', 'kamei14-git-v1'):
                    raise BaselineError('INPUT_SCHEMA_MISMATCH', '原模型的输入口径不支持仓库解释')
                names = snapshot.schema.in_model_names()
                values = []
                for name in names:
                    value = record['features'].get('entropy' if name == 'ent' else name)
                    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                        raise BaselineError('FEATURES_INVALID', '原提交缺少有效的入模字段，无法生成解释')
                    values.append(value)
                def predict(vector):
                    return predict_risks(snapshot.model, [{'features': vector}], snapshot.schema)
                current = predict(values)[0]
                if not math.isclose(current, context['risk'], rel_tol=1e-7, abs_tol=1e-8):
                    raise BaselineError('SCORE_MISMATCH', '原模型重算与保存分数不一致，保留旧分数且未生成解释')
                baseline = attribution.feature_baseline(self.storage, model['artifactDatasetVersion'], names)
                missing = [name for name in names if name not in baseline]
                explained = attribution.explain(predict, values, baseline, names)
                items = [item for item in explained['items'] if item['delta'] != 0]
                summary = '本次没有达到显示精度的单特征影响，不表示该提交不存在缺陷。'
                if items:
                    lead = items[0]
                    direction = '推高' if lead['delta'] > 0 else '拉低'
                    summary = f"影响最大的字段为 {lead['feature']}，{direction}模型分数 {abs(lead['delta']):.6f}；这不是缺陷结论。"
                result.update(explanationStatus='supported', explanation=items,
                    explanationMethod=explained['method'], explanationSummary=summary,
                    featureSchemaVersion=snapshot.schema.name, modelSha256=model['sha256'],
                    baselineSource='zero' if len(missing) == len(names) else 'mixed' if missing else 'model-dataset-mean',
                    baselineDatasetVersion=model['artifactDatasetVersion'], missingBaselineFeatures=missing)
                if missing:
                    result['limitations'].append('模型绑定数据集的部分字段均值不可用，所列缺失字段明确使用零基线。')
            except BaselineError as exc:
                result.update(explanationStatus='not-supported', explanationReason=self._reason(exc), reasonCode=exc.code)
            except Exception:
                result.update(explanationStatus='not-supported', explanationReason='本次归因计算失败，原分数和审查计划保持不变，可稍后重试。',
                              reasonCode='EXPLANATION_FAILED')
            result['generatedAt'] = utc_now()
            with self.storage.connection(write=True) as db:
                # Parent deletion must not leave an orphan explanation or resurrect an analysis.
                if not db.execute('SELECT 1 FROM repository_commit WHERE sync_id=? AND commit_id=?',
                                  (view_sync_id, commit_id)).fetchone():
                    raise RequestError('NOT_FOUND')
                db.execute('INSERT INTO repository_explanation VALUES (?,?,?) ON CONFLICT(sync_id,commit_id) '
                           'DO UPDATE SET payload_json=excluded.payload_json',
                           (view_sync_id, commit_id, json.dumps(result, ensure_ascii=False, allow_nan=False)))
            return result

    @staticmethod
    def _reason(error):
        if error.code in ('MODEL_REFERENCE_MISSING', 'MODEL_CONTEXT_MISMATCH', 'SCORE_MISMATCH', 'FEATURES_INVALID', 'INPUT_SCHEMA_MISMATCH'):
            return str(error)
        return '原分析模型不可用或未通过完整性校验，未切换其他模型；原分数保持不变，请联系管理员恢复产物后重试。'
