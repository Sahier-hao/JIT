"""CLI adapters for author-method reproduction."""
from __future__ import annotations

import json
from pathlib import Path

from ..errors import BaselineError
from .catalog import catalog, method_entry, method_ids, prepare_method
from .runner import load_run


def catalog_result(method=None):
    if method:
        return {
            "schema": "author-catalog-view-v1",
            "method": method,
            "entry": method_entry(method),
            "catalog": catalog(),
        }
    return {"schema": "author-catalog-view-v1", "methods": method_ids(),
            "catalog": catalog()}


def prepare_result(method):
    if method not in method_ids():
        raise BaselineError("AUTHOR_METHOD_UNKNOWN", f"未知作者方法：{method}")
    return prepare_method(method)


def run_method(args):
    method = args.method
    if method == "kamei":
        from .kamei import run_kamei
        mode = args.mode if args.mode in ("author", "unified14") else "author"
        return run_kamei(mode=mode, output=args.output, seed=args.seed, argv=None)
    if method == "deepjit":
        from .deepjit import run_deepjit
        mode = args.mode if args.mode in ("evaluate", "train") else "evaluate"
        return run_deepjit(
            mode=mode, output=args.output, seed=args.seed, max_train=args.max_train,
            epochs=args.epochs, learning_rate_source=args.learning_rate_source,
            batch_size=args.batch_size or 64, data_dir=args.data_dir,
            model_path=args.model, argv=None,
        )
    if method == "jitline":
        from .jitline import VARIANTS, run_jitline
        variant = args.variant
        if variant is None and args.mode in VARIANTS:
            variant = args.mode
        return run_jitline(
            variant=variant or "jitfine-baseline", output=args.output, seed=args.seed,
            max_train=args.max_train, line_commits=args.line_commits,
            lime_samples=args.lime_samples, smote_k=args.smote_k, argv=None,
        )
    if method == "jitfine":
        from .jitfine import run_jitfine
        return run_jitfine(
            output=args.output, seed=args.seed, max_train=args.max_train or 32,
            max_valid=args.max_valid or 16, max_test=args.max_test or 32,
            epochs=args.epochs, batch_size=args.batch_size or 2, argv=None,
        )
    if method == "jitsmart":
        from .jitsmart import run_jitsmart
        return run_jitsmart(
            output=args.output, seed=args.seed, max_train=args.max_train or 16,
            max_valid=args.max_valid or 8, max_test=args.max_test or 16,
            epochs=args.epochs, batch_size=args.batch_size or 1, argv=None,
            test_project=args.test_project,
        )
    raise BaselineError("AUTHOR_METHOD_UNKNOWN", f"未知作者方法：{method}")


def report_result(run_path):
    run = load_run(Path(run_path))
    directory = Path(run["output"])
    metrics_path = directory / "metrics.json"
    metrics = None
    if metrics_path.is_file():
        metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    return {
        "schema": "author-report-v1",
        "run": run,
        "metrics": metrics,
        "hasPredictions": (directory / "predictions.jsonl").is_file(),
        "hasLinePredictions": (directory / "line-predictions.jsonl").is_file(),
    }
