"""Compatibility proxy; the canonical module is `storage.store`."""
import sys
import types
from .storage import store as _target


class _ModuleProxy(types.ModuleType):
    def __getattr__(self, attribute):
        return getattr(_target, attribute)

    def __setattr__(self, attribute, value):
        if attribute.startswith('__') and attribute.endswith('__'):
            return super().__setattr__(attribute, value)
        setattr(_target, attribute, value)


sys.modules[__name__].__class__ = _ModuleProxy
