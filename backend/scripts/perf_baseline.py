"""本机推理服务性能基线测量。

对 GET /api/review-batch 发 30 次顺序请求，逐次计时并计算 nearest-rank P95，
记录 Python/CPU/RAM 环境与错误数。结果只描述当前本机链路，不是 NFR-01 阈值判定；
原始逐次计时写入运行工作区 docs/evidence/_run/（可被覆盖、不入库）。
"""

import ctypes
import json
import os
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

ENDPOINT = "http://127.0.0.1:8000/api/review-batch"
SAMPLES = 30
REPO_ROOT = Path(__file__).resolve().parents[2]
RUN_DIR = REPO_ROOT / "docs" / "evidence" / "_run"


def ram_bytes() -> int | None:
    """Windows GlobalMemoryStatusEx 物理内存总量；不可用时返回 None。"""
    try:

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MEMORYSTATUSEX()
        status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return status.ullTotalPhys
    except Exception:
        pass
    return None


def nearest_rank_p95(values: list[float]) -> float | None:
    """nearest-rank P95：升序后取第 ceil(0.95*n) 个（1 起索引）。"""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[((95 * len(ordered)) + 99) // 100 - 1]


def main() -> None:
    measured_at = datetime.now(timezone.utc).isoformat()
    samples: list[dict] = []
    errors = 0
    for index in range(SAMPLES):
        begin = time.perf_counter()
        try:
            response = httpx.get(ENDPOINT, timeout=60.0)
            elapsed = time.perf_counter() - begin
            ok = response.status_code == 200
            if not ok:
                errors += 1
            samples.append({"index": index, "elapsedSeconds": elapsed, "status": response.status_code, "ok": ok})
        except Exception:
            errors += 1
            samples.append({"index": index, "elapsedSeconds": time.perf_counter() - begin, "status": None, "ok": False})
    elapsed_seconds = [sample["elapsedSeconds"] for sample in samples if sample["ok"]]
    report = {
        "kind": "perf-baseline-backend",
        "measuredAt": measured_at,
        "endpoint": ENDPOINT,
        "method": f"{SAMPLES} sequential GET /api/review-batch, nearest-rank P95",
        "samples": samples,
        "errors": errors,
        "p95Seconds": nearest_rank_p95(elapsed_seconds),
        "meanSeconds": sum(elapsed_seconds) / len(elapsed_seconds) if elapsed_seconds else None,
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "processor": platform.processor(),
            "cpuCount": os.cpu_count(),
            "ramTotalBytes": ram_bytes(),
        },
        "statement": "本机链路基线，未做阈值判定；NFR-01 完整协议（每种模型 200 次单条 JSON、"
                     "4 个 LAN 客户端、P95<=2s/列表<=3s）待在线预测接口落地后重测。",
    }
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    output = RUN_DIR / "perf-backend-batch.json"
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    summary = {key: value for key, value in report.items() if key != "samples"}
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f"raw written to {output}")


if __name__ == "__main__":
    main()
