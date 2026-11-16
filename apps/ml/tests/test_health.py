import json
import threading
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta

import pytest

from bms_ml.health import HealthState, make_server
from bms_ml.scheduler import EXIT_CYCLE_FAILED, EXIT_OK, CycleResult

T0 = datetime(2026, 11, 15, 12, tzinfo=UTC)
SUMMARY = {
    "as_of_hour": "2026-11-15T12:00:00+00:00",
    "organizations": 2,
    "eligible": 21,
    "scored": 16,
    "rows_written": 768,
    "runs_succeeded": 2,
    "runs_failed": 0,
    "duration_seconds": 41.2,
    "skipped": {"too_few_days": 3},
}


def state() -> HealthState:
    return HealthState(3600, T0, 1, "fake-forecaster", "test-1")


def test_starting_until_the_first_cycle():
    code, body = state().snapshot(T0 + timedelta(minutes=30))
    assert (code, body["status"]) == (200, "starting")


def test_ok_after_a_success_younger_than_twice_the_interval():
    health = state()
    health.record(CycleResult(EXIT_OK, SUMMARY), T0 + timedelta(minutes=5))
    code, body = health.snapshot(T0 + timedelta(hours=2))
    assert (code, body["status"]) == (200, "ok")
    assert body["schemaVersion"] == 1
    assert body["model"] == {"name": "fake-forecaster", "version": "test-1"}
    assert body["lastCycle"]["scored"] == 16


def test_degraded_when_the_last_success_is_too_old():
    health = state()
    health.record(CycleResult(EXIT_OK, SUMMARY), T0 + timedelta(minutes=5))
    code, body = health.snapshot(T0 + timedelta(hours=2, minutes=6))
    assert (code, body["status"]) == (503, "degraded")


def test_degraded_when_no_cycle_succeeded_in_twice_the_interval():
    code, body = state().snapshot(T0 + timedelta(hours=2))
    assert (code, body["status"]) == (503, "degraded")


def test_degraded_after_a_first_failure():
    health = state()
    health.record(CycleResult(EXIT_CYCLE_FAILED, None, timed_out=True), T0 + timedelta(minutes=5))
    code, body = health.snapshot(T0 + timedelta(minutes=6))
    assert (code, body["status"]) == (503, "degraded")
    assert body["cyclesFailed"] == 1


def test_the_body_carries_counts_only_whatever_the_child_printed():
    health = state()
    leaky = {
        **SUMMARY,
        "asset_code": "ROOM-1",
        "organization_id": "x",
        "skipped": {"stale": 1, "ROOM-9": "y"},
    }
    health.record(CycleResult(EXIT_OK, leaky), T0)
    _, body = health.snapshot(T0)
    text = json.dumps(body)
    assert "ROOM-1" not in text and "organization_id" not in text and "ROOM-9" not in text
    assert body["lastCycle"]["skipped"] == {"stale": 1}


def test_an_as_of_hour_that_is_not_an_instant_is_dropped():
    health = state()
    health.record(CycleResult(EXIT_OK, {**SUMMARY, "as_of_hour": "ROOM-1 at PHEWB"}), T0)
    _, body = health.snapshot(T0)
    assert "as_of_hour" not in body["lastCycle"]
    health.record(CycleResult(EXIT_OK, SUMMARY), T0)
    assert health.snapshot(T0)[1]["lastCycle"]["as_of_hour"] == "2026-11-15T12:00:00+00:00"


@pytest.fixture
def server():
    health = state()
    health.record(CycleResult(EXIT_OK, SUMMARY), T0)
    srv = make_server(health, lambda: T0 + timedelta(minutes=1), port=0)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv
    srv.shutdown()
    srv.server_close()


def _request(srv, path, method="GET"):
    port = srv.server_address[1]
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method)
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def test_the_listener_binds_loopback(server):
    assert server.server_address[0] == "127.0.0.1"


def test_get_health_answers_json(server):
    status, raw = _request(server, "/health")
    assert status == 200
    assert json.loads(raw)["status"] == "ok"


@pytest.mark.parametrize("path", ["/", "/metrics", "/health/x", "/healthz"])
def test_any_other_path_is_404(server, path):
    assert _request(server, path)[0] == 404


