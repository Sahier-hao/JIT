"""项目分析口径：分区判定与纳入规则。"""
from jit_baseline.analysis_scope import _included, partition_for


def _scope():
    return {
        "strategy": "repository-trained",
        "excludedCommitIds": ["excluded"],
        "split": {
            "train": {"endEpoch": 100},
            "validation": {"endEpoch": 200},
            "test": {"endEpoch": 300},
            "holdout": {"startEpoch": 400},
        },
    }


def test_partitions_follow_temporal_boundaries():
    scope = _scope()
    assert partition_for(scope, "a", 50) == "train"
    assert partition_for(scope, "a", 150) == "validation"
    assert partition_for(scope, "a", 250) == "test"
    assert partition_for(scope, "a", 450) == "holdout"
    assert partition_for(scope, "a", 350) == "unassigned"


def test_excluded_commit_wins_over_time_boundary():
    assert partition_for(_scope(), "excluded", 50) == "excluded"


def test_generic_model_has_no_training_partitions():
    assert partition_for({"strategy": "generic-model"}, "a", 50) == "scored"
    assert partition_for(None, "a", 50) == "unassigned"


def test_inclusion_matches_dataset_cohort_rules():
    assert _included({"added_lines": 10, "deleted_lines": 2, "files": 3,
                      "features_json": '{"ns":1,"nd":1,"nf":1,"entropy":0.2,"la":10,"ld":2,'
                                       '"lt":10,"fix":0,"ndev":1,"age":1,"nuc":1,"exp":1,'
                                       '"rexp":1,"sexp":1}'})
    assert not _included({"added_lines": 0, "deleted_lines": 2, "files": 3,
                          "features_json": "{}"})
    assert not _included({"added_lines": 10, "deleted_lines": 20000, "files": 3,
                          "features_json": "{}"})
    assert not _included({"added_lines": 10, "deleted_lines": 2, "files": 101,
                          "features_json": "{}"})
