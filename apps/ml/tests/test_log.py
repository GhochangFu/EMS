import io
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from bms_ml import log
from bms_ml.config import load_config
from bms_ml.readiness import PointStats
from bms_ml.records import PointRef
from bms_ml.scorer import run_cycle
from bms_ml.series import HourRow
from tests.fakes import FakeClock, FakeDb, FakeForecaster

NOW = datetime(2026, 11, 15, 12, 5, tzinfo=UTC)
AS_OF = datetime(2026, 11, 15, 12, tzinfo=UTC)
PASSWORD = "hunter2-secret"
DSN = f"postgres://bms_fleet:{PASSWORD}@db.internal:5432/bms"
DRIVER_TEXT = "FATAL: password authentication failed for user bms_fleet near row value 42.17"


@pytest.fixture
def captured():
    stream = io.StringIO()
    log.configure("debug", stream)
    yield stream
    log.configure("info")


def test_one_json_object_per_line(captured):
    log.event("hello", count=3)
    log.event("quiet", "debug")
    lines = captured.getvalue().splitlines()
    assert [json.loads(line)["event"] for line in lines] == ["hello", "quiet"]
    assert json.loads(lines[0])["count"] == 3
    assert json.loads(lines[0])["level"] == "info"


def test_debug_lines_are_dropped_at_info():
    stream = io.StringIO()
    log.configure("info", stream)
    log.event("point_skipped", "debug", asset_code="ROOM-1")
    log.event("kept")
    assert [json.loads(line)["event"] for line in stream.getvalue().splitlines()] == ["kept"]


def test_a_full_failing_cycle_logs_no_secret_and_no_driver_text(captured):
    org_a, org_b = UUID(int=0xA), UUID(int=0xB)
    points = [
        PointStats(org, UUID(int=0x100 + i), f"ROOM-{i}", "cold_room_temp_c",
                   AS_OF - timedelta(days=60), AS_OF - timedelta(hours=1), 1440, 60)
        for i, org in enumerate((org_a, org_b))
    ]  # fmt: skip
    db = FakeDb(stats=points)
    for point in points:
        db.histories[PointRef(point.asset_id, point.point_key)] = [
            HourRow(AS_OF - timedelta(hours=h), 1.0, 1) for h in range(1, 800)
        ]
    forecaster = FakeForecaster(
        fail_with=ConnectionError(f"{DRIVER_TEXT} via {DSN}"), fail_on_calls=frozenset({0, 1})
    )
    summary = run_cycle(db, forecaster, FakeClock(NOW), load_config({"DATABASE_URL_FLEET": DSN}))

    out = captured.getvalue()
    assert summary.runs_failed == 2
    assert "run_failed" in out
    assert PASSWORD not in out
    assert "password authentication failed" not in out
    assert "42.17" not in out
    for run in db.runs:
        assert run.error_text == "predict:ConnectionError"


def test_an_exception_passed_by_accident_never_prints_its_traceback(captured):
    try:
        raise RuntimeError(DSN)
    except RuntimeError:
        logger = log._LOGGER
        logger.error("crash", exc_info=True)
    assert PASSWORD not in captured.getvalue()
