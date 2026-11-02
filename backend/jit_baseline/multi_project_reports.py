"""Read-only access to existing multi-project experiment reports.

Reports are produced offline by ``jit_baseline.cli run-multi-project`` and are
never trained or modified here. The browser only supplies a content-derived
identifier; every filesystem path comes from the configured report roots.
"""
import hashlib
import json
import os
from pathlib import Path

from .config import BACKEND
from .errors import BaselineError
from .multi_project import REPORT_KIND, REPORT_VERSION

REPO_ROOT = BACKEND.parent
DEFAULT_LIMIT = 8 * 1024 * 1024
REPORT_FILE = 'multi-project-report.json'
STATUSES = ('complete', 'partial', 'failed', 'invalid')


def default_roots():
    configured = os.environ.get('JIT_MULTI_PROJECT_REPORT_ROOT')
    if configured:
        return [Path(item) for item in configured.split(os.pathsep) if item.strip()]
    roots = [BACKEND / 'artifacts/multi-project']
    evidence = REPO_ROOT / 'docs/evidence'
    if evidence.is_dir():
        roots.append(evidence)
    return roots


def _display_path(path, root):
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return f'{root.name}/{path.resolve().relative_to(root.resolve()).as_posix()}'


def _normalized_status(report):
    results = report.get('results')
    if not isinstance(results, dict) or not results:
        return 'failed'
    statuses = [protocol.get('status')
                for method in results.values() if isinstance(method, dict)
                for protocol in method.values() if isinstance(protocol, dict)]
    if not any(status == 'complete' for status in statuses):
        return 'failed'
    if report.get('failures') or any(status != 'complete' for status in statuses):
        return 'partial'
    return 'complete'


def _counts(report):
    projects = report.get('projects') if isinstance(report.get('projects'), list) else []
    methods = report.get('methods') if isinstance(report.get('methods'), list) else []
    protocols = report.get('protocols') if isinstance(report.get('protocols'), list) else []
    failures = report.get('failures') if isinstance(report.get('failures'), list) else []
    results = report.get('results') if isinstance(report.get('results'), dict) else {}
    protocol_statuses = [protocol.get('status')
                         for method in results.values() if isinstance(method, dict)
                         for protocol in method.values() if isinstance(protocol, dict)]
    return {
        'projectCount': len(projects),
        'failedProjectCount': sum(1 for project in projects
                                  if isinstance(project, dict) and project.get('status') != 'succeeded'),
        'failureCount': len(failures),
        'methodCount': len(methods),
        'protocolCount': len(protocols),
        'resultCount': sum(len(protocol.get('targets') or [])
                           for method in results.values() if isinstance(method, dict)
                           for protocol in method.values() if isinstance(protocol, dict)),
        'partialProtocolCount': sum(1 for status in protocol_statuses if status == 'partial'),
        'completeProtocolCount': sum(1 for status in protocol_statuses if status == 'complete'),
        'failedProtocolCount': sum(1 for status in protocol_statuses if status == 'failed'),
    }


def _validate(report):
    if not isinstance(report, dict):
        raise BaselineError('REPORT_INVALID', '报告根节点必须是对象')
    if report.get('kind') != REPORT_KIND:
        raise BaselineError('REPORT_INVALID', '报告类型不是多项目训练报告')
    if report.get('reportVersion') != REPORT_VERSION:
        raise BaselineError('REPORT_INVALID', '报告版本不受支持')
    for key in ('generatedUtc', 'schema', 'metricSet'):
        if not isinstance(report.get(key), str) or not report[key]:
            raise BaselineError('REPORT_INVALID', f'报告缺少 {key}')
    for key in ('protocols', 'methods', 'projects', 'failures'):
        if not isinstance(report.get(key), list):
            raise BaselineError('REPORT_INVALID', f'报告字段 {key} 结构无效')
    if not isinstance(report.get('results'), dict):
        raise BaselineError('REPORT_INVALID', '报告缺少 results')
    if not isinstance(report.get('boundary'), dict):
        raise BaselineError('REPORT_INVALID', '报告缺少边界说明')
    return report


class MultiProjectReportService:
    """List and load frozen reports from fixed roots; never writes or trains."""

    def __init__(self, roots=None, *, limit=DEFAULT_LIMIT):
        self.roots = [Path(root) for root in (roots if roots is not None else default_roots())]
        self.limit = limit

    def _files(self):
        seen = {}
        for root in self.roots:
            try:
                resolved = root.resolve()
            except OSError:
                continue
            if not resolved.is_dir():
                continue
            for path in sorted(resolved.glob(f'**/{REPORT_FILE}')):
                try:
                    if not path.is_file() or path.stat().st_size > self.limit:
                        continue
                    real = path.resolve()
                    if not real.is_relative_to(resolved):
                        continue
                    blob = real.read_bytes()
                except OSError:
                    continue
                identity = hashlib.sha256(blob).hexdigest()[:24]
                seen.setdefault(identity, (real, root, blob))
        return seen

    def _load(self, identity, path, root, blob):
        entry = {'reportId': identity, 'source': _display_path(path, root)}
        try:
            report = _validate(json.loads(blob.decode('utf-8')))
        except (UnicodeError, ValueError) as exc:
            raise BaselineError('REPORT_INVALID', f'报告不是有效的 UTF-8 JSON：{exc}') from exc
        except BaselineError as exc:
            entry.update(status='invalid', reportStatus=None, generatedUtc=None,
                         schema=None, metricSet=None, protocols=[], methods=[],
                         **_counts({}), error={'code': exc.code, 'message': str(exc)})
            return entry, None
        entry.update(status=_normalized_status(report), reportStatus=report.get('status'),
                     generatedUtc=report.get('generatedUtc'), schema=report.get('schema'),
                     metricSet=report.get('metricSet'), protocols=report.get('protocols'),
                     methods=report.get('methods'), **_counts(report), error=None)
        return entry, report

    def list(self):
        reports = []
        for identity, (path, root, blob) in self._files().items():
            try:
                entry, _ = self._load(identity, path, root, blob)
            except BaselineError as exc:
                entry = {'reportId': identity, 'source': _display_path(path, root),
                         'status': 'invalid', 'reportStatus': None, 'generatedUtc': None,
                         'schema': None, 'metricSet': None, 'protocols': [], 'methods': [],
                         **_counts({}), 'error': {'code': exc.code, 'message': str(exc)}}
            reports.append(entry)
        reports.sort(key=lambda item: (item.get('generatedUtc') or '', item['reportId']), reverse=True)
        return {'reports': reports, 'total': len(reports)}

    def get(self, report_id):
        if not isinstance(report_id, str) or not report_id.strip():
            raise BaselineError('REPORT_NOT_FOUND', '多项目实验报告不存在')
        found = self._files().get(report_id.strip())
        if found is None:
            raise BaselineError('REPORT_NOT_FOUND', '多项目实验报告不存在')
        path, root, blob = found
        entry, report = self._load(report_id.strip(), path, root, blob)
        if report is None:
            raise BaselineError('REPORT_INVALID', entry['error']['message'])
        return {**entry, 'report': report}
