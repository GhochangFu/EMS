"""Forecast targets: which points the scorer forecasts (ADR 0135 Amendment 2, ruling 2).

A target is `domain/asset_type/point_key`, matched against `bms.assets.domain`,
`bms.asset_templates.asset_type` and `bms.asset_points.point_key`. The list is
class-keyed on purpose: a new room of a targeted class becomes eligible by
itself once its own history passes the readiness gate, with no code change.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

MAX_TARGETS = 32
_PART = re.compile(r"[a-z0-9_]{1,64}")


class TargetError(ValueError):
    """A malformed target list. The message never carries the value."""


@dataclass(frozen=True)
class Target:
    domain: str
    asset_type: str
    point_key: str

    def __str__(self) -> str:
        return f"{self.domain}/{self.asset_type}/{self.point_key}"


DEFAULT_TARGETS: tuple[Target, ...] = (
    Target("facility", "cold_room", "cold_room_temp_c"),
    Target("electrical", "energy_meter", "kw"),
)


def _energy_meter(*keys: str) -> tuple[Target, ...]:
    return tuple(Target("electrical", "energy_meter", key) for key in keys)


# ADR 0135 Amendment 5, ruling 1, in the table's order. Never `kwh_total`: a counter that only climbs.
DEFAULT_ANOMALY_TARGETS: tuple[Target, ...] = (
    *_energy_meter(
        "kw",
        "kva",
        "kvar",
        "pf",
        "frequency_hz",
        "voltage_l1_v",
        "voltage_vry",
        "voltage_vyb",
        "voltage_vbr",
        "voltage_vrn",
        "voltage_vyn",
        "voltage_vbn",
        "current_ir",
        "current_iy",
        "current_ib",
    ),
    Target("electrical", "pump_breaker", "breaker_main"),
    Target("electrical", "chlorine_pump", "chlorine_pump_on"),
    Target("environment", "rtu_health", "battery_charge_pct"),
    Target("environment", "rtu_health", "network_strength"),
    Target("environment", "rtu_health", "controller_power_status"),
    Target("facility", "cold_room", "cold_room_temp_c"),
)


def parse_targets(
    raw: str | None,
    *,
    variable: str = "ML_FORECAST_TARGETS",
    default: tuple[Target, ...] = DEFAULT_TARGETS,
) -> tuple[Target, ...]:
    """Parse a target list. Unset or blank means `default`. Errors name `variable`, never `raw`."""
    if raw is None or raw.strip() == "":
        return default
    entries = [entry.strip() for entry in raw.split(",")]
    if len(entries) > MAX_TARGETS:
        raise TargetError(f"{variable} may list at most {MAX_TARGETS} targets")
    targets: list[Target] = []
    for position, entry in enumerate(entries, start=1):
        parts = entry.split("/")
        if len(parts) != 3 or not all(_PART.fullmatch(part) for part in parts):
            raise TargetError(
                f"{variable} entry {position} is not domain/asset_type/point_key "
                "with each part [a-z0-9_]{1,64}"
            )
        target = Target(*parts)
        if target in targets:
            raise TargetError(f"{variable} entry {position} is a duplicate")
        targets.append(target)
    return tuple(targets)
