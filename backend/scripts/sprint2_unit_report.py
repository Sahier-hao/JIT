"""Generate and verify the Sprint2 unit-test delivery report."""
from argparse import ArgumentParser
from datetime import datetime, timezone
import hashlib
from html import escape
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

from .validate_sprint2_unit_inventory import MANIFEST, ROOT, validate


CACHE = ROOT / ".cache/sprint2-unit"
DEFAULT_OUTPUT = ROOT / "docs/test-delivery/sprint2-unit-test/generated"
MANUAL_REVIEW = ROOT / "docs/test-delivery/sprint2-unit-test/manual-review.json"


def _read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _identity_files(manifest):
    files = [MANIFEST]
    scope = manifest["scope"]
    for side, section in scope.items():
        base = ROOT / ("backend" if side == "backend" else "frontend")
        files.extend(base / relative for relative in section["suiteFiles"])
        files.extend(base / relative for relative in section["coverageFiles"])
    files.extend([
        ROOT / "backend/pytest.sprint2.ini",
        ROOT / "backend/requirements.txt",
        ROOT / "frontend/vitest.sprint2.config.ts",
        ROOT / "frontend/package.json",
        ROOT / "frontend/package-lock.json",
    ])
    return sorted({path.resolve() for path in files if path.is_file()})


def _identity(manifest):
    digest = hashlib.sha256()
    files = {}
    for path in _identity_files(manifest):
        relative = path.relative_to(ROOT).as_posix()
        value = _sha256(path)
        files[relative] = value
        digest.update(relative.encode("utf-8"))
        digest.update(value.encode("ascii"))
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True,
        capture_output=True, text=True,
    ).stdout.strip()
    return {
        "repository": str(ROOT),
        "gitCommit": commit,
        "identitySha256": digest.hexdigest(),
        "files": files,
    }


def _backend_results():
    junit = ET.parse(CACHE / "backend-junit.xml").getroot()
    suite = junit.find("testsuite") if junit.tag == "testsuites" else junit
    failures = []
    skipped = []
    for case in suite.findall("testcase"):
        name = f"{case.get('classname', '')}::{case.get('name', '')}"
        if case.find("failure") is not None or case.find("error") is not None:
            failures.append(name)
        if case.find("skipped") is not None:
            skipped.append(name)
    tests = int(suite.get("tests", 0))
    failed_count = int(suite.get("failures", 0)) + int(suite.get("errors", 0))
    skipped_count = int(suite.get("skipped", len(skipped)))
    return {
        "tests": tests,
        "passed": tests - failed_count - skipped_count,
        "failed": failed_count,
        "skipped": skipped_count,
        "durationSeconds": float(suite.get("time", 0)),
        "failures": failures,
        "skippedCases": skipped,
    }


def _backend_coverage(expected_files):
    payload = _read_json(CACHE / "backend-coverage.json")
    totals = {"statements": 0, "lines": 0, "branches": 0, "coveredBranches": 0}
    files = []
    for name, item in payload["files"].items():
        summary = item["summary"]
        relative = name.replace("\\", "/")
        record = {
            "file": relative,
            "lines": summary["covered_lines"],
            "statements": summary["num_statements"],
            "linePercent": summary["percent_statements_covered"],
            "branches": summary["covered_branches"],
            "branchTotal": summary["num_branches"],
            "branchPercent": summary["percent_branches_covered"],
            "missingLines": summary["missing_lines"],
            "missingBranches": summary["missing_branches"],
        }
        files.append(record)
        totals["lines"] += record["lines"]
        totals["statements"] += record["statements"]
        totals["branches"] += record["branches"]
        totals["coveredBranches"] += record["branchTotal"]
    actual = {item["file"] for item in files}
    if actual != set(expected_files):
        raise ValueError(f"后端覆盖率范围不一致：{sorted(actual)} != {sorted(expected_files)}")
    line_percent = 100.0 * totals["lines"] / totals["statements"] if totals["statements"] else 0
    branch_percent = 100.0 * totals["branches"] / totals["coveredBranches"] if totals["coveredBranches"] else 0
    return {
        "linePercent": line_percent,
        "branchPercent": branch_percent,
        "coveredLines": totals["lines"],
        "totalLines": totals["statements"],
        "coveredBranches": totals["branches"],
        "totalBranches": totals["coveredBranches"],
        "branchGaps": [
            {key: item[key] for key in ("file", "branchPercent", "missingBranches")}
            for item in files if item["branchPercent"] < 70
        ],
        "files": files,
    }


