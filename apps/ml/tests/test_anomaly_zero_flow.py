"""Zero flow on a one-point flow meter (ADR 0135 Amendment 7 item 4): no special rule.

Pure numpy grids against the unchanged `baseline_mad` detector. Every name and
number here is made up; no site, meter or reading is real.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from bms_ml import anomaly_baseline as ab
from bms_ml.anomaly_baseline import SLOT_MODE_DAY, evaluate_asset, score_baseline

# The read-time line, `ANOMALY_UNUSUAL_SCORE` in packages/shared/src/contracts/ml-anomalies.ts.
# `src/bms_ml` never knows it (E1.2 plan R18); tests/e1.1-ml-readiness-single-source.test.ts
# fails if the two drift apart.
ANOMALY_UNUSUAL_SCORE = 0.99

POINT = "made_up_flow"
FIRST = datetime(2026, 1, 5, 0, tzinfo=UTC)  # the meter's first hour: a Monday, 00:00 UTC
REFERENCE_DAYS = 28
SCORED_DAYS = 7
HOURS = (REFERENCE_DAYS + SCORED_DAYS) * 24
RUN_LEVEL = 100.0
STOP_PATTERNS = ((20,), (20, 21), tuple(range(16, 24)))
NAN = float("nan")


def flow(stop_hours: tuple[int, ...]) -> np.ndarray:
    """35 days: a level that moves a little while the pump runs, exactly 0 in the stop hours."""
    i = np.arange(HOURS)
    series = RUN_LEVEL + 2.0 * (((i * 7) % 5) - 2)
    series[np.isin(i % 24, stop_hours)] = 0.0
    return series


def at(series: np.ndarray, index: int) -> tuple[dict[str, np.ndarray], datetime, datetime]:
    """The scorer's grid for hour `index`: 2,184 h before it (NaN before the first sample), then it."""
    scored_hour = FIRST + timedelta(hours=index)
    grid = np.full(ab.BASELINE_HOURS + 1, NAN)
    history = series[max(0, index - ab.BASELINE_HOURS) : index + 1]
    grid[-history.size :] = history
    return {POINT: grid}, scored_hour - timedelta(hours=ab.BASELINE_HOURS), scored_hour


def scored_week() -> range:
    return range(REFERENCE_DAYS * 24, HOURS)


@pytest.mark.parametrize("stop_hours", STOP_PATTERNS)
def test_a_daily_stop_at_a_fixed_utc_hour_is_never_unusual_once_28_days_are_in(stop_hours):
    series = flow(stop_hours)
    stops = [i for i in scored_week() if i % 24 in stop_hours]
    assert len(stops) == SCORED_DAYS * len(stop_hours)
    for index in stops:
        grids, start, scored_hour = at(series, index)
        outcome = score_baseline(grids, start, scored_hour)
        asset = evaluate_asset(grids, start, scored_hour)
        assert asset.points[POINT].mode == SLOT_MODE_DAY  # under 56 days: hour of day
        assert (outcome.skip_reason, outcome.reference_size) == (None, ab.REFERENCE_HOURS)
        assert outcome.score < ANOMALY_UNUSUAL_SCORE
        # The mechanism, not only the line: the stop hour's own median is 0, so z is 0.
        assert asset.z_at_hour == {POINT: 0.0}
        assert outcome.score == 0.0
        assert outcome.contributing_points == ()


@pytest.mark.parametrize("stop_hours", STOP_PATTERNS)
def test_a_stop_in_an_hour_that_is_normally_on_is_unusual(stop_hours):
    series = flow(stop_hours)
    index = 30 * 24 + 9  # 09:00 UTC on day 31: the pump runs at this hour every day
    assert series[index] > 0
    series[index] = 0.0
    outcome = score_baseline(*at(series, index))
    assert outcome.score >= ANOMALY_UNUSUAL_SCORE
    assert outcome.score == 1.0
    assert outcome.contributing_points == (POINT,)


@pytest.mark.parametrize("stop_hours", STOP_PATTERNS)
def test_a_run_in_an_hour_that_is_normally_off_is_unusual(stop_hours):
    series = flow(stop_hours)
    index = 30 * 24 + stop_hours[0]
    assert series[index] == 0.0
    series[index] = RUN_LEVEL
    outcome = score_baseline(*at(series, index))
    assert outcome.score >= ANOMALY_UNUSUAL_SCORE


def test_a_meter_that_is_always_0_scores_0():
    series = np.zeros(HOURS)
    scores = {score_baseline(*at(series, index)).score for index in scored_week()}
    assert scores == {0.0}
