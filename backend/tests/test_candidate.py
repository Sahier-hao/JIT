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


def test_new_rules_detect_only_high_confidence_calls_and_keep_templates():
    from jit_baseline.candidate import RULE_VERSION, suggestion
    content = (
        "subprocess.run('git status', shell=True)\n"
        "data = yaml.load(text)\n"
        "requests.get(url, verify=False)\n"
        "path = tempfile.mktemp()\n"
        "subprocess.run(['git', 'status'], shell=False)\n"
        "data = yaml.load(text, Loader=yaml.SafeLoader)\n"
        "requests.get(url, verify=True)\n"
        "with tempfile.NamedTemporaryFile() as handle:\n"
        "    pass\n"
    )
    items, error = analyze('pkg/a.py', 'head', content)
    assert error is None
    by_rule = {item['ruleId']: item for item in items}
    assert set(by_rule) == {
        'py-subprocess-shell-true', 'py-yaml-unsafe-load',
        'py-requests-verify-false', 'py-tempfile-mktemp',
    }
    assert {name: item['line'] for name, item in by_rule.items()} == {
        'py-subprocess-shell-true': 1, 'py-yaml-unsafe-load': 2,
        'py-requests-verify-false': 3, 'py-tempfile-mktemp': 4,
    }
    assert all(item['ruleVersion'] == RULE_VERSION for item in by_rule.values())
    for name, item in by_rule.items():
        advice = suggestion(item)
        assert advice['ruleId'] == name
        assert advice['ruleVersion'] == RULE_VERSION
        assert advice['title'] and advice['rationale']
        assert advice['manualChecks'] and advice['example']
    assert suggestion({'ruleId': 'py-unregistered', 'ruleVersion': RULE_VERSION,
                       'path': 'pkg/a.py', 'line': 1, 'side': 'head'}) is None


def test_candidates_are_persisted_and_coverage_is_reported(tmp_path, monkeypatch):
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    snapshot = {'owner': 'example', 'name': 'repo', 'number': 1, 'title': 'demo',
                'url': 'https://github.com/example/repo/pull/1', 'baseSha': 'a' * 40,
                'headSha': 'b' * 40, 'totalFiles': 4, 'filesComplete': True,
                'commits': [], 'totalCommits': 0,
                'files': [{'path': 'pkg/a.py', 'previousPath': None, 'blobSha': 'c' * 40,
                           'status': 'modified', 'additions': 1, 'deletions': 0,
                           'patch': None, 'patchComplete': False}]}
    for path in ('pkg/clean.py', 'pkg/truncated.py', 'pkg/unsupported.js'):
        snapshot['files'].append(dict(snapshot['files'][0], path=path))
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
    def context(snapshot_id, path, side):
        content = 'x = 1\n' if path == 'pkg/clean.py' or side == 'base' else 'def f(items=[], cache={}):\n    pass\n'
        return {'absent': False, 'content': content, 'complete': path != 'pkg/truncated.py'}

    monkeypatch.setattr(review, 'context', context)
    result = review.candidates('snap1', ['pkg/a.py'], 'head')
    assert result['coverage']['analyzed'] == ['pkg/a.py']
    assert len(result['candidates']) == 1
    assert result['candidates'][0]['ruleId'] == 'py-mutable-default'
    assert result['candidates'][0]['suggestion']['title']
    stored = review.stored_candidates('snap1')
    assert stored['coverage']['analyzed'] == ['pkg/a.py']
    assert len(stored['candidates']) == 1
    assert stored['candidates'][0]['suggestion']['manualChecks']
    review.candidates('snap1', ['pkg/clean.py'], 'head')
    review.candidates('snap1', ['pkg/a.py'], 'base')
    review.candidates('snap1', ['pkg/truncated.py', 'pkg/unsupported.js'], 'head')
    stored = review.stored_candidates('snap1')
    files = {(item['path'], item['side']): item['reason'] for item in stored['coverage']['files']}
    assert files == {('pkg/a.py', 'head'): None, ('pkg/a.py', 'base'): None,
                     ('pkg/clean.py', 'head'): None, ('pkg/truncated.py', 'head'): 'incomplete-content',
                     ('pkg/unsupported.js', 'head'): 'unsupported-language'}
    assert [(item['path'], item['side']) for item in stored['candidates']] == [('pkg/a.py', 'head')]


def test_stored_legacy_rule_results_are_read_as_v1_and_marked_legacy(tmp_path):
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    snapshot = {'owner': 'example', 'name': 'repo', 'number': 2, 'title': 'legacy',
                'url': 'https://github.com/example/repo/pull/2', 'baseSha': 'a' * 40,
                'headSha': 'b' * 40, 'totalFiles': 1, 'filesComplete': True,
                'commits': [], 'totalCommits': 0,
                'files': [{'path': 'pkg/a.py', 'previousPath': None, 'blobSha': 'c' * 40,
                           'status': 'modified', 'additions': 1, 'deletions': 0,
                           'patch': None, 'patchComplete': False}]}
    coverage = {'analyzerVersion': 'python-ast-v1', 'side': 'head',
                'analyzed': ['pkg/a.py'], 'skipped': [], 'selected': 1, 'totalFiles': 1}
    with storage.connection(write=True) as db:
        db.execute("INSERT INTO repository(id,url,display_name,default_branch,commit_count,high_count,"
                   "medium_count,low_count,unknown_count,created_at,updated_at) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                   ('repo2', 'https://github.com/example/repo', 'repo', 'main', 0, 0, 0, 0, 0,
                    utc_now(), utc_now()))
        db.execute("INSERT INTO pr_snapshot(id,repository_id,owner,name,number,base_sha,head_sha,"
                   "payload_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                   ('snap2', 'repo2', 'example', 'repo', 2, 'a' * 40, 'b' * 40,
                    json.dumps(snapshot), utc_now()))
        db.execute("INSERT INTO pr_candidate_run VALUES (?,?,?,?,?)",
                   ('snap2', 'python-ast-v1', 'complete', json.dumps(coverage), utc_now()))
        db.execute("INSERT INTO pr_candidate VALUES (?,?,?,?,?,?,?,?,?)",
                   ('snap2', 'python-ast-v1', 'head', 'pkg/a.py', 3,
                    'py-bare-except', '1', '裸 except', 'except:'))
    review = PullRequestReview(SimpleNamespace(sync=SimpleNamespace(storage=storage)))
    result = review.stored_candidates('snap2')
    assert result['ruleSet'] == {
        'analyzerVersion': 'python-ast-v1',
        'ruleVersion': '1',
        'status': 'legacy',
    }
    assert result['coverage']['analyzerVersion'] == 'python-ast-v1'
    assert result['candidates'][0]['ruleVersion'] == '1'
    assert result['candidates'][0]['suggestion']['ruleVersion'] == '1'
