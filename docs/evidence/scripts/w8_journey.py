"""隔离服务上的端到端旅程：建户 → 项目 → 分析（真实采集+训练+评分）→ 分区与趋势。

只使用真实 HTTP 接口；不修改开发库、不停止其他服务。失败即抛出，不做兜底。
"""
import json
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

BASE = "http://127.0.0.1:18830"
jar = CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, payload=None, *, expect=(200, 201, 202)):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(BASE + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
    try:
        with opener.open(request, timeout=60) as response:
            body = response.read().decode("utf-8")
            status = response.status
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        status = exc.code
    if status not in expect:
        raise SystemExit(f"{method} {path} -> {status}: {body[:400]}")
    return json.loads(body) if body else {}


def wait_sync(sync_id, limit=900):
    deadline = time.time() + limit
    while time.time() < deadline:
        view = call("GET", f"/api/v1/repository-syncs/{sync_id}")
        if view["status"] in ("completed", "failed", "cancelled", "interrupted"):
            return view
        time.sleep(3)
    raise SystemExit(f"分析未在 {limit} 秒内结束")


TRAIN = {
    "repositoryUrl": "https://github.com/encode/httpx",
    "branch": "HEAD", "since": "2023-01-01", "commitLimit": 5000,
    "strategy": "force-train", "algorithm": "logistic-regression-l2-v1",
    "splitPreset": "temporal-70-15-15",
}


def main():
    setup = call("POST", "/api/admin/setup",
                 {"username": "admin", "password": "journey-password-123"},
                 expect=(200, 201, 409))
    print("admin setup:", setup.get("authenticated", setup))
    call("POST", "/api/admin/login",
         {"username": "admin", "password": "journey-password-123"}, expect=(200, 201))

    listing = call("GET", "/api/v1/datasets")
    names = [item["dataset"] for item in listing["datasets"]]
    assert "kamei14-git-v2-flask-mature" in names, names
    print("datasets include mature flask:", len(names))

    project = call("POST", "/api/v1/repositories",
                   {"repositoryUrl": "https://github.com/encode/httpx"})
    repository_id = project["repositoryId"]
    print("project:", repository_id)

    body = call("POST", "/api/v1/repository-syncs", TRAIN)
    sync_id = body["syncId"]
    print("sync:", sync_id, "status:", body["status"])
    duplicate = call("POST", "/api/v1/repository-syncs", TRAIN)
    assert duplicate["syncId"] == sync_id, (body["syncId"], duplicate["syncId"])
    print("duplicate request reused sync: True")

    done = wait_sync(sync_id)
    print("final status:", done["status"], "stage:", done.get("stage"),
          "model:", done.get("modelId"), "run:", done.get("runId"))
    if done["status"] != "completed":
        raise SystemExit(f"分析失败：{done.get('errorCode')} {done.get('errorMessage')}")

    detail = call("GET", f"/api/v1/repositories/{repository_id}")
    context = detail["viewContext"]
    scope = context["scope"]
    coverage = scope["partitionCoverage"]
    print("lineage:", coverage["status"], coverage["reason"],
          coverage.get("memberVerification"), "preset:", coverage.get("preset"))
    assert coverage["status"] == "verified", coverage
    split = scope["split"]
    print("split counts:", {name: split[name]["count"] for name in
                            ("train", "validation", "test", "holdout")})
    printed = {name: sum(scope["distributions"][name].values())
               for name in ("all", "train", "validation", "test", "holdout", "excluded",
                            "notIncluded", "unknown", "scored")}
    print("distributions:", printed)
    total = printed["all"]
    grouped = sum(printed[name] for name in
                  ("train", "validation", "test", "holdout", "excluded", "notIncluded",
                   "unknown", "scored"))
    print("conservation:", total, grouped, total == grouped)
    assert total == grouped

    commits = call("GET", f"/api/v1/repository-syncs/{sync_id}/commits?limit=200&sort=risk")
    labels = {}
    for commit in commits["commits"]:
        labels[commit["partition"]] = labels.get(commit["partition"], 0) + 1
    print("first page partitions:", labels, "total commits:", commits["total"])

    groups = call("GET", f"/api/v1/repositories/{repository_id}/trend-groups")
    assert groups["groups"], groups
    view = call("POST", f"/api/v1/repositories/{repository_id}/trend-views",
                {"groupId": groups["groups"][0]["groupId"], "start": "2023-01-01",
                 "end": "2026-12-01", "grain": "month"})
    print("trend coverage:", view["partitionCoverage"]["status"])
    assert view["partitionCoverage"]["status"] == "verified"

    # 失败隔离：另一次分析立即取消。
    cancel_body = call("POST", "/api/v1/repository-syncs", {
        "repositoryUrl": "https://github.com/encode/httpx", "branch": "HEAD",
        "since": "2019-01-01", "commitLimit": 5000, "strategy": "force-train",
        "algorithm": "decision-tree-v1", "splitPreset": "temporal-70-15-15",
    })
    cancelled = call("POST", f"/api/v1/repository-syncs/{cancel_body['syncId']}/cancel")
    print("cancel:", cancel_body["syncId"], cancelled["status"])

    print(json.dumps({"repositoryId": repository_id, "syncId": sync_id,
                      "modelId": done.get("modelId"), "coverage": coverage["status"],
                      "partitions": {name: split[name]["count"] for name in
                                     ("train", "validation", "test", "holdout")}},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
