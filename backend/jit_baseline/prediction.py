"""Single feature-input predictions: compute first, atomically publish after commit."""
import json
from uuid import uuid4

from . import attribution
from .artifacts import identity
from .catalog import encoded
from .catalog_input import prediction_input, uuid_text
from .catalog_storage import utc_now
from .model import predict_risks
from .api_errors import RequestError


class PredictionService:
    def __init__(self, catalog):
        self.catalog = catalog

    def create(self, request):
        data = prediction_input(request)
        snapshot, model = self.catalog.load_model(data['modelId'])
        if snapshot.schema.name != data['featureSchemaVersion'] or not model['jsonPredictionSupported']:
            raise RequestError('INPUT_SCHEMA_MISMATCH', field='featureSchemaVersion')
        record = data['record']
        persisted = data['source'] == 'persisted-commit'
        if persisted:
            stored = self.catalog.store.commit(data['datasetVersion'], record['commitId'])
            if stored is None:
                raise RequestError('NOT_FOUND')
            if set(stored['features']) != set(snapshot.schema.in_model_names()):
                raise RequestError('INPUT_SCHEMA_MISMATCH', field='record.features')
            record = {**record, 'features': {name: stored['features'][name]
                                             for name in snapshot.schema.in_model_names()}}
        names = snapshot.schema.in_model_names()
        vector = [record['features'][field] for field in names]
        try:
            risks = predict_risks(snapshot.model, [{'features': vector}], snapshot.schema)
        except Exception as exc:
            raise RequestError('INFERENCE_ERROR') from exc
        explanation = self._explain(snapshot, model, vector, names)
        batch_id, prediction_id = str(uuid4()), str(uuid4())
        created_at = utc_now()
        explained = explanation['status'] == 'supported'
        record_result = {'predictionId': prediction_id, **record, 'risk': risks[0],
                         'explanationStatus': explanation['status']}
        if explained:
            record_result.update({'explanationMethod': explanation['method'],
                                  'explanation': explanation['items'],
                                  'explanationSummary': explanation['summary']})
        else:
            record_result['explanationReason'] = explanation['reason']
        result = {'mode': 'persisted-commit' if persisted else 'feature-input',
                  'sourceKind': 'persisted-commit' if persisted else 'client-features',
                  'batchId': batch_id, 'datasetVersion': data['datasetVersion'],
                  'project': data['project'], 'runId': model['runId'], 'model': model,
                  'featureSchemaVersion': data['featureSchemaVersion'],
                  'inputSha256': identity({key: value for key, value in data.items() if key != 'modelId'}),
                  'createdAt': created_at,
                  'records': [record_result],
                  'limitations': ['特征来自已导入的提交数据，尚未核验真实标签。' if persisted
                                  else '原始特征由调用方提供，尚未核验源码提取或真实标签。',
                                  '风险为已登记模型估计，未验证在线仓库效果，不代表已确认缺陷。',
                                  ('归因来自模型对单特征的敏感度，不是缺陷结论或代码定位。' if explained
                                   else '本轮未提供真实预测解释或代码定位。'),
                                  *explanation['limitations'], *model['limitations']]}
        with self.catalog.store.connection(write=True) as db:
            db.execute('INSERT INTO prediction_batch VALUES (?,?,?,?)',
                       (batch_id, model['modelId'], encoded(result), created_at))
            db.execute('INSERT INTO prediction VALUES (?,?,?,?,?)',
                       (prediction_id, batch_id, record['recordId'], risks[0], encoded(record['features'])))
        return result

    def _explain(self, snapshot, model, vector, names):
        """计算特征归因；失败或基线不可用时降级为未支持，不改变风险（PEX-05）。"""
        baseline = attribution.feature_baseline(self.catalog.store, model.get('artifactDatasetVersion'), names)
        try:
            result = attribution.explain(
                lambda values: predict_risks(snapshot.model, [{'features': values}], snapshot.schema),
                vector, baseline, names)
        except Exception:
            return {'status': 'not-supported', 'method': None, 'items': None, 'summary': None,
                    'reason': '本次归因计算失败，风险本身仍然有效。', 'limitations': []}
        limitations = []
        if any(name not in baseline for name in names):
            limitations.append('部分入模特征缺少训练数据均值，本次归因对缺失字段按零基线计算。')
        return {'status': 'supported', 'method': result['method'], 'items': result['items'],
                'summary': result['summary'], 'reason': None, 'limitations': limitations}

    def get(self, batch_id):
        batch_id = uuid_text(batch_id, 'batchId')
        with self.catalog.store.connection() as db:
            row = db.execute('SELECT payload_json FROM prediction_batch WHERE id=?', (batch_id,)).fetchone()
            count = db.execute('SELECT count(*) FROM prediction WHERE batch_id=?', (batch_id,)).fetchone()[0]
        if row is None:
            raise RequestError('NOT_FOUND')
        if count != 1:
            raise RequestError('STORAGE_UNAVAILABLE')
        try:
            result = json.loads(row['payload_json'])
            if result['batchId'] != batch_id or len(result['records']) != 1:
                raise ValueError('batch')
            return result
        except (ValueError, KeyError, TypeError) as exc:
            raise RequestError('STORAGE_UNAVAILABLE') from exc
