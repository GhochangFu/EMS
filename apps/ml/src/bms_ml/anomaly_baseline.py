"""The median/MAD baseline detector, `baseline_mad` (ADR 0135 Amendment 5; plan e1.2 section 4).

Pure numpy: this module never imports `sklearn` (the forest lives in its own
module). It takes one float64 grid per scored point, hourly from `grid_start`,
with NaN where an hour is missing, and scores the hour `scored_hour` (`S`).

- Baseline window `B` = `[S - 2,184 h, S)`: slot median and MAD, and the floor.
- Reference window `W` = `[S - 672 h, S)`: the percentile's reference.
- Neither holds `S`. A missing hour is never a number: it is skipped, never
  filled (`tests/test_no_imputation.py`).
- `score = count(r in R : r < b(S)) / n`: strictly below (the ties correction).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime

import numpy as np

DETECTOR_BASELINE = "baseline_mad"
DETECTOR_FOREST = "isolation_forest"
ANOMALY_MODEL_NAME = "bms-anomaly"

REFERENCE_HOURS = 672
BASELINE_HOURS = 2184
SLOT_MIN_SAMPLES = 8
REFERENCE_MIN = 336
MAD_SCALE = 1.4826
FLOOR_ABSOLUTE = 1e-6
FLOOR_MEDIAN_FRACTION = 1e-4
FLOOR_SPREAD_FRACTION = 0.01
FLOOR_SPREAD_LOW_PERCENTILE = 5
FLOOR_SPREAD_HIGH_PERCENTILE = 95
CONTRIBUTING_POINTS_MAX = 3
TIES = "strict"

SLOT_MODE_WEEK = "hour_of_week"
SLOT_MODE_DAY = "hour_of_day"
WEEK_SLOTS = 168
DAY_SLOTS = 24

SKIP_REFERENCE_TOO_SPARSE = "reference_too_sparse"
SKIP_NO_DATA_AT_HOUR = "no_data_at_hour"
SKIP_SLOT_TOO_SPARSE = "slot_too_sparse"

# Every constant of section 4.1-4.5 this module owns, for the anomaly config hash.
BASELINE_HASH_CONSTANTS: dict[str, object] = {
    "reference_hours": REFERENCE_HOURS,
    "baseline_hours": BASELINE_HOURS,
    "slot_min_samples": SLOT_MIN_SAMPLES,
    "reference_min": REFERENCE_MIN,
    "mad_scale": MAD_SCALE,
    "floor_absolute": FLOOR_ABSOLUTE,
    "floor_median_fraction": FLOOR_MEDIAN_FRACTION,
    "floor_spread_fraction": FLOOR_SPREAD_FRACTION,
    "floor_spread_percentiles": [FLOOR_SPREAD_LOW_PERCENTILE, FLOOR_SPREAD_HIGH_PERCENTILE],
    "contributing_points_max": CONTRIBUTING_POINTS_MAX,
    "ties": TIES,
}

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)  # a Thursday: weekday 3 with Monday = 0
_EPOCH_WEEKDAY = 3


def _hour_index(value: datetime) -> int:
    """Whole UTC hours since the epoch; refuses a naive or non-whole-hour time."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("anomaly baseline needs timezone-aware datetimes")
    seconds = (value - _EPOCH).total_seconds()
    if seconds % 3600 != 0:
        raise ValueError("anomaly baseline needs whole UTC hours")
    return int(seconds // 3600)


def _how(hour_indexes: np.ndarray) -> np.ndarray:
    weekday = (hour_indexes // 24 + _EPOCH_WEEKDAY) % 7
    return weekday * 24 + hour_indexes % 24


def hour_of_week(value: datetime) -> int:
    """`weekday(t) x 24 + hour(t)`, Monday = 0, UTC."""
    utc = value.astimezone(UTC)
    _hour_index(value)
    return utc.weekday() * 24 + utc.hour


def hour_of_week_slots(first_hour: datetime, count: int) -> np.ndarray:
    """The hour-of-week slot of each of `count` hours from `first_hour`."""
    return _how(_hour_index(first_hour) + np.arange(count, dtype=np.int64))


def percentile_strictly_below(reference: np.ndarray, value: float) -> float:
    """`count(r < value) / n`: the share of the reference strictly below `value`.

    Shared by both detectors. The reference must be non-empty and finite.
    """
    ref = np.asarray(reference, dtype=np.float64)
    if ref.size == 0:
        raise ValueError("percentile needs a non-empty reference")
    if not np.all(np.isfinite(ref)):
        raise ValueError("percentile needs a finite reference")
    return int(np.count_nonzero(ref < value)) / int(ref.size)


@dataclass(frozen=True)
class PointBaseline:
    """One point's slot statistics over its baseline window.

    `medians` and `mads` are NaN for an undefined slot (fewer than 8 samples);
    `floor` is NaN when the window holds no value at all.
    """

    mode: str
    counts: np.ndarray
    medians: np.ndarray
    mads: np.ndarray
    floor: float

    def slots(self, first_hour: datetime, count: int) -> np.ndarray:
        indexes = _hour_index(first_hour) + np.arange(count, dtype=np.int64)
        return _how(indexes) if self.mode == SLOT_MODE_WEEK else indexes % 24

    def z(self, values: np.ndarray, first_hour: datetime) -> np.ndarray:
        """Robust z per hour; NaN where the value is missing or the slot undefined."""
        x = np.asarray(values, dtype=np.float64)
        k = self.slots(first_hour, x.size)
        scale = MAD_SCALE * np.maximum(self.mads[k], self.floor)
        with np.errstate(invalid="ignore"):
            z = np.abs(x - self.medians[k]) / scale
        z[~np.isfinite(x)] = np.nan
        return z


def fit_point(values: np.ndarray, first_hour: datetime) -> PointBaseline:
    """Slot mode, slot median/MAD and the floor over a baseline window (4.3 steps 1-3)."""
    x = np.asarray(values, dtype=np.float64)
    present = np.isfinite(x)
    indexes = _hour_index(first_hour) + np.arange(x.size, dtype=np.int64)
    how = _how(indexes)
    week_counts = np.bincount(how[present], minlength=WEEK_SLOTS)
    if week_counts.min() >= SLOT_MIN_SAMPLES:
        mode, slots, size = SLOT_MODE_WEEK, how, WEEK_SLOTS
    else:
        mode, slots, size = SLOT_MODE_DAY, indexes % 24, DAY_SLOTS

    counts = np.zeros(size, dtype=np.int64)
    medians = np.full(size, np.nan)
    mads = np.full(size, np.nan)
    for k in range(size):
        sample = x[present & (slots == k)]
        counts[k] = sample.size
        if sample.size >= SLOT_MIN_SAMPLES:
            medians[k] = np.median(sample)
            mads[k] = np.median(np.abs(sample - medians[k]))

    finite = x[present]
    if finite.size:
        p05, p95 = np.percentile(finite, [FLOOR_SPREAD_LOW_PERCENTILE, FLOOR_SPREAD_HIGH_PERCENTILE])
        floor = max(
            FLOOR_ABSOLUTE,
            FLOOR_MEDIAN_FRACTION * float(np.median(np.abs(finite))),
            FLOOR_SPREAD_FRACTION * float(p95 - p05),
        )
    else:
        floor = float("nan")
    return PointBaseline(mode=mode, counts=counts, medians=medians, mads=mads, floor=floor)


def contributing_points(z_at_hour: Mapping[str, float | None]) -> tuple[str, ...]:
    """Points with a defined `z > 0`, by `z` descending then key ascending; the first 3."""
    defined = [(key, float(z)) for key, z in z_at_hour.items() if z is not None and np.isfinite(z) and z > 0]
    defined.sort(key=lambda item: (-item[1], item[0]))
    return tuple(key for key, _ in defined[:CONTRIBUTING_POINTS_MAX])


@dataclass(frozen=True)
class AssetBaseline:
    """The intermediate values of one asset at one scored hour."""

    points: dict[str, PointBaseline]
    z_at_hour: dict[str, float | None]
    value_present_at_hour: dict[str, bool]
    b_at_hour: float | None
    reference: np.ndarray  # defined b(t) over W, in time order


@dataclass(frozen=True)
class BaselineOutcome:
    """A `baseline_mad` score, or the reason there is none.

    `contributing_points` is filled whenever any point has `z > 0` at the hour,
    also when the score is skipped, so the forest row can carry the same list.
    """

    score: float | None
    skip_reason: str | None
    contributing_points: tuple[str, ...]
    reference_size: int


def evaluate_asset(
    grids: Mapping[str, np.ndarray], grid_start: datetime, scored_hour: datetime
) -> AssetBaseline:
    """Per point fit over `B`, `z` at `S`, `b(S)` and the reference `{b(t) : t in W}`."""
    if not grids:
        raise ValueError("an asset needs at least one scored point")
    start = _hour_index(grid_start)
    s = _hour_index(scored_hour) - start
    arrays = {key: np.asarray(grids[key], dtype=np.float64) for key in sorted(grids)}
    lengths = {a.shape for a in arrays.values()}
    if len(lengths) != 1 or len(next(iter(lengths))) != 1:
        raise ValueError("every point grid must be one-dimensional and of one length")
    length = next(iter(lengths))[0]
    if not 0 <= s < length:
        raise ValueError("the scored hour must lie inside the grid")

    b_from = max(0, s - BASELINE_HOURS)
    w_from = max(0, s - REFERENCE_HOURS)
    b_first = datetime.fromtimestamp((start + b_from) * 3600, UTC)
    w_first = datetime.fromtimestamp((start + w_from) * 3600, UTC)

    points: dict[str, PointBaseline] = {}
    z_at_hour: dict[str, float | None] = {}
    present_at_hour: dict[str, bool] = {}
    window_z = []
    for key, x in arrays.items():
        fit = fit_point(x[b_from:s], b_first)
        points[key] = fit
        window_z.append(fit.z(x[w_from:s], w_first))
        z_s = float(fit.z(x[s : s + 1], scored_hour)[0])
        z_at_hour[key] = z_s if np.isfinite(z_s) else None
        present_at_hour[key] = bool(np.isfinite(x[s]))

    b_window = np.fmax.reduce(np.stack(window_z), axis=0)
    reference = b_window[np.isfinite(b_window)]
    defined = [z for z in z_at_hour.values() if z is not None]
    return AssetBaseline(
        points=points,
        z_at_hour=z_at_hour,
        value_present_at_hour=present_at_hour,
        b_at_hour=max(defined) if defined else None,
        reference=reference,
    )


def score_baseline(
    grids: Mapping[str, np.ndarray], grid_start: datetime, scored_hour: datetime
) -> BaselineOutcome:
    """The `baseline_mad` score of one asset at `scored_hour` (section 4.3)."""
    asset = evaluate_asset(grids, grid_start, scored_hour)
    listed = contributing_points(asset.z_at_hour)
    n = int(asset.reference.size)
    if n < REFERENCE_MIN:
        return BaselineOutcome(None, SKIP_REFERENCE_TOO_SPARSE, listed, n)
    if asset.b_at_hour is None:
        reason = SKIP_SLOT_TOO_SPARSE if any(asset.value_present_at_hour.values()) else SKIP_NO_DATA_AT_HOUR
        return BaselineOutcome(None, reason, listed, n)
    return BaselineOutcome(percentile_strictly_below(asset.reference, asset.b_at_hour), None, listed, n)
