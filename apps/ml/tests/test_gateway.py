"""Unit half of the gateway: the preflight decisions. The SQL itself runs in tests/integration."""

import dataclasses
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from bms_ml.db import sql
from bms_ml.db.gateway import (
    EXPECTED_ML_SCHEMA_VERSION,
    Gateway,
    PreflightError,
    WriteMismatchError,
    anomaly_insert_params,
    check_role,
    parse_marker,
)
from bms_ml.records import AnomalyRow, RunRecord
from tests.sql_guard import tokenize


def test_expected_version_is_one():
    assert EXPECTED_ML_SCHEMA_VERSION == 1


def test_marker_absent_schema():
    with pytest.raises(PreflightError, match="schema ml is absent"):
        parse_marker(None)


@pytest.mark.parametrize(
    "marker", [None, "", "bms-ml-schema-version=", "bms-ml-schema-version=x", "version=1"]
)
def test_marker_missing_or_malformed(marker):
    with pytest.raises(PreflightError, match="marker"):
        parse_marker({"marker": marker})


def test_marker_below_expected_names_the_versions():
    with pytest.raises(PreflightError, match="version 0, below the expected 1"):
        parse_marker({"marker": "bms-ml-schema-version=0"})


@pytest.mark.parametrize(
    ("marker", "version"), [("bms-ml-schema-version=1", 1), ("bms-ml-schema-version=7", 7)]
)
def test_marker_at_or_above_expected_passes(marker, version):
    # Additive, forward-only migrations keep an older scorer valid on a newer schema (plan R2).
    assert parse_marker({"marker": marker}) == version


FLEET = {
    "role_name": "bms_fleet",
    "is_superuser": False,
    "can_insert_runs": True,
    "can_insert_forecasts": True,
    "can_insert_anomaly_scores": True,
    "can_rewrite_ml": False,
}


def test_bms_fleet_passes():
    assert check_role(dict(FLEET)) == "bms_fleet"


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"is_superuser": True}, "superuser"),
        ({"can_insert_runs": False}, "cannot insert"),
        ({"can_insert_forecasts": False}, "cannot insert"),
        ({"can_insert_anomaly_scores": False}, "cannot insert"),
        ({"can_rewrite_ml": True}, "can update, delete or truncate"),
    ],
)
def test_a_role_outside_the_contract_is_refused(change, message):
    with pytest.raises(PreflightError, match=message):
        check_role({**FLEET, **change})


def test_no_role_row_is_refused():
    with pytest.raises(PreflightError):
        check_role(None)


def test_the_role_query_reads_the_anomaly_insert_privilege():
    # check_role reads the column by name, so the query must produce it (E1.2 plan T1.5).
    assert (
        "has_table_privilege(current_user, 'ml.anomaly_scores', 'INSERT') AS can_insert_anomaly_scores"
        in " ".join(sql.PREFLIGHT_ROLE_SQL.split())
    )


# --- the anomaly write's parameters (E1.2 plan T1.5) -------------------------------------

HOUR = datetime(2027, 1, 25, 9, tzinfo=UTC)


def _run(rows_written: int) -> RunRecord:
    when = HOUR + timedelta(hours=1, minutes=5)
    return RunRecord(
        uuid4(), uuid4(), "bms-anomaly", "v", "0" * 64, when, when, rows_written, "succeeded", None
    )


def test_an_anomaly_row_carries_no_organization_id():
    # The INSERT takes it from bms.assets, so Python can never stamp a wrong one (E1.1 plan R5).
    assert [field.name for field in dataclasses.fields(AnomalyRow)] == [
        "asset_id",
        "bucket",
        "detector",
        "score",
        "contributing_points",
    ]


def test_the_anomaly_insert_takes_organization_id_from_the_asset():
    tokens = tokenize(sql.INSERT_ANOMALY_SCORES_SQL)
    assert {token.value for token in tokens if token.kind == "param"} == {
        "%(bucket)s",
        "%(model_run_id)s",
        "%(asset_ids)s",
        "%(detectors)s",
        "%(scores)s",
        "%(points)s",
    }
    words = [token.value for token in tokens if token.kind == "word"]
    assert words[words.index("SELECT") + 1] == "a.organization_id"
    join = words.index("JOIN")
    assert words[join + 1 : join + 3] == ["bms.assets", "a"]


def test_the_anomaly_params_are_one_array_per_column_and_carry_no_organization():
    asset_a, asset_b = uuid4(), uuid4()
    rows = [
        AnomalyRow(asset_a, HOUR, "baseline_mad", 0.5, ("kw", "pf", "kva")),
        AnomalyRow(asset_a, HOUR, "isolation_forest", 1.0, ("kw", "pf", "kva")),
        AnomalyRow(asset_b, HOUR, "baseline_mad", 0.0, ()),
    ]
    run = _run(3)
    assert anomaly_insert_params(run, rows) == {
        "bucket": HOUR,
        "model_run_id": run.id,
        "asset_ids": [asset_a, asset_a, asset_b],
        "detectors": ["baseline_mad", "isolation_forest", "baseline_mad"],
        "scores": [0.5, 1.0, 0.0],
        "points": ["kw,pf,kva", "kw,pf,kva", ""],
    }


