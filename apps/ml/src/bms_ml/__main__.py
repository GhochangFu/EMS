"""python -m bms_ml serve | run-once [--force] [--as-of ISO] | eligibility [--as-of ISO] | preflight | health

Exit codes: 0 ok (a partial failure is counted, not retried); 1 the cycle
failed for every organization it tried (the scheduler retries); 78 the
configuration, the database's ml schema, the role or the model is not one the
scorer may run with (the scheduler stops, and `serve` exits 78 too).

Every failure is logged as a fixed reason or `<stage>:<ExceptionClass>`, never
as an exception's message (AGENTS.md §9.6).
"""

from __future__ import annotations

import argparse
import signal
import sys
import threading
from collections.abc import Mapping
from contextlib import AbstractContextManager
from datetime import UTC, datetime, timedelta
from functools import partial
from typing import Any

from bms_ml import log
from bms_ml.config import Config, ConfigError, load_config
from bms_ml.forecasting import NoModelError, installed_model, load_forecaster
from bms_ml.health import HealthState, health_client, make_server
from bms_ml.readiness import LOOKBACK_DAYS, coverage, forecast_verdict
from bms_ml.scheduler import EXIT_CONFIG, EXIT_CYCLE_FAILED, EXIT_OK, run_cycle_process, run_scheduler
from bms_ml.scorer import run_cycle
from bms_ml.series import floor_to_hour


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class PreflightRefused(Exception):
    """Raised by `connect`'s database when the preflight refuses (wraps the gateway's error)."""


def connect(config: Config) -> AbstractContextManager[Any]:
    """The real gateway, imported here so `health` never loads the database driver."""
    from bms_ml.db.gateway import Gateway

    return Gateway.connect(config.database_url_fleet)


def _preflight(db: Any) -> tuple[int, str]:
    from bms_ml.db.gateway import PreflightError

    try:
        return db.preflight()
    except PreflightError as err:
        raise PreflightRefused(str(err)) from None


def _instant(text: str) -> datetime:
    try:
        value = datetime.fromisoformat(text)
    except ValueError:
        raise argparse.ArgumentTypeError("--as-of must be an ISO 8601 instant with a zone") from None
    if value.tzinfo is None or value.utcoffset() is None:
        raise argparse.ArgumentTypeError("--as-of must carry a zone, for example 2026-11-15T12:00Z")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m bms_ml", description="TRINETRA BMS batch scorer")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("serve", help="the hourly loop with GET /health on loopback")
    run_once = commands.add_parser("run-once", help="one cycle, then exit")
    run_once.add_argument("--force", action="store_true", help="score even when the hour is already scored")
    run_once.add_argument("--as-of", type=_instant, help="score as of this instant (verification, backfill)")
    eligibility = commands.add_parser("eligibility", help="print the readiness verdict of every target point")
    eligibility.add_argument("--as-of", type=_instant)
    commands.add_parser("preflight", help="check the schema version and the role, then exit")
    commands.add_parser("health", help="GET the local /health (the Docker HEALTHCHECK client)")
    return parser


def cmd_preflight(config: Config) -> int:
    try:
        with connect(config) as db:
            version, role = _preflight(db)
    except PreflightRefused as err:
        log.event("preflight_failed", "error", reason=str(err))
        return EXIT_CONFIG
    except Exception as exc:  # noqa: BLE001 - a driver message can carry a host or a user
        log.event("preflight_failed", "error", reason=f"connect:{type(exc).__name__}")
        return EXIT_CONFIG
    log.event("preflight_ok", schema_version=version, role=role)
    return EXIT_OK


