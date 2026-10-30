"""Local administrator accounts and revocable, expiring browser sessions."""
import hashlib
import hmac
import os
import secrets
import threading
import time
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from .catalog_input import read_object
from .errors import BaselineError

COOKIE = 'jit_admin_session'
SESSION_SECONDS = 8 * 60 * 60


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600_000).hex()


def reset_password(storage, username, password):
    if not isinstance(password, str) or not 12 <= len(password) <= 256:
        raise BaselineError('INPUT_INVALID', '密码须为 12–256 位')
    salt = secrets.token_hex(16)
    digest = password_hash(password, salt)
    with storage.connection(write=True) as db:
        if not db.execute('SELECT 1 FROM admin_account WHERE username=?', (username,)).fetchone():
            raise BaselineError('NOT_FOUND', '该管理员账户不存在')
        db.execute('UPDATE admin_account SET salt=?,password_hash=? WHERE username=?', (salt, digest, username))
        db.execute('DELETE FROM admin_session WHERE username=?', (username,))


def protected(path):
    return (path == '/api/review-batch' or path.startswith('/api/admin/data') or
            any(path == prefix or path.startswith(prefix + '/') for prefix in
                ('/api/v1/models', '/api/v1/model-candidates', '/api/v1/datasets',
                 '/api/v1/training-tasks', '/api/v1/commits', '/api/v1/predictions',
                 '/api/v1/prediction-batches', '/api/v1/feature-schemas')))


def error(code, message, status):
    request_id = str(uuid4())
    return JSONResponse({'error': {'code': code, 'message': message, 'requestId': request_id}},
                        status_code=status, headers={'X-Request-Id': request_id, 'Cache-Control': 'no-store'})


def install_admin(app, storage):
    setup_lock = threading.Lock()
    attempt_lock = threading.Lock()
    attempts = {}

    def username_for(token):
        if not token or len(token) > 256:
            return None
        with storage.connection() as db:
            row = db.execute('SELECT username FROM admin_session WHERE token_hash=? AND expires_at>?',
                             (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
        return row['username'] if row else None

    def configured():
        with storage.connection() as db:
            return db.execute('SELECT COUNT(*) FROM admin_account').fetchone()[0] > 0

    def issue(username, status=200, secure=False):
        token = secrets.token_urlsafe(32)
        with storage.connection(write=True) as db:
            db.execute('DELETE FROM admin_session WHERE expires_at<=?', (time.time(),))
            db.execute('INSERT INTO admin_session VALUES (?,?,?)',
                       (hashlib.sha256(token.encode()).hexdigest(), username, time.time() + SESSION_SECONDS))
        response = JSONResponse({'authenticated': True, 'username': username, 'setupRequired': False}, status_code=status)
        response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True, samesite='strict', secure=secure, path='/api')
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.middleware('http')
    async def admin_boundary(request, call_next):
        path = request.url.path.rstrip('/')
        try:
            if request.method not in ('GET', 'HEAD', 'OPTIONS') and (protected(path) or path.startswith('/api/admin/')):
                origin = request.headers.get('origin')
                source = urlparse(origin) if origin else None
                frontend_port = os.environ.get('JIT_FRONTEND_PORT', '4173')
                allowed_origins = {str(request.base_url).rstrip('/'),
                                   f'http://127.0.0.1:{frontend_port}', f'http://localhost:{frontend_port}'}
                if (request.headers.get('sec-fetch-site') == 'cross-site' or source and
                        origin.rstrip('/') not in allowed_origins):
                    return error('ACCESS_DENIED', '请从本机管理页面执行此操作', 403)
            if protected(path):
                username = await run_in_threadpool(username_for, request.cookies.get(COOKIE))
                if not username:
                    return error('AUTH_REQUIRED', '请先登录管理工作区', 401)
                request.state.admin_username = username
        except BaselineError:
            return error('STORAGE_UNAVAILABLE', '请先初始化或升级本机目录库', 503)
        response = await call_next(request)
        if path.startswith('/api/admin/') or protected(path):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/api/admin/session')
    def session(request: Request):
        name = username_for(request.cookies.get(COOKIE))
        return {'authenticated': bool(name), 'username': name, 'setupRequired': not configured()}

    @app.post('/api/admin/setup')
    async def setup(request: Request):
        data = await read_object(request)
        username, password = data.get('username'), data.get('password')
        if (not isinstance(username, str) or not 1 <= len(username.strip()) <= 80 or
                not isinstance(password, str) or not 12 <= len(password) <= 256):
            return error('INPUT_INVALID', '请输入账户名，并设置 12–256 位密码', 422)
        # First-account creation is serialized and stored atomically, never a default password.
        def create():
            with setup_lock:
                salt = secrets.token_hex(16)
                digest = password_hash(password, salt)
                with storage.connection(write=True) as db:
                    if db.execute('SELECT COUNT(*) FROM admin_account').fetchone()[0]:
                        return False
                    db.execute('INSERT INTO admin_account VALUES (?,?,?,?)', (username.strip(), salt, digest, time.time()))
            return True
        if not await run_in_threadpool(create):
            return error('AUTH_ALREADY_CONFIGURED', '管理员已建立，请直接登录', 409)
        return await run_in_threadpool(issue, username.strip(), 201, request.url.scheme == 'https')

    @app.post('/api/admin/login')
    async def login(request: Request):
        data = await read_object(request)
        username, password = data.get('username'), data.get('password')
        if not isinstance(username, str) or not isinstance(password, str) or len(password) > 256:
            return error('AUTH_INVALID', '账户名或密码不正确', 401)
        key = request.client.host if request.client else 'local'
        with attempt_lock:
            now = time.monotonic()
            recent = [stamp for stamp in attempts.get(key, []) if now - stamp < 60]
            if len(recent) >= 5:
                return error('RATE_LIMITED', '尝试过于频繁，请一分钟后重试', 429)
            attempts[key] = [*recent, now]
        def verify():
            with storage.connection() as db:
                row = db.execute('SELECT * FROM admin_account WHERE username=?', (username.strip(),)).fetchone()
            salt = row['salt'] if row else '0' * 32
            digest = password_hash(password, salt)
            return row is not None and hmac.compare_digest(row['password_hash'], digest)
        if not await run_in_threadpool(verify):
            return error('AUTH_INVALID', '账户名或密码不正确', 401)
        with attempt_lock:
            attempts.pop(key, None)
        return await run_in_threadpool(issue, username.strip(), 200, request.url.scheme == 'https')

    @app.post('/api/admin/logout')
    def logout(request: Request):
        token = request.cookies.get(COOKIE, '')
        with storage.connection(write=True) as db:
            db.execute('DELETE FROM admin_session WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),))
        response = Response(status_code=204)
        response.delete_cookie(COOKIE, path='/api')
        return response
