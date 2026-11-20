from label_fixtures import register_labeled
import pytest

from jit_baseline import collect, datasets
from jit_baseline.api.routers.admin import require_trainable_dataset
from jit_baseline.core.api_errors import RequestError
from jit_baseline.schemas import resolve


NAMES = resolve("kamei14-git-v2").in_model_names()


def _records(count=120):
    base = dict(ns=1, nd=2, nf=3, entropy=0.5, la=10, ld=1, lt=100, fix=0,
                ndev=2, age=3, nuc=2, exp=4, rexp=1, sexp=2)
    return [{"id": f"{index + 1:040x}", "epoch": 1_704_067_200 + index * 86_400,
             "time": f"time-{index}", "label": index % 2, "metrics": dict(base)}
            for index in range(count)]


def test_sharing_requires_a_trainable_dataset_version(tmp_path):
    root = tmp_path / "datasets"
    source = tmp_path / "shared.csv"
    records = _records()
    source.write_bytes(collect._csv_bytes(records, NAMES))
    cohort = collect.cohort("2020-01-01", "2030-01-01")
    legacy = datasets.register(source, schema="kamei14-git-v2", dataset="legacy",
                               root=root, cohort=cohort)
    mature = register_labeled(source, records, schema="kamei14-git-v2",
                              dataset="mature", root=root, cohort=cohort)

    with pytest.raises(RequestError) as rejected:
        require_trainable_dataset(root, legacy["version"])
    assert rejected.value.code == "DATASET_NOT_TRAINABLE"

    preview = require_trainable_dataset(root, mature["version"])
    assert preview["available"] is True