def cmd_run_once(config: Config, *, force: bool, as_of: datetime | None) -> int:
    stage = "connect"
    try:
        with connect(config) as db:
            stage = "preflight"
            _preflight(db)
            stage = "model"
            forecaster = load_forecaster(config.model_dir, config.torch_threads)
            stage = "cycle"
            summary = run_cycle(db, forecaster, SystemClock(), config, force=force, as_of=as_of)
    except PreflightRefused as err:
        log.event("preflight_failed", "error", reason=str(err))
        return EXIT_CONFIG
    except NoModelError as err:
        log.event("model_missing", "error", reason=str(err))
        return EXIT_CONFIG
    except Exception as exc:  # noqa: BLE001
        log.event("cycle_failed", "error", error=f"{stage}:{type(exc).__name__}")
        return EXIT_CYCLE_FAILED
    log.event("cycle_summary", **summary.counts())
    # Exit 1 (retry in 300 s) only when nothing succeeded. A partial failure is
    # counted and logged, and retried at the next tick: a retry would reload the
    # model only to fail the same organization again (code review, PR 3).
    complete_failure = summary.runs_failed > 0 and summary.runs_succeeded == 0
    return EXIT_CYCLE_FAILED if complete_failure else EXIT_OK


def cmd_eligibility(config: Config, *, as_of: datetime | None) -> int:
    as_of_hour = floor_to_hour(as_of if as_of is not None else SystemClock().now())
    try:
        with connect(config) as db:
            _preflight(db)  # the same role contract as run-once: never read as a superuser
            stats = db.eligibility(
                config.forecast_targets, as_of_hour - timedelta(days=LOOKBACK_DAYS), as_of_hour
            )
    except PreflightRefused as err:
        log.event("preflight_failed", "error", reason=str(err))
        return EXIT_CONFIG
    except Exception as exc:  # noqa: BLE001
        log.event("eligibility_failed", "error", error=f"eligibility:{type(exc).__name__}")
        return EXIT_CYCLE_FAILED
    columns = (
        "organization_id",
        "asset_code",
        "point_key",
        "days",
        "coverage_pct",
        "newest_bucket",
        "verdict",
    )
    lines = ["\t".join(columns)]
    for point in stats:
        newest = point.last_bucket.astimezone(UTC).isoformat() if point.last_bucket else "-"
        cover = 100 * coverage(point.first_bucket, point.last_bucket, point.hours_with_data)
        verdict = forecast_verdict(point, as_of_hour)
        row = (str(point.organization_id), point.asset_code, point.point_key, str(point.days_with_data))
        lines.append("\t".join((*row, f"{cover:.1f}", newest, verdict)))
    sys.stdout.write("\n".join(lines) + "\n")
    return EXIT_OK


def cmd_serve(config: Config) -> int:
    try:
        with connect(config) as db:
            version, role = _preflight(db)
        name, model_version = installed_model(config.model_dir)
    except PreflightRefused as err:
        log.event("preflight_failed", "error", reason=str(err))
        return EXIT_CONFIG
    except NoModelError as err:
        log.event("model_missing", "error", reason=str(err))
        return EXIT_CONFIG
    except Exception as exc:  # noqa: BLE001
        log.event("preflight_failed", "error", reason=f"connect:{type(exc).__name__}")
        return EXIT_CONFIG

    stop = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stop.set())
    clock = SystemClock()
    state = HealthState(config.interval_seconds, clock.now(), version, name, model_version)
    server = make_server(state, clock.now, config.health_port)
    threading.Thread(target=server.serve_forever, name="health", daemon=True).start()
    log.event("serve_started", schema_version=version, role=role, model=name, health_port=config.health_port)
    try:
        return run_scheduler(
            clock=clock,
            wait=stop.wait,
            run_cycle_process=partial(
                run_cycle_process,
                [sys.executable, "-m", "bms_ml", "run-once"],
                config.cycle_timeout_seconds,
                stop=stop,
            ),
            health=state,
            interval_seconds=config.interval_seconds,
        )
    finally:
        server.shutdown()
        server.server_close()
        log.event("serve_stopped")


def main(argv: list[str] | None = None, environ: Mapping[str, str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        config = load_config(environ)
    except ConfigError as err:
        log.configure("info")
        log.event("config_refused", "error", reason=str(err))
        return EXIT_CONFIG
    log.configure(config.log_level)
    if args.command == "health":
        return health_client(config.health_port)
    if args.command == "preflight":
        return cmd_preflight(config)
    if args.command == "eligibility":
        return cmd_eligibility(config, as_of=args.as_of)
    if args.command == "run-once":
        return cmd_run_once(config, force=args.force, as_of=args.as_of)
    return cmd_serve(config)


if __name__ == "__main__":
    sys.exit(main())
