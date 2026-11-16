from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from bms_ml import readiness
from bms_ml.readiness import PointStats, coverage, forecast_verdict

AS_OF = datetime(2026, 11, 15, 12, tzinfo=UTC)
ORG = UUID("00000000-0000-0000-0000-00000000000a")
ASSET = UUID("00000000-0000-0000-0000-0000000000a1")


def stats(days: int, cover: float, newest_age_hours: int = 1) -> PointStats:
    """A point whose span is `days` whole days ending `newest_age_hours` before as_of."""
    last = AS_OF - timedelta(hours=newest_age_hours)
    span_hours = days * 24 - 1
    first = last - timedelta(hours=span_hours)
    hours = round(cover * (span_hours + 1))
    return PointStats(ORG, ASSET, "ROOM-1", "cold_room_temp_c", first, last, hours, days)


def test_constants_match_step_0():
    assert readiness.FORECASTING_MIN_DAYS == 14
    assert readiness.FORECASTING_GOOD_DAYS == 56
    assert readiness.ANOMALY_MIN_DAYS == 28
    assert readiness.MIN_COVERAGE == 0.8
    assert readiness.FRESHNESS_HOURS == 3
    assert readiness.LOOKBACK_DAYS == 400
    assert readiness.MIN_CONTEXT_HOURS == 14 * 24


@pytest.mark.parametrize(
    ("days", "cover", "expected"),
    [
        (130, 0.969, "ready"),  # GOAT
        (117, 0.851, "ready"),  # CHK
        (113, 0.819, "ready"),  # PORK, 1.9 points above the floor
        (113, 0.799, "low_coverage"),  # PORK after a bad week
        (33, 0.973, "too_few_days"),  # VAP_Chiller_Room_3, VAP_Deep_Freezer_2
        (17, 0.171, "too_few_days"),  # VAP_Blast_Freezer_2
        (56, 1.0, "ready"),  # exactly the floor
        (55, 1.0, "too_few_days"),  # one day short
    ],
)
def test_amendment_1_rooms(days, cover, expected):
    assert forecast_verdict(stats(days, cover), AS_OF) == expected


def test_freshness_three_hours_passes_four_is_stale():
    assert forecast_verdict(stats(60, 1.0, newest_age_hours=3), AS_OF) == "ready"
    assert forecast_verdict(stats(60, 1.0, newest_age_hours=4), AS_OF) == "stale"


def test_no_rows_is_no_data():
    empty = PointStats(ORG, ASSET, "ROOM-1", "cold_room_temp_c", None, None, 0, 0)
    assert forecast_verdict(empty, AS_OF) == "no_data"


def test_first_failure_wins():
    # too few days AND low coverage AND stale: the days verdict is reported.
    assert forecast_verdict(stats(20, 0.1, newest_age_hours=48), AS_OF) == "too_few_days"
    # enough days, low coverage AND stale: coverage is reported.
    assert forecast_verdict(stats(60, 0.5, newest_age_hours=48), AS_OF) == "low_coverage"


def test_coverage_is_the_cli_formula_capped_at_one():
    first = datetime(2026, 1, 1, tzinfo=UTC)
    assert coverage(first, first, 1) == 1.0
    assert coverage(first, first + timedelta(hours=9), 5) == 0.5
    assert coverage(first, first + timedelta(hours=9), 20) == 1.0
    assert coverage(None, None, 0) == 0.0


def test_naive_times_are_refused():
    naive = PointStats(ORG, ASSET, "R", "k", datetime(2026, 1, 1), datetime(2026, 3, 1), 100, 60)
    with pytest.raises(ValueError):
        forecast_verdict(naive, AS_OF)


def test_anomaly_thresholds_and_the_forecast_ones_are_untouched():
    assert readiness.ANOMALY_THRESHOLDS == {
        "anomaly_min_days": 28,
        "min_coverage": 0.8,
        "freshness_hours": 3,
        "lookback_days": 400,
    }
    assert readiness.THRESHOLDS == {
        "forecasting_min_days": 14,
        "forecasting_good_days": 56,
        "min_coverage": 0.8,
        "freshness_hours": 3,
        "lookback_days": 400,
    }


def test_anomaly_27_days_is_too_few_28_goes_on():
    from bms_ml.readiness import anomaly_verdict

    assert anomaly_verdict(stats(27, 1.0), AS_OF) == "too_few_days"
    assert anomaly_verdict(stats(28, 1.0), AS_OF) == "ready"
    assert anomaly_verdict(stats(28, 0.79), AS_OF) == "low_coverage"
    assert anomaly_verdict(stats(28, 1.0, newest_age_hours=4), AS_OF) == "stale"
    assert anomaly_verdict(stats(28, 1.0, newest_age_hours=3), AS_OF) == "ready"


def test_anomaly_order_is_no_data_then_days_then_coverage_then_stale():
    from bms_ml.readiness import anomaly_verdict

    empty = PointStats(ORG, ASSET, "R", "p", None, None, 0, 0)
    assert anomaly_verdict(empty, AS_OF) == "no_data"
    assert anomaly_verdict(stats(10, 0.5, newest_age_hours=9), AS_OF) == "too_few_days"
    assert anomaly_verdict(stats(30, 0.5, newest_age_hours=9), AS_OF) == "low_coverage"


def test_shared_verdict_takes_min_days_and_forecast_still_wants_56():
    from bms_ml.readiness import verdict

    assert verdict(stats(14, 1.0), AS_OF, 14) == "ready"
    assert verdict(stats(13, 1.0), AS_OF, 14) == "too_few_days"
    assert forecast_verdict(stats(28, 1.0), AS_OF) == "too_few_days"
