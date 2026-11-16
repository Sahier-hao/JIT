"""The release baseline uses project-local v2 partitions and emits qualification evidence."""

import csv
import io

from jit_baseline import datasets
from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.release_baseline import run_current_schema_baseline


FIELDS = ["ns", "nd", "nf", "entropy", "la", "ld", "lt", "fix", "ndev",
          "age", "nuc", "exp", "rexp", "sexp"]


def _source(path, prefix):
    stream = io.StringIO()
    names = ["commit_id", "author_date", "bugcount", "label_status",
             "observed_through_epoch", "maturity_days", *FIELDS]
    writer = csv.DictWriter(stream, fieldnames=names)
    writer.writeheader()
    for index in range(100):
        label = index % 5 == 0
        writer.writerow({
            "commit_id": f"{prefix}{index:039x}"[-40:],
            "author_date": str(1_700_000_000 + index * 3600),
            "bugcount": str(int(label)),
            "label_status": "positive" if label else "unobserved",
            "observed_through_epoch": str(1_700_000_000 + 100 * 86400),
            "maturity_days": "90",
            **{name: str(index + 1) for name in FIELDS},
        })
    path.write_bytes(stream.getvalue().encode())


def test_current_schema_baseline_uses_four_project_pool(tmp_path):
    manifests = []
    for index, name in enumerate(("project-a", "project-b", "project-c", "project-d")):
        source = tmp_path / f"{name}.csv"
        _source(source, index + 1)
        registered = datasets.register(
            source, schema="kamei14-git-v2", dataset=name, root=tmp_path / "datasets",
            cohort={"startEpochInclusive": 0, "endEpochExclusive": 2_000_000_000,
                    "addedLinesGreaterThan": 0, "maxChurnInclusive": 10000,
                    "maxFilesInclusive": 100},
            provenance={"publisher": "fixture", "revision": f"{index + 1:040x}",
                        "url": f"https://example.com/{name}"},
        )
        manifests.append(tmp_path / "datasets" / name / f"{registered['version']}.json")
    output = tmp_path / "release"
    baseline = run_current_schema_baseline(
        manifests,
        output_dir=output,
        dataset_root=tmp_path / "datasets",
        artifact_root=tmp_path / "artifacts",
        storage=CatalogStorage(tmp_path / "catalog.sqlite3"),
        methods=["logistic-regression-l2-v1", "decision-tree-v1"],
    )
    assert baseline["dataset"]["sourceProjects"][0]["dataset"] == "project-a"
    assert baseline["dataset"]["sourceProjects"][3]["dataset"] == "project-d"
    assert not baseline["failures"], baseline["failures"]
    assert len(baseline["results"]) == 2
    assert baseline["coverage"]["passed"] is False
    assert (output / "release-baseline.json").is_file()
    assert (output / "dataset" / "pooled-index.json").is_file()
