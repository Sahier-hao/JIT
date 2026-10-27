"""Bounded, noninteractive remote HEAD lookup in an owned process tree."""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from .collect import validate_source
from .config import BACKEND
from .errors import BaselineError
from .task_process import OwnedProcess


def parse_remote(text, branch):
    wanted = 'HEAD' if branch == 'HEAD' else f'refs/heads/{branch}'
    head, resolved = None, None
    for line in text.splitlines():
        parts = line.split('\t')
        if len(parts) != 2 or parts[1] != wanted:
            continue
        if parts[0].startswith('ref: refs/heads/'):
            resolved = parts[0][len('ref: refs/heads/'):]
        elif re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', parts[0]):
            head = parts[0]
    if not head:
        raise BaselineError('REPOSITORY_UNAVAILABLE', '仓库或分支不可用')
    return {'head': head, 'branch': resolved or branch}


def probe_repository(url, branch, stop, *, allow_local=False, timeout=35):
    validate_source(url, allow_local=allow_local)
    with tempfile.TemporaryDirectory(prefix='jit-head-') as work:
        output = Path(work) / 'head.json'
        owner = OwnedProcess([sys.executable, '-m', 'jit_baseline.repository_probe'],
                             {'url': url, 'branch': branch, 'output': str(output)}, cwd=BACKEND)
        try:
            deadline = time.monotonic() + timeout
            while owner.poll() is None:
                if stop.wait(.05):
                    raise BaselineError('SYNC_INTERRUPTED', '仓库检查已停止')
                if time.monotonic() >= deadline:
                    raise BaselineError('REPOSITORY_CHECK_TIMEOUT', '仓库检查超时')
            if not output.is_file():
                raise BaselineError('REPOSITORY_UNAVAILABLE', '无法检查远端仓库')
            result = json.loads(output.read_text(encoding='utf-8'))
            if 'error' in result:
                raise BaselineError(result['error'], '无法检查远端仓库')
            return result
        finally:
            owner.close()


def main():
    payload = json.load(sys.stdin)
    try:
        branch = payload['branch']
        ref = 'HEAD' if branch == 'HEAD' else f'refs/heads/{branch}'
        result = subprocess.run(['git', '-c', 'credential.helper=', '-c', 'http.lowSpeedLimit=1000',
                                 '-c', 'http.lowSpeedTime=20', 'ls-remote', '--symref', '--', payload['url'], ref],
                                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30,
                                env=dict(os.environ, GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='never'))
        if result.returncode:
            raise BaselineError('REPOSITORY_UNAVAILABLE', '仓库不可用')
        output = parse_remote(result.stdout, branch)
    except subprocess.TimeoutExpired:
        output = {'error': 'REPOSITORY_CHECK_TIMEOUT'}
    except (BaselineError, OSError) as exc:
        output = {'error': getattr(exc, 'code', 'REPOSITORY_UNAVAILABLE')}
    Path(payload['output']).write_text(json.dumps(output), encoding='utf-8')


if __name__ == '__main__':
    main()