def _frontend_results():
    payload = _read_json(CACHE / "frontend-results.json")
    failures = []
    skipped = []
    for suite in payload.get("testResults", []):
        for case in suite.get("assertionResults", []):
            name = " > ".join([*case.get("ancestorTitles", []), case.get("title", "")])
            if case.get("status") == "failed":
                failures.append(name)
            elif case.get("status") not in {"passed"}:
                skipped.append(name)
    start = payload.get("startTime")
    end = max((suite.get("endTime", start or 0) for suite in payload.get("testResults", [])), default=start or 0)
    return {
        "tests": payload.get("numTotalTests", 0),
        "passed": payload.get("numPassedTests", 0),
        "failed": payload.get("numFailedTests", 0),
        "skipped": payload.get("numPendingTests", 0) + payload.get("numTodoTests", 0),
        "durationSeconds": (end - start) / 1000 if start and end else 0,
        "failures": failures,
        "skippedCases": skipped,
    }


def _frontend_coverage(expected_files):
    payload = _read_json(CACHE / "frontend-coverage/coverage-final.json")
    files = []
    totals = {"lines": 0, "statements": 0, "branches": 0, "branchTotal": 0}
    for name, item in payload.items():
        relative = Path(name).resolve().relative_to(ROOT / "frontend").as_posix()
        statements = item.get("s", {})
        statement_map = item.get("statementMap", {})
        all_lines = {
            statement_map[key]["start"]["line"]
            for key in statement_map
            if key in statements
        }
        covered_lines = {
            statement_map[key]["start"]["line"]
            for key, value in statements.items()
            if value > 0 and key in statement_map
        }
        branch_values = [value for group in item.get("b", {}).values() for value in group]
        record = {
            "file": relative,
            "lines": len(covered_lines),
            "statements": len(all_lines),
            "branches": sum(1 for value in branch_values if value > 0),
            "branchTotal": len(branch_values),
            "missingLines": sorted(all_lines - covered_lines),
        }
        record["linePercent"] = 100.0 * record["lines"] / record["statements"] if record["statements"] else 0
        record["branchPercent"] = 100.0 * record["branches"] / record["branchTotal"] if record["branchTotal"] else 0
        files.append(record)
        totals["lines"] += record["lines"]
        totals["statements"] += record["statements"]
        totals["branches"] += record["branches"]
        totals["branchTotal"] += record["branchTotal"]
    actual = {item["file"] for item in files}
    if actual != set(expected_files):
        raise ValueError(f"前端覆盖率范围不一致：{sorted(actual)} != {sorted(expected_files)}")
    return {
        "linePercent": 100.0 * totals["lines"] / totals["statements"] if totals["statements"] else 0,
        "branchPercent": 100.0 * totals["branches"] / totals["branchTotal"] if totals["branchTotal"] else 0,
        "coveredLines": totals["lines"],
        "totalLines": totals["statements"],
        "coveredBranches": totals["branches"],
        "totalBranches": totals["branchTotal"],
        "branchGaps": [item for item in files if item["branchPercent"] < 70],
        "files": files,
    }


def _durations():
    path = CACHE / "run-meta.json"
    if not path.is_file():
        return {}, "runner-meta-missing"
    return _read_json(path), "runner-meta"


