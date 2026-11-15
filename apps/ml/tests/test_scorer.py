from dataclasses import fields, replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

import numpy as np
import pytest

from bms_ml.config import load_config
from bms_ml.readiness import PointStats
from bms_ml.records import ForecastRow, PointRef
from bms_ml.scorer import run_cycle
from bms_ml.series import HourRow
from tests.fakes import FakeClock, FakeDb, FakeForecaster

NOW = datetime(2026, 11, 15, 12, 5, tzinfo=UTC)
AS_OF = datetime(2026, 11, 15, 12, tzinfo=UTC)
ORG_A = UUID("00000000-0000-0000-0000-00000000000a")
ORG_B = UUID("00000000-0000-0000-0000-00000000000b")
SECRET_DSN = "postgres://bms_fleet:hunter2-secret@db.internal:5432/bms"


def config(**env: str):
    return load_config({"DATABASE_URL_FLEET": SECRET_DSN, "ML_FORECAST_HORIZON_HOURS": "4", **env})


def asset(n: int) -> UUID:
    return UUID(int=0xA000 + n)


def ready(org: UUID, n: int, key: str = "cold_room_temp_c") -> PointStats:
    return PointStats(
        org, asset(n), f"ROOM-{n}", key, AS_OF - timedelta(days=60), AS_OF - timedelta(hours=1), 1440, 60
    )


def weak(org: UUID, n: int) -> PointStats:
    return PointStats(
        org, asset(n), f"ROOM-{n}", "cold_room_temp_c", AS_OF - timedelta(days=17), AS_OF, 70, 17
    )


def history(level: float, hours: int = 2016) -> list[HourRow]:
    return [HourRow(AS_OF - timedelta(hours=h), level, 1) for h in range(1, hours + 1)]


def db_for(*points: PointStats, levels: dict[int, float] | None = None) -> FakeDb:
    fake = FakeDb(stats=list(points))
    for point in points:
        level = (levels or {}).get(point.asset_id.int - 0xA000, float(point.asset_id.int - 0xA000))
        fake.histories[PointRef(point.asset_id, point.point_key)] = history(level)
    return fake


def cycle(db, forecaster=None, *, force=False, clock=None, cfg=None):
    return run_cycle(
        db, forecaster or FakeForecaster(), clock or FakeClock(NOW), cfg or config(), force=force
    )


def test_only_what_eligibility_returns_is_ever_seen_by_the_model():
    db = db_for(ready(ORG_A, 1))
    simulated = PointRef(asset(99), "cold_room_temp_c")
    db.histories[simulated] = history(999.0)  # a simulated series the scorer must never read
    forecaster = FakeForecaster()
    cycle(db, forecaster)
    assert all(not np.any(context == 999.0) for context in forecaster.seen)
    assert simulated not in [p for request in db.history_requests for p in request]
    assert {row.asset_id for _, _, row in db.forecasts} == {asset(1)}


def test_per_point_gating_inside_one_organization():
    db = db_for(ready(ORG_A, 1), weak(ORG_A, 2))
    summary = cycle(db)
    assert {row.asset_id for _, _, row in db.forecasts} == {asset(1)}
    assert summary.scored == 1
    assert summary.skipped["too_few_days"] == 1
    assert db.history_requests == [[PointRef(asset(1), "cold_room_temp_c")]]


def test_one_succeeded_run_per_organization_and_rows_written_matches():
    db = db_for(ready(ORG_A, 1), ready(ORG_A, 2), ready(ORG_B, 3))
    summary = cycle(db)
    assert sorted((run.organization_id, run.status, run.rows_written) for run in db.runs) == [
        (ORG_A, "succeeded", 8),
        (ORG_B, "succeeded", 4),
    ]
    assert summary.runs_succeeded == 2
    assert summary.rows_written == 12 == len(db.forecasts)
    for run in db.runs:
        assert run.rows_written == sum(1 for run_id, _, _ in db.forecasts if run_id == run.id)
        assert run.finished_at >= run.started_at
        assert len(run.config_hash) == 64


def test_the_horizon_starts_at_as_of_hour_and_issued_at_is_the_run_start():
    db = db_for(ready(ORG_A, 1))
    cycle(db)
    buckets = [row.horizon_bucket for _, _, row in db.forecasts]
    assert buckets == [AS_OF + timedelta(hours=k) for k in range(4)]
    (run,) = db.runs
    assert {issued for _, issued, _ in db.forecasts} == {run.started_at}


def test_quantiles_are_written_in_order_even_when_the_model_crosses_them():
    db = db_for(ready(ORG_A, 1), levels={1: 20.0})
    cycle(db, FakeForecaster(crossed=True))
    assert all(row.p10 <= row.p50 <= row.p90 for _, _, row in db.forecasts)
    assert {(row.p10, row.p50, row.p90) for _, _, row in db.forecasts} == {(19.0, 20.0, 21.0)}


