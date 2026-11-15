"""The command line, over a fake database: exit codes and what reaches stdout."""

import json
import socket
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from bms_ml import __main__ as cli
from bms_ml.db.gateway import PreflightError
from bms_ml.readiness import PointStats
from bms_ml.records import PointRef
from bms_ml.series import HourRow
from tests.fakes import FakeDb, FakeForecaster

PASSWORD = "hunter2-secret"
ENV = {
    "DATABASE_URL_FLEET": f"postgres://bms_fleet:{PASSWORD}@db.internal/bms",
    "ML_FORECAST_HORIZON_HOURS": "2",
}
AS_OF = datetime(2026, 11, 15, 12, tzinfo=UTC)
ORG = UUID(int=0xA)


def ready_db() -> FakeDb:
    point = PointStats(ORG, UUID(int=0x101), "ROOM-1", "cold_room_temp_c",
                       AS_OF - timedelta(days=60), AS_OF - timedelta(hours=1), 1440, 60)  # fmt: skip
    weak = PointStats(ORG, UUID(int=0x102), "ROOM-2", "cold_room_temp_c",
                      AS_OF - timedelta(days=17), AS_OF - timedelta(hours=1), 70, 17)  # fmt: skip
    db = FakeDb(stats=[point, weak])
    db.histories[PointRef(point.asset_id, point.point_key)] = [
        HourRow(AS_OF - timedelta(hours=h), 5.0, 1) for h in range(1, 500)
    ]
    return db


@pytest.fixture
def fake_db(monkeypatch):
    db = ready_db()

    @contextmanager
    def connect(_config):
        yield db

    monkeypatch.setattr(cli, "connect", connect)
    return db


def events(out: str) -> list[dict]:
    return [json.loads(line) for line in out.splitlines() if line.startswith("{")]


def test_a_refused_config_exits_78_and_names_the_variable(capsys):
    assert cli.main(["preflight"], {"DATABASE_URL": ENV["DATABASE_URL_FLEET"]}) == 78
    (event,) = events(capsys.readouterr().out)
    assert event["event"] == "config_refused"
    assert "DATABASE_URL_FLEET" in event["reason"]


def test_a_naive_as_of_is_refused():
    with pytest.raises(SystemExit) as err:
        cli.main(["run-once", "--as-of", "2026-11-15T12:00"], ENV)
    assert err.value.code == 2


def test_preflight_ok(fake_db, capsys):
    assert cli.main(["preflight"], ENV) == 0
    last = events(capsys.readouterr().out)[-1]
    assert (last["event"], last["schema_version"], last["role"]) == ("preflight_ok", 1, "bms_fleet")


def test_preflight_refused_exits_78_with_the_fixed_reason(fake_db, capsys):
    fake_db.preflight_error = PreflightError("schema ml is absent: run the migrations (0157) first")
    assert cli.main(["preflight"], ENV) == 78
    assert events(capsys.readouterr().out)[-1]["reason"].startswith("schema ml is absent")


def test_a_connection_failure_logs_the_class_never_the_message(monkeypatch, capsys):
    @contextmanager
    def connect(_config):
        raise ConnectionError(f"FATAL: password authentication failed via {ENV['DATABASE_URL_FLEET']}")
        yield

    monkeypatch.setattr(cli, "connect", connect)
    assert cli.main(["preflight"], ENV) == 78
    assert cli.main(["run-once"], ENV) == 1
    out = capsys.readouterr().out
    assert PASSWORD not in out and "password authentication" not in out
    assert [e.get("reason") or e.get("error") for e in events(out)] == ["connect:ConnectionError"] * 2


def test_run_once_without_a_model_names_the_reason(fake_db, capsys):
    assert cli.main(["run-once"], ENV) == 78
    last = events(capsys.readouterr().out)[-1]
    assert last["event"] == "model_missing"
    assert last["reason"] == "no model installed in this build"
    assert fake_db.runs == []


def test_serve_without_a_model_exits_78(fake_db, capsys):
    assert cli.main(["serve"], ENV) == 78
    assert events(capsys.readouterr().out)[-1]["reason"] == "no model installed in this build"


def test_run_once_with_a_forecaster_prints_the_summary_last(fake_db, monkeypatch, capsys):
    monkeypatch.setattr(cli, "load_forecaster", lambda _dir: FakeForecaster())
    assert cli.main(["run-once", "--as-of", "2026-11-15T12:30:00+00:00"], ENV) == 0
    last = events(capsys.readouterr().out)[-1]
    assert last["event"] == "cycle_summary"
    assert (last["scored"], last["rows_written"], last["skipped"]) == (1, 2, {"too_few_days": 1})
    assert last["as_of_hour"] == "2026-11-15T12:00:00+00:00"


def test_eligibility_prints_one_row_per_target_point(fake_db, capsys):
    assert cli.main(["eligibility", "--as-of", "2026-11-15T12:00Z"], ENV) == 0
    header, *rows = capsys.readouterr().out.strip().splitlines()
    assert header.split("\t") == [
        "organization_id", "asset_code", "point_key", "days", "coverage_pct", "newest_bucket", "verdict",
    ]  # fmt: skip
    cells = [row.split("\t") for row in rows]
    assert [(c[1], c[3], c[5], c[6]) for c in cells] == [
        ("ROOM-1", "60", "2026-11-15T11:00:00+00:00", "ready"),
        ("ROOM-2", "17", "2026-11-15T11:00:00+00:00", "too_few_days"),
    ]


def test_health_with_nothing_listening_exits_1(capsys):
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    assert cli.main(["health"], {**ENV, "ML_HEALTH_PORT": str(port)}) == 1
    assert json.loads(capsys.readouterr().out) == {"status": "unreachable"}
