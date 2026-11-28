import subprocess

import pytest

from jit_baseline.errors import BaselineError
from jit_baseline.services.commit_line_evidence import commit_line_evidence

SHA = 'a' * 40


def _repository():
    return {'repositoryId': 'repository-1', 'url': 'https://github.com/example/project'}


def _request(*, patch='@@ -1 +1 @@\n-old\n+const value = 1\n'):
    calls = []

    def request(path):
        calls.append(path)
        if '/commits/' in path:
            return {
                'sha': SHA,
                'files': [{
                    'filename': 'src/value.ts',
                    'status': 'modified',
                    'additions': 1,
                    'deletions': 1,
                    'patch': patch,
                }],
            }
        raise AssertionError(path)

    return request, calls


def test_commit_line_evidence_reads_fixed_sha_and_patch_text():
    request, calls = _request()
    result = commit_line_evidence(_repository(), SHA, 'src/value.ts', request=request)
    assert result['status'] == 'supported'
    assert result['commitId'] == SHA and result['ref'] == SHA
    assert result['path'] == 'src/value.ts'
    assert result['coverage']['textSource'] == 'patch'
    assert result['coverage']['usesFullFile'] is False
    assert result['lines'][0]['line'] == 1
    assert result['lines'][0]['text'] == 'const value = 1'
    assert any('/commits/' + SHA in path for path in calls)
    assert not any('/contents/' in path for path in calls)


def test_missing_patch_does_not_guess_candidates_or_content():
    request, calls = _request(patch=None)
    result = commit_line_evidence(_repository(), SHA, 'src/value.ts', request=request)
    assert result['status'] == 'patch-incomplete'
    assert result['lines'] == []
    assert not any('/contents/' in path for path in calls)


def test_commit_source_failure_is_explicit_and_not_replaced():
    def request(_path):
        raise BaselineError('PR_RATE_LIMITED', 'limited')

    result = commit_line_evidence(_repository(), SHA, 'src/value.ts', request=request)
    assert result['status'] == 'source-unavailable'
    assert result['reason'] == 'PR_RATE_LIMITED'


def test_commit_line_evidence_requires_full_sha():
    request, _ = _request()
    with pytest.raises(BaselineError):
        commit_line_evidence(_repository(), SHA[:12], 'src/value.ts', request=request)


def test_local_git_commit_evidence_reads_exact_sha(tmp_path):
    repo = tmp_path / 'repo'
    repo.mkdir()
    subprocess.run(['git', 'init', '-q'], cwd=repo, check=True)
    subprocess.run(['git', 'config', 'user.email', 'test@example.com'], cwd=repo, check=True)
    subprocess.run(['git', 'config', 'user.name', 'Test'], cwd=repo, check=True)
    source = repo / 'value.ts'
    source.write_text('const value = 1\n', encoding='utf-8')
    subprocess.run(['git', 'add', 'value.ts'], cwd=repo, check=True)
    subprocess.run(['git', 'commit', '-qm', 'initial'], cwd=repo, check=True)
    first = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    source.write_text('const value = 2\nreturn value\n', encoding='utf-8')
    subprocess.run(['git', 'add', 'value.ts'], cwd=repo, check=True)
    subprocess.run(['git', 'commit', '-qm', 'update'], cwd=repo, check=True)
    second = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    result = commit_line_evidence(
        {'repositoryId': 'repository-1', 'url': str(repo)},
        second,
        'value.ts',
        allow_local=True,
    )
    assert result['status'] == 'supported'
    assert result['commitId'] == second
    assert {row['line'] for row in result['lines']} == {1, 2}
    old = commit_line_evidence(
        {'repositoryId': 'repository-1', 'url': str(repo)},
        first,
        'value.ts',
        allow_local=True,
    )
    assert old['status'] == 'supported'
    assert {row['line'] for row in old['lines']} == {1}
