from datetime import UTC, datetime, timedelta, timezone

import numpy as np
import pytest

from bms_ml.series import HourRow, build_context, floor_to_hour, non_missing_hours

AS_OF = datetime(2026, 11, 15, 12, tzinfo=UTC)
IST = timezone(timedelta(hours=5, minutes=30))


def hourly(start: datetime, hours: int, value: float = 4.0, count: int = 4) -> list[HourRow]:
    return [HourRow(start + timedelta(hours=i), value * count, count) for i in range(hours)]


def test_value_is_sum_over_count():
    rows = [HourRow(AS_OF - timedelta(hours=2), 10.0, 4), HourRow(AS_OF - timedelta(hours=1), 9.0, 3)]
    assert build_context(rows, AS_OF, 336).tolist() == [2.5, 3.0]


def test_a_missing_hour_is_nan_and_stays_nan():
    rows = [HourRow(AS_OF - timedelta(hours=3), 1.0, 1), HourRow(AS_OF - timedelta(hours=1), 3.0, 1)]
    context = build_context(rows, AS_OF, 336)
    assert context[0] == 1.0
    assert np.isnan(context[1])
    assert context[2] == 3.0


def test_a_daily_five_and_a_half_hour_gap_over_15_days_survives_as_nan_runs():
    start = AS_OF - timedelta(days=15)
    rows = [row for row in hourly(start, 15 * 24) if not 1 <= row.bucket.hour <= 5]
    context = build_context(rows, AS_OF, 2016)
    assert len(context) == 15 * 24
    nan_runs = np.flatnonzero(np.diff(np.isnan(context).astype(int)) == 1)
    assert len(nan_runs) == 15
    assert int(np.isnan(context).sum()) == 15 * 5


def test_the_current_partial_hour_and_later_are_excluded():
    rows = hourly(AS_OF - timedelta(hours=2), 4)  # AS_OF-2h, -1h, AS_OF, AS_OF+1h
    assert len(build_context(rows, AS_OF, 336)) == 2


def test_leading_empty_hours_are_trimmed_trailing_ones_are_kept():
    rows = [HourRow(AS_OF - timedelta(hours=10), 5.0, 1)]
    context = build_context(rows, AS_OF, 336)
    assert len(context) == 10
    assert context[0] == 5.0
    assert np.isnan(context[1:]).all()


def test_the_window_is_capped_at_context_hours():
    rows = hourly(AS_OF - timedelta(hours=5000), 5000)
    context = build_context(rows, AS_OF, 336)
    assert len(context) == 336
    assert non_missing_hours(context) == 336


def test_the_grid_is_utc_whatever_zone_the_rows_arrive_in():
    utc_rows = hourly(AS_OF - timedelta(hours=48), 48)
    ist_rows = [HourRow(row.bucket.astimezone(IST), row.sum_value, row.sample_count) for row in utc_rows]
    expected = build_context(utc_rows, AS_OF, 336)
    assert np.array_equal(build_context(ist_rows, AS_OF.astimezone(IST), 336), expected)


def test_rows_with_no_samples_or_non_finite_values_are_gaps():
    rows = [
        HourRow(AS_OF - timedelta(hours=4), 2.0, 1),
        HourRow(AS_OF - timedelta(hours=3), 5.0, 0),
        HourRow(AS_OF - timedelta(hours=2), None, None),
        HourRow(AS_OF - timedelta(hours=1), float("inf"), 1),
    ]
    context = build_context(rows, AS_OF, 336)
    assert context[0] == 2.0
    assert np.isnan(context[1:]).all()
    assert non_missing_hours(context) == 1


def test_no_data_is_an_empty_context():
    assert build_context([], AS_OF, 336).size == 0
    assert non_missing_hours(build_context([], AS_OF, 336)) == 0


def test_naive_times_are_refused():
    with pytest.raises(ValueError):
        build_context([HourRow(datetime(2026, 11, 15, 10), 1.0, 1)], AS_OF, 336)
    with pytest.raises(ValueError):
        floor_to_hour(datetime(2026, 11, 15, 10, 30))


def test_an_unaligned_bucket_is_refused():
    with pytest.raises(ValueError):
        build_context([HourRow(AS_OF - timedelta(minutes=90), 1.0, 1)], AS_OF, 336)


def test_floor_to_hour_returns_utc():
    floored = floor_to_hour(datetime(2026, 11, 15, 17, 59, 59, tzinfo=IST))
    assert floored == datetime(2026, 11, 15, 12, tzinfo=UTC)
    assert floored.tzinfo is UTC


def test_hourly_grid_of_2185_hours_ends_at_the_scored_hour():
    from bms_ml.series import hourly_grid

    scored = datetime(2026, 11, 15, 11, tzinfo=UTC)  # S = H - 1 h
    start = scored - timedelta(hours=2184)
    grid = hourly_grid(hourly(start, 2185), start, 2185)
    assert grid.shape == (2185,)
    assert grid[0] == 4.0 and grid[-1] == 4.0
    assert not np.isnan(grid).any()
    # one hour past S is outside the grid
    grid = hourly_grid(hourly(start, 2186), start, 2185)
    assert grid.shape == (2185,)


@pytest.mark.parametrize(
    "row",
    [
        HourRow(datetime(2026, 11, 15, 1, tzinfo=UTC), 5.0, 0),
        HourRow(datetime(2026, 11, 15, 1, tzinfo=UTC), 5.0, None),
        HourRow(datetime(2026, 11, 15, 1, tzinfo=UTC), None, 3),
        HourRow(datetime(2026, 11, 15, 1, tzinfo=UTC), float("inf"), 3),
        HourRow(datetime(2026, 11, 15, 1, tzinfo=UTC), float("nan"), 3),
    ],
)
def test_hourly_grid_missing_hour_is_nan(row):
    from bms_ml.series import hourly_grid

    start = datetime(2026, 11, 15, 0, tzinfo=UTC)
    grid = hourly_grid([row], start, 3)
    assert np.isnan(grid).all()


def test_hourly_grid_keeps_gaps_and_values():
    from bms_ml.series import hourly_grid

    start = datetime(2026, 11, 15, 0, tzinfo=UTC)
    rows = [HourRow(start, 6.0, 3), HourRow(start + timedelta(hours=2), 9.0, 3)]
    grid = hourly_grid(rows, start, 4)
    assert grid[0] == 2.0 and np.isnan(grid[1]) and grid[2] == 3.0 and np.isnan(grid[3])


def test_hourly_grid_refuses_an_off_hour_bucket():
    from bms_ml.series import hourly_grid

    start = datetime(2026, 11, 15, 0, tzinfo=UTC)
    with pytest.raises(ValueError):
        hourly_grid([HourRow(start + timedelta(minutes=30), 1.0, 1)], start, 3)


def test_hourly_grid_keeps_an_hour_of_zeros_as_0_not_a_gap():
    from bms_ml.series import hourly_grid

    start = datetime(2026, 11, 15, 0, tzinfo=UTC)
    rows = [HourRow(start, 0.0, 12), HourRow(start + timedelta(hours=1), 6.0, 12)]
    grid = hourly_grid(rows, start, 3)
    assert grid[0] == 0.0 and grid[1] == 0.5 and np.isnan(grid[2])
