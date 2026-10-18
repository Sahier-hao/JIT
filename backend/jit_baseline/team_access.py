"""Team roles for the new API only. Never log authorization material."""
import hmac
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
ADMIN_PATHS = {'/api/v1/model-candidates', '/api/v1/models/register'}
MEMBER_PATHS = {'/api/v1/models', '/api/v1/predictions', '/api/v1/datasets', '/api/v1/commits'}
MESSAGES = {
    'ACCESS_CONFIG_INVALID': '团队访问凭据配置无效，请联系维护者',
    'AUTH_REQUIRED': '需要有效的团队 Bearer 凭据',
    'ACCESS_DENIED': '此操作需要管理员权限',
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
    'MODEL_NOT_READY': '模型不可用，请由管理员重新校验登记',
    'INFERENCE_ERROR': '所选模型推理失败，未保存预测',
}
STATUS = {'AUTH_REQUIRED': 401, 'ACCESS_DENIED': 403, 'NOT_FOUND': 404,
          'SCHEMA_UNKNOWN': 404, 'INPUT_INVALID': 422, 'INPUT_SCHEMA_MISMATCH': 422,
          'INPUT_LIMIT_EXCEEDED': 413, 'CONTEXT_MISMATCH': 409, 'INFERENCE_ERROR': 500}


class RequestError(BaselineError):
    def __init__(self, code, *, field=None):
        super().__init__(code, MESSAGES.get(code, '请求未完成，请核验运行声明'))
        self.details = [{'field': field, 'reason': str(self)}] if field else []


def managed_path(path):
    return path in ADMIN_PATHS | MEMBER_PATHS or bool(re.fullmatch(
        r'/api/v1/(?:feature-schemas|prediction-batches)/[^/]+'
        r'|/api/v1/datasets(?:/[^/]+(?:/versions)?)?'
        r'|/api/v1/commits(?:/[^/]+)?', path))


def authorize(header, member, admin, *, require_admin=False):
    if not member or not admin or member == admin:
        raise RequestError('ACCESS_CONFIG_INVALID')
    parts = (header or '').split()
    if len(parts) != 2 or parts[0].lower() != 'bearer':
        raise RequestError('AUTH_REQUIRED')
    token = parts[1].encode('utf-8')
    is_admin = hmac.compare_digest(token, admin.encode('utf-8'))
    is_member = hmac.compare_digest(token, member.encode('utf-8'))
    if not is_admin and not is_member:
        raise RequestError('AUTH_REQUIRED')
    if require_admin and not is_admin:
        raise RequestError('ACCESS_DENIED')
    return 'admin' if is_admin else 'member'


def install_access(app, member, admin):
    @app.middleware('http')
    async def team_access(request, call_next):
        if not managed_path(request.url.path):
            return await call_next(request)
        request.state.request_id = str(uuid4())
        request.state.role = 'anonymous'
        try:
            request.state.role = authorize(request.headers.get('Authorization'), member, admin)
            if request.url.path in ADMIN_PATHS and request.state.role != 'admin':
                raise RequestError('ACCESS_DENIED')
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
        response.headers['X-Request-Id'] = request.state.request_id
        response.headers['Cache-Control'] = 'no-store'
        model_id, run_id, batch_id = getattr(request.state, 'business_ids', (None, None, None))
        LOGGER.info('operation=%s role=%s requestId=%s status=%s modelId=%s runId=%s batchId=%s',
                    request.method, request.state.role, request.state.request_id, response.status_code,
                    model_id, run_id, batch_id)
        return response
