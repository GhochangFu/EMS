"""Per-point readiness: may this point be forecast now? (ADR 0135 Amendment 1, decision 2)

The thresholds are step 0's (`packages/db/src/ml-data-readiness.ts`
`THRESHOLDS`); `tests/e1.1-ml-readiness-single-source.test.ts` fails if the
two drift apart. Days and coverage use the readiness CLI's definitions, so the
scorer's verdict per room reproduces Amendment 1's table.

The order is the plan's R8, and the first failure wins:
`no_data` -> `too_few_days` -> `low_coverage` -> `stale` -> `ready`.
Two more refusals happen after the history read, in the scorer:
`context_too_sparse` and `non_finite_output`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

FORECASTING_MIN_DAYS = 14
FORECASTING_GOOD_DAYS = 56
ANOMALY_MIN_DAYS = 28
MIN_COVERAGE = 0.8
FRESHNESS_HOURS = 3
LOOKBACK_DAYS = 400

# A context needs at least the minimum days' worth of hours that hold data.
MIN_CONTEXT_HOURS = FORECASTING_MIN_DAYS * 24

THRESHOLDS = {
    "forecasting_min_days": FORECASTING_MIN_DAYS,
    "forecasting_good_days": FORECASTING_GOOD_DAYS,
    "min_coverage": MIN_COVERAGE,
    "freshness_hours": FRESHNESS_HOURS,
    "lookback_days": LOOKBACK_DAYS,
}


ANOMALY_THRESHOLDS = {
    "anomaly_min_days": ANOMALY_MIN_DAYS,
    "min_coverage": MIN_COVERAGE,
    "freshness_hours": FRESHNESS_HOURS,
    "lookback_days": LOOKBACK_DAYS,
}


@dataclass(frozen=True)
class PointStats:
    """One target point's `_1h` history inside the lookback, as the eligibility read returns it."""

    organization_id: UUID
    asset_id: UUID
    asset_code: str
    point_key: str
    first_bucket: datetime | None
    last_bucket: datetime | None
    hours_with_data: int
    days_with_data: int


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("readiness needs timezone-aware datetimes")
    return value


def coverage(first: datetime | None, last: datetime | None, hours_with_data: int) -> float:
    """hours_with_data / max(1, span_hours + 1), capped at 1 (the CLI's formula)."""
    if first is None or last is None or hours_with_data <= 0:
        return 0.0
    span_hours = (_aware(last) - _aware(first)).total_seconds() / 3600
    return min(1.0, hours_with_data / max(1.0, span_hours + 1))


def verdict(stats: PointStats, as_of_hour: datetime, min_days: int) -> str:
    """The verdict for one point at `as_of_hour`, the first failure winning."""
    if stats.hours_with_data <= 0 or stats.first_bucket is None or stats.last_bucket is None:
        return "no_data"
    if stats.days_with_data < min_days:
        return "too_few_days"
    if coverage(stats.first_bucket, stats.last_bucket, stats.hours_with_data) < MIN_COVERAGE:
        return "low_coverage"
    if _aware(stats.last_bucket) < _aware(as_of_hour) - timedelta(hours=FRESHNESS_HOURS):
        return "stale"
    return "ready"


def forecast_verdict(stats: PointStats, as_of_hour: datetime) -> str:
    """The R8 verdict for one point at `as_of_hour`."""
    return verdict(stats, as_of_hour, FORECASTING_GOOD_DAYS)


def anomaly_verdict(stats: PointStats, as_of_hour: datetime) -> str:
    """The same checks with the anomaly job's 28-day floor (plan 4.2)."""
    return verdict(stats, as_of_hour, ANOMALY_MIN_DAYS)
