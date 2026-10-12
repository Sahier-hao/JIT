"""Fixed offline protocol, explicit independent outputs, localhost serving."""
import argparse
import json
import sys
from pathlib import Path

from .artifacts import DEFAULT_RUN, Snapshot, build_run, compare_runs, verify_run, write_json
from . import evidence
from .config import BACKEND
from .data import BaselineError, fetch_sources


def main():
    parser = argparse.ArgumentParser(description="固定 OpenStack 六字段回顾性基线")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("fetch")
    run = commands.add_parser("run")
    run.add_argument("--output", type=Path, default=DEFAULT_RUN)
    verify = commands.add_parser("verify")
    verify.add_argument("--run", type=Path, default=DEFAULT_RUN)
    compare = commands.add_parser("compare")
    compare.add_argument("first", type=Path)
    compare.add_argument("second", type=Path)
    compare.add_argument("--report", type=Path, required=True)
    commands.add_parser("serve")
    freeze = commands.add_parser("freeze-evidence")
    freeze.add_argument("target", type=Path)
    freeze.add_argument("--workspace", type=Path, default=None)
    check = commands.add_parser("check-evidence")
    check.add_argument("target", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "fetch":
            result = fetch_sources(BACKEND / "data/openstack")
        elif args.command == "run":
            manifest = build_run(BACKEND / "data/openstack", args.output)
            result = {"runId": manifest["runId"], "output": str(args.output.resolve()), "kind": "real-frozen-retrospective-baseline"}
        elif args.command == "verify":
            manifest = verify_run(args.run)
            result = {"runId": manifest["runId"], "records": len(Snapshot.load(args.run).batch()["records"]), "passed": True}
        elif args.command == "compare":
            result = compare_runs(args.first, args.second)
            args.report.parent.mkdir(parents=True, exist_ok=True)
            write_json(args.report, result)
        elif args.command == "freeze-evidence":
            manifest = evidence.freeze(args.target, args.workspace)
            result = {"kind": manifest["kind"], "target": str(args.target.resolve()),
                      "sourceRunId": manifest["sourceRunId"], "frozenUtc": manifest["frozenUtc"],
                      "copied": manifest["copiedFromWorkspace"], "excluded": manifest["excluded"],
                      "fileCount": manifest["fileCount"]}
        elif args.command == "check-evidence":
            result = evidence.check(args.target)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            if not result["passed"]:
                sys.exit(1)
            return
        else:
            import uvicorn
            uvicorn.run("jit_baseline.api:app", host="127.0.0.1", port=8000, workers=1)
            return
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (BaselineError, OSError) as exc:
        print(json.dumps({"error": getattr(exc, "code", "IO_ERROR"), "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
