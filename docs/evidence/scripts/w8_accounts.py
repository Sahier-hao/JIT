"""三会话核对：用户 A 的派生数据不对用户 B 可见，管理员可见；退出后会话失效。"""
import json
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

BASE = "http://127.0.0.1:18830"


def client():
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))

    def call(method, path, payload=None, *, expect=(200, 201, 202)):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(BASE + path, data=data, method=method,
                                         headers={"Content-Type": "application/json"})
        try:
            with opener.open(request, timeout=120) as response:
                body, status = response.read().decode("utf-8"), response.status
        except urllib.error.HTTPError as exc:
            body, status = exc.read().decode("utf-8"), exc.code
        if status not in expect:
            raise SystemExit(f"{method} {path} -> {status}: {body[:300]}")
        return json.loads(body) if body else {}

    return call


def account(username, password):
    call = client()
    call("POST", "/api/user/register", {"username": username, "password": password},
         expect=(200, 201, 409))
    call("POST", "/api/user/login", {"username": username, "password": password})
    return call


def main():
    alice = account("alice", "alice-password-123")
    bob = account("bob", "bob-password-123")
    admin = client()
    admin("POST", "/api/admin/login",
          {"username": "admin", "password": "journey-password-123"})

    shared = "kamei14-git-v2-flask-mature-2010-04-06_2026-07-30-742c2cc8"
    recipe = {"version": 1, "rules": [{"id": "max-value", "field": "la", "value": 100}]}
    preview = alice("POST", f"/api/v1/user/datasets/{shared}/curation/preview",
                    {"recipe": recipe})
    print("preview kept:", preview.get("kept"), "excluded:", preview.get("excluded"))
    derived = alice("POST", f"/api/v1/user/datasets/{shared}/curation/derive",
                    {"recipe": recipe})
    version = derived["dataset"]["version"]
    print("derived:", version)

    alice_versions = {item["version"] for item in
                      alice("GET", "/api/v1/user/datasets")["datasets"]}
    bob_versions = {item["version"] for item in
                    bob("GET", "/api/v1/user/datasets")["datasets"]}
    admin_versions = {version for group in admin("GET", "/api/v1/datasets")["datasets"]
                      for version in (item["version"] for item in group["versions"])}
    print("alice sees:", version in alice_versions, "bob sees:", version in bob_versions,
          "admin sees:", version in admin_versions)
    assert version in alice_versions and version not in bob_versions and version in admin_versions
    bob("GET", f"/api/v1/user/datasets/{version}", expect=(403, 404))

    alice("POST", "/api/user/logout", expect=(200, 204))
    alice("GET", "/api/v1/user/datasets", expect=(401,))
    print("logout invalidates session: True")
    print(json.dumps({"derivedVersion": version,
                      "counts": {"alice": len(alice_versions), "bob": len(bob_versions),
                                 "admin": len(admin_versions)}}, ensure_ascii=False))


if __name__ == "__main__":
    main()
