"""Local end-user accounts, sessions and ownership helpers."""
import hashlib
import hmac
import os
import secrets
import threading
import time

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from . import admin
from .catalog_input import read_object
from .errors import BaselineError

COOKIE = 'jit_user_session'
SESSION_SECONDS = 8 * 60 * 60
USERNAME_LIMIT = 80
PASSWORD_MIN = 8
PASSWORD_MAX = 256


def _hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600_000).hex()


def user_for(storage, token):
    if not token or len(token) > 256:
        return None
    with storage.connection() as db:
        row = db.execute(
            'SELECT username FROM user_session WHERE token_hash=? AND expires_at>?',
            (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
    return row[0] if row else None


def current_user(request):
    """当前普通用户；管理员会话不当作普通用户。"""
    storage = getattr(request.app.state, 'user_storage', None)
    if storage is None:
        return None
    return user_for(storage, request.cookies.get(COOKIE))


def current_admin(request):
    storage = getattr(request.app.state, 'user_storage', None)
    if storage is None:
        return None
    return admin.session_username(storage, request.cookies.get(admin.COOKIE))


def install_users(app, storage):
    app.state.user_storage = storage
    attempt_lock = threading.Lock()
    attempts = {}

    def issue(username, status=200, secure=False):
        token = secrets.token_urlsafe(32)
        with storage.connection(write=True) as db:
            db.execute('DELETE FROM user_session WHERE expires_at<=?', (time.time(),))
            db.execute('INSERT INTO user_session VALUES (?,?,?)',
                       (hashlib.sha256(token.encode()).hexdigest(), username,
                        time.time() + SESSION_SECONDS))
        response = JSONResponse({'authenticated': True, 'username': username}, status_code=status)
        response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True,
                            samesite='strict', secure=secure, path='/api')
        response.headers['Cache-Control'] = 'no-store'
        return response

    def validate(username, password):
        if not isinstance(username, str) or not 1 <= len(username.strip()) <= USERNAME_LIMIT:
            return '请输入 1–80 位账户名'
        if not isinstance(password, str) or not PASSWORD_MIN <= len(password) <= PASSWORD_MAX:
            return f'密码须为 {PASSWORD_MIN}–{PASSWORD_MAX} 位'
        return None

    @app.middleware('http')
    async def user_boundary(request, call_next):
        path = request.url.path.rstrip('/')
        if request.method not in ('GET', 'HEAD', 'OPTIONS') and (
                path.startswith('/api/user/') or path.startswith('/api/v1/user/')):
            origin = request.headers.get('origin')
            if origin:
                from urllib.parse import urlparse
                source = urlparse(origin)
                frontend_port = os.environ.get('JIT_FRONTEND_PORT', '4173')
                extra_ports = [item.strip() for item in
                               os.environ.get('JIT_EXTRA_FRONTEND_PORTS', '').split(',') if item.strip()]
                allowed = {str(request.base_url).rstrip('/'),
                           f'http://127.0.0.1:{frontend_port}',
                           f'http://localhost:{frontend_port}'}
                for port in extra_ports:
                    allowed.update({f'http://127.0.0.1:{port}', f'http://localhost:{port}'})
                if (request.headers.get('sec-fetch-site') == 'cross-site'
                        or origin.rstrip('/') not in allowed):
                    return JSONResponse(
                        {'error': {'code': 'ACCESS_DENIED',
                                   'message': '请从本机用户页面执行此操作'}},
                        status_code=403, headers={'Cache-Control': 'no-store'})
        response = await call_next(request)
        if path.startswith('/api/user') or path.startswith('/api/v1/user'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/api/user/session')
    def session(request: Request):
        return {'authenticated': bool(current_user(request)),
                'username': current_user(request)}

    @app.post('/api/user/register')
    async def register(request: Request):
        data = await read_object(request)
        username, password = data.get('username'), data.get('password')
        problem = validate(username, password)
        if problem:
            raise BaselineError('INPUT_INVALID', problem)
        username = username.strip()
        salt = secrets.token_hex(16)
        digest = _hash(password, salt)
        try:
            with storage.connection(write=True) as db:
                if db.execute('SELECT 1 FROM user_account WHERE username=?', (username,)).fetchone():
                    raise BaselineError('USERNAME_TAKEN', '账户名已被使用')
                db.execute('INSERT INTO user_account (username,salt,password_hash,created_at) VALUES (?,?,?,?)',
                           (username, salt, digest, time.time()))
        except BaselineError:
            raise
        return await run_in_threadpool(issue, username, 201, request.url.scheme == 'https')

    @app.post('/api/user/login')
    async def login(request: Request):
        data = await read_object(request)
        username, password = data.get('username'), data.get('password')
        if not isinstance(username, str) or not isinstance(password, str) or len(password) > PASSWORD_MAX:
            raise BaselineError('AUTH_INVALID', '账户名或密码不正确')
        key = request.client.host if request.client else 'local'
        with attempt_lock:
            now = time.monotonic()
            recent = [stamp for stamp in attempts.get(key, []) if now - stamp < 60]
            if len(recent) >= 5:
                raise BaselineError('RATE_LIMITED', '尝试过于频繁，请一分钟后重试')
            attempts[key] = [*recent, now]

        def verify():
            with storage.connection() as db:
                row = db.execute('SELECT * FROM user_account WHERE username=?',
                                 (username.strip(),)).fetchone()
            salt = row['salt'] if row else '0' * 32
            digest = _hash(password, salt)
            return row is not None and hmac.compare_digest(row['password_hash'], digest)

        if not await run_in_threadpool(verify):
            raise BaselineError('AUTH_INVALID', '账户名或密码不正确')
        with attempt_lock:
            attempts.pop(key, None)
        return await run_in_threadpool(issue, username.strip(), 200, request.url.scheme == 'https')

    @app.post('/api/user/password')
    async def change_password(request: Request):
        username = current_user(request)
        if not username:
            raise BaselineError('AUTH_REQUIRED', '请先登录用户账户')
        data = await read_object(request)
        current, new = data.get('currentPassword'), data.get('newPassword')
        if not isinstance(new, str) or not PASSWORD_MIN <= len(new) <= PASSWORD_MAX:
            raise BaselineError('INPUT_INVALID', f'新密码须为 {PASSWORD_MIN}–{PASSWORD_MAX} 位')
        if not isinstance(current, str):
            raise BaselineError('AUTH_INVALID', '当前密码不正确')

        def verify_and_update():
            with storage.connection() as db:
                row = db.execute('SELECT * FROM user_account WHERE username=?', (username,)).fetchone()
            if row is None:
                return False
            digest = _hash(current, row['salt'])
            if not hmac.compare_digest(row['password_hash'], digest):
                return False
            salt = secrets.token_hex(16)
            with storage.connection(write=True) as db:
                db.execute('UPDATE user_account SET salt=?,password_hash=? WHERE username=?',
                           (salt, _hash(new, salt), username))
                db.execute('DELETE FROM user_session WHERE username=?', (username,))
            return True

        if not await run_in_threadpool(verify_and_update):
            raise BaselineError('AUTH_INVALID', '当前密码不正确')
        return await run_in_threadpool(issue, username, 200, request.url.scheme == 'https')

    @app.post('/api/user/logout')
    def logout(request: Request):
        token = request.cookies.get(COOKIE, '')
        with storage.connection(write=True) as db:
            db.execute('DELETE FROM user_session WHERE token_hash=?',
                       (hashlib.sha256(token.encode()).hexdigest(),))
        response = Response(status_code=204)
        response.delete_cookie(COOKIE, path='/api')
        return response
