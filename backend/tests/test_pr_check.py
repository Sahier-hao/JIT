"""离线 PR 检查包与报告：身份、覆盖、哈希和个人数据边界。"""
import json

import pytest

from jit_baseline.catalog_storage import CatalogStorage, utc_now
from jit_baseline.pr_check import (BUNDLE_FORMAT, PrCheckError, build_report,
                                   export_bundle, write_report)


def _fixture(tmp_path):
    storage = CatalogStorage(tmp_path / 'catalog.sqlite3')
    storage.initialize()
    snapshot = {'owner': 'example', 'name': 'repo', 'number': 7, 'title': 'demo',
                'url': 'https://github.com/example/repo/pull/7', 'baseSha': 'a' * 40,
                'headSha': 'b' * 40, 'totalFiles': 3, 'filesComplete': True, 'totalCommits': 2}
    with storage.connection(write=True) as db:
        db.execute("INSERT INTO repository(id,url,display_name,default_branch,commit_count,high_count,"
                   "medium_count,low_count,unknown_count,created_at,updated_at) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                   ('repo1', 'https://github.com/example/repo', 'repo', 'main', 0, 0, 0, 0, 0,
                    utc_now(), utc_now()))
        db.execute("INSERT INTO pr_snapshot(id,repository_id,owner,name,number,base_sha,head_sha,"
                   "payload_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                   ('snap1', 'repo1', 'example', 'repo', 7, 'a' * 40, 'b' * 40,
                    json.dumps(snapshot), utc_now()))
        db.execute("INSERT INTO repository_sync(id,repository_url,branch,requested_strategy,status,stage,"
                   "dataset_version,run_id,model_id,created_at,updated_at,source_kind,source_snapshot_id) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   ('sync1', 'https://github.com/example/repo', 'main', 'generic-model', 'completed',
                    'completed', 'demo-v1', 'run-1', 'model-1', utc_now(), utc_now(), 'pr', 'snap1'))
        db.execute("INSERT INTO repository_commit(sync_id,commit_id,epoch,risk,added_lines,"
                   "deleted_lines,files,features_json,label,label_note,subject,author_name) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                   ('sync1', 'c' * 40, 1, 0.9, 10, 1, 2, '{}', 0, None, 'risky', 'A'))
        db.execute("INSERT INTO repository_commit(sync_id,commit_id,epoch,risk,added_lines,"
                   "deleted_lines,files,features_json,label,label_note,subject,author_name) "
                   "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                   ('sync1', 'd' * 40, 2, 0.2, 3, 0, 1, '{}', 0, None, 'safe', 'B'))
    return storage


def test_export_and_report_keep_identity_and_coverage(tmp_path):
    storage = _fixture(tmp_path)
    bundle = export_bundle(storage, 'snap1', 'sync1')
    assert bundle['format'] == BUNDLE_FORMAT and bundle['contentSha256']
    assert bundle['coverage'] == {'commitsTotal': 2, 'commitsScored': 2}
    assert bundle['personalDataIncluded'] is False

    report = build_report(bundle)
    assert report['baseSha'] == 'a' * 40 and report['headSha'] == 'b' * 40
    assert report['model'] == {'modelId': 'model-1', 'runId': 'run-1'}
    assert report['commits'][0]['risk'] == 0.9
    assert any('缺陷概率' in item for item in report['limitations'])

    path = tmp_path / 'report.md'
    write_report(bundle, path, 'markdown')
    assert 'PR 检查报告' in path.read_text(encoding='utf-8')


def test_identity_and_tampering_are_rejected(tmp_path):
    storage = _fixture(tmp_path)
    bundle = export_bundle(storage, 'snap1', 'sync1')
    tampered = dict(bundle, headSha='f' * 40)
    with pytest.raises(PrCheckError) as error:
        build_report(tampered)
    assert error.value.exit_code == 4

    with storage.connection(write=True) as db:
        db.execute("UPDATE repository_sync SET source_snapshot_id='other' WHERE id='sync1'")
    with pytest.raises(PrCheckError) as mismatch:
        export_bundle(storage, 'snap1', 'sync1')
    assert mismatch.value.exit_code == 3


def test_incomplete_analysis_is_not_a_report(tmp_path):
    storage = _fixture(tmp_path)
    with storage.connection(write=True) as db:
        db.execute("UPDATE repository_sync SET status='failed' WHERE id='sync1'")
    with pytest.raises(PrCheckError) as error:
        export_bundle(storage, 'snap1', 'sync1')
    assert error.value.exit_code == 2
