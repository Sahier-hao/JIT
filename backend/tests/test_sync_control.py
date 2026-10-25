"""采集文件发布不得覆盖已有版本。"""

def test_dataset_collision_never_overwrites_an_existing_csv(tmp_path):
    from test_repository_sync import _small_repo, SINCE, UNTIL
    from jit_baseline import collect
    from jit_baseline.sync import _register_unique
    collected = collect.collect(_small_repo(tmp_path), since=SINCE, until=UNTIL)
    dataset = 'kamei14-git-v1-control'
    version = f'{dataset}-2024-01-01_2024-01-07'
    room = tmp_path / 'datasets' / dataset
    room.mkdir(parents=True)
    original = room / f'{version}.csv'
    original.write_bytes(b'protected-previous-data')
    result = _register_unique(room, dataset, version, collected['csv'], schema=collect.SCHEMA_NAME,
                              cohort=collect.cohort(SINCE, UNTIL), root=room.parent)
    assert original.read_bytes() == b'protected-previous-data'
    assert result['version'].startswith(version + '-')
