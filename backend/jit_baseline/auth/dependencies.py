"""Unified authentication dependencies for FastAPI routers.

Admin routes declare ``dependencies=[Depends(require_admin)]`` instead of
relying on a hard-coded path whitelist. The dependency reads the same
HttpOnly session cookie and storage-backed session table as the existing
auth helpers, so behavior and expiry are unchanged.
"""
from fastapi import Request

from ..core.errors import BaselineError
from . import admin
from .users import current_user


def _storage(request: Request):
    storage = getattr(request.app.state, 'storage', None)
    if storage is None:
        raise BaselineError('STORAGE_UNAVAILABLE', '目录存储不可用')
    return storage


def require_admin(request: Request) -> str:
    username = admin.session_username(_storage(request), request.cookies.get(admin.COOKIE))
    if not username:
        raise BaselineError('AUTH_REQUIRED', '请先登录管理工作区')
    request.state.admin_username = username
    return username


def require_user(request: Request) -> str:
    username = current_user(request)
    if not username:
        raise BaselineError('AUTH_REQUIRED', '请先登录用户账户')
    return username


def optional_user(request: Request) -> str | None:
    return current_user(request)
