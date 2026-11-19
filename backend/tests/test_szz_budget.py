"""SZZ 时间预算：默认按改动量自动放宽，显式覆盖时保持固定值。"""
from jit_baseline.ml.szz import AUTO_MAX_SECONDS, MAX_SECONDS, auto_budget


def test_auto_budget_uses_floor_for_small_changes():
    assert auto_budget([{'files': []}, {'files': [{'added': 10, 'deleted': 5}]}]) == MAX_SECONDS


def test_auto_budget_scales_with_changed_lines_and_caps():
    candidates = [{'files': [{'added': 100_000, 'deleted': 50_000}]}]
    assert auto_budget(candidates) == 660
    huge = [{'files': [{'added': 500_000, 'deleted': 500_000}]} for _ in range(10)]
    assert auto_budget(huge) == AUTO_MAX_SECONDS
