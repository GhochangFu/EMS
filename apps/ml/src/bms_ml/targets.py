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
    """A malformed ML_FORECAST_TARGETS. The message never carries the value."""


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


def parse_targets(raw: str | None) -> tuple[Target, ...]:
    """Parse `ML_FORECAST_TARGETS`. Unset or blank means `DEFAULT_TARGETS`."""
    if raw is None or raw.strip() == "":
        return DEFAULT_TARGETS
    entries = [entry.strip() for entry in raw.split(",")]
    if len(entries) > MAX_TARGETS:
        raise TargetError(f"ML_FORECAST_TARGETS may list at most {MAX_TARGETS} targets")
    targets: list[Target] = []
    for position, entry in enumerate(entries, start=1):
        parts = entry.split("/")
        if len(parts) != 3 or not all(_PART.fullmatch(part) for part in parts):
            raise TargetError(
                f"ML_FORECAST_TARGETS entry {position} is not domain/asset_type/point_key "
                "with each part [a-z0-9_]{1,64}"
            )
        target = Target(*parts)
        if target in targets:
            raise TargetError(f"ML_FORECAST_TARGETS entry {position} is a duplicate")
        targets.append(target)
    return tuple(targets)
