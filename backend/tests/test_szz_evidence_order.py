"""SZZ 证据排序：缺失旧路径不能与字符串比较而中断采集。"""
from jit_baseline.ml.szz import _evidence_order


def test_evidence_order_accepts_missing_old_path():
    entries = [
        (('fix-2', 'src/b.py', None), []),
        (('fix-1', 'src/a.py', 'src/old.py'), []),
        (('fix-1', 'src/a.py', None), []),
    ]
    ordered = [item[0] for item in sorted(entries, key=_evidence_order)]
    assert ordered == [
        ('fix-1', 'src/a.py', None),
        ('fix-1', 'src/a.py', 'src/old.py'),
        ('fix-2', 'src/b.py', None),
    ]
