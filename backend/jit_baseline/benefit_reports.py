"""Read-only lookup of frozen model benefit reports by artifact run identity."""
import hashlib
import json
import os
from pathlib import Path

from .benefit import BENEFIT_FILE, REPORT_KIND, REPORT_VERSION
from .config import BACKEND
from .errors import BaselineError

REPO_ROOT = BACKEND.parent
DEFAULT_LIMIT = 8 * 1024 * 1024


def default_roots():
    configured = os.environ.get('JIT_BENEFIT_REPORT_ROOT')
    if configured:
        return [Path(item) for item in configured.split(os.pathsep) if item.strip()]
    roots = [BACKEND / 'artifacts/benefit']
    evidence = REPO_ROOT / 'docs/evidence'
    if evidence.is_dir():
        roots.append(evidence)
    return roots


def _display_path(path, root):
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return f'{root.name}/{path.resolve().relative_to(root.resolve()).as_posix()}'


def _validate(report):
    if not isinstance(report, dict):
        raise BaselineError('REPORT_INVALID', '收益评估报告根节点必须是对象')
    if report.get('kind') != REPORT_KIND:
        raise BaselineError('REPORT_INVALID', '不是模型收益评估报告')
    if report.get('reportVersion') != REPORT_VERSION:
        raise BaselineError('REPORT_INVALID', '收益评估报告版本不受支持')
    artifact = report.get('artifact')
    if not isinstance(artifact, dict) or not isinstance(artifact.get('runId'), str) or not artifact['runId']:
        raise BaselineError('REPORT_INVALID', '收益评估报告缺少模型运行身份')
    for key in ('test', 'strategies', 'conclusion', 'boundary'):
        if not isinstance(report.get(key), dict):
            raise BaselineError('REPORT_INVALID', f'收益评估报告缺少 {key}')
    if not isinstance(report.get('limitations'), list):
        raise BaselineError('REPORT_INVALID', '收益评估报告缺少限制说明')
    return report


class BenefitReportService:
    """Find the latest valid benefit report for a model run; never writes."""

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
            for path in sorted(resolved.glob(f'**/{BENEFIT_FILE}')):
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
            raise BaselineError('REPORT_INVALID', f'收益评估报告不是有效的 UTF-8 JSON：{exc}') from exc
        return {**entry, 'report': report}

    def for_run(self, run_id):
        candidates, invalid = [], None
        for identity, (path, root, blob) in self._files().items():
            try:
                entry = self._load(identity, path, root, blob)
            except BaselineError as exc:
                entry = {'reportId': identity, 'source': _display_path(path, root)}
                raw = None
                try:
                    raw = json.loads(blob.decode('utf-8'))
                except (UnicodeError, ValueError):
                    continue
                if isinstance(raw, dict) and isinstance(raw.get('artifact'), dict) \
                        and raw['artifact'].get('runId') == run_id:
                    invalid = {'code': exc.code, 'message': str(exc)}
                continue
            if entry['report']['artifact']['runId'] == run_id:
                candidates.append(entry)
        if candidates:
            candidates.sort(key=lambda item: (item['report'].get('generatedUtc') or '', item['reportId']),
                            reverse=True)
            return candidates[0], None
        return None, invalid
