"""Fixed offline protocol, explicit independent outputs, localhost serving."""
import argparse
import json
import sys
import os
from pathlib import Path

from .artifacts import (DEFAULT_RUN, Snapshot, build_run, compare_methods, compare_runs,
                        declared_reproducibility, environment, run_origin, verify_run, write_json)
from .suite import compare_projects, run_suite
from . import evidence
from .config import BACKEND
from .data import BaselineError, fetch_sources


def service_port(value):
    try:
        port = int(value)
    except (ValueError, TypeError) as exc:
        raise argparse.ArgumentTypeError('端口必须为 1–65535 的整数') from exc
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError('端口必须为 1–65535 的整数')
    return port


def main():
    parser = argparse.ArgumentParser(description="OpenStack 回顾性基线与具名方法")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("fetch")
    run = commands.add_parser("run")
    run.add_argument("--output", type=Path, default=DEFAULT_RUN)
    run.add_argument("--schema", default=None, help="具名特征 schema；默认 openstack-six-v1")
    run.add_argument("--algorithm", default=None, help="具名方法；默认 logistic-regression-l2-v1")
    run.add_argument("--metric-set", default=None, help="具名指标集；默认 metric-set-v1")
    run.add_argument("--dataset-manifest", type=Path, default=None,
                     help="数据集描述文件；给定后改读该数据集而不是 OpenStack 快照")
    run.add_argument("--holdout", type=int, default=None,
                     help="epoch 截止时间；只把早于它的记录用于切分与训练")
    run.add_argument("--embedding-dir", type=Path, default=None,
                     help="语义 schema 使用的嵌入表目录")
    verify = commands.add_parser("verify")
    verify.add_argument("--run", type=Path, default=DEFAULT_RUN)
    compare = commands.add_parser("compare")
    compare.add_argument("first", type=Path)
    compare.add_argument("second", type=Path)
    compare.add_argument("--report", type=Path, required=True)
    methods = commands.add_parser("compare-methods")
    methods.add_argument("runs", type=Path, nargs="+")
    methods.add_argument("--report", type=Path, required=True)
    suite = commands.add_parser("run-suite")
    suite.add_argument("--dataset-manifest", type=Path, required=True)
    suite.add_argument("--output", type=Path, required=True)
    suite.add_argument("--methods", nargs="*", default=None,
                       help="方法子集；省略表示全部已注册方法")
    suite.add_argument("--metric-set", default=None, help="默认 metric-set-v2")
    benchmark_import = commands.add_parser("import-benchmark")
    benchmark_import.add_argument("--source", choices=("jit-fine-v1",), required=True)
    benchmark_import.add_argument("--input", type=Path, required=True,
                                  help="固定 JIT-Fine data.zip 快照")
    benchmark_import.add_argument("--output", type=Path, required=True,
                                  help="规范化 CSV 输出路径")
    benchmark_import.add_argument("--dataset", default="jit-fine-kamei14")
    benchmark_import.add_argument("--version", default=None)
    benchmark_import.add_argument("--root", type=Path, default=None,
                                  help="数据集描述文件根目录；默认 backend/data/datasets")
    embeddings = commands.add_parser("build-embeddings")
    embeddings.add_argument("--text", type=Path, required=True)
    embeddings.add_argument("--output", type=Path, required=True)
    embeddings.add_argument("--model", default=None)
    embeddings.add_argument("--revision", default=None)
    embeddings.add_argument("--pooling", default=None)
    embeddings.add_argument("--max-length", type=int, default=None)
    embeddings.add_argument("--batch-size", type=int, default=16)
    embeddings.add_argument("--hf-endpoint", default=None)
    schemes = commands.add_parser("compare-schemes")
    schemes.add_argument("runs", type=Path, nargs="+")
    schemes.add_argument("--report", type=Path, required=True)
    projects = commands.add_parser("compare-projects")
    projects.add_argument("suites", type=Path, nargs="+")
    projects.add_argument("--report", type=Path, required=True)
    serve = commands.add_parser("serve")
    serve.add_argument('--port', type=service_port, default=8000, help='本机服务端口；隔离验证应显式指定')
    from .catalog_storage import DEFAULT_DATABASE
    initialize = commands.add_parser('catalog-init')
    initialize.add_argument('--database', type=Path, default=os.environ.get('JIT_CATALOG_DATABASE', DEFAULT_DATABASE))
    reset_admin = commands.add_parser('admin-reset-password', help='在本机重置管理员密码并撤销其全部会话')
    reset_admin.add_argument('--database', type=Path, default=os.environ.get('JIT_CATALOG_DATABASE', DEFAULT_DATABASE))
    reset_admin.add_argument('--username', required=True)
    register = commands.add_parser('register-model')
    register.add_argument('--run-key', required=True)
    register.add_argument('--database', type=Path, default=os.environ.get('JIT_CATALOG_DATABASE', DEFAULT_DATABASE))
    register.add_argument('--artifact-root', type=Path, default=os.environ.get('JIT_ARTIFACT_ROOT', BACKEND / 'artifacts'))
    dataset_register = commands.add_parser('register-dataset')
    dataset_register.add_argument('--csv', type=Path, default=BACKEND / 'data/openstack/openstack.csv')
    dataset_register.add_argument('--schema', default=None, help='具名特征 schema；默认 openstack-six-v1')
    dataset_register.add_argument('--dataset', default=None, help='数据集名；默认取 schema 名')
    dataset_register.add_argument('--version', default=None, help='版本名；默认 <数据集>-<起始日>_<结束日>')
    dataset_register.add_argument('--output', type=Path, default=None, help='描述文件根目录；默认 backend/data/datasets')
    dataset_import = commands.add_parser('import-dataset')
    dataset_import.add_argument('--csv', type=Path, default=None, help='原始 CSV；默认按描述文件的 file.path 定位')
    dataset_import.add_argument('--manifest', type=Path, required=True)
    dataset_import.add_argument('--database', type=Path, default=os.environ.get('JIT_CATALOG_DATABASE', DEFAULT_DATABASE))
    collect = commands.add_parser('collect-repository')
    collect.add_argument('--repo', required=True, help='本地仓库路径或远程仓库地址')
    collect.add_argument('--since', default=None, help='起始时间（YYYY-MM-DD 或 ISO）')
    collect.add_argument('--until', default=None, help='结束时间（YYYY-MM-DD 或 ISO）')
    collect.add_argument('--branch', default='HEAD', help='采集的分支或提交；默认 HEAD')
    collect.add_argument('--limit', type=int, default=None, help='提交数上限；超过即拒绝')
    collect.add_argument('--dataset', default=None, help='数据集名；默认由仓库名派生')
    collect.add_argument('--output', type=Path, default=None, help='采集 CSV 输出路径')
    collect.add_argument('--register', action='store_true', help='采集后直接登记数据集')
    collect.add_argument('--with-text', action='store_true', help='同时产出有界 diff 文本 sidecar')
    collect.add_argument('--root', type=Path, default=None, help='数据集登记目录；默认 backend/data/datasets')
    freeze = commands.add_parser("freeze-evidence")
    freeze.add_argument("target", type=Path)
    freeze.add_argument("--workspace", type=Path, default=None)
    check = commands.add_parser("check-evidence")
    check.add_argument("target", type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'catalog-init':
            from .catalog_storage import CatalogStorage, VERSION
            CatalogStorage(args.database).initialize()
            result = {'kind': 'catalog-initialized', 'version': VERSION}
        elif args.command == 'admin-reset-password':
            from getpass import getpass
            from .catalog_storage import CatalogStorage
            from .admin import reset_password
            password = getpass('新管理员密码（至少 12 位）：')
            if getpass('再次输入密码：') != password:
                raise BaselineError('INPUT_INVALID', '两次密码不一致')
            reset_password(CatalogStorage(args.database), args.username, password)
            result = {'kind': 'admin-password-reset', 'sessionsRevoked': True}
        elif args.command == 'register-model':
            from .catalog import ModelCatalog
            from .catalog_storage import CatalogStorage
            result = ModelCatalog(CatalogStorage(args.database), args.artifact_root).register_key(args.run_key)
        elif args.command == 'register-dataset':
            from . import store
            result = dict(store.register(args.csv, schema=args.schema, dataset=args.dataset,
                                         version=args.version, root=args.output), kind='dataset-registered')
        elif args.command == 'import-dataset':
            from . import store
            from .catalog_storage import CatalogStorage
            storage = CatalogStorage(args.database)
            storage.initialize()
            result = dict(store.import_dataset(args.csv, args.manifest, storage), kind='dataset-imported')
        elif args.command == 'collect-repository':
            from . import collect as collector
            result = collector.collect_repository(args.repo, since=args.since, until=args.until,
                                                  branch=args.branch, output=args.output,
                                                  dataset=args.dataset, register=args.register,
                                                  limit=args.limit, root=args.root,
                                                  with_text=args.with_text)
        elif args.command == "fetch":
            result = fetch_sources(BACKEND / "data/openstack")
        elif args.command == "run":
            manifest = build_run(BACKEND / "data/openstack", args.output, args.schema, args.algorithm,
                                 metric_set=args.metric_set,
                                 dataset_manifest=args.dataset_manifest, holdout=args.holdout,
                                 embedding_dir=args.embedding_dir)
            result = {"runId": manifest["runId"], "output": str(args.output.resolve()), "kind": "real-frozen-retrospective-baseline"}
        elif args.command == "verify":
            manifest = verify_run(args.run)
            config = manifest["config"]
            # 校验记录本次判定与本机验证环境：两者都只进校验记录，不写回产物（PDB-16／PDB-19）。
            result = {"runId": manifest["runId"], "records": len(Snapshot.load(args.run).batch()["records"]),
                      "origin": run_origin(manifest),
                      "trainingEnvironment": config.get("trainingEnvironment") or config.get("environment"),
                      "verificationEnvironment": environment(),
                      "reproducibility": declared_reproducibility(manifest)[1], "passed": True}
        elif args.command == "compare":
            result = compare_runs(args.first, args.second)
            args.report.parent.mkdir(parents=True, exist_ok=True)
            write_json(args.report, result)
        elif args.command == "compare-methods":
            result = compare_methods(args.runs)
            args.report.parent.mkdir(parents=True, exist_ok=True)
            write_json(args.report, result)
        elif args.command == "run-suite":
            result = run_suite(args.dataset_manifest, args.output, args.methods, args.metric_set)
        elif args.command == "import-benchmark":
            from .benchmark import import_jit_fine
            result = import_jit_fine(args.input, args.output, dataset=args.dataset,
                                     version=args.version, root=args.root)
        elif args.command == "compare-projects":
            result = compare_projects(args.suites)
            args.report.parent.mkdir(parents=True, exist_ok=True)
            write_json(args.report, result)
        elif args.command == "build-embeddings":
            from .semantic import build_embeddings
            options = {"batch_size": args.batch_size}
            if args.model:
                options["model_id"] = args.model
            if args.revision:
                options["revision"] = args.revision
            if args.pooling:
                options["pooling"] = args.pooling
            if args.max_length:
                options["max_length"] = args.max_length
            if args.hf_endpoint:
                options["hf_endpoint"] = args.hf_endpoint
            result = build_embeddings(args.text, args.output, **options)
        elif args.command == "compare-schemes":
            from .semantic import compare_schemes
            result = compare_schemes(args.runs)
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
            uvicorn.run("jit_baseline.api:app", host="127.0.0.1", port=args.port, workers=1)
            return
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (BaselineError, OSError) as exc:
        print(json.dumps({"error": getattr(exc, "code", "IO_ERROR"), "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
