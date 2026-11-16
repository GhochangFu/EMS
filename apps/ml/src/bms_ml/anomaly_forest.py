"""The Isolation Forest detector (plan T1.4, section 4.4, R1/R4).

The only module in apps/ml that imports scikit-learn. A forest is fitted new on
every call to `score_hour`, on the hours of the reference window where every
scored point is present. A gap is NaN and stays NaN: a row with a missing value
is never a training row and is never filled.

The statistic is `i(t) = -score_samples(row)`, higher is more unusual. The score
is the share of training rows whose statistic is strictly below `i(S)` (ADR 0135
Amendment 5, ties count strictly below).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import sklearn
from sklearn.ensemble import IsolationForest

MIN_TRAINING_ROWS = 336
# The scorer feeds these to the run's config hash.
FOREST_KWARGS: dict[str, Any] = {
    "n_estimators": 100,
    "max_samples": 256,
    "contamination": "auto",
    "max_features": 1.0,
    "bootstrap": False,
    "n_jobs": 1,
    "random_state": 135,
    "warm_start": False,
}
SKLEARN_VERSION: str = sklearn.__version__

SKIP_TOO_FEW_ROWS = "if_too_few_rows"
SKIP_INCOMPLETE_HOUR = "if_incomplete_hour"


@dataclass(frozen=True)
class ForestResult:
    """A score in [0, 1], or the reason there is none."""

    score: float | None = None
    skip_reason: str | None = None


def _share_strictly_below(reference: np.ndarray, value: float) -> float:
    return float(np.count_nonzero(reference < value)) / float(reference.size)


def score_hour(reference: np.ndarray, current: np.ndarray) -> ForestResult:
    """Score the hour `current` (shape (P,)) against `reference` (shape (rows, P))."""
    matrix = np.asarray(reference, dtype=np.float64)
    row = np.asarray(current, dtype=np.float64).reshape(-1)
    training = matrix[~np.isnan(matrix).any(axis=1)]
    if training.shape[0] < MIN_TRAINING_ROWS:
        return ForestResult(skip_reason=SKIP_TOO_FEW_ROWS)
    if np.isnan(row).any():
        return ForestResult(skip_reason=SKIP_INCOMPLETE_HOUR)
    forest = IsolationForest(**FOREST_KWARGS)
    forest.fit(training)
    reference_stat = -forest.score_samples(training)
    current_stat = float(-forest.score_samples(row.reshape(1, -1))[0])
    return ForestResult(score=_share_strictly_below(reference_stat, current_stat))