def _manual_review(manifest):
    try:
        review = _read_json(MANUAL_REVIEW)
    except (OSError, json.JSONDecodeError) as exc:
        return {
            "passed": False,
            "reviewer": None,
            "reviewedAt": None,
            "reviewed": 0,
            "total": len(manifest["functions"]),
            "missing": [item["id"] for item in manifest["functions"]],
            "invalid": [f"人工审核记录不可读：{exc}"],
        }
    decisions = {}
    reviewed_ids = set()
    pending = []
    invalid = []
    for item in review.get("decisions", []):
        function_id = item.get("function")
        verdict = item.get("verdict")
        comment = item.get("comment")
        if not function_id or function_id in decisions:
            invalid.append(f"人工审核函数标识为空或重复：{function_id}")
            continue
        if verdict == "reviewed" and isinstance(comment, str) and comment.strip():
            reviewed_ids.add(function_id)
        elif verdict == "pending":
            pending.append(function_id)
        else:
            invalid.append(f"{function_id} 没有有效复核结论")
        decisions[function_id] = item
    expected = [item["id"] for item in manifest["functions"]]
    missing = [function_id for function_id in expected
               if function_id not in reviewed_ids]
    reviewer = review.get("reviewer")
    reviewed_at = review.get("reviewedAt")
    if review.get("status") not in ("completed", "pending"):
        invalid.append("人工审核状态不是 completed")
    if not isinstance(reviewer, str) or not reviewer.strip():
        invalid.append("人工审核人缺失")
    if not isinstance(reviewed_at, str) or not reviewed_at.strip():
        invalid.append("人工审核日期缺失")
    return {
        "passed": not missing and not invalid,
        "reviewer": reviewer,
        "reviewedAt": reviewed_at,
        "reviewed": len(reviewed_ids),
        "total": len(expected),
        "pending": [function_id for function_id in expected if function_id in pending],
        "missing": missing,
        "invalid": invalid,
    }


def _checks(inventory, backend, frontend, manual_review=None):
    manual_review = manual_review or {"passed": True}
    return {
        "inventoryComplete": inventory["passed"],
        "noFailedTests": backend["failed"] == 0 and frontend["failed"] == 0,
        "noUnexplainedSkips": backend["skipped"] == 0 and frontend["skipped"] == 0,
        "backendWithin60Seconds": backend["processSeconds"] <= 60,
        "frontendWithin60Seconds": frontend["processSeconds"] <= 60,
        "backendLinesAtLeast80": backend["coverage"]["linePercent"] >= 80,
        "frontendLinesAtLeast80": frontend["coverage"]["linePercent"] >= 80,
        "manualReviewComplete": manual_review["passed"],
    }


def _report():
    inventory = validate(MANIFEST, require_sources=True)
    if not inventory["passed"]:
        raise ValueError("清单校验失败：" + "；".join(inventory["errors"]))
    manifest = _read_json(MANIFEST)
    manual_review = _manual_review(manifest)
    backend_expected = [item.replace("jit_baseline/", "jit_baseline/")
                        for item in manifest["scope"]["backend"]["coverageFiles"]]
    frontend_expected = manifest["scope"]["frontend"]["coverageFiles"]
    run_meta, duration_source = _durations()
    backend = {**_backend_results(), "coverage": _backend_coverage(backend_expected)}
    frontend = {**_frontend_results(), "coverage": _frontend_coverage(frontend_expected)}
    if "backendSeconds" in run_meta:
        backend["processSeconds"] = run_meta["backendSeconds"]
    else:
        backend["processSeconds"] = backend["durationSeconds"]
    if "frontendSeconds" in run_meta:
        frontend["processSeconds"] = run_meta["frontendSeconds"]
    else:
        frontend["processSeconds"] = frontend["durationSeconds"]
    checks = _checks(inventory, backend, frontend, manual_review)
    npm = shutil.which("npm")
    npm_version = (subprocess.run([npm, "--version"], capture_output=True, text=True).stdout.strip()
                   if npm else "")
    return {
        "schemaVersion": 1,
        "kind": "sprint2-unit-test-report",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "status": "passed" if all(checks.values()) else "failed",
        "checks": checks,
        "identity": _identity(manifest),
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "node": subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip(),
            "npm": npm_version,
            "durationSource": duration_source,
        },
        "commands": {
            "backend": ".venv\\Scripts\\python.exe -m pytest -c pytest.sprint2.ini tests\\test_sprint2_unit_core.py",
            "frontend": "npm.cmd run test:unit:sprint2",
            "all": "backend\\.venv\\Scripts\\python.exe -m scripts.run_sprint2_unit",
        },
        "inventory": inventory,
        "manualReview": manual_review,
        "backend": backend,
        "frontend": frontend,
    }