def test_the_anomaly_rows_of_one_run_share_one_bucket():
    rows = [
        AnomalyRow(uuid4(), HOUR, "baseline_mad", 0.5, ()),
        AnomalyRow(uuid4(), HOUR + timedelta(hours=1), "baseline_mad", 0.5, ()),
    ]
    with pytest.raises(ValueError, match="one bucket"):
        anomaly_insert_params(_run(2), rows)


@pytest.mark.parametrize("key", ["a,b", ""])
def test_a_contributing_point_with_a_comma_or_empty_is_refused(key):
    # string_to_array splits on ',' and drops an empty string: either would change the list.
    with pytest.raises(ValueError, match="contributing point"):
        anomaly_insert_params(_run(1), [AnomalyRow(uuid4(), HOUR, "baseline_mad", 0.5, (key,))])


# The ledger's predicates, as text. The SQL runs in tests/integration (CI's ml job);
# this is the gate a session without a database can run.
ANOMALY_LEDGER_PREDICATES = (
    "r.organization_id = %(organization_id)s",
    "r.model_name = %(model_name)s",
    "r.model_version = %(model_version)s",
    "r.config_hash = %(config_hash)s",
    "r.status = 'succeeded'",
    "(SELECT max(s.bucket) FROM ml.anomaly_scores s WHERE s.model_run_id = r.id) = %(scored_hour)s",
)


@pytest.mark.parametrize("predicate", ANOMALY_LEDGER_PREDICATES)
def test_the_anomaly_ledger_holds_each_predicate(predicate):
    assert predicate in " ".join(sql.ANOMALY_ALREADY_SCORED_SQL.split())


# --- the gateway's write path, against a fake connection -------------------------------


class _FakeCursor:
    def __init__(self, conn: "_FakeConnection") -> None:
        self._conn = conn
        self.rowcount = -1

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement, params=None):
        self._conn.executed.append((statement, params))
        if statement is sql.INSERT_ANOMALY_SCORES_SQL:
            self.rowcount = self._conn.insert_rowcount

    def fetchone(self):
        return self._conn.fetch


class _FakeTransaction:
    def __init__(self, conn: "_FakeConnection") -> None:
        self._conn = conn

    def __enter__(self):
        return self

    def __exit__(self, exc_type, *exc):
        self._conn.outcomes.append("rollback" if exc_type else "commit")
        return False


class _FakeConnection:
    def __init__(self, insert_rowcount: int = 0, fetch=None) -> None:
        self.read_only = None
        self.insert_rowcount = insert_rowcount
        self.fetch = fetch
        self.executed: list = []
        self.outcomes: list[str] = []

    def transaction(self):
        return _FakeTransaction(self)

    def cursor(self, **_kwargs):
        return _FakeCursor(self)


def _gateway(conn: _FakeConnection) -> Gateway:
    return Gateway(conn)  # type: ignore[arg-type]


def test_a_succeeded_anomaly_run_writes_the_run_then_its_rows_in_one_transaction():
    rows = [AnomalyRow(uuid4(), HOUR, "baseline_mad", 0.5, ("kw",))]
    run = _run(1)
    conn = _FakeConnection(insert_rowcount=1)
    assert _gateway(conn).write_succeeded_anomaly_run(run, rows) == 1
    assert [statement for statement, _ in conn.executed] == [
        sql.INSERT_MODEL_RUN_SQL,
        sql.INSERT_ANOMALY_SCORES_SQL,
    ]
    assert conn.executed[0][1]["id"] == run.id and conn.executed[0][1]["model_name"] == "bms-anomaly"
    assert conn.outcomes == ["commit"] and conn.read_only is False


@pytest.mark.parametrize(("built", "written", "declared"), [(2, 1, 2), (2, 2, 3)])
def test_an_anomaly_write_count_difference_rolls_back(built, written, declared):
    rows = [AnomalyRow(uuid4(), HOUR, "baseline_mad", 0.5, ()) for _ in range(built)]
    conn = _FakeConnection(insert_rowcount=written)
    with pytest.raises(WriteMismatchError):
        _gateway(conn).write_succeeded_anomaly_run(_run(declared), rows)
    assert conn.outcomes == ["rollback"]


def test_a_succeeded_anomaly_run_with_no_rows_writes_the_run_row_only():
    conn = _FakeConnection()
    assert _gateway(conn).write_succeeded_anomaly_run(_run(0), []) == 0
    assert [statement for statement, _ in conn.executed] == [sql.INSERT_MODEL_RUN_SQL]


def test_bad_rows_are_refused_before_any_write():
    conn = _FakeConnection()
    with pytest.raises(ValueError, match="contributing point"):
        _gateway(conn).write_succeeded_anomaly_run(
            _run(1), [AnomalyRow(uuid4(), HOUR, "baseline_mad", 0.5, ("a,b",))]
        )
    assert conn.executed == [] and conn.outcomes == []


@pytest.mark.parametrize(("fetch", "expected"), [({"?column?": 1}, True), (None, False)])
def test_the_anomaly_ledger_reads_in_a_read_only_transaction(fetch, expected):
    org = uuid4()
    conn = _FakeConnection(fetch=fetch)
    assert _gateway(conn).anomaly_already_scored(org, "bms-anomaly", "v", "0" * 64, HOUR) is expected
    assert conn.executed == [
        (
            sql.ANOMALY_ALREADY_SCORED_SQL,
            {
                "organization_id": org,
                "model_name": "bms-anomaly",
                "model_version": "v",
                "config_hash": "0" * 64,
                "scored_hour": HOUR,
            },
        )
    ]
    assert conn.read_only is True
