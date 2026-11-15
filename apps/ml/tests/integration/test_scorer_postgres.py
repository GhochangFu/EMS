"""The pipeline end to end against a real TimescaleDB, as bms_fleet, with a fake model (plan T3.10).

Both directions every time: forecasts are written where they should be, and
NOT written for the weak, the simulated and the non-target points.
"""

from __future__ import annotations

from datetime import timedelta

import numpy as np
import psycopg
import pytest

from bms_ml.config import load_config
from bms_ml.db import sql
from bms_ml.db.gateway import Gateway, PreflightError, parse_marker
from bms_ml.readiness import LOOKBACK_DAYS
from bms_ml.scorer import run_cycle
from tests.fakes import FakeClock, FakeForecaster
from tests.integration.fixture import (
    FORECAST,
    FORECASTER_NAME,
    G1_MISSING_HOURS,
    NO_FORECAST,
    TARGET,
    Planted,
)

pytestmark = pytest.mark.integration


def config(fleet_url: str):
    return load_config({"DATABASE_URL_FLEET": fleet_url, "ML_FORECAST_TARGETS": TARGET})


def test_preflight_passes_as_bms_fleet(fleet_url):
    with Gateway.connect(fleet_url) as db:
        assert db.preflight() == (1, "bms_fleet")


def test_preflight_refuses_the_superuser(database_urls):
    with Gateway.connect(database_urls[0]) as db, pytest.raises(PreflightError, match="superuser"):
        db.preflight()


def test_the_marker_sql_refuses_a_schema_without_its_marker(superuser):
    with superuser.transaction(force_rollback=True):
        superuser.execute("COMMENT ON SCHEMA ml IS NULL")
        row = superuser.cursor(row_factory=psycopg.rows.dict_row).execute(sql.PREFLIGHT_MARKER_SQL).fetchone()
        with pytest.raises(PreflightError, match="no bms-ml-schema-version marker"):
            parse_marker(row)
    assert superuser.execute("SELECT obj_description('ml'::regnamespace, 'pg_namespace')").fetchone()[0] == (
        "bms-ml-schema-version=1"
    )


def test_the_marker_sql_refuses_an_absent_schema(superuser):
    with superuser.transaction(force_rollback=True):
        superuser.execute("ALTER SCHEMA ml RENAME TO ml_hidden_by_test")
        row = superuser.cursor(row_factory=psycopg.rows.dict_row).execute(sql.PREFLIGHT_MARKER_SQL).fetchone()
        with pytest.raises(PreflightError, match="schema ml is absent"):
            parse_marker(row)


def test_eligibility_returns_the_real_target_points_only(planted: Planted, fleet_url):
    with Gateway.connect(fleet_url) as db:
        stats = db.eligibility(
            config(fleet_url).forecast_targets, planted.as_of - timedelta(days=LOOKBACK_DAYS), planted.as_of
        )
    mine = {point.asset_code: point for point in stats if point.asset_code.startswith("MLFX-")}
    # S1 is not real (no mqtt, RTU not ingest-enabled); T0's point is not a target.
    assert sorted(mine) == sorted(["MLFX-R1", "MLFX-R2", "MLFX-G1", "MLFX-W1", "MLFX-V1", "MLFX-O2"])
    assert mine["MLFX-R1"].hours_with_data == 1440
    assert mine["MLFX-G1"].hours_with_data == 1440 - G1_MISSING_HOURS
    assert mine["MLFX-W1"].days_with_data == 17
    assert mine["MLFX-O2"].organization_id == planted.organizations["B"]


def _fingerprint(superuser: psycopg.Connection, run_id) -> str:
    return superuser.execute(
        "SELECT md5(string_agg(f::text, '|' "
        "ORDER BY f.asset_id, f.point_key, f.horizon_bucket, f.issued_at)) "
        "FROM ml.forecasts f WHERE f.model_run_id = %s",
        (run_id,),
    ).fetchone()[0]


