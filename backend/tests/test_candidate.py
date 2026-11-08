"""静态候选位置：只识别受支持的 Python 规则，不把候选变成模型分数。"""
import json
from types import SimpleNamespace

from jit_baseline.candidate import analyze
from jit_baseline.catalog_storage import CatalogStorage, utc_now
from jit_baseline.pr_review import PullRequestReview


def test_python_rules_return_lines_and_evidence():
    content = ("def f(items=[]):\n"
               "    try:\n"
               "        eval('1')\n"
               "    except:\n"
               "        pass\n")
    items, error = analyze('pkg/a.py', 'head', content)
    assert error is None
    rules = {item['ruleId'] for item in items}
    assert {'py-mutable-default', 'py-bare-except', 'py-eval-exec'} <= rules
    assert all(item['side'] == 'head' and item['path'] == 'pkg/a.py' for item in items)
    assert all(item['line'] > 0 and item['evidence'] for item in items)


def test_each_rule_gets_a_different_suggestion_without_patching_code():
    from jit_baseline.candidate import suggestion
    content = ("def f(items=[]):\n"
               "    try:\n"
               "        eval('1')\n"
               "    except:\n"
               "        pass\n")
    items, _ = analyze('pkg/a.py', 'head', content)
    by_rule = {item['ruleId']: suggestion(item) for item in items}
    assert by_rule['py-mutable-default']['example']['after'].startswith('def handle(items=None)')
    assert by_rule['py-bare-except']['manualChecks']
    assert by_rule['py-eval-exec']['example'] is None
    assert len({entry['title'] for entry in by_rule.values()}) == 3
    assert all(entry['location']['path'] == 'pkg/a.py' and entry['location']['side'] == 'head'
               and entry['location']['line'] > 0 for entry in by_rule.values())


def test_unsupported_or_invalid_file_is_not_guessed():
    assert analyze('pkg/a.js', 'head', 'const x = 1') == ([], 'unsupported-language')
    assert analyze('pkg/a.py', 'head', 'def broken(:') == ([], 'parse-failed')


def test_candidates_are_persisted_and_coverage_is_reported(tmp_path, monkeypatch):
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    snapshot = {'owner': 'example', 'name': 'repo', 'number': 1, 'title': 'demo',
                'url': 'https://github.com/example/repo/pull/1', 'baseSha': 'a' * 40,
                'headSha': 'b' * 40, 'totalFiles': 1, 'filesComplete': True,
                'commits': [], 'totalCommits': 0,
                'files': [{'path': 'pkg/a.py', 'previousPath': None, 'blobSha': 'c' * 40,
                           'status': 'modified', 'additions': 1, 'deletions': 0,
                           'patch': None, 'patchComplete': False}]}
    with storage.connection(write=True) as db:
        db.execute("INSERT INTO repository(id,url,display_name,default_branch,commit_count,high_count,"
                   "medium_count,low_count,unknown_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                   ('repo1', 'https://github.com/example/repo', 'repo', 'main', 0, 0, 0, 0, 0,
                    utc_now(), utc_now()))
        db.execute("INSERT INTO pr_snapshot(id,repository_id,owner,name,number,base_sha,head_sha,"
                   "payload_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                   ('snap1', 'repo1', 'example', 'repo', 1, 'a' * 40, 'b' * 40,
                    json.dumps(snapshot), utc_now()))
    review = PullRequestReview(SimpleNamespace(sync=SimpleNamespace(storage=storage)))
    monkeypatch.setattr(review, 'context', lambda snapshot_id, path, side:
                        {'absent': False, 'content': 'def f(items=[]):\n    pass\n'})
    result = review.candidates('snap1', ['pkg/a.py'], 'head')
    assert result['coverage']['analyzed'] == ['pkg/a.py']
    assert result['candidates'][0]['ruleId'] == 'py-mutable-default'
    assert result['candidates'][0]['suggestion']['title']
    stored = review.stored_candidates('snap1')
    assert stored['coverage']['analyzed'] == ['pkg/a.py']
    assert len(stored['candidates']) == 1
    assert stored['candidates'][0]['suggestion']['manualChecks']
