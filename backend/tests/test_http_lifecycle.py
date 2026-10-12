"""Actual TCP restart and serialization-context check; not a second experiment."""
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import joblib
import pytest

from test_artifacts import copied_run, real_run  # noqa: F401
from jit_baseline import evidence
from jit_baseline.artifacts import BACKEND, identity, write_json
from jit_baseline.data import sha256


def request(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/review-batch", timeout=2) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as exc:
        return exc.code, json.load(exc)


def wait_ready(port, timeout=15):
    """Poll the owned service until it answers with a parseable batch.

    The service binds its port before the app finishes starting, so an accepted
    connection can carry an empty or unparseable body. That is not readiness.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            return request(port)
        except (OSError, TimeoutError, json.JSONDecodeError):
            time.sleep(.1)
    raise AssertionError(f"Own test service on port {port} did not become ready within {timeout}s")


def test_actual_tcp_unavailable_restart_and_new_model_context(copied_run, tmp_path):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    package_path = Path(sys.prefix) / ("Lib/site-packages" if os.name == "nt" else f"lib/python{sys.version_info.major}.{sys.version_info.minor}/site-packages")
    code = "import sys; sys.path.insert(0,sys.argv[3]); from pathlib import Path; import uvicorn; from jit_baseline.api import create_app; uvicorn.run(create_app(Path(sys.argv[1])),host='127.0.0.1',port=int(sys.argv[2]))"
    model_path = copied_run / "model.joblib"
    saved = model_path.read_bytes()
    model_path.unlink()
    stages = []
    log = (tmp_path / "own-service.log").open("wb")
    def start():
        # Base executable avoids a Windows venv launcher child; this exact owned PID is stopped.
        return subprocess.Popen([sys._base_executable, "-c", code, str(copied_run), str(port), str(package_path)],
                                cwd=BACKEND, stdout=log, stderr=subprocess.STDOUT,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    process = start()
    try:
        status, error = wait_ready(port)
        assert status == 503 and error["error"]["code"] == "ARTIFACT_UNAVAILABLE"
        stages.append({"stage": "missing-model", "status": status, "error": error})
    finally:
        process.terminate()
        process.wait(timeout=5)
    model_path.write_bytes(saved)
    process = start()
    try:
        status, original = wait_ready(port)
        assert status == 200 and len(original["records"]) == 1853
        stages.append({"stage": "restored-and-restarted", "status": status, "runId": original["runId"]})
    finally:
        process.terminate()
        process.wait(timeout=5)
    # Same fitted pipeline, different serialization bytes, hence a different valid run context.
    model = joblib.load(model_path)
    joblib.dump(model, model_path, protocol=5 if saved[1] != 5 else 4)
    model_hash = sha256(model_path.read_bytes())
    manifest = json.loads((copied_run / "manifest.json").read_text(encoding="utf-8"))
    manifest["files"]["model.joblib"] = model_hash
    manifest["config"]["coreFiles"]["model.joblib"] = model_hash
    manifest["config"]["modelSha256"] = model_hash
    manifest["runId"] = identity(manifest["config"])
    summary = json.loads((copied_run / "summary.json").read_text(encoding="utf-8"))
    summary.update(runId=manifest["runId"], modelSha256=model_hash)
    write_json(copied_run / "summary.json", summary)
    manifest["files"]["summary.json"] = sha256((copied_run / "summary.json").read_bytes())
    write_json(copied_run / "manifest.json", manifest)
    process = start()
    try:
        status, variant = wait_ready(port)
        assert status == 200 and variant["runId"] != original["runId"]
        assert variant["records"] == original["records"]
        stages.append({"stage": "same-pipeline-other-serialization", "status": status, "runId": variant["runId"], "sameRecordsAndRisks": True})
        write_json(evidence.run_dir() / "http-lifecycle.json", {"kind": "real-tcp-restart-and-context-behavior-check", "host": "127.0.0.1", "port": port,
                                                                 "stages": stages, "formalArtifactsUnmodified": True, "passed": True})
        write_json(evidence.fixtures_dir() / "runtime-context-fixture-batch.json", variant)
    finally:
        process.terminate()
        process.wait(timeout=5)
        log.close()


class NotYetReady:
    """A service that binds its port before answering; the first replies are not readiness."""

    def __init__(self, bodies):
        self._bodies = bodies
        self._socket = socket.socket()
        self._socket.bind(("127.0.0.1", 0))
        self._socket.listen(8)
        self.port = self._socket.getsockname()[1]
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        index = 0
        header = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n"
        while True:
            try:
                connection, _ = self._socket.accept()
            except OSError:
                return
            with connection:
                connection.recv(65536)
                body = self._bodies[min(index, len(self._bodies) - 1)]
                index += 1
                connection.sendall(header % len(body) + body)

    def close(self):
        self._socket.close()


@pytest.mark.parametrize("early", [b"", b"not json"])
def test_wait_ready_retries_past_a_transient_unready_reply(early):
    service = NotYetReady([early, b'{"ok": true}'])
    try:
        assert wait_ready(service.port, timeout=5) == (200, {"ok": True})
    finally:
        service.close()


def test_wait_ready_fails_with_the_waited_target_after_the_timeout():
    service = NotYetReady([b""])
    try:
        with pytest.raises(AssertionError) as failure:
            wait_ready(service.port, timeout=1)
        assert str(service.port) in str(failure.value)
    finally:
        service.close()
