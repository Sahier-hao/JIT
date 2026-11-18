"""HTTP application package.

``create_app`` remains importable from ``jit_baseline.api`` for CLI, tests and
external scripts. Routers live under ``jit_baseline.api.routers``.
"""
from .app import app, create_app

__all__ = ['app', 'create_app']
