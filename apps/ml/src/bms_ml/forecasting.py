"""The forecaster seam and quantile post-processing (plan T3.5, R13).

A forecaster returns, per context, `horizon` buckets of the three quantiles in
`QUANTILES`. The scorer never trusts their order: each bucket is sorted before
the write (monotone rearrangement), and a point with any non-finite value is
refused rather than written. `ml.forecasts_quantiles_check` rejects anything
that gets past this.

The production forecaster is Chronos (`chronos_model.py`, plan PR 4), loaded
from weights baked into the image. Without a baked model, `run-once` and
`serve` exit 78.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

import numpy as np

QUANTILES: tuple[float, float, float] = (0.1, 0.5, 0.9)
MODEL_FILE = "MODEL.json"
WEIGHT_FILES = ("config.json", "model.safetensors")
# Decision 1 / decision 5: Apache-2.0 models only; ruling 5 picks one of these two.
MODEL_KINDS = {"amazon/chronos-2": "chronos2", "amazon/chronos-bolt-small": "bolt"}
_REVISION = re.compile(r"[0-9a-f]{40}")


class ForecastShapeError(ValueError):
    """The forecaster returned an array of the wrong shape."""


class NoModelError(RuntimeError):
    """No production forecaster is installed (exit code 78)."""


class Forecaster(Protocol):
    name: str
    version: str

    def predict(self, contexts: Sequence[np.ndarray], horizon: int) -> np.ndarray:
        """An array shaped (len(contexts), horizon, 3) for QUANTILES."""
        ...


def finalise_quantiles(raw: np.ndarray, n_points: int, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """Check the shape, sort each bucket's quantiles, flag points with a non-finite value.

    Returns `(ordered, ok)`: `ordered` has the input's shape, `ok[i]` is False
    when point `i` holds any NaN or infinity and must not be written.
    """
    values = np.asarray(raw, dtype=np.float64)
    expected = (n_points, horizon, len(QUANTILES))
    if values.shape != expected:
        raise ForecastShapeError(f"forecaster returned shape {values.shape}, expected {expected}")
    ok = np.isfinite(values).all(axis=(1, 2))
    return np.sort(values, axis=2), ok


def installed_model(model_dir: str) -> tuple[str, str]:
    """(repo, revision) of the model baked at `model_dir`, read without importing torch.

    The image build writes `MODEL.json` next to the weights, so `ml.model_runs`
    records what was baked, not what an environment variable claims. `serve`
    calls this: the parent reports the model on /health but never loads it
    (plan R11). Every refusal is a fixed message."""
    path = Path(model_dir) / MODEL_FILE
    if not path.is_file():
        raise NoModelError("no model installed: ML_MODEL_DIR holds no MODEL.json")
    try:
        identity = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        raise NoModelError("MODEL.json is not readable JSON") from None
    repo = identity.get("repo") if isinstance(identity, dict) else None
    revision = identity.get("revision") if isinstance(identity, dict) else None
    if not isinstance(repo, str) or repo not in MODEL_KINDS:
        raise NoModelError("MODEL.json names a model outside the ADR 0135 allowlist")
    if not isinstance(revision, str) or not _REVISION.fullmatch(revision):
        raise NoModelError("MODEL.json revision is not a 40-hex commit")
    for name in WEIGHT_FILES:
        if not (Path(model_dir) / name).is_file():
            raise NoModelError("ML_MODEL_DIR holds MODEL.json but not the weights it names")
    return repo, revision


def load_forecaster(model_dir: str, threads: int | None = None) -> Forecaster:
    """The production forecaster baked into the image at `model_dir`.

    Imported lazily: only a `run-once` child loads torch."""
    from bms_ml.chronos_model import load

    return load(model_dir, threads)
