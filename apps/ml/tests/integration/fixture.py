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

E1.2 (ADR 0135 Amendment 5) adds two synthetic anomaly classes, kept apart from
the rooms above (`Planted.anomaly_assets`, never `Planted.assets`, so the forecast
suite's per-asset counts keep their meaning): `ml_fixture_meter` with 4 points
and `ml_fixture_single` with 1, 60 days each, same `as_of`.

| Asset      | Shape                                                  | Expected (anomaly job)        |
|------------|--------------------------------------------------------|-------------------------------|
| MLFX-AM1   | meter, mqtt, 60 d, all 4 points full                   | baseline_mad + isolation_forest |
| MLFX-AS1   | single, mqtt, 60 d                                     | baseline_mad only             |
| MLFX-AMST  | meter, mqtt, 60 d, STALE_POINT missing its last 5 h    | nothing, asset_not_ready (R5) |
| MLFX-AMSIM | meter, not mqtt, no RTU (simulated)                    | nothing, never returned       |
| MLFX-BM1   | meter, mqtt, 60 d, the SECOND organization             | both, under its own run       |
| MLFX-BS1   | single, mqtt, 60 d, the SECOND organization            | baseline_mad only             |

Runnable for plan PR 4's step 6: `python -m tests.integration.fixture` plants it
through ML_TEST_DATABASE_URL_SUPERUSER and prints `as_of` and the target.
`--extra-ready N` adds N more ready rooms (MLFX-X00..), 90 days each, so plan
T4.4 can time a cycle at 8 and at 21 series with a full 2,016-hour context.

E1.2 plan T1.10 (ruling 5's measurement, `measure_cycle.py`) adds two options:
`--anomaly-shape` plants the anomaly job at the real shape, in organization A
only, on three more synthetic classes of their own (so no other suite's targets
see them): 5 assets x 15 points, 5 x 3 and 28 x 1, each point 91 days
(MEASURE_HOURS). `--ahead-days D` moves `as_of` to this hour + D days (default
AHEAD_DAYS = 70, unchanged for the suites); 91 days of history stay ahead of
now only when D > 91, hence MEASURE_AHEAD_DAYS.
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

# --- E1.2: the anomaly classes ---------------------------------------------------------
METER_TYPE = "ml_fixture_meter"
SINGLE_TYPE = "ml_fixture_single"
METER_POINTS = ("ml_fixture_kw", "ml_fixture_kva", "ml_fixture_pf", "ml_fixture_volt")
SINGLE_POINT = "ml_fixture_level"
ANOMALY_TEMPLATE_CODES = {METER_TYPE: "ML_FIXTURE_METER", SINGLE_TYPE: "ML_FIXTURE_SINGLE"}
ANOMALY_TARGETS = ",".join(
    [f"{DOMAIN}/{METER_TYPE}/{point}" for point in METER_POINTS] + [f"{DOMAIN}/{SINGLE_TYPE}/{SINGLE_POINT}"]
)
SINGLE_TARGET = f"{DOMAIN}/{SINGLE_TYPE}/{SINGLE_POINT}"
STALE_POINT = "ml_fixture_pf"
STALE_MISSING_HOURS = 5  # last bucket = as_of - 6 h, older than the 3 h staleness line
ANOMALY_SCORED = ("MLFX-AM1", "MLFX-AS1", "MLFX-BM1", "MLFX-BS1")
ANOMALY_NOT_SCORED = ("MLFX-AMST", "MLFX-AMSIM")
# The model name the anomaly job writes (`anomaly_baseline.ANOMALY_MODEL_NAME`, ADR 0135
# Amendment 5 A-a), and the names the integration tests write runs under directly.
ANOMALY_MODEL_NAME = "bms-anomaly"
ANOMALY_FIXTURE_NAME = "ml-fixture-anomaly"
PROOF_FORECASTER_NAME = "ml-fixture-forecaster-aa"
OTHER_MODEL_NAME = "ml-fixture-other-model"
FIXTURE_RUN_NAMES = (
    FORECASTER_NAME,
    ANOMALY_MODEL_NAME,
    ANOMALY_FIXTURE_NAME,
    PROOF_FORECASTER_NAME,
    OTHER_MODEL_NAME,
)
AHEAD_DAYS = 70

# --- E1.2 T1.10: the anomaly job at the real shape (ruling 5's measurement) -------------
MEASURE_HOURS = 91 * 24  # 2,184: the baseline's 91 days
MEASURE_AHEAD_DAYS = 95  # every one of the 2,184 hours stays ahead of now
MEASURE_CLASSES = (
    # (asset type, template code, code prefix, asset count, point keys)
    (
        "ml_fixture_meter15",
        "ML_FIXTURE_METER15",
        "MLFX-MM",
        5,
        tuple(f"ml_fixture_e{i:02d}" for i in range(15)),
    ),
    ("ml_fixture_rtu3", "ML_FIXTURE_RTU3", "MLFX-MR", 5, tuple(f"ml_fixture_h{i}" for i in range(3))),
    ("ml_fixture_single91", "ML_FIXTURE_SINGLE91", "MLFX-MS", 28, ("ml_fixture_s",)),
)
MEASURE_TARGETS = ",".join(
    f"{DOMAIN}/{asset_type}/{point}" for asset_type, _, _, _, points in MEASURE_CLASSES for point in points
)
MEASURE_TEMPLATE_CODES = tuple(template for _, template, _, _, _ in MEASURE_CLASSES)


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


@dataclass(frozen=True)
class AnomalyShape:
    code: str
    organization: str
    asset_type: str
    points: tuple[str, ...]
    mqtt: bool
    stale_point: str | None
    level: float


ANOMALY_SHAPES = (
    AnomalyShape("MLFX-AM1", "A", METER_TYPE, METER_POINTS, True, None, 20.0),
    AnomalyShape("MLFX-AS1", "A", SINGLE_TYPE, (SINGLE_POINT,), True, None, 3.0),
    AnomalyShape("MLFX-AMST", "A", METER_TYPE, METER_POINTS, True, STALE_POINT, 21.0),
    AnomalyShape("MLFX-AMSIM", "A", METER_TYPE, METER_POINTS, False, None, 22.0),
    AnomalyShape("MLFX-BM1", "B", METER_TYPE, METER_POINTS, True, None, 23.0),
    AnomalyShape("MLFX-BS1", "B", SINGLE_TYPE, (SINGLE_POINT,), True, None, 4.0),
)


def anomaly_hours_for(shape: AnomalyShape, point_key: str) -> list[int]:
    """60 days back from as_of; the stale point stops STALE_MISSING_HOURS before it."""
    if point_key == shape.stale_point:
        return [h for h in full(60) if h > STALE_MISSING_HOURS]
    return full(60)


def anomaly_value(shape: AnomalyShape, point_key: str, h: int) -> float:
    """A daily cycle per point, each point on its own level and phase."""
    index = shape.points.index(point_key)
    return shape.level + index + 0.25 * math.sin((h + 3 * index) / 24 * 2 * math.pi)


def measure_shapes() -> tuple[AnomalyShape, ...]:
    """The anomaly job's real shape for T1.10: 38 assets in organization A, none stale."""
    return tuple(
        AnomalyShape(f"{prefix}{i:02d}", "A", asset_type, points, True, None, 10.0 + i)
        for asset_type, _, prefix, count, points in MEASURE_CLASSES
        for i in range(count)
    )


def measure_value(shape: AnomalyShape, point_key: str, h: int) -> float:
    """A daily and a weekly cycle per point, plus a fixed pseudo-random wobble.

    Deterministic, so a run is repeatable, and not flat, so the forest and the
    baseline do their real work.
    """
    index = shape.points.index(point_key)
    wobble = ((h * 2654435761 + index * 40503 + int(shape.level) * 9973) % 1000) / 1000 - 0.5
    daily = math.sin((h + 3 * index) / 24 * 2 * math.pi)
    weekly = math.sin(h / 168 * 2 * math.pi)
    return shape.level + index + daily + 0.3 * weekly + 0.2 * wobble


def as_of_for(now: datetime, ahead_days: int) -> datetime:
    """This hour + `ahead_days`: the fixture's rows sit ahead of every refresh watermark."""
    return now.astimezone(UTC).replace(minute=0, second=0, microsecond=0) + timedelta(days=ahead_days)


def asset_id(code: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, code)


@dataclass(frozen=True)
class Planted:
    as_of: datetime
    organizations: dict[str, uuid.UUID]
    assets: dict[str, uuid.UUID]
    asset_organization: dict[str, uuid.UUID]
    # E1.2: the anomaly classes, apart from `assets` (see the module docstring).
    anomaly_assets: dict[str, uuid.UUID]
    anomaly_asset_organization: dict[str, uuid.UUID]


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
        ids = sorted(
            {asset_id(shape.code) for shape in (*SHAPES, *ANOMALY_SHAPES, *measure_shapes())}
            | {row[0] for row in rows}
        )
        names = list(FIXTURE_RUN_NAMES)
        runs = "SELECT id FROM ml.model_runs WHERE model_name = ANY(%s)"
        # Rows go before their runs: neither child foreign key to ml.model_runs cascades.
        conn.execute(
            f"DELETE FROM ml.forecasts WHERE asset_id = ANY(%s) OR model_run_id IN ({runs})", (ids, names)
        )
        conn.execute(
            f"DELETE FROM ml.anomaly_scores WHERE asset_id = ANY(%s) OR model_run_id IN ({runs})",
            (ids, names),
        )
        conn.execute("DELETE FROM ml.model_runs WHERE model_name = ANY(%s)", (names,))
        conn.execute("DELETE FROM telemetry.point_values WHERE asset_id = ANY(%s)", (ids,))
        conn.execute("DELETE FROM bms.asset_points WHERE asset_id = ANY(%s)", (ids,))
        conn.execute("DELETE FROM bms.assets WHERE id = ANY(%s)", (ids,))
        conn.execute("DELETE FROM bms.rtus WHERE code LIKE %s", ("MLFX-%",))
        conn.execute(
            "DELETE FROM bms.asset_templates WHERE code = ANY(%s)",
            ([TEMPLATE_CODE, *ANOMALY_TEMPLATE_CODES.values(), *MEASURE_TEMPLATE_CODES],),
        )


def plant(
    conn: psycopg.Connection,
    now: datetime | None = None,
    extra_ready: int = 0,
    *,
    ahead_days: int = AHEAD_DAYS,
    anomaly_shape: bool = False,
) -> Planted:
    clean(conn)
    shapes = SHAPES + extra_shapes(extra_ready)
    measured = measure_shapes() if anomaly_shape else ()
    as_of = as_of_for(now if now is not None else datetime.now(UTC), ahead_days)
    organizations: dict[str, uuid.UUID] = {}
    locations: dict[str, uuid.UUID] = {}
    templates: dict[str, uuid.UUID] = {}
    anomaly_templates: dict[tuple[str, str], uuid.UUID] = {}
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
            for asset_type, template_code in ANOMALY_TEMPLATE_CODES.items():
                anomaly_templates[(key, asset_type)] = conn.execute(
                    "INSERT INTO bms.asset_templates (organization_id, code, name, asset_type, domain) "
                    "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                    (organizations[key], template_code, f"ML fixture {asset_type}", asset_type, DOMAIN),
                ).fetchone()[0]
        if measured:
            for asset_type, template_code, _, _, _ in MEASURE_CLASSES:
                anomaly_templates[("A", asset_type)] = conn.execute(
                    "INSERT INTO bms.asset_templates (organization_id, code, name, asset_type, domain) "
                    "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                    (organizations["A"], template_code, f"ML fixture {asset_type}", asset_type, DOMAIN),
                ).fetchone()[0]
        for rtu_code, enabled in (("MLFX-RTU-ON", True), ("MLFX-RTU-OFF", False)):
            rtus[rtu_code] = conn.execute(
                "INSERT INTO bms.rtus (organization_id, location_id, code, display_name, ingest_enabled) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (organizations["A"], locations["A"], rtu_code, rtu_code, enabled),
            ).fetchone()[0]
        measure_points = [point for *_, points in MEASURE_CLASSES for point in points] if measured else []
        for key in (POINT, OTHER_POINT, *METER_POINTS, SINGLE_POINT, *measure_points):
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
        for anomaly in (*ANOMALY_SHAPES, *measured):
            org = organizations[anomaly.organization]
            # Not mqtt and no RTU: the simulated meter, which the real-data rule never returns.
            meta = {"telemetrySource": "mqtt"} if anomaly.mqtt else {}
            conn.execute(
                "INSERT INTO bms.assets (id, organization_id, code, name, site_name, location_id, domain, "
                "template_id, rtu_id, meta) VALUES (%s, %s, %s, %s, 'ML fixture', %s, %s, %s, NULL, %s)",
                (asset_id(anomaly.code), org, anomaly.code, anomaly.code, locations[anomaly.organization],
                 DOMAIN, anomaly_templates[(anomaly.organization, anomaly.asset_type)], Jsonb(meta)),
            )  # fmt: skip
            for point_key in anomaly.points:
                conn.execute(
                    "INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key, "
                    "source_kind, rtu_id) VALUES (%s, %s, %s, %s, 'unmapped', NULL)",
                    (org, asset_id(anomaly.code), point_key, point_key),
                )
        with conn.cursor().copy(
            "COPY telemetry.point_values (time, asset_id, point_key, value, unit) FROM STDIN"
        ) as copy:
            for shape in shapes:
                for h in hours_for(shape.code, as_of):
                    when = as_of - timedelta(hours=h) + timedelta(minutes=10)
                    value = shape.level + 0.25 * math.sin(h / 24 * 2 * math.pi)
                    copy.write_row((when, asset_id(shape.code), shape.point_key, value, "degC"))
            for anomaly in ANOMALY_SHAPES:
                for point_key in anomaly.points:
                    for h in anomaly_hours_for(anomaly, point_key):
                        when = as_of - timedelta(hours=h) + timedelta(minutes=10)
                        value = anomaly_value(anomaly, point_key, h)
                        copy.write_row((when, asset_id(anomaly.code), point_key, value, "unit"))
            for anomaly in measured:
                for point_key in anomaly.points:
                    for h in range(1, MEASURE_HOURS + 1):
                        when = as_of - timedelta(hours=h) + timedelta(minutes=10)
                        value = measure_value(anomaly, point_key, h)
                        copy.write_row((when, asset_id(anomaly.code), point_key, value, "unit"))
    return Planted(
        as_of=as_of,
        organizations=organizations,
        assets={shape.code: asset_id(shape.code) for shape in shapes},
        asset_organization={shape.code: organizations[shape.organization] for shape in shapes},
        anomaly_assets={anomaly.code: asset_id(anomaly.code) for anomaly in ANOMALY_SHAPES},
        anomaly_asset_organization={
            anomaly.code: organizations[anomaly.organization] for anomaly in ANOMALY_SHAPES
        },
    )


def main() -> int:
    url = os.environ.get("ML_TEST_DATABASE_URL_SUPERUSER", "").strip()
    if not url:
        sys.stderr.write("ML_TEST_DATABASE_URL_SUPERUSER is required\n")
        return 78
    extra = int(sys.argv[sys.argv.index("--extra-ready") + 1]) if "--extra-ready" in sys.argv else 0
    ahead = int(sys.argv[sys.argv.index("--ahead-days") + 1]) if "--ahead-days" in sys.argv else AHEAD_DAYS
    shape = "--anomaly-shape" in sys.argv
    with psycopg.connect(url, autocommit=True) as conn:
        planted = plant(conn, extra_ready=extra, ahead_days=ahead, anomaly_shape=shape)
    targets = MEASURE_TARGETS if shape else ANOMALY_TARGETS
    sys.stdout.write(
        json.dumps({"as_of": planted.as_of.isoformat(), "target": TARGET, "anomaly_targets": targets}) + "\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