def test_one_cycle_end_to_end(planted: Planted, superuser: psycopg.Connection, fleet_url):
    cfg = config(fleet_url)
    clock = FakeClock(planted.as_of + timedelta(minutes=5))
    forecaster = FakeForecaster(name=FORECASTER_NAME, version="fixture-1")
    ids = list(planted.assets.values())

    with Gateway.connect(fleet_url) as db:
        summary = run_cycle(db, forecaster, clock, cfg)
    assert (summary.runs_succeeded, summary.runs_failed) == (2, 0)
    assert summary.skipped["too_few_days"] >= 2

    per_asset = dict(
        superuser.execute(
            "SELECT a.code, count(*) FROM ml.forecasts f JOIN bms.assets a ON a.id = f.asset_id "
            "WHERE f.asset_id = ANY(%s) GROUP BY a.code",
            (ids,),
        ).fetchall()
    )
    assert per_asset == {code: 48 for code in FORECAST}
    assert not set(per_asset) & set(NO_FORECAST)

    mismatched = superuser.execute(
        "SELECT count(*) FROM ml.forecasts f JOIN bms.assets a ON a.id = f.asset_id "
        "WHERE f.asset_id = ANY(%s) AND f.organization_id <> a.organization_id",
        (ids,),
    ).fetchone()[0]
    assert mismatched == 0

    runs = superuser.execute(
        "SELECT id, organization_id, status, rows_written, started_at FROM ml.model_runs "
        "WHERE model_name = %s ORDER BY organization_id",
        (FORECASTER_NAME,),
    ).fetchall()
    assert sorted((run[1], run[2], run[3]) for run in runs) == sorted(
        [(planted.organizations["A"], "succeeded", 3 * 48), (planted.organizations["B"], "succeeded", 48)]
    )
    first_buckets = superuser.execute(
        "SELECT DISTINCT min(horizon_bucket) OVER (), max(horizon_bucket) OVER () FROM ml.forecasts "
        "WHERE asset_id = ANY(%s)",
        (ids,),
    ).fetchone()
    assert first_buckets == (planted.as_of, planted.as_of + timedelta(hours=47))

    # The gaps reached the model as NaN, never as a number (Amendment 1 decision 3).
    with_gaps = [context for context in forecaster.seen if np.isnan(context).any()]
    assert len(with_gaps) == 1
    assert int(np.isnan(with_gaps[0]).sum()) == 75

    before = {run[0]: _fingerprint(superuser, run[0]) for run in runs}

    # A second cycle in the same hour writes nothing: the ledger says it is scored.
    with Gateway.connect(fleet_url) as db:
        again = run_cycle(db, forecaster, clock, cfg)
    assert again.organizations_already_scored == 2 and again.rows_written == 0
    count_runs = "SELECT count(*) FROM ml.model_runs WHERE model_name = %s"
    assert superuser.execute(count_runs, (FORECASTER_NAME,)).fetchone()[0] == 2

    # --force re-runs under new run ids and new issued_at, and leaves the first set byte-identical.
    with Gateway.connect(fleet_url) as db:
        forced = run_cycle(db, forecaster, clock, cfg, force=True)
    assert forced.runs_succeeded == 2
    assert superuser.execute(count_runs, (FORECASTER_NAME,)).fetchone()[0] == 4
    total = superuser.execute(
        "SELECT count(*) FROM ml.forecasts WHERE asset_id = ANY(%s)", (ids,)
    ).fetchone()[0]
    assert total == 2 * 4 * 48
    assert {run_id: _fingerprint(superuser, run_id) for run_id in before} == before

    # The ledger is keyed on the hour scored: the next hour is scored, and so is a
    # backfill of the previous hour run later (code review, PR 3: a started_at
    # comparison skipped the one and never skipped the other).
    with Gateway.connect(fleet_url) as db:
        next_hour = run_cycle(db, forecaster, FakeClock(planted.as_of + timedelta(hours=1, minutes=5)), cfg)
        backfill = run_cycle(db, forecaster, clock, cfg, as_of=planted.as_of - timedelta(hours=1))
        backfill_again = run_cycle(db, forecaster, clock, cfg, as_of=planted.as_of - timedelta(hours=1))
    assert next_hour.runs_succeeded == 2
    assert backfill.runs_succeeded == 2
    assert backfill_again.organizations_already_scored == 2 and backfill_again.rows_written == 0
    assert superuser.execute(count_runs, (FORECASTER_NAME,)).fetchone()[0] == 8


def test_a_short_forecast_write_rolls_the_run_row_back(planted: Planted, fleet_url, superuser):
    from uuid import uuid4

    from bms_ml.db.gateway import WriteMismatchError
    from bms_ml.records import ForecastRow, RunRecord

    run_id = uuid4()
    when = planted.as_of + timedelta(days=1)
    run = RunRecord(run_id, planted.organizations["A"], FORECASTER_NAME, "fixture-1", "0" * 64,
                    when, when, 2, "succeeded", None)  # fmt: skip
    rows = [
        ForecastRow(planted.assets["MLFX-R1"], "ml_fixture_temp_c", when.replace(minute=0), 1.0, 2.0, 3.0),
        ForecastRow(uuid4(), "ml_fixture_temp_c", when.replace(minute=0), 1.0, 2.0, 3.0),  # no such asset
    ]
    with Gateway.connect(fleet_url) as db, pytest.raises(WriteMismatchError):
        db.write_succeeded_run(run, rows)
    assert superuser.execute("SELECT count(*) FROM ml.model_runs WHERE id = %s", (run_id,)).fetchone()[0] == 0
    assert (
        superuser.execute("SELECT count(*) FROM ml.forecasts WHERE model_run_id = %s", (run_id,)).fetchone()[
            0
        ]
        == 0
    )


def test_reads_run_in_a_read_only_transaction(fleet_url):
    with Gateway.connect(fleet_url) as db, db._read() as cursor:
        assert cursor.execute("SHOW transaction_read_only").fetchone()["transaction_read_only"] == "on"


def test_bms_fleet_cannot_rewrite_a_forecast(planted: Planted, fleet_url):
    with (
        psycopg.connect(fleet_url, autocommit=True) as conn,
        pytest.raises(psycopg.errors.InsufficientPrivilege),
    ):
        conn.execute("UPDATE ml.forecasts SET p50 = p50 WHERE asset_id = %s", (planted.assets["MLFX-R1"],))
