"""The integration fixture's shapes hold at every hour of the day.

`eligibility` counts UTC days (`date_trunc('day', bucket, 'UTC')`), and the
fixture's `as_of` is "this hour + 70 days", so a shape that spans a UTC midnight
at some hours changes the count with the clock. CI on main ran at 02:40 UTC and
saw W1 on 18 days instead of 17.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from tests.integration.fixture import hours_for


@pytest.mark.parametrize("hour", range(24))
def test_w1_is_17_utc_days_of_4_hours_at_every_hour(hour: int):
    as_of = datetime(2027, 1, 25, hour, tzinfo=UTC)
    buckets = [as_of - timedelta(hours=h) for h in hours_for("MLFX-W1", as_of)]
    assert len(set(buckets)) == 68
    assert len({b.date() for b in buckets}) == 17
