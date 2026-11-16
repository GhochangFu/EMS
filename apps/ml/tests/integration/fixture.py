"""Plants the E1.1 integration fixture into `bms_ml_test` (plan T3.10).

A local or CI database holds no real telemetry, so the fixture plants its own
class: a point key, an asset type `ml_fixture_room` with one template per
organization, two RTUs (one ingest-enabled, one not) and eight assets with one
sample per hour. Every sample is dated AHEAD of now (`as_of` = this hour + 70
days): refresh policies stop at `now() - end_offset`, so these rows are always
served by the live branch of `_1h` and no background job can hide them behind a
watermark mid-test (the F4.28 pattern).

| Asset | Shape                                                      | Expected                    |
|-------|------------------------------------------------------------|-----------------------------|
| R1    | meta.telemetrySource = 'mqtt', 60 d, full                  | forecast                    |
| R2    | measured on an ingest_enabled RTU, 60 d                    | forecast                    |
| G1    | mqtt, 60 d, a 5 h hole on each of the last 15 days         | forecast; context holds NaN |
| W1    | mqtt, 17 d at 4 h a day (the VAP_Blast_Freezer_2 shape)    | nothing, too_few_days       |
| V1    | mqtt, 33 d full (the two VAP rooms)                        | nothing, too_few_days       |
| S1    | R1's data, not mqtt, on an RTU with ingest_enabled = false | nothing, never returned     |
| T0    | mqtt, 60 d, a point key that is not a target               | nothing                     |
| O2    | mqtt, 60 d, the SECOND organization                        | forecast, under its own run |

Runnable for plan PR 4's step 6: `python -m tests.integration.fixture` plants it
through ML_TEST_DATABASE_URL_SUPERUSER and prints `as_of` and the target.
`--extra-ready N` adds N more ready rooms (MLFX-X00..), 90 days each, so plan
T4.4 can time a cycle at 8 and at 21 series with a full 2,016-hour context.
"""

from __future__ import annotations

import json
import math
import os
import sys
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import psycopg
from psycopg.types.json import Jsonb

REQUIRED_DATABASE = "bms_ml_test"
NAMESPACE = uuid.UUID("6f1d0a52-3b8e-4c1e-9f0e-e11a00000000")
DOMAIN = "facility"
ASSET_TYPE = "ml_fixture_room"
POINT = "ml_fixture_temp_c"
OTHER_POINT = "ml_fixture_other"
TARGET = f"{DOMAIN}/{ASSET_TYPE}/{POINT}"
TEMPLATE_CODE = "ML_FIXTURE_ROOM"
FORECASTER_NAME = "ml-fixture-forecaster"
ORGANIZATIONS = {"A": "ESKOM", "B": "PHEWB"}
FORECAST = ("MLFX-R1", "MLFX-R2", "MLFX-G1", "MLFX-O2")
NO_FORECAST = ("MLFX-W1", "MLFX-V1", "MLFX-S1", "MLFX-T0")
G1_MISSING_HOURS = 15 * 5


def full(days: int) -> list[int]:
    """Hours back from as_of (1 = the bucket that ends at as_of)."""
    return list(range(1, days * 24 + 1))


def with_daily_hole(days: int, as_of: datetime) -> list[int]:
    return [h for h in full(days) if not (h <= 15 * 24 and 1 <= (as_of - timedelta(hours=h)).hour <= 5)]


def four_hours_a_day(days: int, as_of: datetime) -> list[int]:
    """Four hours on each of `days` UTC days, never across a UTC midnight.

    `eligibility` counts UTC days, so the four hours of one day must share a
    date: at an `as_of` hour of 1-3 the four hours before it cross midnight, so
    they start just before it instead (tests/test_fixture_shapes.py).
    """
    first = as_of.hour + 1 if 1 <= as_of.hour <= 3 else 1
    return [first + day * 24 + offset for day in range(days) for offset in range(4)]


@dataclass(frozen=True)
class Shape:
    code: str
    organization: str
    mqtt: bool
    rtu: str | None
    point_key: str
    level: float


SHAPES = (
    Shape("MLFX-R1", "A", True, None, POINT, 2.0),
    Shape("MLFX-R2", "A", False, "MLFX-RTU-ON", POINT, 3.0),
    Shape("MLFX-G1", "A", True, None, POINT, 4.0),
    Shape("MLFX-W1", "A", True, None, POINT, 5.0),
    Shape("MLFX-V1", "A", True, None, POINT, 6.0),
    Shape("MLFX-S1", "A", False, "MLFX-RTU-OFF", POINT, 2.0),
    Shape("MLFX-T0", "A", True, None, OTHER_POINT, 7.0),
    Shape("MLFX-O2", "B", True, None, POINT, 8.0),
)


def extra_shapes(count: int) -> tuple[Shape, ...]:
    """More ready rooms, 90 days each (a full 2,016-hour context), for plan T4.4's measurement."""
    return tuple(Shape(f"MLFX-X{i:02d}", "A", True, None, POINT, 3.0 + i / 10) for i in range(count))


def hours_for(code: str, as_of: datetime) -> list[int]:
    if code.startswith("MLFX-X"):
        return full(90)
    if code == "MLFX-G1":
        return with_daily_hole(60, as_of)
    if code == "MLFX-W1":
        return four_hours_a_day(17, as_of)
    if code == "MLFX-V1":
        return full(33)
    return full(60)


def asset_id(code: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, code)


@dataclass(frozen=True)
class Planted:
    as_of: datetime
    organizations: dict[str, uuid.UUID]
    assets: dict[str, uuid.UUID]
    asset_organization: dict[str, uuid.UUID]


