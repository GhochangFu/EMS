"""`_1h` rows -> an hourly UTC grid with NaN gaps (ADR 0135 Amendment 1, decision 3).

A missing hour stays missing. Both Chronos models build their context mask
from `isnan`, so a gap is passed as NaN and never filled: no interpolation,
no forward or backward fill (`tests/test_no_imputation.py` holds that).
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import numpy as np


@dataclass(frozen=True)
class HourRow:
    """One `telemetry.point_values_1h` bucket for one point."""

    bucket: datetime
    sum_value: float | None
    sample_count: int | None


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("series needs timezone-aware datetimes")
    return value.astimezone(UTC)


def floor_to_hour(value: datetime) -> datetime:
    """The UTC hour that contains `value`."""
    return _utc(value).replace(minute=0, second=0, microsecond=0)


def hourly_grid(rows: Iterable[HourRow], start: datetime, hours: int) -> np.ndarray:
    """A fixed grid of `hours` hourly means from `start`; NaN where an hour is missing.

    An hour is missing when there is no row, `sample_count` is null or 0,
    `sum_value` is null, or the quotient is not finite. Rows outside
    `[start, start + hours)` are ignored. Gaps are never filled.
    """
    first = _utc(start)
    end = first + timedelta(hours=hours)
    grid = np.full(hours, np.nan, dtype=np.float64)
    for row in rows:
        bucket = _utc(row.bucket)
        if bucket < first or bucket >= end:
            continue
        offset = (bucket - first).total_seconds()
        if offset % 3600 != 0:
            raise ValueError("a _1h bucket is not on a whole UTC hour")
        if not row.sample_count or row.sum_value is None:
            continue
        value = float(row.sum_value) / int(row.sample_count)
        if not math.isfinite(value):
            continue
        grid[int(offset // 3600)] = value
    return grid


def build_context(rows: Iterable[HourRow], as_of_hour: datetime, context_hours: int) -> np.ndarray:
    """The context for one point: hourly values from its first data hour in the
    window to `as_of_hour - 1 h`, with NaN where an hour has no data.

    The window is the `context_hours` whole hours before `as_of_hour`; the hour
    that starts at `as_of_hour` is still filling and is excluded. Leading empty
    hours are trimmed; interior and trailing gaps are kept as NaN.
    """
    end = floor_to_hour(as_of_hour)
    grid = hourly_grid(rows, end - timedelta(hours=context_hours), context_hours)
    present = np.flatnonzero(np.isfinite(grid))
    if present.size == 0:
        return np.empty(0, dtype=np.float64)
    return grid[present[0] :].copy()


def non_missing_hours(context: np.ndarray) -> int:
    """How many hours of the context hold data."""
    return int(np.isfinite(context).sum())
