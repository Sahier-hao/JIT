"""Probe only a service created by this process, on an ephemeral localhost port."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.request import urlopen


def listening(port):
    with socket.socket() as sock:
        return sock.connect_ex(('127.0.0.1', port)) == 0


def main():
    root = Path(__file__).resolve().parents[2]
    temporary = root / '.cache/redesign-validation/temp'
    temporary.mkdir(parents=True, exist_ok=True)
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    default_before = listening(8000)
    env = dict(os.environ, TEMP=str(temporary), TMP=str(temporary), PYTHONIOENCODING='utf-8',
               JIT_CATALOG_DATABASE=str(temporary / 'probe.sqlite3'))
    child = subprocess.Popen([sys.executable, '-m', 'jit_baseline.cli', 'serve', '--port', str(port)],
                             cwd=root / 'backend', env=env, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    ready = False
    try:
        for _ in range(200):
            if child.poll() is not None:
                raise RuntimeError('Owned service exited before readiness')
            try:
                with urlopen(f'http://127.0.0.1:{port}/api/review-batch', timeout=.5) as response:
                    ready = response.status == 200
                if ready:
                    break
            except OSError:
                time.sleep(.1)
        if not ready:
            raise RuntimeError('Owned service readiness timed out')
    finally:
        child.terminate()
        child.wait(timeout=15)
    for _ in range(50):
        if not listening(port):
            break
        time.sleep(.1)
    assert not listening(port), 'Owned port was not released'
    assert listening(8000) == default_before, 'Default service availability changed'
    print(json.dumps({'ready': ready, 'ownedPort': port, 'reclaimed': True,
                      'defaultServiceUnchanged': True, 'isolatedDatabase': True}))


if __name__ == '__main__':
    main()
