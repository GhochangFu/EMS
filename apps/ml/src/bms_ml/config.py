"""Configuration. The ONLY module that reads `os.environ`.

Every variable is read once, at start, and checked against its bound. A bad
value refuses to start with a message that names the variable and never its
value: a value can be a DSN, and a DSN carries a password (AGENTS.md §9.6).
There is deliberately no fallback from `DATABASE_URL_FLEET` to
`DATABASE_URL`: the scorer runs as `bms_fleet` or not at all (ADR 0135
decision 3).
"""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, fields

from bms_ml.targets import Target, TargetError, parse_targets

LOG_LEVELS = ("debug", "info", "warning", "error")


class ConfigError(ValueError):
    """A configuration the scorer refuses to start with (exit code 78)."""


@dataclass(frozen=True, repr=False)
class Config:
    database_url_fleet: str
    interval_seconds: int
    cycle_timeout_seconds: int
    forecast_horizon_hours: int
    context_hours: int
    forecast_targets: tuple[Target, ...]
    model_dir: str
    torch_threads: int | None
    health_port: int
    log_level: str

    def __repr__(self) -> str:
        shown = []
        for item in fields(self):
            value = "<redacted>" if item.name == "database_url_fleet" else repr(getattr(self, item.name))
            shown.append(f"{item.name}={value}")
        return f"Config({', '.join(shown)})"

    __str__ = __repr__


def _integer(environ: Mapping[str, str], name: str, default: int, low: int, high: int) -> int:
    raw = environ.get(name)
    if raw is None or raw.strip() == "":
        value = default
    else:
        try:
            value = int(raw.strip(), 10)
        except ValueError:
            raise ConfigError(f"{name} must be an integer from {low} to {high}") from None
    if not low <= value <= high:
        raise ConfigError(f"{name} must be an integer from {low} to {high}")
    return value


def load_config(environ: Mapping[str, str] | None = None) -> Config:
    """Read and check every variable. `environ` defaults to `os.environ`."""
    source = os.environ if environ is None else environ

    dsn = source.get("DATABASE_URL_FLEET", "").strip()
    if not dsn:
        raise ConfigError("DATABASE_URL_FLEET is required (there is no fallback to DATABASE_URL)")

    interval = _integer(source, "ML_INTERVAL_SECONDS", 3600, 900, 86400)
    # Ticks land at k * interval + 5 min. A multiple of 900 that divides a day keeps
    # every tick at :05, :20, :35 or :50, never in an hour's first five minutes.
    if interval % 900 or 86400 % interval:
        raise ConfigError("ML_INTERVAL_SECONDS must be a multiple of 900 that divides 86400")
    timeout = _integer(source, "ML_CYCLE_TIMEOUT_SECONDS", 900, 60, interval - 60)
    horizon = _integer(source, "ML_FORECAST_HORIZON_HOURS", 48, 1, 64)
    context = _integer(source, "ML_CONTEXT_HOURS", 2016, 336, 2048)
    health_port = _integer(source, "ML_HEALTH_PORT", 4200, 1024, 65535)

    raw_threads = source.get("ML_TORCH_THREADS")
    threads = None
    if raw_threads is not None and raw_threads.strip() != "":
        threads = _integer(source, "ML_TORCH_THREADS", 1, 1, 64)

    try:
        targets = parse_targets(source.get("ML_FORECAST_TARGETS"))
    except TargetError as err:
        raise ConfigError(str(err)) from None

    log_level = source.get("LOG_LEVEL", "info").strip().lower() or "info"
    if log_level not in LOG_LEVELS:
        raise ConfigError(f"LOG_LEVEL must be one of {', '.join(LOG_LEVELS)}")

    return Config(
        database_url_fleet=dsn,
        interval_seconds=interval,
        cycle_timeout_seconds=timeout,
        forecast_horizon_hours=horizon,
        context_hours=context,
        forecast_targets=targets,
        model_dir=source.get("ML_MODEL_DIR", "").strip() or "/opt/bms-ml/model",
        torch_threads=threads,
        health_port=health_port,
        log_level=log_level,
    )


def config_hash(
    config: Config,
    *,
    model_name: str,
    model_version: str,
    thresholds: Mapping[str, float | int],
    quantiles: Sequence[float],
    package_versions: Mapping[str, str],
) -> str:
    """sha256 of the canonical JSON of everything that shapes a forecast.

    The DSN, the schedule and the health port do not shape a forecast, so they
    are left out: changing them must not make the ledger re-score an hour.
    """
    payload = {
        "horizon_hours": config.forecast_horizon_hours,
        "context_hours": config.context_hours,
        "targets": [str(target) for target in config.forecast_targets],
        "thresholds": dict(thresholds),
        "quantiles": list(quantiles),
        "model": {"name": model_name, "version": model_version},
        "packages": dict(package_versions),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
