"""故障注入：模型产物损坏后，模型卡与显式选择的分析都必须给出原因，不静默替换。"""
import json
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path

BASE = "http://127.0.0.1:18830"
jar = CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, payload=None, *, expect=(200, 201, 202)):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(BASE + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
    try:
        with opener.open(request, timeout=60) as response:
            body, status = response.read().decode("utf-8"), response.status
    except urllib.error.HTTPError as exc:
        body, status = exc.read().decode("utf-8"), exc.code
    if status not in expect:
        raise SystemExit(f"{method} {path} -> {status}: {body[:300]}")
    return json.loads(body) if body else {}


def main():
    call("POST", "/api/admin/login", {"username": "admin", "password": "journey-password-123"})
    # 隔离目录中的内置模型；损坏它的模型文件。
    models = call("GET", "/api/v1/models")["models"]
    target = next(item for item in models if item["method"] == "decision-tree-v1")
    directory = Path("D:/tmp/w8/artifacts") / "decision-tree-v1" / "model.joblib"
    original = directory.read_bytes()[:16]
    directory.write_bytes(b"corrupted")
    card = call("GET", f"/api/v1/model-cards/{target['modelId']}")
    print("card available:", card.get("available"), "reason:", card.get("reason"))
    assert card.get("available") is False and card.get("reason"), card

    project = call("POST", "/api/v1/repositories",
                   {"repositoryUrl": "https://github.com/encode/httpx"})
    body = call("POST", "/api/v1/repository-syncs", {
        "repositoryUrl": "https://github.com/encode/httpx", "branch": "HEAD",
        "since": "2024-01-01", "commitLimit": 5000, "strategy": "generic-model",
        "modelId": target["modelId"],
    })
    deadline = time.time() + 300
    while time.time() < deadline:
        view = call("GET", f"/api/v1/repository-syncs/{body['syncId']}")
        if view["status"] in ("failed", "completed", "cancelled", "interrupted"):
            break
        time.sleep(2)
    print("analysis with corrupted model:", view["status"], view.get("errorCode"),
          view.get("errorMessage"))
    assert view["status"] == "failed", view
    assert view.get("modelId") in (None, target["modelId"])

    # 恢复文件，便于隔离服务后续手动复查。
    original_blob = Path("D:/tmp/w8/artifacts/decision-tree-v1/model.joblib").read_bytes()
    print("corrupted bytes still in place:", original_blob == b"corrupted", original.hex()[:8])


if __name__ == "__main__":
    main()