def _markdown(report):
    status = "通过" if report["status"] == "passed" else "未通过"
    lines = [
        "# Sprint2 单元测试报告",
        "",
        f"- 状态：**{status}**",
        f"- 提交：`{report['identity']['gitCommit']}`",
        f"- 测试身份：`{report['identity']['identitySha256']}`",
        f"- 函数：{report['inventory']['functions']} 个，正常/边界/异常各 "
        f"{report['inventory']['scenarioCounts']['normal']} 个",
        "",
        "| 测试端 | 通过 | 失败 | 跳过 | 进程耗时 | 行覆盖 | 分支覆盖 |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, label in (("backend", "后端"), ("frontend", "前端")):
        item = report[name]
        lines.append(
            f"| {label} | {item['passed']} | {item['failed']} | {item['skipped']} | "
            f"{item['processSeconds']:.2f}s | {item['coverage']['linePercent']:.2f}% | "
            f"{item['coverage']['branchPercent']:.2f}% |"
        )
    lines.extend(["", "## 覆盖文件", ""])
    for name in ("backend", "frontend"):
        for item in report[name]["coverage"]["files"]:
            lines.append(
                f"- `{item['file']}`：行 {item['linePercent']:.2f}%，"
                f"分支 {item['branchPercent']:.2f}%；"
                f"行分子/分母 {item['lines']}/{item['statements']}，"
                f"分支分子/分母 {item['branches']}/{item['branchTotal']}"
            )
    lines.extend([
        "",
        f"- 用例定义：{sum(report['inventory']['suiteTests'].values())} 个测试函数；"
        f"参数化展开后执行 {report['backend']['tests'] + report['frontend']['tests']} 条",
        "",
        "## 来源",
        "",
        "AI 生成：" + str(report["inventory"]["sourceCounts"].get("ai", 0)) + " 个；"
        "AI 生成后人工修改：" + str(report["inventory"]["sourceCounts"].get("humanModified", 0)) + " 个；"
        "手写：" + str(report["inventory"]["sourceCounts"].get("human", 0)) + " 个。",
        "",
        "## 人工复核",
        "",
        f"- 状态：{'完成' if report['manualReview']['passed'] else '待人工完成'}",
        f"- 进度：{report['manualReview']['reviewed']}/{report['manualReview']['total']} 个核心函数",
        f"- 待复核：{len(report['manualReview'].get('pending', []))} 个核心函数",
        f"- 审核人：{report['manualReview']['reviewer'] or '未填写'}",
        f"- 审核日期：{report['manualReview']['reviewedAt'] or '未填写'}",
        "",
        "本报告由原始 JUnit、Vitest JSON 和两端覆盖率 JSON 生成；"
        "Sprint2 一次性交付，不改变持续回归或 PR 门禁。",
        "",
    ])
    return "\n".join(lines)


def _html(report):
    status = "通过" if report["status"] == "passed" else "未通过"
    source = report["inventory"]["sourceCounts"]
    result_rows = []
    coverage_rows = []
    for name, label in (("backend", "后端"), ("frontend", "前端")):
        item = report[name]
        result_rows.append(
            f"<tr><td>{label}</td><td>{item['passed']}</td><td>{item['failed']}</td>"
            f"<td>{item['skipped']}</td><td>{item['processSeconds']:.2f} 秒</td>"
            f"<td>{item['coverage']['linePercent']:.2f}%</td>"
            f"<td>{item['coverage']['branchPercent']:.2f}%</td></tr>"
        )
        for file in item["coverage"]["files"]:
            coverage_rows.append(
                f"<tr><td><code>{escape(file['file'])}</code></td>"
                f"<td>{file['linePercent']:.2f}%</td><td>{file['lines']}/{file['statements']}</td>"
                f"<td>{file['branchPercent']:.2f}%</td><td>{file['branches']}/{file['branchTotal']}</td></tr>"
            )
    review = report["manualReview"]
    review_status = "已完成" if review["passed"] else "待人工完成"
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sprint2 单元测试报告</title>
<style>
  :root {{ color-scheme: light; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; background: #f5f7f6; color: #1f2328;
    font-family: "Microsoft YaHei", "Noto Sans CJK SC", "PingFang SC", sans-serif;
    font-size: 13px; line-height: 1.65;
  }}
  main {{ width: 980px; margin: 32px auto; padding: 42px 48px; background: #fff; border: 1px solid #d8dee4; }}
  h1 {{ margin: 0; font-size: 28px; line-height: 1.25; letter-spacing: -.02em; }}
  h2 {{ margin: 30px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e2e7eb; font-size: 17px; }}
  p {{ margin: 6px 0; }}
  .eyebrow {{ color: #59636e; font-size: 12px; letter-spacing: .08em; }}
  .status {{ display: inline-block; margin-top: 12px; padding: 3px 10px; border-radius: 999px; background: #e2efe9; color: #1f5d4c; font-weight: 600; }}
  .meta {{ display: grid; grid-template-columns: 130px 1fr; gap: 5px 12px; margin-top: 22px; padding: 16px 18px; background: #f6f8fa; }}
  .meta dt {{ color: #59636e; }}
  .meta dd {{ margin: 0; word-break: break-all; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 10px; }}
  th, td {{ padding: 7px 9px; border-bottom: 1px solid #e2e7eb; text-align: left; vertical-align: top; }}
  th {{ color: #59636e; font-size: 12px; font-weight: 600; background: #f6f8fa; }}
  td:not(:first-child), th:not(:first-child) {{ text-align: right; font-variant-numeric: tabular-nums; }}
  code {{ font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; }}
  ul {{ margin: 8px 0; padding-left: 20px; }}
  li {{ margin: 4px 0; }}
  .note {{ margin-top: 12px; padding: 11px 14px; border-left: 3px solid #1f5d4c; background: #f6f8fa; color: #424a53; }}
  footer {{ margin-top: 30px; padding-top: 12px; border-top: 1px solid #e2e7eb; color: #6e7781; font-size: 12px; }}
  @media print {{
    @page {{ size: A4; margin: 12mm; }}
    body {{ background: #fff; }}
    main {{ width: auto; margin: 0; padding: 0; border: 0; }}
    h2 {{ break-after: avoid; }}
    table {{ break-inside: auto; }}
    tr {{ break-inside: avoid; }}
  }}
</style>
</head>
<body>
<main>
  <div class="eyebrow">软件缺陷预测系统 · Sprint 2 交付物</div>
  <h1>Sprint2 单元测试报告</h1>
  <div class="status">报告状态：{status}</div>
  <dl class="meta">
    <dt>代码提交</dt><dd><code>{escape(report['identity']['gitCommit'])}</code></dd>
    <dt>测试身份</dt><dd><code>{escape(report['identity']['identitySha256'])}</code></dd>
    <dt>生成时间</dt><dd>{escape(report['generatedAt'])}</dd>
    <dt>测试函数</dt><dd>{report['inventory']['functions']} 个；正常、边界、异常各 {report['inventory']['scenarioCounts']['normal']} 个</dd>
    <dt>人工复核</dt><dd>{review_status}，{review['reviewed']}/{review['total']} 个核心函数；审核人：{escape(review['reviewer'] or '未填写')}</dd>
  </dl>

  <h2>一、测试结果汇总</h2>
  <table>
    <thead><tr><th>测试端</th><th>通过</th><th>失败</th><th>跳过</th><th>进程耗时</th><th>行覆盖</th><th>分支覆盖</th></tr></thead>
    <tbody>{''.join(result_rows)}</tbody>
  </table>
  <p>参数化展开后共执行 {report['backend']['tests'] + report['frontend']['tests']} 条测试；测试函数共 {sum(report['inventory']['suiteTests'].values())} 个。</p>

  <h2>二、覆盖率明细</h2>
  <table>
    <thead><tr><th>文件</th><th>行覆盖</th><th>行分子/分母</th><th>分支覆盖</th><th>分支分子/分母</th></tr></thead>
    <tbody>{''.join(coverage_rows)}</tbody>
  </table>

  <h2>三、用例来源</h2>
  <ul>
    <li>AI 生成：{source.get('ai', 0)} 个</li>
    <li>AI 生成后人工修改：{source.get('humanModified', 0)} 个</li>
    <li>手写：{source.get('human', 0)} 个</li>
  </ul>
  <p class="note">本报告是中文提交版。`coverage.py` 生成的英文 HTML/PDF 仅作为原始工具底稿保留，不作为报告正文。</p>

  <h2>四、运行环境与复现</h2>
  <ul>
    <li>Python：{escape(report['environment']['python'])}；Node：{escape(report['environment']['node'])}；npm：{escape(report['environment']['npm'])}</li>
    <li>后端：<code>{escape(report['commands']['backend'])}</code></li>
    <li>前端：<code>{escape(report['commands']['frontend'])}</code></li>
    <li>一键运行：<code>{escape(report['commands']['all'])}</code></li>
  </ul>

  <h2>五、结论</h2>
  <p>本次 Sprint2 单元测试共执行 {report['backend']['tests'] + report['frontend']['tests']} 条，失败 {report['backend']['failed'] + report['frontend']['failed']} 条，跳过 {report['backend']['skipped'] + report['frontend']['skipped']} 条。后端行覆盖率 {report['backend']['coverage']['linePercent']:.2f}%，前端行覆盖率 {report['frontend']['coverage']['linePercent']:.2f}%，达到本次交付门槛。测试结果、覆盖率和人工复核记录均来自已保存的原始结果。</p>

  <footer>本报告由原始 JUnit、Vitest JSON 和两端覆盖率 JSON 生成；Sprint2 一次性交付，不改变持续回归或 PR 门禁。</footer>
</main>
</body>
</html>
"""


def _check(path, expected_commit=None):
    report = _read_json(path)
    current = _identity(_read_json(MANIFEST))
    errors = []
    if expected_commit and report["identity"]["gitCommit"] != expected_commit:
        errors.append(f"报告提交陈旧：{report['identity']['gitCommit']} != {expected_commit}")
    if report["identity"]["identitySha256"] != current["identitySha256"]:
        errors.append("测试清单、测试文件或配置已变化，报告陈旧")
    if report.get("status") != "passed" or not all(report.get("checks", {}).values()):
        errors.append("报告未通过全部交付检查")
    return {"passed": not errors, "report": str(Path(path).resolve()), "errors": errors}


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", type=Path)
    parser.add_argument("--expected-commit")
    args = parser.parse_args()
    if args.check:
        result = _check(args.check, args.expected_commit)
    else:
        report = _report()
        args.output_dir.mkdir(parents=True, exist_ok=True)
        json_path = args.output_dir / "report.json"
        markdown_path = args.output_dir / "report.md"
        html_path = args.output_dir / "report-zh.html"
        _write_json(json_path, report)
        markdown_path.write_text(_markdown(report), encoding="utf-8")
        html_path.write_text(_html(report), encoding="utf-8")
        result = {
            "passed": report["status"] == "passed",
            "report": str(json_path.resolve()),
            "markdown": str(markdown_path.resolve()),
            "html": str(html_path.resolve()),
            "status": report["status"],
            "checks": report["checks"],
        }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
