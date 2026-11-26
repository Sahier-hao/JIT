"""Compatibility proxy; the canonical module is `research.line_shadow`."""
from __future__ import annotations

import sys

from .research import line_shadow as _target

sys.modules[__name__] = _target