def require_test_database(conn: psycopg.Connection) -> None:
    name = conn.execute("SELECT current_database()").fetchone()[0]
    if name != REQUIRED_DATABASE:
        raise RuntimeError(
            f"refusing to plant into {name!r}: only {REQUIRED_DATABASE!r} is a throwaway database"
        )


def clean(conn: psycopg.Connection) -> None:
    """Remove every row an earlier plant or run left. Superuser only; bms_ml_test only."""
    require_test_database(conn)
    with conn.transaction():
        rows = conn.execute("SELECT id FROM bms.assets WHERE code LIKE %s", ("MLFX-%",)).fetchall()
        ids = sorted({asset_id(shape.code) for shape in SHAPES} | {row[0] for row in rows})
        conn.execute("DELETE FROM ml.forecasts WHERE asset_id = ANY(%s)", (ids,))
        conn.execute("DELETE FROM ml.model_runs WHERE model_name = %s", (FORECASTER_NAME,))
        conn.execute("DELETE FROM telemetry.point_values WHERE asset_id = ANY(%s)", (ids,))
        conn.execute("DELETE FROM bms.asset_points WHERE asset_id = ANY(%s)", (ids,))
        conn.execute("DELETE FROM bms.assets WHERE id = ANY(%s)", (ids,))
        conn.execute("DELETE FROM bms.rtus WHERE code LIKE %s", ("MLFX-%",))
        conn.execute("DELETE FROM bms.asset_templates WHERE code = %s", (TEMPLATE_CODE,))


def plant(conn: psycopg.Connection, now: datetime | None = None, extra_ready: int = 0) -> Planted:
    clean(conn)
    shapes = SHAPES + extra_shapes(extra_ready)
    current = now if now is not None else datetime.now(UTC)
    as_of = current.astimezone(UTC).replace(minute=0, second=0, microsecond=0) + timedelta(days=70)
    organizations: dict[str, uuid.UUID] = {}
    locations: dict[str, uuid.UUID] = {}
    templates: dict[str, uuid.UUID] = {}
    rtus: dict[str, uuid.UUID] = {}
    with conn.transaction():
        for key, code in ORGANIZATIONS.items():
            organizations[key] = conn.execute(
                "SELECT id FROM bms.organizations WHERE code = %s", (code,)
            ).fetchone()[0]
            locations[key] = conn.execute(
                "SELECT id FROM bms.locations WHERE organization_id = %s ORDER BY id LIMIT 1",
                (organizations[key],),
            ).fetchone()[0]
            templates[key] = conn.execute(
                "INSERT INTO bms.asset_templates (organization_id, code, name, asset_type, domain) "
                "VALUES (%s, %s, 'ML fixture room', %s, %s) RETURNING id",
                (organizations[key], TEMPLATE_CODE, ASSET_TYPE, DOMAIN),
            ).fetchone()[0]
        for rtu_code, enabled in (("MLFX-RTU-ON", True), ("MLFX-RTU-OFF", False)):
            rtus[rtu_code] = conn.execute(
                "INSERT INTO bms.rtus (organization_id, location_id, code, display_name, ingest_enabled) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (organizations["A"], locations["A"], rtu_code, rtu_code, enabled),
            ).fetchone()[0]
        for key in (POINT, OTHER_POINT):
            conn.execute(
                "INSERT INTO bms.point_keys (code, name) VALUES (%s, %s) ON CONFLICT (code) DO NOTHING",
                (key, key),
            )
        for shape in shapes:
            org = organizations[shape.organization]
            rtu = rtus.get(shape.rtu) if shape.rtu else None
            meta = {"telemetrySource": "mqtt"} if shape.mqtt else {}
            conn.execute(
                "INSERT INTO bms.assets (id, organization_id, code, name, site_name, location_id, domain, "
                "template_id, rtu_id, meta) VALUES (%s, %s, %s, %s, 'ML fixture', %s, %s, %s, %s, %s)",
                (asset_id(shape.code), org, shape.code, shape.code, locations[shape.organization], DOMAIN,
                 templates[shape.organization], rtu, Jsonb(meta)),
            )  # fmt: skip
            conn.execute(
                "INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, "
                "source_kind, rtu_id) VALUES (%s, %s, %s, %s, %s, %s)",
                (org, asset_id(shape.code), shape.point_key, shape.point_key,
                 "measured" if rtu else "unmapped", rtu),
            )  # fmt: skip
        with conn.cursor().copy(
            "COPY telemetry.point_values (time, asset_id, point_key, value, unit) FROM STDIN"
        ) as copy:
            for shape in shapes:
                for h in hours_for(shape.code, as_of):
                    when = as_of - timedelta(hours=h) + timedelta(minutes=10)
                    value = shape.level + 0.25 * math.sin(h / 24 * 2 * math.pi)
                    copy.write_row((when, asset_id(shape.code), shape.point_key, value, "degC"))
    return Planted(
        as_of=as_of,
        organizations=organizations,
        assets={shape.code: asset_id(shape.code) for shape in shapes},
        asset_organization={shape.code: organizations[shape.organization] for shape in shapes},
    )


def main() -> int:
    url = os.environ.get("ML_TEST_DATABASE_URL_SUPERUSER", "").strip()
    if not url:
        sys.stderr.write("ML_TEST_DATABASE_URL_SUPERUSER is required\n")
        return 78
    extra = int(sys.argv[sys.argv.index("--extra-ready") + 1]) if "--extra-ready" in sys.argv else 0
    with psycopg.connect(url, autocommit=True) as conn:
        planted = plant(conn, extra_ready=extra)
    sys.stdout.write(json.dumps({"as_of": planted.as_of.isoformat(), "target": TARGET}) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
