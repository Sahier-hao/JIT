"""Dependency smoke with synthetic data. This is not a real experiment."""
import importlib.metadata
import io
import json
import platform

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from threadpoolctl import threadpool_limits


def main():
    with threadpool_limits(limits=1):
        x = np.array([[0.0], [1.0], [2.0], [3.0]])
        y = np.array([0, 0, 1, 1])
        model = LogisticRegression(C=1, solver="lbfgs", random_state=2026).fit(x, y)
        serialized = io.BytesIO()
        joblib.dump(model, serialized)
        serialized.seek(0)
        restored = joblib.load(serialized)
        assert np.allclose(model.predict_proba(x), restored.predict_proba(x))
        assert np.isfinite(restored.predict_proba(x)).all()
    print(json.dumps({
        "kind": "synthetic-dependency-smoke", "success": True,
        "python": platform.python_version(),
        "packages": {name: importlib.metadata.version(name) for name in
                     ["numpy", "scikit-learn", "fastapi", "uvicorn", "pytest", "joblib"]},
    }, indent=2))


if __name__ == "__main__":
    main()