@pytest.mark.parametrize("method", ["POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
def test_any_other_method_is_405(server, method):
    assert _request(server, "/health", method)[0] == 405


# --- E1.2: the anomaly job (plan R8) ---------------------------------------------------------

ANOMALY_SUMMARY = {
    "job": "anomaly",
    "as_of_hour": "2026-11-15T12:00:00+00:00",
    "scored_hour": "2026-11-15T11:00:00+00:00",
    "organizations": 2,
    "eligible": 40,
    "assets": 6,
    "scored": 5,
    "baseline_rows": 5,
    "isolation_forest_rows": 3,
    "rows_written": 8,
    "runs_succeeded": 2,
    "runs_failed": 0,
    "organizations_already_scored": 0,
    "duration_seconds": 7.5,
    "skipped": {"asset_not_ready": 1, "stale": 1, "if_incomplete_hour": 1},
}


def both(enabled: bool = True) -> HealthState:
    return HealthState(3600, T0, 1, "fake-forecaster", "test-1", anomaly_enabled=enabled)


def test_the_body_gains_an_anomaly_object_and_keeps_the_forecasts_last_cycle():
    health = both()
    health.record(CycleResult(EXIT_OK, SUMMARY), T0)
    health.recorder("anomaly").record(CycleResult(EXIT_OK, ANOMALY_SUMMARY), T0)
    code, body = health.snapshot(T0 + timedelta(minutes=1))
    assert (code, body["status"]) == (200, "ok")
    assert body["lastCycle"]["rows_written"] == 768
    expected = {k: v for k, v in ANOMALY_SUMMARY.items() if k != "job"}
    assert body["anomaly"] == {
        "enabled": True,
        "cyclesSucceeded": 1,
        "cyclesFailed": 0,
        "lastCycle": expected,
    }


def test_status_is_the_worst_of_the_enabled_jobs():
    health = both()
    health.record(CycleResult(EXIT_OK, SUMMARY), T0)
    # The forecast is ok; the anomaly job has not run yet: starting.
    assert health.snapshot(T0 + timedelta(minutes=1))[:1] == (200,)
    assert health.snapshot(T0 + timedelta(minutes=1))[1]["status"] == "starting"
    health.recorder("anomaly").record(CycleResult(EXIT_CYCLE_FAILED, None), T0 + timedelta(minutes=2))
    code, body = health.snapshot(T0 + timedelta(minutes=3))
    assert (code, body["status"]) == (503, "degraded")
    assert (body["cyclesFailed"], body["anomaly"]["cyclesFailed"]) == (0, 1)
    health.recorder("anomaly").record(CycleResult(EXIT_OK, ANOMALY_SUMMARY), T0 + timedelta(minutes=8))
    code, body = health.snapshot(T0 + timedelta(minutes=9))
    assert (code, body["status"]) == (200, "ok")


def test_a_disabled_anomaly_job_does_not_count_toward_status():
    health = both(enabled=False)
    health.record(CycleResult(EXIT_OK, SUMMARY), T0)
    code, body = health.snapshot(T0 + timedelta(hours=1, minutes=59))
    assert (code, body["status"]) == (200, "ok")
    assert body["anomaly"] == {"enabled": False, "cyclesSucceeded": 0, "cyclesFailed": 0, "lastCycle": None}


def test_a_failed_forecast_degrades_even_when_the_anomaly_job_is_ok():
    health = both()
    health.record(CycleResult(EXIT_CYCLE_FAILED, None), T0)
    health.recorder("anomaly").record(CycleResult(EXIT_OK, ANOMALY_SUMMARY), T0)
    assert health.snapshot(T0 + timedelta(minutes=1))[1]["status"] == "degraded"


def test_the_anomaly_body_carries_counts_only_whatever_the_child_printed():
    health = both()
    leaky = {
        **ANOMALY_SUMMARY,
        "asset_code": "MTR-1",
        "organization_id": "00000000-0000-0000-0000-00000000000a",
        "scored_hour": "MTR-1 at PHEWB",
        "skipped": {"stale": 1, "MTR-9": 2, "context_too_sparse": 4},
        "rows_written": "MTR-2",
    }
    health.recorder("anomaly").record(CycleResult(EXIT_OK, leaky), T0)
    _, body = health.snapshot(T0)
    text = json.dumps(body)
    for leak in ("MTR-", "PHEWB", "organization_id", "00000000-0000"):
        assert leak not in text
    last = body["anomaly"]["lastCycle"]
    assert last["skipped"] == {"stale": 1}
    assert "scored_hour" not in last and "rows_written" not in last and "job" not in last


def test_an_unknown_job_has_no_recorder():
    with pytest.raises(KeyError):
        both().recorder("export")


def test_the_anomaly_allowlists_cover_everything_the_scorer_can_emit():
    """Build the lists from the scorer's own names, so a new key or reason cannot vanish."""
    from bms_ml import anomaly_baseline, anomaly_forest, anomaly_scorer, health

    summary = anomaly_scorer.AnomalySummary(
        as_of_hour=datetime(2026, 11, 16, 5, tzinfo=UTC), scored_hour=datetime(2026, 11, 16, 4, tzinfo=UTC)
    )
    keys = set(summary.counts()) - {"job", "skipped"}
    assert keys == set(health.ANOMALY_COUNT_KEYS) | set(health.ANOMALY_INSTANT_KEYS)

    emitted = {
        value
        for module in (anomaly_baseline, anomaly_forest, anomaly_scorer)
        for name, value in vars(module).items()
        if name.startswith("SKIP_") and isinstance(value, str)
    }
    readiness = {"no_data", "too_few_days", "low_coverage", "stale"}
    assert emitted | readiness == set(health.ANOMALY_SKIP_REASONS)
