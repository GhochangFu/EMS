"""The command line, over a fake database: exit codes and what reaches stdout."""

import json
import os
import socket
import subprocess
import sys
import threading
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import pytest

from bms_ml import __main__ as cli
from bms_ml.config import load_config
from bms_ml.db.gateway import PreflightError
from bms_ml.health import HealthState
from bms_ml.readiness import PointStats
from bms_ml.records import PointRef
from bms_ml.scheduler import CycleResult
from bms_ml.series import HourRow
from bms_ml.targets import DEFAULT_ANOMALY_TARGETS, DEFAULT_TARGETS
from tests.fakes import FakeAnomalyDb, FakeDb, FakeForecaster, FakeForest

PASSWORD = "hunter2-secret"
ENV = {
    "DATABASE_URL_FLEET": f"postgres://bms_fleet:{PASSWORD}@db.internal/bms",
    "ML_FORECAST_HORIZON_HOURS": "2",
    # Never the image's baked model: these tests drive the CLI, not torch.
    "ML_MODEL_DIR": "/nonexistent/bms-ml-model",
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
    assert last["reason"].startswith("no model installed")
    assert fake_db.runs == []


def test_serve_without_a_model_exits_78(fake_db, capsys):
    assert cli.main(["serve"], ENV) == 78
    assert events(capsys.readouterr().out)[-1]["reason"].startswith("no model installed")


def test_run_once_with_a_forecaster_prints_the_summary_last(fake_db, monkeypatch, capsys):
    loads = []
    monkeypatch.setattr(cli, "load_forecaster", lambda *args: loads.append(args) or FakeForecaster())
    env = {**ENV, "ML_TORCH_THREADS": "2"}
    assert cli.main(["run-once", "--as-of", "2026-11-15T12:30:00+00:00"], env) == 0
    # ML_TORCH_THREADS reaches the loader: torch would otherwise count the host's CPUs.
    assert loads == [("/nonexistent/bms-ml-model", 2)]
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


# --- E1.2: run-anomaly, eligibility --job, the serve job list (plan T1.7) ---------------------

ANOMALY_ORG = UUID(int=0xB)


def anomaly_db() -> FakeAnomalyDb:
    """One 1-point asset with 91 days of hourly data up to the scored hour 11:00."""
    start = AS_OF - timedelta(hours=1 + 2184)
    stats = PointStats(
        ANOMALY_ORG, UUID(int=0x201), "MTR-1", "kw", start, AS_OF - timedelta(hours=1), 2185, 92
    )
    db = FakeAnomalyDb(stats=[stats])
    db.histories[PointRef(stats.asset_id, "kw")] = [
        HourRow(start + timedelta(hours=k), 5.0 + (k % 24) / 10 + (k % 7) / 100, 1) for k in range(2185)
    ]
    return db


@pytest.fixture
def fake_anomaly_db(monkeypatch):
    db = anomaly_db()
    connects = []

    @contextmanager
    def connect(_config):
        connects.append(1)
        yield db

    monkeypatch.setattr(cli, "connect", connect)
    monkeypatch.setattr(cli, "load_forest", lambda: FakeForest())
    db.connects = connects
    return db


def test_run_anomaly_with_the_switch_off_logs_and_exits_0_without_connecting(fake_anomaly_db, capsys):
    assert cli.main(["run-anomaly"], {**ENV, "ML_ANOMALY_ENABLED": "false"}) == 0
    (event,) = events(capsys.readouterr().out)
    assert event["event"] == "anomaly_disabled"
    assert fake_anomaly_db.connects == []
    assert fake_anomaly_db.runs == []


def test_run_anomaly_prints_the_summary_last_and_needs_no_model(fake_anomaly_db, capsys):
    # ML_MODEL_DIR points nowhere (ENV): the anomaly child never looks for Chronos.
    assert cli.main(["run-anomaly", "--as-of", "2026-11-15T12:30:00+00:00"], ENV) == 0
    last = events(capsys.readouterr().out)[-1]
    assert last["event"] == "cycle_summary"
    assert last["job"] == "anomaly"
    assert (last["as_of_hour"], last["scored_hour"]) == (
        "2026-11-15T12:00:00+00:00",
        "2026-11-15T11:00:00+00:00",
    )
    assert (last["baseline_rows"], last["isolation_forest_rows"], last["rows_written"]) == (1, 0, 1)
    (run,) = fake_anomaly_db.runs
    assert run.model_name == "bms-anomaly"


def test_run_anomaly_force_rewrites_a_scored_hour(fake_anomaly_db):
    argv = ["run-anomaly", "--as-of", "2026-11-15T12:00Z"]
    assert cli.main(argv, ENV) == 0
    assert cli.main(argv, ENV) == 0
    assert len(fake_anomaly_db.runs) == 1
    assert cli.main([*argv, "--force"], ENV) == 0
    assert len(fake_anomaly_db.runs) == 2


def test_run_anomaly_preflight_refused_exits_78(fake_anomaly_db, capsys):
    fake_anomaly_db.preflight_error = PreflightError("the database role is a superuser: connect as bms_fleet")
    assert cli.main(["run-anomaly"], ENV) == 78
    assert events(capsys.readouterr().out)[-1]["event"] == "preflight_failed"


def test_run_anomaly_a_complete_failure_exits_1_with_the_class_only(fake_anomaly_db, capsys):
    fake_anomaly_db.fail_history_for[UUID(int=0x201)] = ConnectionError(f"lost {ENV['DATABASE_URL_FLEET']}")
    assert cli.main(["run-anomaly", "--as-of", "2026-11-15T12:00Z"], ENV) == 1
    out = capsys.readouterr().out
    assert PASSWORD not in out
    (run,) = fake_anomaly_db.runs
    assert run.error_text == "history:ConnectionError"


def test_run_anomaly_a_connection_failure_logs_the_class(monkeypatch, capsys):
    @contextmanager
    def connect(_config):
        raise ConnectionError(f"FATAL via {ENV['DATABASE_URL_FLEET']}")
        yield

    monkeypatch.setattr(cli, "connect", connect)
    assert cli.main(["run-anomaly"], ENV) == 1
    out = capsys.readouterr().out
    assert PASSWORD not in out
    assert events(out)[-1]["error"] == "connect:ConnectionError"


def test_eligibility_job_anomaly_uses_the_anomaly_targets_and_its_28_day_floor(fake_anomaly_db, capsys):
    thirty = PointStats(
        ANOMALY_ORG,
        UUID(int=0x202),
        "MTR-2",
        "kva",
        AS_OF - timedelta(days=30),
        AS_OF - timedelta(hours=1),
        720,
        30,
    )
    fake_anomaly_db.stats.append(thirty)
    assert cli.main(["eligibility", "--job", "anomaly", "--as-of", "2026-11-15T12:00Z"], ENV) == 0
    _, *rows = capsys.readouterr().out.strip().splitlines()
    assert [(c[1], c[2], c[6]) for c in (row.split("\t") for row in rows)] == [
        ("MTR-1", "kw", "ready"),
        ("MTR-2", "kva", "ready"),  # 30 days: ready for the anomaly job, too few for a forecast
    ]
    targets, _, _ = fake_anomaly_db.eligibility_requests[0]
    assert targets == DEFAULT_ANOMALY_TARGETS
    assert cli.main(["eligibility", "--as-of", "2026-11-15T12:00Z"], ENV) == 0
    assert capsys.readouterr().out.strip().splitlines()[2].split("\t")[6] == "too_few_days"
    assert fake_anomaly_db.eligibility_requests[1][0] == DEFAULT_TARGETS


def test_eligibility_refuses_an_unknown_job():
    with pytest.raises(SystemExit) as err:
        cli.main(["eligibility", "--job", "export"], ENV)
    assert err.value.code == 2


def _jobs(env: dict) -> tuple[list, list]:
    started = []

    def runner(argv, timeout_seconds, *, stop=None):
        started.append((list(argv), timeout_seconds, stop))
        return CycleResult(0, {})

    config = load_config(env)
    state = HealthState(config.interval_seconds, AS_OF, 1, "m", "v", anomaly_enabled=config.anomaly_enabled)
    return cli.build_jobs(config, state, threading.Event(), runner=runner), started


def test_serve_runs_the_forecast_then_the_anomaly_child_with_the_ticks_hour():
    jobs, started = _jobs(ENV)
    assert [job.name for job in jobs] == ["forecast", "anomaly"]
    hour = datetime(2026, 11, 16, 13, tzinfo=UTC)
    for job in jobs:
        job.run(hour)
    (forecast_argv, timeout, _), (anomaly_argv, _, _) = started
    assert forecast_argv[1:] == ["-m", "bms_ml", "run-once"]
    assert anomaly_argv[1:] == ["-m", "bms_ml", "run-anomaly", "--as-of", "2026-11-16T13:00:00+00:00"]
    assert timeout == 900


def test_serve_with_the_switch_off_starts_no_anomaly_child():
    jobs, started = _jobs({**ENV, "ML_ANOMALY_ENABLED": "0"})
    assert [job.name for job in jobs] == ["forecast"]
    for job in jobs:
        job.run(datetime(2026, 11, 16, 13, tzinfo=UTC))
    assert all("run-anomaly" not in argv for argv, _, _ in started)


def test_the_parent_imports_neither_sklearn_nor_torch():
    # Ruling 5 / Amendment 2 R11: only the children load a model library.
    code = (
        "import json, sys\n"
        "import bms_ml.__main__, bms_ml.scheduler, bms_ml.health, bms_ml.config\n"
        "print(json.dumps(sorted(m for m in ('sklearn', 'torch', 'scipy') if m in sys.modules)))\n"
    )
    src = Path(cli.__file__).resolve().parents[1]
    env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(src), os.environ.get("PYTHONPATH", "")])}
    done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=120)
    assert done.returncode == 0, done.stderr[-400:]
    assert json.loads(done.stdout.strip().splitlines()[-1]) == []
