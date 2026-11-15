"""`GET /health` on 127.0.0.1, and nothing else (ADR 0135 decision 2; plan T3.9).

`ok` needs a successful cycle younger than twice the interval; before the
first cycle, and for no longer than that, the status is `starting`; anything
else is `degraded` (503). The body carries the schema version, the model name
and version, and the last cycle's counts. It never carries an asset id, an
asset code or an organization: the counts are copied through an allowlist, so
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
    "duration_seconds",
)
SKIP_REASONS = (
    "no_data",
    "too_few_days",
    "low_coverage",
    "stale",
    "context_too_sparse",
    "non_finite_output",
    "already_scored",
)


def _counts_only(summary: dict[str, Any] | None) -> dict[str, Any] | None:
    if summary is None:
        return None
    counts: dict[str, Any] = {}
    for key in COUNT_KEYS:
        value = summary.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            counts[key] = value
    as_of = summary.get("as_of_hour")
    if isinstance(as_of, str) and len(as_of) <= 40:
        counts["as_of_hour"] = as_of
    skipped = summary.get("skipped")
    if isinstance(skipped, dict):
        counts["skipped"] = {
            reason: skipped[reason]
            for reason in SKIP_REASONS
            if isinstance(skipped.get(reason), int) and not isinstance(skipped.get(reason), bool)
        }
    return counts


class HealthState:
    def __init__(
        self,
        interval_seconds: int,
        started_at: datetime,
        schema_version: int,
        model_name: str,
        model_version: str,
    ) -> None:
        self._lock = threading.Lock()
        self._window = timedelta(seconds=2 * interval_seconds)
        self._started_at = started_at
        self._schema_version = schema_version
        self._model = {"name": model_name, "version": model_version}
        self._last_success: datetime | None = None
        self._last_summary: dict[str, Any] | None = None
        self.cycles_succeeded = 0
        self.cycles_failed = 0

    def record(self, result: CycleResult, at: datetime) -> None:
        with self._lock:
            if result.exit_code == EXIT_OK:
                self.cycles_succeeded += 1
                self._last_success = at
            else:
                self.cycles_failed += 1
            self._last_summary = _counts_only(result.summary)

    def snapshot(self, now: datetime) -> tuple[int, dict[str, Any]]:
        with self._lock:
            if self._last_success is not None and now - self._last_success < self._window:
                code, status = 200, "ok"
            elif (
                self._last_success is None
                and self.cycles_failed == 0
                and now - self._started_at < self._window
            ):
                code, status = 200, "starting"
            else:
                code, status = 503, "degraded"
            return code, {
                "status": status,
                "schemaVersion": self._schema_version,
                "model": dict(self._model),
                "cyclesSucceeded": self.cycles_succeeded,
                "cyclesFailed": self.cycles_failed,
                "lastCycle": self._last_summary,
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

        do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _refuse  # noqa: N815

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
