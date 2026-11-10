"""Fixed offline protocol, explicit independent outputs, localhost serving."""
import argparse
import json
import sys
import os
from pathlib import Path

from .artifacts import (DEFAULT_RUN, Snapshot, build_run, compare_methods, compare_runs,
                        declared_reproducibility, environment, run_origin, verify_run, write_json)
from .suite import compare_projects, run_suite
from .multi_project import run_multi_project
from .benefit import DEFAULT_RANDOM_RUNS, DEFAULT_SEED, run_benefit
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
    run.add_argument("--split-preset", default=None,
                     help="时间切分预设：temporal-70-15-15、temporal-80-10-10 或 temporal-60-20-20")
    run.add_argument("--embedding-dir", type=Path, default=None,
                     help="语义 schema 使用的嵌入表目录")
    run.add_argument("--params", default=None,
                     help="受控参数覆盖 JSON，例如 {\"C\": 0.5}；默认使用方法冻结参数")
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
    multi_project = commands.add_parser("run-multi-project")
    multi_project.add_argument("--dataset-manifest", type=Path, nargs="+", required=True)
    multi_project.add_argument("--output", type=Path, required=True)
    multi_project.add_argument("--methods", nargs="*", default=None,
                               help="方法子集；省略表示五种经典方法")
    multi_project.add_argument("--metric-set", default=None, help="默认 metric-set-v2")
    evaluation = commands.add_parser("run-evaluation-matrix",
                                     help="固定协议的多模型时间外与留一仓库评价")
    evaluation.add_argument("--data", action="append", required=True,
                            help="可重复：语言=数据集描述文件路径（如 python=backend/data/datasets/x/y.json）")
    evaluation.add_argument("--output", type=Path, required=True, help="报告 JSON 输出路径")
    evaluation.add_argument("--methods", nargs="*", default=None,
                            help="方法子集；默认逻辑回归、决策树、随机森林与 MLP")
    evaluation.add_argument("--seed", action="append", type=int, default=None,
                            help="随机方法的种子，可重复；默认 42/43/44")
    benefit = commands.add_parser("evaluate-benefit", help="用冻结测试分区比较模型、时间与随机检查顺序")
    benefit.add_argument("--run", type=Path, required=True, help="已交付模型产物目录")
    benefit.add_argument("--output", type=Path, required=True, help="报告文件或目录；目录写 benefit-report.json")
    benefit.add_argument("--random-runs", type=int, default=DEFAULT_RANDOM_RUNS,
                         help=f"随机重复次数，默认 {DEFAULT_RANDOM_RUNS}")
    benefit.add_argument("--seed", type=int, default=DEFAULT_SEED, help=f"随机种子，默认 {DEFAULT_SEED}")
    diagnose = commands.add_parser("diagnose-model", help="从既有产物生成三档冻结诊断报告")
    diagnose.add_argument("--run", type=Path, required=True, help="已校验的模型产物目录")
    diagnose.add_argument("--output", type=Path, required=True, help="报告文件或目录")
    diagnose.add_argument("--dataset-root", type=Path, default=None, help="数据集描述文件根目录")
    pr_export = commands.add_parser("pr-check-export", help="从固定 PR 分析导出离线检查包")
    pr_export.add_argument("--database", type=Path, default=os.environ.get('JIT_CATALOG_DATABASE', None))
    pr_export.add_argument("--snapshot", required=True, help="PR 快照标识")
    pr_export.add_argument("--analysis", required=True, help="固定分析标识")
    pr_export.add_argument("--output", type=Path, required=True, help="分析包输出路径")
    pr_report = commands.add_parser("pr-check-report", help="从离线检查包生成 JSON 或 Markdown 报告")
    pr_report.add_argument("--bundle", type=Path, required=True, help="pr-check-export 生成的分析包")
    pr_report.add_argument("--format", choices=("json", "markdown"), default="json")
    pr_report.add_argument("--output", type=Path, required=True, help="报告输出路径")
    pr_analyze = commands.add_parser("pr-check-analyze", help="从本地 Git 提交范围执行采集、推理与报告")
    pr_analyze.add_argument("--repo", type=Path, required=True, help="本地 Git 仓库路径")
    pr_analyze.add_argument("--base", required=True, help="基准提交 SHA 或引用")
    pr_analyze.add_argument("--head", default="HEAD", help="目标提交 SHA 或引用；默认 HEAD")
    pr_analyze.add_argument("--model-id", required=True, help="目录库中明确选择的已登记模型 ID")
    pr_analyze.add_argument("--output", type=Path, required=True, help="JSON 报告输出路径")
    pr_analyze.add_argument("--markdown", type=Path, default=None, help="可选：同时写出 Markdown 报告")
    pr_analyze.add_argument("--database", type=Path, default=os.environ.get('JIT_CATALOG_DATABASE', None))
    pr_analyze.add_argument("--artifact-root", type=Path,
                            default=os.environ.get('JIT_ARTIFACT_ROOT', BACKEND / 'artifacts'))
    pr_analyze.add_argument("--max-commits", type=int, default=200, help="范围内提交数上限")
    serve = commands.add_parser("serve")
    serve.add_argument('--port', type=service_port, default=8000, help='本机服务端口；隔离验证应显式指定')
    from .catalog_storage import DEFAULT_DATABASE
    initialize = commands.add_parser('catalog-init')
    initialize.add_argument('--database', type=Path, default=os.environ.get('JIT_CATALOG_DATABASE', DEFAULT_DATABASE))
    initialize.add_argument('--artifact-root', type=Path,
                            default=os.environ.get('JIT_ARTIFACT_ROOT', BACKEND / 'artifacts'),
                            help='内置模型包的本地解包与登记根目录')
    bundled = initialize.add_mutually_exclusive_group()
    bundled.add_argument('--bundled-package', type=Path, default=None,
                         help='覆盖默认仓库内置模型包路径')
    bundled.add_argument('--skip-bundled-models', action='store_true',
                         help='只初始化目录库，不导入仓库内置模型包')
    reset_admin = commands.add_parser('admin-reset-password', help='在本机重置管理员密码并撤销其全部会话')
    reset_admin.add_argument('--database', type=Path, default=os.environ.get('JIT_CATALOG_DATABASE', DEFAULT_DATABASE))
    reset_admin.add_argument('--username', required=True)
    register = commands.add_parser('register-model')
    register.add_argument('--run-key', required=True)
    register.add_argument('--database', type=Path, default=os.environ.get('JIT_CATALOG_DATABASE', DEFAULT_DATABASE))
    register.add_argument('--artifact-root', type=Path, default=os.environ.get('JIT_ARTIFACT_ROOT', BACKEND / 'artifacts'))
    export_models = commands.add_parser('export-models')
    export_models.add_argument('model_ids', nargs='+', help='明确选择的已登记模型 ID')
    export_models.add_argument('--output', type=Path, required=True, help='模型包 ZIP 输出路径')
    export_models.add_argument('--database', type=Path, default=os.environ.get('JIT_CATALOG_DATABASE', DEFAULT_DATABASE))
    export_models.add_argument('--artifact-root', type=Path, default=os.environ.get('JIT_ARTIFACT_ROOT', BACKEND / 'artifacts'))
    import_models = commands.add_parser('import-models')
    import_models.add_argument('package', type=Path, help='模型包 ZIP')
    import_models.add_argument('--database', type=Path, default=os.environ.get('JIT_CATALOG_DATABASE', DEFAULT_DATABASE))
    import_models.add_argument('--artifact-root', type=Path, default=os.environ.get('JIT_ARTIFACT_ROOT', BACKEND / 'artifacts'))
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
    collect.add_argument('--szz', choices=['full', 'line', 'simple'], default='full',
                         help='标签规则：full 完整流程（默认），line 行级兼容，simple 文件级兼容')
    collect.add_argument('--root', type=Path, default=None, help='数据集登记目录；默认 backend/data/datasets')
    batch = commands.add_parser('collect-batch', help='多仓库采集批处理：创建、续跑、取消或查看状态')
    batch.add_argument('--manifest', type=Path, default=None, help='任务清单 JSON：[{repo, branch, since, until, limit, szz, dataset, language}]')
    batch.add_argument('--batch', default=None, help='既有批次标识；省略 --manifest 时用于续跑或查看')
    batch.add_argument('--state-root', type=Path, default=None, help='批次状态目录；默认 backend/artifacts/collection-batches')
    batch.add_argument('--root', type=Path, default=None, help='数据集登记目录；默认 backend/data/datasets')
    batch.add_argument('--retry-failed', action='store_true', help='续跑时重试失败仓库')
    batch.add_argument('--max-repos', type=int, default=None, help='本次最多执行的仓库数')
    batch.add_argument('--cancel', action='store_true', help='请求取消批次；停止后续仓库')
    batch.add_argument('--status', action='store_true', help='只输出状态，不执行')
    batch.add_argument('--no-register', action='store_true', help='只采集 CSV，不登记数据集')
    freeze = commands.add_parser("freeze-evidence")
    freeze.add_argument("target", type=Path)
    freeze.add_argument("--workspace", type=Path, default=None)
    check = commands.add_parser("check-evidence")
    check.add_argument("target", type=Path)
    sample = commands.add_parser("szz-sample")
    sample.add_argument("manifest", type=Path)
    sample.add_argument("--repo", default=None, help="可选：本地仓库路径，用于补全提交标题")
    sample.add_argument("--limit", type=int, default=100)
    sample.add_argument("--output", type=Path, required=True, help="复核表 CSV 输出路径")
    line_dataset = commands.add_parser("line-dataset")
    line_dataset.add_argument("manifest", type=Path)
    line_dataset.add_argument("--repo", default=None, help="本地仓库或缓存裸克隆；缺省读取数据集描述中的路径")
    line_dataset.add_argument("--output", type=Path, required=True, help="行级样本 JSONL 输出路径")
    line_dataset.add_argument("--negatives-per-positive", type=int, default=3)
    line_dataset.add_argument("--context", type=int, default=3)
    line_dataset.add_argument("--negative-mode", choices=["added-line", "same-file"], default="added-line")
    line_dataset.add_argument("--seed", type=int, default=42)
    line_candidates = commands.add_parser("line-candidates",
                                          help="导出完整候选集（全部新增/修改代码行）")
    line_candidates.add_argument("manifest", type=Path)
    line_candidates.add_argument("--repo", default=None, help="本地仓库或缓存裸克隆；缺省读取数据集描述中的路径")
    line_candidates.add_argument("--output", type=Path, required=True, help="候选 JSONL 输出路径")
    evaluate_candidates = commands.add_parser("evaluate-line-candidates",
                                              help="在完整候选总体上评价固定启发式与随机基线")
    evaluate_candidates.add_argument("--input", action="append", type=Path, required=True,
                                     help="可重复：候选 JSONL")
    evaluate_candidates.add_argument("--output", type=Path, required=True, help="评价报告 JSON")
    evaluate_candidates.add_argument("--cases", type=Path, default=None, help="可选：案例包 JSON 输出")
    evaluate_candidates.add_argument("--cases-limit", type=int, default=30)
    line_train = commands.add_parser("line-train")
    line_train.add_argument("--input", action="append", type=Path, required=True, help="可重复：line-szz-v1 JSONL")
    line_train.add_argument("--test-repo", default=None, help="留出整个仓库做跨项目测试")
    line_train.add_argument("--output", type=Path, required=True, help="指标报告 JSON")
    line_train.add_argument("--seed", type=int, default=42)
    line_train.add_argument("--model-output", type=Path, default=None, help="可选：另存 joblib 基线")
    line_train.add_argument("--include-commit-features", action="store_true", help="加入提交级 Kamei 特征（默认关闭以避免泄漏）")
    line_train.add_argument("--no-repo-balance", action="store_true", help="按原始样本量训练，不按仓库平衡")
    line_train.add_argument("--no-position-features", action="store_true", help="不把文件长度与行位置作为特征")
    line_train.add_argument("--language", action="append", default=None, help="只训练/评估这些语言，可重复")
    line_train.add_argument("--no-text", action="store_true", help="只用数值与语言特征，做文本特征消融")
    line_train.add_argument("--preview-model-output", type=Path, default=None,
                            help="导出可移植系数模型供研究预览；需配合 --no-text，且不含提交级特征")
    line_train.add_argument("--manifest", type=Path, default=None,
                            help="可移植实验 manifest 输出路径；默认与报告同名 .manifest.json")
    args = parser.parse_args()
    exit_code = 0
    try:
        if args.command == 'catalog-init':
            from .catalog import ModelCatalog
            from .catalog_storage import CatalogStorage, VERSION
            from .model_packages import BUNDLED_PACKAGE_PATH, import_bundled_model_package
            storage = CatalogStorage(args.database)
            storage.initialize()
            result = {'kind': 'catalog-initialized', 'version': VERSION}
            if args.skip_bundled_models:
                result['bundledPackage'] = {
                    'status': 'skipped',
                    'reason': 'disabled-by-option',
                    'skipped': True,
                }
            else:
                bundled_result = import_bundled_model_package(
                    ModelCatalog(storage, args.artifact_root),
                    args.bundled_package or BUNDLED_PACKAGE_PATH,
                )
                result['bundledPackage'] = bundled_result
                if bundled_result['status'] != 'completed':
                    exit_code = 1
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
        elif args.command == 'export-models':
            from .catalog import ModelCatalog
            from .catalog_storage import CatalogStorage
            from .model_packages import export_model_package
            result = export_model_package(
                ModelCatalog(CatalogStorage(args.database), args.artifact_root),
                args.model_ids, args.output,
            )
        elif args.command == 'import-models':
            from .catalog import ModelCatalog
            from .catalog_storage import CatalogStorage
            from .model_packages import import_model_package
            storage = CatalogStorage(args.database)
            storage.initialize()
            result = import_model_package(
                ModelCatalog(storage, args.artifact_root), args.package,
            )
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
                                                  with_text=args.with_text, szz=args.szz)
        elif args.command == 'collect-batch':
            from .batch_collection import BatchCollection
            from .config import BACKEND as _BACKEND
            service = BatchCollection(args.state_root or _BACKEND / 'artifacts/collection-batches',
                                      dataset_root=args.root)
            created = None
            if args.cancel:
                if not args.batch:
                    raise BaselineError("INPUT_INVALID", "取消需要 --batch")
                state = service.cancel(args.batch)
            elif args.batch:
                state = service.load(args.batch)
                if not args.status:
                    state = service.run(args.batch, retry_failed=args.retry_failed,
                                        max_repos=args.max_repos)
            elif args.manifest:
                payload = json.loads(args.manifest.read_text(encoding='utf-8'))
                tasks = payload.get('tasks') if isinstance(payload, dict) else payload
                state, created = service.create(tasks, register=not args.no_register)
                if not args.status:
                    state = service.run(state['batchId'], retry_failed=args.retry_failed,
                                        max_repos=args.max_repos)
            else:
                raise BaselineError("INPUT_INVALID", "需要 --manifest、--batch 或 --cancel")
            result = BatchCollection.summary(state)
            if created is not None:
                result['created'] = created
            if result['counts'].get('failed'):
                exit_code = 1
        elif args.command == 'szz-sample':
            import json as json_module
            from . import szz as szz_module
            manifest = json_module.loads(Path(args.manifest).read_text(encoding='utf-8'))
            rows = szz_module.sample_evidence(manifest, repo=args.repo, limit=args.limit)
            target = szz_module.write_sample_csv(rows, args.output)
            result = {'kind': 'szz-sample', 'rows': len(rows), 'output': str(target)}
        elif args.command == 'line-candidates':
            import json as json_module
            from . import line_candidates as candidates_module
            manifest = json_module.loads(args.manifest.read_text(encoding='utf-8'))
            summary = candidates_module.export_candidates(manifest, args.repo, args.output)
            result = {"kind": summary["format"], **summary, "output": str(args.output)}
        elif args.command == 'evaluate-line-candidates':
            from . import line_candidates as candidates_module
            report = candidates_module.evaluate_candidates(args.input, args.output)
            result = {"kind": report["format"], "output": str(args.output),
                      "repos": len(report["repos"])}
            if args.cases:
                result["cases"] = candidates_module.case_pack(
                    args.input, args.cases, limit=args.cases_limit)
        elif args.command == 'line-dataset':
            import json as json_module
            from . import line_dataset as line_module
            manifest = json_module.loads(Path(args.manifest).read_text(encoding='utf-8'))
            summary = line_module.build_line_dataset(
                manifest, args.output, repo=args.repo,
                negatives_per_positive=args.negatives_per_positive,
                context=args.context, seed=args.seed, negative_mode=args.negative_mode,
            )
            result = {'kind': 'line-dataset', **summary, 'output': str(args.output)}
        elif args.command == 'line-train':
            from . import line_train as train_module
            report = train_module.train_line_baseline(
                args.input, args.output, test_repo=args.test_repo, seed=args.seed,
                model_output=args.model_output,
                include_commit_features=args.include_commit_features,
                repo_balance=not args.no_repo_balance,
                position_features=not args.no_position_features,
                languages=args.language,
                manifest_output=args.manifest,
                text_features=not args.no_text,
                preview_output=args.preview_model_output,
            )
            result = {'kind': 'line-model-report', 'samples': report['samples'],
                      'metrics': report['metrics'], 'localization': report['localization'],
                      'byRepo': report['byRepo'], 'byLanguage': report['byLanguage'],
                      'manifest': str(args.manifest or Path(args.output).with_suffix('.manifest.json')),
                      'output': str(args.output)}
        elif args.command == "fetch":
            result = fetch_sources(BACKEND / "data/openstack")
        elif args.command == "run":
            params = None
            if args.params:
                try:
                    params = json.loads(args.params)
                except json.JSONDecodeError as exc:
                    raise BaselineError("INPUT_INVALID", "参数覆盖不是合法 JSON") from exc
            manifest = build_run(BACKEND / "data/openstack", args.output, args.schema, args.algorithm,
                                 metric_set=args.metric_set,
                                 dataset_manifest=args.dataset_manifest, holdout=args.holdout,
                                 embedding_dir=args.embedding_dir,
                                 split_preset=args.split_preset, params=params)
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
        elif args.command == "run-multi-project":
            report_path = args.output / "multi-project-report.json"
            result = run_multi_project(args.dataset_manifest, report_path,
                                       methods=args.methods, metric_set=args.metric_set)
        elif args.command == "run-evaluation-matrix":
            from . import evaluation_matrix
            specs = []
            for item in args.data:
                if "=" not in item:
                    raise BaselineError("INPUT_INVALID", "--data 需要 语言=路径")
                language, path = item.split("=", 1)
                specs.append((language, path))
            methods = args.methods or evaluation_matrix.FROZEN_METHODS
            seeds = tuple(args.seed) if args.seed else evaluation_matrix.FROZEN_SEEDS
            report = evaluation_matrix.run_matrix(specs, args.output,
                                                  methods=methods, seeds=seeds)
            result = {"kind": report["format"], "output": str(args.output),
                      "status": report["status"],
                      "summary": evaluation_matrix.summarize(report),
                      "protocolSha256": report["protocolSha256"]}
        elif args.command == "evaluate-benefit":
            report, path = run_benefit(args.run, args.output,
                                       random_runs=args.random_runs, seed=args.seed)
            result = {"kind": report["kind"], "runId": report["artifact"]["runId"],
                      "artifact": report["artifact"]["artifactPath"],
                      "test": report["test"], "conclusion": report["conclusion"],
                      "reportPath": str(path)}
        elif args.command == "diagnose-model":
            from .model_diagnostics import generate_report, write_report
            report = generate_report(args.run, dataset_root=args.dataset_root)
            report, path, created = write_report(report, args.output)
            result = {
                "kind": report["kind"],
                "artifactRunId": report["artifactRunId"],
                "created": created,
                "reportPath": str(path),
                "metricsByPartition": report["metricsByPartition"],
            }
        elif args.command == "pr-check-export":
            from . import pr_check
            from .catalog_storage import CatalogStorage, DEFAULT_DATABASE
            bundle = pr_check.export_bundle(CatalogStorage(args.database or DEFAULT_DATABASE),
                                            args.snapshot, args.analysis)
            write_json(args.output, bundle)
            result = {"kind": bundle["format"], "output": str(args.output),
                      "commits": len(bundle["commits"])}
        elif args.command == "pr-check-report":
            from . import pr_check
            bundle = json.loads(args.bundle.read_text(encoding="utf-8"))
            report, path = pr_check.write_report(bundle, args.output, args.format)
            result = {"kind": report["format"], "output": str(path),
                      "commits": len(report["commits"])}
        elif args.command == "pr-check-analyze":
            from . import commit_analysis
            from .catalog import ModelCatalog
            from .catalog_storage import CatalogStorage, DEFAULT_DATABASE
            catalog = ModelCatalog(CatalogStorage(args.database or DEFAULT_DATABASE),
                                   args.artifact_root)
            report = commit_analysis.analyze(
                args.repo, args.base, args.head, catalog, args.model_id,
                max_commits=args.max_commits)
            commit_analysis.write_report(report, args.output, args.markdown)
            result = {"kind": report["format"], "analysisId": report["analysisId"],
                      "contentSha256": report["contentSha256"],
                      "commits": len(report["commits"]),
                      "candidates": len(report["candidates"]),
                      "output": str(args.output)}
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
        if exit_code:
            sys.exit(exit_code)
    except (BaselineError, OSError) as exc:
        print(json.dumps({"error": getattr(exc, "code", "IO_ERROR"), "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(getattr(exc, "exit_code", 1))


if __name__ == "__main__":
    main()
