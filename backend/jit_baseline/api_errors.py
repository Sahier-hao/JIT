"""Local API error envelopes and request diagnostics."""
import logging
import re
from uuid import uuid4

from fastapi.responses import JSONResponse

from .errors import BaselineError

LOGGER = logging.getLogger('jit.catalog')
LOGGER.setLevel(logging.INFO)
if not LOGGER.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(levelname)s jit.catalog %(message)s'))
    LOGGER.addHandler(handler)
API_PATHS = {'/api/v1/model-candidates', '/api/v1/models/register',
                '/api/v1/models', '/api/v1/predictions', '/api/v1/datasets', '/api/v1/commits',
                '/api/v1/repository-syncs', '/api/v1/repositories', '/api/v1/repository-models'}
MESSAGES = {
    'PR_SOURCE_UNAVAILABLE': '无法读取公开 GitHub PR 或原版本，请检查来源和网络后重试；已有草稿仍可保留',
    'PR_RATE_LIMITED': 'GitHub 请求受限，请稍后重试；旧版本和草稿保持不变',
    'PR_VERSION_CHANGED': '读取期间 PR 版本发生变化，请重新检查；旧版本保持不变',
    'PR_SOURCE_TOO_LARGE': 'PR 响应或文件列表过大，未取得完整来源，请重试或在 GitHub 核对',
    'PR_CONTENT_UNAVAILABLE': '该文件是二进制、过大或非 UTF-8 文本，无法完整显示；不能计入已阅读范围',
    'NOT_FOUND': '指定资源不存在',
    'INPUT_INVALID': '请求格式或字段值无效',
    'INPUT_SCHEMA_MISMATCH': '输入与所选模型的 schema 不匹配或未支持',
    'INPUT_LIMIT_EXCEEDED': '单条 JSON 请求超过 64 KiB 上限',
    'CONTEXT_MISMATCH': '候选或运行上下文发生变化，请重新选择',
    'DATASET_INVALID': '数据集描述或原始文件不符合约定',
    'DATASET_UNAVAILABLE': '数据集文件不可用',
    'DATASET_EXISTS': '数据集版本已存在且内容不同，不覆盖',
    'DATASET_REGISTRY_EMPTY': '没有已登记的数据集描述文件',
    'STORAGE_UNAVAILABLE': '目录存储不可用，请检查初始化、版本或存储权限',
    'ARTIFACT_UNAVAILABLE': '运行必要文件不可用，请恢复并重新登记',
    'INTEGRITY_ERROR': '运行文件校验不匹配，请核验并重新登记',
    'ARTIFACT_INVALID': '运行声明或环境无效，请核验产物',
    'MODEL_INVALID': '模型不可加载或结构无效',
    'MODEL_NOT_READY': '模型不可用，请重新校验登记',
    'MODEL_DISABLED': '所选模型已停用，请刷新模型列表并重新选择；历史结果仍可查看',
    'DEFAULT_MODEL_REQUIRED': '请管理员先设置另一个可用的默认模型；也可明确选择已启用模型',
    'INFERENCE_ERROR': '所选模型推理失败，未保存预测',
    'REPOSITORY_UNAVAILABLE': '仓库不可用：请检查地址、分支或网络后重试',
    'REPOSITORY_CHECK_TIMEOUT': '检查远端仓库超时，请重试；已有分析结果仍可查看',
    'SYNC_TIMEOUT': '同步超时，请缩小时间范围或提交上限后重试',
    'SYNC_INTERRUPTED': '服务重启时同步未完成，请重新同步',
    'SPLIT_INVALID': '数据无法完成时间切分，请调整时间范围或改用现成模型',
    'OUTPUT_EXISTS': '同步产物目录已存在，请稍后重试',
    'REPOSITORY_UNKNOWN': '仓库不存在，请刷新仓库列表后重试',
    'REPOSITORY_ANALYSIS_UNKNOWN': '指定分析不属于该仓库或不存在',
    'REPOSITORY_ANALYSIS_UNAVAILABLE': '指定分析尚未成功完成',
    'CONFLICT_ACTIVE_SYNC': '还有进行中的分析，请等待结束后再操作',
    'SYNC_NOT_ACTIVE': '该分析已经结束，请刷新记录；已有结果保持不变',
    'SYNC_SERVICE_STOPPING': '分析服务正在停止，请稍后重试',
    'REVIEW_PLAN_CONTEXT_MISMATCH': '计划备份不属于当前固定分析，项目、分析、数据或模型来源不一致；原计划保持不变',
    'REVIEW_PLAN_COMMIT_UNKNOWN': '计划包含不在该分析中的提交，未接受任何条目；原计划保持不变',
    'REVIEW_PLAN_LIMIT_EXCEEDED': '计划备份不能超过 1 MiB 或 5000 个提交',
}
STATUS = {'NOT_FOUND': 404,
          'PR_SOURCE_UNAVAILABLE': 502, 'PR_RATE_LIMITED': 429, 'PR_VERSION_CHANGED': 409,
          'PR_SOURCE_TOO_LARGE': 413, 'PR_CONTENT_UNAVAILABLE': 422,
          'MODEL_DISABLED': 409, 'DEFAULT_MODEL_REQUIRED': 409,
          'SCHEMA_UNKNOWN': 404, 'REPOSITORY_UNKNOWN': 404,
          'REPOSITORY_ANALYSIS_UNKNOWN': 404, 'REPOSITORY_ANALYSIS_UNAVAILABLE': 409,
          'INPUT_INVALID': 422, 'INPUT_SCHEMA_MISMATCH': 422,
          'INPUT_LIMIT_EXCEEDED': 413, 'CONTEXT_MISMATCH': 409, 'INFERENCE_ERROR': 500,
          'REPOSITORY_UNAVAILABLE': 502, 'REPOSITORY_CHECK_TIMEOUT': 504, 'SYNC_TIMEOUT': 504, 'SYNC_INTERRUPTED': 503,
          'SPLIT_INVALID': 422, 'OUTPUT_EXISTS': 409, 'CONFLICT_ACTIVE_SYNC': 409,
          'SYNC_NOT_ACTIVE': 409, 'SYNC_SERVICE_STOPPING': 503,
          'REVIEW_PLAN_CONTEXT_MISMATCH': 409, 'REVIEW_PLAN_COMMIT_UNKNOWN': 422,
          'REVIEW_PLAN_LIMIT_EXCEEDED': 413}


