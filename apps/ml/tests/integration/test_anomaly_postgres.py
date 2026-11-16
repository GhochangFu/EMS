"""The anomaly write contract against a real TimescaleDB, as bms_fleet (E1.2 plan T1.8).

CI's `ml` job runs this; locally it skips without the two URLs (`conftest.py`). The
write and ledger cases need only the gateway (unit 1-E); the end-to-end cycle cases
at the end run `run_anomaly_cycle` with the real Isolation Forest (unit 1-F).

Isolation from `test_scorer_postgres.py`, which runs after this file in the same
session against the same planted rows: nothing here writes a run under
FORECASTER_NAME or a row on a forecast room (`Planted.assets`), and every direct
write lands on an hour other than the anomaly job's scored hour (`as_of - 1 h`),
except the A-a proof's, which is under PROOF_FORECASTER_NAME. Each test writes on
its own hour, so the session-scoped fixture needs no reset between them.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.rows import dict_row

from bms_ml.anomaly_scorer import run_anomaly_cycle
from bms_ml.config import config_hash, load_config
from bms_ml.db import sql
from bms_ml.db.gateway import Gateway, WriteMismatchError
from bms_ml.forecasting import QUANTILES
from bms_ml.readiness import THRESHOLDS
from bms_ml.records import AnomalyRow, ForecastRow, RunRecord
from bms_ml.scorer import package_versions, run_cycle
from bms_ml.targets import parse_targets
from tests.fakes import FakeClock, FakeForecaster
from tests.integration.fixture import (
    ANOMALY_FIXTURE_NAME,
    ANOMALY_MODEL_NAME,
    ANOMALY_NOT_SCORED,
    ANOMALY_SCORED,
    ANOMALY_SHAPES,
    ANOMALY_TARGETS,
    METER_POINTS,
    PROOF_FORECASTER_NAME,
    SHAPES,
    SINGLE_POINT,
    SINGLE_TARGET,
    STALE_MISSING_HOURS,
    STALE_POINT,
    Planted,
    anomaly_hours_for,
)

pytestmark = pytest.mark.integration

HASH = "a" * 64
OTHER_HASH = "b" * 64
VERSION = "bms-ml=fixture;scikit-learn=fixture"
BASELINE = "baseline_mad"
FOREST = "isolation_forest"


def _run(organization_id: UUID, hour: datetime, rows: int, **change) -> RunRecord:
    """A run that scored `hour`, finished five minutes into the next one."""
    when = hour + timedelta(hours=1, minutes=5)
    fields = {
        "id": uuid4(),
        "organization_id": organization_id,
        "model_name": ANOMALY_FIXTURE_NAME,
        "model_version": VERSION,
        "config_hash": HASH,
        "started_at": when,
        "finished_at": when,
        "rows_written": rows,
        "status": "succeeded",
        "error_text": None,
    }
    fields.update(change)
    return RunRecord(**fields)


def _hour(planted: Planted, days: int) -> datetime:
    """A whole hour `days` after as_of: away from the job's scored hour and every other test's."""
    return planted.as_of + timedelta(days=days)


def _meter_rows(planted: Planted, code: str, hour: datetime) -> list[AnomalyRow]:
    points = (METER_POINTS[1], METER_POINTS[0], METER_POINTS[3])
    return [
        AnomalyRow(planted.anomaly_assets[code], hour, BASELINE, 0.995, points),
        AnomalyRow(planted.anomaly_assets[code], hour, FOREST, 0.25, points),
    ]


def _single_row(planted: Planted, code: str, hour: datetime) -> AnomalyRow:
    return AnomalyRow(planted.anomaly_assets[code], hour, BASELINE, 0.0, ())


def _count(superuser: psycopg.Connection, query: str, *params) -> int:
    return superuser.execute(query, params).fetchone()[0]


# --- the fixture's own shapes (no database: these run everywhere) ----------------------


def test_the_anomaly_fixture_is_synthetic_and_apart_from_the_forecast_rooms():
    codes = [shape.code for shape in ANOMALY_SHAPES]
    assert all(code.startswith("MLFX-") for code in codes)
    assert sorted(codes) == sorted(ANOMALY_SCORED + ANOMALY_NOT_SCORED)
    assert not set(codes) & {shape.code for shape in SHAPES}
    assert {shape.organization for shape in ANOMALY_SHAPES if shape.code in ANOMALY_SCORED} == {"A", "B"}
    assert [len(shape.points) for shape in ANOMALY_SHAPES if shape.code in ANOMALY_SCORED] == [4, 1, 4, 1]


def test_the_anomaly_targets_parse_and_name_both_classes():
    targets = parse_targets(ANOMALY_TARGETS, variable="ML_ANOMALY_TARGETS")
    assert [t.point_key for t in targets] == [*METER_POINTS, SINGLE_POINT]
    assert str(targets[-1]) == SINGLE_TARGET


def test_the_stale_meter_misses_one_point_only_at_the_end():
    stale = next(shape for shape in ANOMALY_SHAPES if shape.code == "MLFX-AMST")
    assert min(anomaly_hours_for(stale, STALE_POINT)) == STALE_MISSING_HOURS + 1
    assert STALE_MISSING_HOURS + 1 > 3  # older than the 3 h staleness line (section 4.2)
    for point in METER_POINTS:
        if point != STALE_POINT:
            assert min(anomaly_hours_for(stale, point)) == 1
            assert len(anomaly_hours_for(stale, point)) == 60 * 24


# --- preflight ---------------------------------------------------------------------------


def test_preflight_passes_as_bms_fleet_with_the_anomaly_insert(fleet_url):
    with Gateway.connect(fleet_url) as db:
        _, role = db.preflight()
    assert role == "bms_fleet"
    with psycopg.connect(fleet_url) as conn:
        row = conn.cursor(row_factory=dict_row).execute(sql.PREFLIGHT_ROLE_SQL).fetchone()
    assert row["can_insert_anomaly_scores"] is True
    assert row["can_rewrite_ml"] is False


# --- the write ---------------------------------------------------------------------------


def test_a_succeeded_anomaly_run_reads_back_under_the_assets_organization(
    planted: Planted, superuser: psycopg.Connection, fleet_url
):
    hour = _hour(planted, 1)
    org_a = planted.organizations["A"]
    rows = [*_meter_rows(planted, "MLFX-AM1", hour), _single_row(planted, "MLFX-AS1", hour)]
    run = _run(org_a, hour, len(rows))
    with Gateway.connect(fleet_url) as db:
        assert db.write_succeeded_anomaly_run(run, rows) == 3

    stored = superuser.execute(
        "SELECT a.code, s.detector, s.bucket, s.score, s.contributing_points, s.organization_id, "
        "a.organization_id FROM ml.anomaly_scores s JOIN bms.assets a ON a.id = s.asset_id "
        "WHERE s.model_run_id = %s ORDER BY a.code, s.detector",
        (run.id,),
    ).fetchall()
    points = [METER_POINTS[1], METER_POINTS[0], METER_POINTS[3]]
    assert [row[:5] for row in stored] == [
        ("MLFX-AM1", BASELINE, hour, 0.995, points),
        ("MLFX-AM1", FOREST, hour, 0.25, points),
        ("MLFX-AS1", BASELINE, hour, 0.0, []),
    ]
    assert all(row[5] == row[6] == org_a for row in stored)
    assert superuser.execute(
        "SELECT model_name, status, rows_written, error_text FROM ml.model_runs WHERE id = %s", (run.id,)
    ).fetchone() == (ANOMALY_FIXTURE_NAME, "succeeded", 3, None)


def test_a_failed_anomaly_run_writes_the_run_row_and_no_score(
    planted: Planted, superuser: psycopg.Connection, fleet_url
):
    run = _run(
        planted.organizations["A"], _hour(planted, 2), 0, status="failed", error_text="score:ValueError"
    )
    with Gateway.connect(fleet_url) as db:
        db.write_failed_run(run)
    assert (
        _count(superuser, "SELECT count(*) FROM ml.model_runs WHERE id = %s AND status = 'failed'", run.id)
        == 1
    )
    assert _count(superuser, "SELECT count(*) FROM ml.anomaly_scores WHERE model_run_id = %s", run.id) == 0


def test_a_score_for_another_organizations_asset_is_refused_and_the_run_rolls_back(
    planted: Planted, superuser: psycopg.Connection, fleet_url
):
    # organization_id comes from bms.assets (B's), the run is A's: the composite key
    # (model_run_id, organization_id) -> ml.model_runs has no such pair.
    hour = _hour(planted, 3)
    rows = [_single_row(planted, "MLFX-AS1", hour), _single_row(planted, "MLFX-BS1", hour)]
    run = _run(planted.organizations["A"], hour, len(rows))
    with Gateway.connect(fleet_url) as db, pytest.raises(psycopg.errors.ForeignKeyViolation) as raised:
        db.write_succeeded_anomaly_run(run, rows)
    assert raised.value.sqlstate == "23503"
    assert _count(superuser, "SELECT count(*) FROM ml.model_runs WHERE id = %s", run.id) == 0
    assert _count(superuser, "SELECT count(*) FROM ml.anomaly_scores WHERE model_run_id = %s", run.id) == 0


def test_a_short_anomaly_write_rolls_the_run_row_back(
    planted: Planted, superuser: psycopg.Connection, fleet_url
):
    hour = _hour(planted, 4)
    rows = [
        _single_row(planted, "MLFX-AS1", hour),
        AnomalyRow(uuid4(), hour, BASELINE, 0.5, ()),
    ]  # no such asset
    run = _run(planted.organizations["A"], hour, len(rows))
    with Gateway.connect(fleet_url) as db, pytest.raises(WriteMismatchError):
        db.write_succeeded_anomaly_run(run, rows)
    assert _count(superuser, "SELECT count(*) FROM ml.model_runs WHERE id = %s", run.id) == 0
    assert _count(superuser, "SELECT count(*) FROM ml.anomaly_scores WHERE model_run_id = %s", run.id) == 0


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE ml.anomaly_scores SET score = 0 WHERE asset_id = %s",
        "DELETE FROM ml.anomaly_scores WHERE asset_id = %s",
    ],
)
def test_bms_fleet_cannot_rewrite_an_anomaly_score(planted: Planted, fleet_url, statement):
    with (
        psycopg.connect(fleet_url, autocommit=True) as conn,
        pytest.raises(psycopg.errors.InsufficientPrivilege),
    ):
        conn.execute(statement, (planted.anomaly_assets["MLFX-AM1"],))


# --- the ledger (Amendment 5 A-a) -----------------------------------------------------------


def test_the_anomaly_ledger_matches_only_its_own_succeeded_run_and_hour(
    planted: Planted, superuser: psycopg.Connection, fleet_url
):
    hour = _hour(planted, 5)
    org_a, org_b = planted.organizations["A"], planted.organizations["B"]
    with Gateway.connect(fleet_url) as db:
        assert not db.anomaly_already_scored(org_a, ANOMALY_FIXTURE_NAME, VERSION, HASH, hour)
        db.write_succeeded_anomaly_run(_run(org_a, hour, 1), [_single_row(planted, "MLFX-AS1", hour)])

        assert db.anomaly_already_scored(org_a, ANOMALY_FIXTURE_NAME, VERSION, HASH, hour)
        # Each key of the ledger, changed alone, is a different hour scored or not scored.
        assert not db.anomaly_already_scored(
            org_a, ANOMALY_FIXTURE_NAME, VERSION, HASH, hour + timedelta(hours=1)
        )
        assert not db.anomaly_already_scored(
            org_a, ANOMALY_FIXTURE_NAME, VERSION, HASH, hour - timedelta(hours=1)
        )
        assert not db.anomaly_already_scored(org_b, ANOMALY_FIXTURE_NAME, VERSION, HASH, hour)
        assert not db.anomaly_already_scored(org_a, "ml-fixture-other-model", VERSION, HASH, hour)
        assert not db.anomaly_already_scored(org_a, ANOMALY_FIXTURE_NAME, "other-version", HASH, hour)
        assert not db.anomaly_already_scored(org_a, ANOMALY_FIXTURE_NAME, VERSION, OTHER_HASH, hour)


def test_the_anomaly_ledger_ignores_another_models_run_at_the_hour(planted: Planted, fleet_url):
    # The `model_name` predicate: a run of another model, same version and hash, holds a row at the hour.
    hour = _hour(planted, 6)
    org_a = planted.organizations["A"]
    run = _run(org_a, hour, 1, model_name="ml-fixture-other-model")
    with Gateway.connect(fleet_url) as db:
        db.write_succeeded_anomaly_run(run, [_single_row(planted, "MLFX-AS1", hour)])
        assert db.anomaly_already_scored(org_a, "ml-fixture-other-model", VERSION, HASH, hour)
        assert not db.anomaly_already_scored(org_a, ANOMALY_FIXTURE_NAME, VERSION, HASH, hour)


def test_the_anomaly_ledger_ignores_a_failed_run_that_holds_a_row(
    planted: Planted, superuser: psycopg.Connection, fleet_url
):
    # The `status = 'succeeded'` predicate. The gateway never writes a failed run with rows,
    # so the superuser plants one: the ledger must still not count it.
    hour = _hour(planted, 7)
    org_a = planted.organizations["A"]
    run = _run(org_a, hour, 0, status="failed", error_text="write:RuntimeError")
    with superuser.transaction():
        superuser.execute(
            "INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash, "
            "started_at, finished_at, rows_written, status, error_text) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (run.id, org_a, run.model_name, run.model_version, run.config_hash, run.started_at,
             run.finished_at, 0, "failed", run.error_text),
        )  # fmt: skip
        superuser.execute(
            "INSERT INTO ml.anomaly_scores (organization_id, asset_id, bucket, detector, score, "
            "model_run_id) VALUES (%s, %s, %s, %s, 0.5, %s)",
            (org_a, planted.anomaly_assets["MLFX-AS1"], hour, BASELINE, run.id),
        )
    with Gateway.connect(fleet_url) as db:
        assert not db.anomaly_already_scored(org_a, ANOMALY_FIXTURE_NAME, VERSION, HASH, hour)


def test_a_forecast_run_does_not_mark_the_anomaly_ledger(planted: Planted, fleet_url):
    # A-a, one way: a forecast run whose first horizon bucket is the hour, with the SAME
    # name, version and hash, scores the hour for the forecast ledger and not the anomaly one.
    hour = _hour(planted, 8)
    org_a = planted.organizations["A"]
    run = _run(org_a, hour, 1, model_name=PROOF_FORECASTER_NAME)
    forecast = ForecastRow(planted.anomaly_assets["MLFX-AS1"], SINGLE_POINT, hour, 1.0, 2.0, 3.0)
    with Gateway.connect(fleet_url) as db:
        db.write_succeeded_run(run, [forecast])
        assert db.already_scored(org_a, PROOF_FORECASTER_NAME, VERSION, HASH, hour)
        assert not db.anomaly_already_scored(org_a, PROOF_FORECASTER_NAME, VERSION, HASH, hour)


def test_an_anomaly_run_does_not_mark_the_forecast_ledger_and_a_forecast_cycle_still_writes(
    planted: Planted, superuser: psycopg.Connection, fleet_url
):
    # A-a, the other way, with the strongest overlap there is: an anomaly run under the
    # forecaster's exact name, version and config hash, holding rows at the forecast's own
    # as_of hour, in both organizations. The forecast ledger must not see it, and a
    # forecast cycle for that hour must write its forecasts.
    cfg = load_config({"DATABASE_URL_FLEET": fleet_url, "ML_FORECAST_TARGETS": SINGLE_TARGET})
    forecaster = FakeForecaster(name=PROOF_FORECASTER_NAME, version="fixture-aa")
    fingerprint = config_hash(
        cfg,
        model_name=forecaster.name,
        model_version=forecaster.version,
        thresholds=THRESHOLDS,
        quantiles=QUANTILES,
        package_versions=package_versions(),
    )
    hour = planted.as_of
    with Gateway.connect(fleet_url) as db:
        for key, code in (("A", "MLFX-AS1"), ("B", "MLFX-BS1")):
            org = planted.organizations[key]
            run = _run(org, hour, 1, model_name=forecaster.name, model_version=forecaster.version,
                       config_hash=fingerprint)  # fmt: skip
            db.write_succeeded_anomaly_run(run, [_single_row(planted, code, hour)])
            assert db.anomaly_already_scored(org, forecaster.name, forecaster.version, fingerprint, hour)
            assert not db.already_scored(org, forecaster.name, forecaster.version, fingerprint, hour)

        summary = run_cycle(db, forecaster, FakeClock(hour + timedelta(minutes=5)), cfg)
    assert (summary.organizations_already_scored, summary.runs_succeeded, summary.runs_failed) == (0, 2, 0)
    per_asset = dict(
        superuser.execute(
            "SELECT a.code, count(*) FROM ml.forecasts f JOIN bms.assets a ON a.id = f.asset_id "
            "JOIN ml.model_runs r ON r.id = f.model_run_id "
            "WHERE r.model_name = %s AND r.model_version = %s GROUP BY a.code",
            (forecaster.name, forecaster.version),
        ).fetchall()
    )
    assert per_asset == {"MLFX-AS1": 48, "MLFX-BS1": 48}


# --- the end-to-end cycle (unit 1-F) ---------------------------------------------------------
# The cycle runs with the real Isolation Forest, as of planted.as_of + 5 min: the scored hour is
# planted.as_of - 1 h. Rows are counted by `model_name = ANOMALY_MODEL_NAME`: this file's direct
# writes are under other names (ANOMALY_FIXTURE_NAME, PROOF_FORECASTER_NAME) and on other hours.
# No forecast cycle here uses FORECASTER_NAME or a forecast room: test_scorer_postgres.py runs
# after this file on the same planted rows and counts exactly two FORECASTER_NAME runs.

METER_TARGETS = ",".join(target for target in ANOMALY_TARGETS.split(",") if target != SINGLE_TARGET)
ANOMALY_ROWS_SQL = (
    "SELECT a.code, s.detector, s.bucket, s.score, s.contributing_points, s.organization_id, "
    "a.organization_id, s.model_run_id FROM ml.anomaly_scores s JOIN bms.assets a ON a.id = s.asset_id "
    "JOIN ml.model_runs r ON r.id = s.model_run_id WHERE r.model_name = %s ORDER BY a.code, s.detector"
)
ANOMALY_RUNS_SQL = (
    "SELECT id, organization_id, status, rows_written, model_version, error_text FROM ml.model_runs "
    "WHERE model_name = %s ORDER BY started_at, organization_id"
)


def _anomaly_cycle(planted: Planted, fleet_url: str, *, targets: str = ANOMALY_TARGETS, force: bool = False):
    from bms_ml.anomaly_forest import IsolationForestDetector

    cfg = load_config({"DATABASE_URL_FLEET": fleet_url, "ML_ANOMALY_TARGETS": targets})
    clock = FakeClock(planted.as_of + timedelta(minutes=5))
    with Gateway.connect(fleet_url) as db:
        return run_anomaly_cycle(db, IsolationForestDetector(), clock, cfg, force=force)


def test_one_anomaly_cycle_end_to_end(planted: Planted, superuser: psycopg.Connection, fleet_url):
    summary = _anomaly_cycle(planted, fleet_url)
    scored_hour = planted.as_of - timedelta(hours=1)

    stored = superuser.execute(ANOMALY_ROWS_SQL, (ANOMALY_MODEL_NAME,)).fetchall()
    assert [(row[0], row[1]) for row in stored] == [
        ("MLFX-AM1", BASELINE),
        ("MLFX-AM1", FOREST),
        ("MLFX-AS1", BASELINE),
        ("MLFX-BM1", BASELINE),
        ("MLFX-BM1", FOREST),
        ("MLFX-BS1", BASELINE),
    ]
    for code, _, bucket, score, points, stored_org, asset_org, _ in stored:
        assert bucket == scored_hour
        assert 0.0 <= score <= 1.0
        assert stored_org == asset_org == planted.anomaly_asset_organization[code]
        assert set(points) <= set(METER_POINTS) | {SINGLE_POINT} and len(points) <= 3

    runs = superuser.execute(ANOMALY_RUNS_SQL, (ANOMALY_MODEL_NAME,)).fetchall()
    assert sorted((run[1], run[2], run[3], run[5]) for run in runs) == sorted(
        [
            (planted.organizations["A"], "succeeded", 3, None),
            (planted.organizations["B"], "succeeded", 3, None),
        ]
    )
    for run in runs:
        assert run[4].startswith("bms-ml=") and ";scikit-learn=" in run[4]
        assert sum(1 for row in stored if row[7] == run[0]) == run[3]

    counts = summary.counts()
    assert counts["job"] == "anomaly"
    assert (counts["runs_succeeded"], counts["runs_failed"], counts["rows_written"]) == (2, 0, 6)
    assert (counts["baseline_rows"], counts["isolation_forest_rows"], counts["scored"]) == (4, 2, 4)
    # MLFX-AMST: one stale point stops the whole meter (R5); MLFX-AMSIM is never returned.
    assert counts["skipped"] == {"asset_not_ready": 1, "stale": 1}
    assert counts["eligible"] == 4 + 1 + 4 + 4 + 1


def test_a_second_anomaly_cycle_writes_nothing_and_force_writes_a_new_run(
    planted: Planted, superuser: psycopg.Connection, fleet_url
):
    before_rows = superuser.execute(ANOMALY_ROWS_SQL, (ANOMALY_MODEL_NAME,)).fetchall()
    before_runs = superuser.execute(ANOMALY_RUNS_SQL, (ANOMALY_MODEL_NAME,)).fetchall()
    assert len(before_runs) == 2 and len(before_rows) == 6  # the end-to-end case's cycle

    again = _anomaly_cycle(planted, fleet_url)
    assert (again.organizations_already_scored, again.runs_succeeded, again.rows_written) == (2, 0, 0)
    assert superuser.execute(ANOMALY_RUNS_SQL, (ANOMALY_MODEL_NAME,)).fetchall() == before_runs

    forced = _anomaly_cycle(planted, fleet_url, force=True)
    assert (forced.organizations_already_scored, forced.runs_succeeded, forced.rows_written) == (0, 2, 6)
    runs = superuser.execute(ANOMALY_RUNS_SQL, (ANOMALY_MODEL_NAME,)).fetchall()
    assert len(runs) == 4
    assert {run[0] for run in before_runs} < {run[0] for run in runs}
    rows = superuser.execute(ANOMALY_ROWS_SQL, (ANOMALY_MODEL_NAME,)).fetchall()
    assert len(rows) == 12
    first_ids = {run[0] for run in before_runs}
    assert sorted(row for row in rows if row[7] in first_ids) == sorted(before_rows)


def test_an_anomaly_cycle_then_a_forecast_cycle_in_one_tick_both_write(
    planted: Planted, superuser: psycopg.Connection, fleet_url
):
    # A-a through the real jobs, in the hour of the other cycles. Each anomaly cycle here uses
    # its own target list, so its config hash is new and only the other job's runs could
    # skip it; the forecaster is a version no other test writes under.
    org_count = len(planted.organizations)
    first = _anomaly_cycle(planted, fleet_url, targets=SINGLE_TARGET)
    assert (first.organizations_already_scored, first.runs_succeeded, first.rows_written) == (0, org_count, 2)

    cfg = load_config({"DATABASE_URL_FLEET": fleet_url, "ML_FORECAST_TARGETS": SINGLE_TARGET})
    forecaster = FakeForecaster(name=PROOF_FORECASTER_NAME, version="fixture-1f")
    # HH:07, not HH:05: the A-a proof case above already forecast these two assets for this
    # hour with a clock at HH:05, and `issued_at` is the run's start, part of
    # `forecasts_pkey`. The same start would collide on the key (CI, 2026-11-16).
    clock = FakeClock(planted.as_of + timedelta(minutes=7))
    with Gateway.connect(fleet_url) as db:
        forecast = run_cycle(db, forecaster, clock, cfg)
    assert (forecast.organizations_already_scored, forecast.runs_succeeded, forecast.runs_failed) == (
        0,
        org_count,
        0,
    )
    per_asset = dict(
        superuser.execute(
            "SELECT a.code, count(*) FROM ml.forecasts f JOIN bms.assets a ON a.id = f.asset_id "
            "JOIN ml.model_runs r ON r.id = f.model_run_id "
            "WHERE r.model_name = %s AND r.model_version = %s GROUP BY a.code",
            (forecaster.name, forecaster.version),
        ).fetchall()
    )
    assert per_asset == {"MLFX-AS1": 48, "MLFX-BS1": 48}

    after = _anomaly_cycle(planted, fleet_url, targets=METER_TARGETS)
    assert (after.organizations_already_scored, after.runs_succeeded, after.rows_written) == (0, org_count, 4)

    # Each job's ledger still sees its own runs in this hour.
    assert _anomaly_cycle(planted, fleet_url, targets=SINGLE_TARGET).organizations_already_scored == org_count
    with Gateway.connect(fleet_url) as db:
        assert run_cycle(db, forecaster, clock, cfg).organizations_already_scored == org_count