def test_a_forecaster_failure_in_one_organization_still_scores_the_next():
    db = db_for(ready(ORG_A, 1), ready(ORG_B, 2))
    forecaster = FakeForecaster(fail_with=RuntimeError("boom"), fail_on_calls=frozenset({0}))
    summary = cycle(db, forecaster)
    by_org = {run.organization_id: run for run in db.runs}
    assert by_org[ORG_A].status == "failed"
    assert by_org[ORG_A].rows_written == 0
    assert by_org[ORG_A].error_text == "predict:RuntimeError"
    assert by_org[ORG_B].status == "succeeded"
    assert {row.asset_id for _, _, row in db.forecasts} == {asset(2)}
    assert (summary.runs_failed, summary.runs_succeeded) == (1, 1)


def test_error_text_never_carries_the_exception_message():
    db = db_for(ready(ORG_A, 1))
    db.fail_history_with = ConnectionError(f"could not connect to {SECRET_DSN}")
    summary = cycle(db)
    (run,) = db.runs
    assert run.error_text == "history:ConnectionError"
    assert "hunter2" not in run.error_text
    assert summary.runs_failed == 1


def test_already_scored_skips_and_force_writes_a_new_run():
    db = db_for(ready(ORG_A, 1))
    clock = FakeClock(NOW)
    cycle(db, clock=clock)
    assert len(db.runs) == 1
    second = cycle(db, clock=clock)
    assert len(db.runs) == 1
    assert second.organizations_already_scored == 1
    forced = cycle(db, clock=clock, force=True)
    assert forced.runs_succeeded == 1
    first_run, forced_run = db.runs
    assert forced_run.id != first_run.id
    assert forced_run.started_at > first_run.started_at
    issued = {issued for _, issued, _ in db.forecasts}
    assert issued == {first_run.started_at, forced_run.started_at}


def test_the_ledger_is_keyed_on_the_scored_hour_not_on_when_it_ran():
    db = db_for(ready(ORG_A, 1))
    clock = FakeClock(NOW)
    run_cycle(db, FakeForecaster(), clock, config())
    # A backfill of the previous hour, run later, is not "already scored".
    earlier = run_cycle(db, FakeForecaster(), clock, config(), as_of=AS_OF - timedelta(hours=1))
    assert earlier.runs_succeeded == 1
    # A future --as-of run twice writes once.
    future = AS_OF + timedelta(days=70)
    shift = timedelta(days=70)
    db.histories = {
        ref: [replace(row, bucket=row.bucket + shift) for row in rows] for ref, rows in db.histories.items()
    }
    db.stats = [replace(point, first_bucket=point.first_bucket + shift, last_bucket=point.last_bucket + shift)
                for point in db.stats]  # fmt: skip
    assert run_cycle(db, FakeForecaster(), clock, config(), as_of=future).runs_succeeded == 1
    assert run_cycle(db, FakeForecaster(), clock, config(), as_of=future).organizations_already_scored == 1


def test_a_changed_config_is_not_already_scored():
    db = db_for(ready(ORG_A, 1))
    clock = FakeClock(NOW)
    cycle(db, clock=clock)
    cycle(db, clock=clock, cfg=config(ML_CONTEXT_HOURS="1000"))
    assert len(db.runs) == 2
    assert db.runs[0].config_hash != db.runs[1].config_hash


def test_an_organization_with_no_ready_point_writes_no_run():
    db = db_for(ready(ORG_A, 1), weak(ORG_B, 2))
    cycle(db)
    assert {run.organization_id for run in db.runs} == {ORG_A}


def test_a_sparse_context_is_refused_after_the_history_read():
    db = db_for(ready(ORG_A, 1), ready(ORG_A, 2))
    db.histories[PointRef(asset(2), "cold_room_temp_c")] = history(2.0, hours=335)
    summary = cycle(db)
    assert summary.skipped["context_too_sparse"] == 1
    assert {row.asset_id for _, _, row in db.forecasts} == {asset(1)}


def test_a_non_finite_output_refuses_only_that_point():
    db = db_for(ready(ORG_A, 1), ready(ORG_A, 2))
    summary = cycle(db, FakeForecaster(non_finite_for=frozenset({1})))
    assert summary.skipped["non_finite_output"] == 1
    assert {row.asset_id for _, _, row in db.forecasts} == {asset(1)}
    (run,) = db.runs
    assert run.rows_written == 4


def test_a_forecast_row_carries_no_organization_id():
    assert "organization_id" not in {item.name for item in fields(ForecastRow)}


def test_the_summary_holds_counts_only():
    db = db_for(ready(ORG_A, 1), weak(ORG_A, 2))
    counts = cycle(db).counts()
    flat = repr(counts)
    assert "ROOM-" not in flat and str(ORG_A) not in flat and str(asset(1)) not in flat
    assert counts["eligible"] == 2 and counts["scored"] == 1 and counts["rows_written"] == 4


@pytest.mark.parametrize("hour_minute", [(12, 0), (12, 59)])
def test_as_of_hour_is_the_clock_floored(hour_minute):
    db = db_for(ready(ORG_A, 1))
    clock = FakeClock(datetime(2026, 11, 15, *hour_minute, tzinfo=UTC))
    assert cycle(db, clock=clock).as_of_hour == AS_OF