class RequestError(BaselineError):
    def __init__(self, code, *, field=None):
        super().__init__(code, MESSAGES.get(code, '请求未完成，请核验运行声明'))
        self.details = [{'field': field, 'reason': str(self)}] if field else []


def managed_path(path):
    if path == '/api/v1/review-sources' or re.fullmatch(r'/api/v1/pr-snapshots/[^/]+(?:/context|/analyses)?|/api/v1/pr-sources/[^/]+/[^/]+/[^/]+/refresh', path):
        return True
    return path.startswith('/api/admin/') or path.startswith('/api/v1/models/') or path in API_PATHS or bool(re.fullmatch(
        r'/api/v1/(?:feature-schemas|prediction-batches)/[^/]+'
        r'|/api/v1/datasets(?:/[^/]+(?:/versions)?)?'
        r'|/api/v1/repository-syncs(?:/[^/]+(?:/cancel|/commits(?:/[^/]+)?)?)?'
        r'|/api/v1/repositories(?:/[^/]+(?:/(?:commits(?:/[^/]+(?:/explanation)?)?|summary|syncs|updates|refresh|review-plan/validate|comparison))?)?'
        r'|/api/v1/commits(?:/[^/]+)?', path))


def install_errors(app):
    @app.middleware('http')
    async def local_api(request, call_next):
        if not managed_path(request.url.path):
            return await call_next(request)
        request.state.request_id = str(uuid4())
        try:
            response = await call_next(request)
        except BaselineError as exc:
            code = 'NOT_FOUND' if exc.code == 'SCHEMA_UNKNOWN' else exc.code
            error = {'code': code, 'message': MESSAGES.get(code, '运行声明无效，请核验产物'),
                     'requestId': request.state.request_id}
            if getattr(exc, 'details', None):
                error['details'] = exc.details
            response = JSONResponse({'error': error}, status_code=STATUS.get(code, 503))
        except Exception:
            response = JSONResponse({'error': {'code': 'INFERENCE_ERROR',
                'message': MESSAGES['INFERENCE_ERROR'], 'requestId': request.state.request_id}}, status_code=500)
        request.state.request_id = response.headers.get('X-Request-Id', request.state.request_id)
        response.headers['X-Request-Id'] = request.state.request_id
        response.headers['Cache-Control'] = 'no-store'
        model_id, run_id, batch_id = getattr(request.state, 'business_ids', (None, None, None))
        LOGGER.info('operation=%s requestId=%s status=%s modelId=%s runId=%s batchId=%s',
                    request.method, request.state.request_id, response.status_code,
                    model_id, run_id, batch_id)
        return response
