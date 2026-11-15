"""The forecaster seam and quantile post-processing (plan T3.5, R13).

A forecaster returns, per context, `horizon` buckets of the three quantiles in
`QUANTILES`. The scorer never trusts their order: each bucket is sorted before
the write (monotone rearrangement), and a point with any non-finite value is
refused rather than written. `ml.forecasts_quantiles_check` rejects anything
that gets past this.

Plan PR 3 ships no production model: `load_forecaster` refuses, and
`run-once` / `serve` exit 78. Plan PR 4 adds the Chronos adapter behind it.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

import numpy as np

QUANTILES: tuple[float, float, float] = (0.1, 0.5, 0.9)


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


def load_forecaster(model_dir: str) -> Forecaster:
    """The production forecaster baked into the image at `model_dir`."""
    raise NoModelError("no model installed in this build")
