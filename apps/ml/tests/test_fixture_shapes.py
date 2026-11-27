"""The integration fixture's shapes hold at every hour of the day.

`eligibility` counts UTC days (`date_trunc('day', bucket, 'UTC')`), and the
fixture's `as_of` is "this hour + 70 days", so a shape that spans a UTC midnight
at some hours changes the count with the clock. CI on main ran at 02:40 UTC and
saw W1 on 18 days instead of 17.

Freshness is the same trap: `readiness.verdict` calls a point `stale` when its
last bucket is older than `as_of - FRESHNESS_HOURS`. G1's daily hole sat at
01:00-05:59 UTC, so a run starting 04:00-06:59 UTC (PR 1444, run 44457104767)
left G1's newest bucket at 00:00, stale, and G1 got no forecast.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from bms_ml.readiness import FRESHNESS_HOURS, PointStats, forecast_verdict
from tests.integration.fixture import AHEAD_DAYS, G1_MISSING_HOURS, as_of_for, full, hours_for

# The rooms `eligibility` returns (S1 is not real, T0's point is not a target)
# and the verdict each must get, whatever hour the suite starts.
EXPECTED_VERDICTS = {
    "MLFX-R1": "ready",
    "MLFX-R2": "ready",
    "MLFX-G1": "ready",
    "MLFX-O2": "ready",
    "MLFX-W1": "too_few_days",
    "MLFX-V1": "too_few_days",
}


def _as_of(hour: int) -> datetime:
    """The fixture's own `as_of`, from a fixed `now` at `hour`:17 UTC."""
    return as_of_for(datetime(2026, 11, 19, hour, 17, tzinfo=UTC), AHEAD_DAYS)


def _stats(code: str, as_of: datetime) -> PointStats:
    """What `eligibility` would read for this room's planted hours."""
    buckets = sorted(as_of - timedelta(hours=h) for h in hours_for(code, as_of))
    return PointStats(
        organization_id=uuid.uuid4(),
        asset_id=uuid.uuid4(),
        asset_code=code,
        point_key="ml_fixture_temp_c",
        first_bucket=buckets[0],
        last_bucket=buckets[-1],
        hours_with_data=len(buckets),
        days_with_data=len({b.date() for b in buckets}),
    )


@pytest.mark.parametrize("hour", range(24))
def test_w1_is_17_utc_days_of_4_hours_at_every_hour(hour: int):
    as_of = datetime(2027, 1, 25, hour, tzinfo=UTC)
    buckets = [as_of - timedelta(hours=h) for h in hours_for("MLFX-W1", as_of)]
    assert len(set(buckets)) == 68
    assert len({b.date() for b in buckets}) == 17


@pytest.mark.parametrize("hour", range(24))
def test_every_room_gets_its_verdict_at_every_hour(hour: int):
    as_of = _as_of(hour)
    verdicts = {code: forecast_verdict(_stats(code, as_of), as_of) for code in EXPECTED_VERDICTS}
    assert verdicts == EXPECTED_VERDICTS


@pytest.mark.parametrize("hour", range(24))
def test_g1_is_fresh_and_its_hole_is_interior_at_every_hour(hour: int):
    as_of = _as_of(hour)
    present = set(hours_for("MLFX-G1", as_of))
    missing = set(full(60)) - present
    # The newest bucket is inside the freshness line, at every hour.
    assert min(present) <= FRESHNESS_HOURS
    # 75 hours missing, all in the last 15 days and all between two planted
    # hours, so the context carries every one of them as NaN.
    assert len(missing) == G1_MISSING_HOURS
    assert max(missing) <= 15 * 24
    assert min(present) < min(missing) and max(missing) < max(present)
    # Five hours a day: each of the last 15 days holds exactly one 5 h hole.
    assert sorted({(h - 1) // 24 for h in missing}) == list(range(15))
