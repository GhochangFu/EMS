"""`GET /health` on 127.0.0.1, and nothing else (ADR 0135 decision 2; plan T3.9).

`ok` needs a successful cycle younger than twice the interval; before the
first cycle, and for no longer than that, the status is `starting`; anything
else is `degraded` (503). Since E1.2 that holds per job, and `status` is the
worst of the enabled jobs (plan R8). The body carries the schema version, the
model name and version, the forecast's last cycle's counts and, under
`anomaly`, the anomaly job's. It never carries an asset id, an
asset code or an organization: the counts are copied through an allowlist per job, so
whatever a child prints cannot widen what this endpoint shows.

`python -m bms_ml health` is the client the Docker HEALTHCHECK uses.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlsplit

from bms_ml.scheduler import EXIT_OK, CycleResult

COUNT_KEYS = (
    "organizations",
    "eligible",
    "scored",
    "rows_written",
    "runs_succeeded",
    "runs_failed",
    "organizations_already_scored",
    "duration_seconds",
)
SKIP_REASONS = (
    "no_data",
    "too_few_days",
    "low_coverage",
    "stale",
    "context_too_sparse",
    "non_finite_output",
)
# The anomaly job's own allowlists (E1.2 plan R8): `anomaly_scorer.AnomalySummary.counts`.
ANOMALY_COUNT_KEYS = (
    "organizations",
    "eligible",
    "assets",
    "scored",
    "baseline_rows",
    "isolation_forest_rows",
    "rows_written",
    "runs_succeeded",
    "runs_failed",
    "organizations_already_scored",
    "duration_seconds",
)
ANOMALY_SKIP_REASONS = (
    "no_data",
    "too_few_days",
    "low_coverage",
    "stale",
    "asset_not_ready",
    "reference_too_sparse",
    "no_data_at_hour",
    "slot_too_sparse",
    "if_too_few_rows",
    "if_incomplete_hour",
    "forest_failed",
    "non_finite_score",
)
ANOMALY_INSTANT_KEYS = ("as_of_hour", "scored_hour")

_STATUS_RANK = {"ok": 0, "starting": 1, "degraded": 2}


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _counts_only(
    summary: dict[str, Any] | None,
    count_keys: tuple[str, ...] = COUNT_KEYS,
    skip_reasons: tuple[str, ...] = SKIP_REASONS,
    instant_keys: tuple[str, ...] = ("as_of_hour",),
) -> dict[str, Any] | None:
    if summary is None:
        return None
    counts: dict[str, Any] = {}
    for key in count_keys:
        value = summary.get(key)
        if _number(value):
            counts[key] = value
    for key in instant_keys:
        instant = summary.get(key)
        if isinstance(instant, str) and len(instant) <= 40:
            try:
                counts[key] = datetime.fromisoformat(instant).isoformat()
            except ValueError:
                pass
    skipped = summary.get("skipped")
    if isinstance(skipped, dict):
        counts["skipped"] = {
            reason: skipped[reason]
            for reason in skip_reasons
            if isinstance(skipped.get(reason), int) and not isinstance(skipped.get(reason), bool)
        }
    return counts


class _JobState:
    """One job's counters. Every method runs under the owning HealthState's lock."""

    def __init__(self, filter_summary: Callable[[dict[str, Any] | None], dict[str, Any] | None]) -> None:
        self._filter = filter_summary
        self.last_success: datetime | None = None
        self.last_summary: dict[str, Any] | None = None
        self.succeeded = 0
        self.failed = 0

    def record(self, result: CycleResult, at: datetime) -> None:
        if result.exit_code == EXIT_OK:
            self.succeeded += 1
            self.last_success = at
        else:
            self.failed += 1
        self.last_summary = self._filter(result.summary)

    def status(self, now: datetime, started_at: datetime, window: timedelta) -> str:
        if self.last_success is not None and now - self.last_success < window:
            return "ok"
        if self.last_success is None and self.failed == 0 and now - started_at < window:
            return "starting"
        return "degraded"


class JobRecorder:
    """The `Recorder` a scheduler `Job` is given for one named job."""

    def __init__(self, state: HealthState, name: str) -> None:
        self._state, self._name = state, name

    def record(self, result: CycleResult, at: datetime) -> None:
        self._state.record_job(self._name, result, at)


class HealthState:
    """The forecast job's state (the body's top level, as before E1.2) and the anomaly job's.

    `status` is the worst of the enabled jobs (E1.2 plan R8): with the anomaly
    switch off, the anomaly job neither runs nor counts.
    """

    def __init__(
        self,
        interval_seconds: int,
        started_at: datetime,
        schema_version: int,
        model_name: str,
        model_version: str,
        *,
        anomaly_enabled: bool = False,
    ) -> None:
        self._lock = threading.Lock()
        self._window = timedelta(seconds=2 * interval_seconds)
        self._started_at = started_at
        self._schema_version = schema_version
        self._model = {"name": model_name, "version": model_version}
        self._anomaly_enabled = anomaly_enabled
        self._jobs = {
            "forecast": _JobState(_counts_only),
            "anomaly": _JobState(
                lambda summary: _counts_only(
                    summary, ANOMALY_COUNT_KEYS, ANOMALY_SKIP_REASONS, ANOMALY_INSTANT_KEYS
                )
            ),
        }

    @property
    def cycles_succeeded(self) -> int:
        return self._jobs["forecast"].succeeded

    @property
    def cycles_failed(self) -> int:
        return self._jobs["forecast"].failed

    def recorder(self, name: str) -> JobRecorder:
        if name not in self._jobs:
            raise KeyError(name)
        return JobRecorder(self, name)

    def record(self, result: CycleResult, at: datetime) -> None:
        """The forecast job's result (the scheduler's `Recorder` for it)."""
        self.record_job("forecast", result, at)

    def record_job(self, name: str, result: CycleResult, at: datetime) -> None:
        with self._lock:
            self._jobs[name].record(result, at)

    def snapshot(self, now: datetime) -> tuple[int, dict[str, Any]]:
        with self._lock:
            forecast, anomaly = self._jobs["forecast"], self._jobs["anomaly"]
            statuses = [forecast.status(now, self._started_at, self._window)]
            if self._anomaly_enabled:
                statuses.append(anomaly.status(now, self._started_at, self._window))
            status = max(statuses, key=_STATUS_RANK.__getitem__)
            code = 503 if status == "degraded" else 200
            return code, {
                "status": status,
                "schemaVersion": self._schema_version,
                "model": dict(self._model),
                "cyclesSucceeded": forecast.succeeded,
                "cyclesFailed": forecast.failed,
                "lastCycle": forecast.last_summary,
                "anomaly": {
                    "enabled": self._anomaly_enabled,
                    "cyclesSucceeded": anomaly.succeeded,
                    "cyclesFailed": anomaly.failed,
                    "lastCycle": anomaly.last_summary,
                },
            }


def make_server(
    state: HealthState, now: Callable[[], datetime], port: int, host: str = "127.0.0.1"
) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        server_version = "bms-ml"
        sys_version = ""

        def _send(self, code: int, body: dict[str, Any], allow: bool = False) -> None:
            payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            if allow:
                self.send_header("Allow", "GET")
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self) -> None:  # noqa: N802 - the http.server hook name
            if urlsplit(self.path).path != "/health":
                self._send(404, {"error": "not found"})
                return
            code, body = state.snapshot(now())
            self._send(code, body)

        def _refuse(self) -> None:
            self._send(405, {"error": "method not allowed"}, allow=True)

        do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_HEAD = _refuse  # noqa: N815

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - silence the access log
            return

    return ThreadingHTTPServer((host, port), Handler)


def health_client(port: int, out: Callable[[str], None] = print) -> int:
    """GET the local /health. 0 when it answers 200, else 1."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=5) as response:
            out(response.read().decode("utf-8"))
            return 0 if response.status == 200 else 1
    except urllib.error.HTTPError as err:
        out(err.read().decode("utf-8", "replace"))
        return 1
    except (urllib.error.URLError, OSError):
        out(json.dumps({"status": "unreachable"}))
        return 1
