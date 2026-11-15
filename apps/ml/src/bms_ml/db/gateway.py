"""psycopg calls; implements the scorer's `Db` protocol (plan T3.6).

The only module that imports `psycopg`, and every `execute` here passes a
constant from `bms_ml.db.sql` (`tests/test_sql_guard.py`). Reads run in a
`READ ONLY` transaction; a run row and its forecasts are written in ONE
transaction, so both exist or neither does (plan R4).

Errors are raised as fixed messages. A driver message can carry a host, a
user or row values, so it is never copied into a `PreflightError` (§9.6).
"""

from __future__ import annotations

import re
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row

from bms_ml.db import sql
from bms_ml.readiness import PointStats
from bms_ml.records import ForecastRow, PointRef, RunRecord
from bms_ml.series import HourRow
from bms_ml.targets import Target

EXPECTED_ML_SCHEMA_VERSION = 1
_MARKER = re.compile(r"bms-ml-schema-version=([0-9]+)")


class PreflightError(RuntimeError):
    """The database is not one this scorer may run against (exit code 78)."""


class WriteMismatchError(RuntimeError):
    """The forecast INSERT wrote a different number of rows than were built."""


def parse_marker(row: Mapping[str, Any] | None) -> int:
    """The schema version from `COMMENT ON SCHEMA ml` (plan R2). `stored >= expected` passes."""
    if row is None:
        raise PreflightError("schema ml is absent: run the migrations (0157) first")
    match = _MARKER.fullmatch(row.get("marker") or "")
    if match is None:
        raise PreflightError("schema ml carries no bms-ml-schema-version marker")
    stored = int(match.group(1))
    if stored < EXPECTED_ML_SCHEMA_VERSION:
        raise PreflightError(
            f"schema ml is at version {stored}, below the expected {EXPECTED_ML_SCHEMA_VERSION}"
        )
    return stored


def check_role(row: Mapping[str, Any] | None) -> str:
    """Refuse a role wider or narrower than the scorer's contract. Returns the role name."""
    if row is None:
        raise PreflightError("the database role could not be read")
    if row["is_superuser"]:
        raise PreflightError("the database role is a superuser: connect as bms_fleet")
    if not (row["can_insert_runs"] and row["can_insert_forecasts"]):
        raise PreflightError("the database role cannot insert into ml.model_runs and ml.forecasts")
    if row["can_update_forecasts"]:
        raise PreflightError(
            "the database role can update ml.forecasts: it is wider than the scorer's contract"
        )
    return str(row["role_name"])


class Gateway:
    """One connection for one process. Use `Gateway.connect(dsn)` as a context manager."""

    def __init__(self, connection: psycopg.Connection) -> None:
        self._conn = connection

    @classmethod
    @contextmanager
    def connect(cls, conninfo: str) -> Iterator[Gateway]:
        with psycopg.connect(
            conninfo, autocommit=True, application_name="bms-ml", connect_timeout=10
        ) as connection:
            yield cls(connection)

    @contextmanager
    def _read(self) -> Iterator[psycopg.Cursor]:
        self._conn.read_only = True
        with self._conn.transaction(), self._conn.cursor(row_factory=dict_row) as cursor:
            yield cursor

    @contextmanager
    def _write(self) -> Iterator[psycopg.Cursor]:
        self._conn.read_only = False
        with self._conn.transaction(), self._conn.cursor() as cursor:
            yield cursor

    def preflight(self) -> tuple[int, str]:
        """(schema version, role name), or PreflightError."""
        with self._read() as cursor:
            cursor.execute(sql.PREFLIGHT_MARKER_SQL)
            version = parse_marker(cursor.fetchone())
            try:
                cursor.execute(sql.PREFLIGHT_ROLE_SQL)
            except psycopg.errors.InsufficientPrivilege:
                raise PreflightError("the database role cannot use the ml schema") from None
            role = check_role(cursor.fetchone())
        return version, role

    def eligibility(
        self, targets: Sequence[Target], lookback_from: datetime, as_of_hour: datetime
    ) -> list[PointStats]:
        params = {
            "domains": [target.domain for target in targets],
            "asset_types": [target.asset_type for target in targets],
            "point_keys": [target.point_key for target in targets],
            "lookback_from": lookback_from,
            "as_of_hour": as_of_hour,
        }
        with self._read() as cursor:
            cursor.execute(sql.ELIGIBILITY_SQL, params)
            rows = cursor.fetchall()
        return [
            PointStats(
                organization_id=row["organization_id"],
                asset_id=row["asset_id"],
                asset_code=row["asset_code"],
                point_key=row["point_key"],
                first_bucket=row["first_bucket"],
                last_bucket=row["last_bucket"],
                hours_with_data=int(row["hours_with_data"]),
                days_with_data=int(row["days_with_data"]),
            )
            for row in rows
        ]

    def history(
        self, points: Sequence[PointRef], from_hour: datetime, as_of_hour: datetime
    ) -> dict[PointRef, list[HourRow]]:
        out: dict[PointRef, list[HourRow]] = {point: [] for point in points}
        if not points:
            return out
        params = {
            "asset_ids": [point.asset_id for point in points],
            "point_keys": [point.point_key for point in points],
            "from_hour": from_hour,
            "as_of_hour": as_of_hour,
        }
        with self._read() as cursor:
            cursor.execute(sql.HISTORY_SQL, params)
            for row in cursor.fetchall():
                key = PointRef(row["asset_id"], row["point_key"])
                out.setdefault(key, []).append(HourRow(row["bucket"], row["sum_value"], row["sample_count"]))
        return out

    def already_scored(
        self,
        organization_id: UUID,
        model_name: str,
        model_version: str,
        config_hash: str,
        as_of_hour: datetime,
    ) -> bool:
        params = {
            "organization_id": organization_id,
            "model_name": model_name,
            "model_version": model_version,
            "config_hash": config_hash,
            "as_of_hour": as_of_hour,
        }
        with self._read() as cursor:
            cursor.execute(sql.ALREADY_SCORED_SQL, params)
            return cursor.fetchone() is not None

    def write_succeeded_run(self, run: RunRecord, forecasts: Sequence[ForecastRow]) -> int:
        """The run row and its forecasts in one transaction. Returns the rows written."""
        with self._write() as cursor:
            cursor.execute(sql.INSERT_MODEL_RUN_SQL, _run_params(run))
            written = 0
            if forecasts:
                cursor.execute(
                    sql.INSERT_FORECASTS_SQL,
                    {
                        "issued_at": run.started_at,
                        "model_run_id": run.id,
                        "asset_ids": [row.asset_id for row in forecasts],
                        "point_keys": [row.point_key for row in forecasts],
                        "horizon_buckets": [row.horizon_bucket for row in forecasts],
                        "p10": [row.p10 for row in forecasts],
                        "p50": [row.p50 for row in forecasts],
                        "p90": [row.p90 for row in forecasts],
                    },
                )
                written = cursor.rowcount
            if written != len(forecasts) or written != run.rows_written:
                # Raising inside the transaction rolls the run row back too.
                raise WriteMismatchError("forecast rows written differ from the rows built")
        return written

    def write_failed_run(self, run: RunRecord) -> None:
        with self._write() as cursor:
            cursor.execute(sql.INSERT_MODEL_RUN_SQL, _run_params(run))


def _run_params(run: RunRecord) -> dict[str, Any]:
    return {
        "id": run.id,
        "organization_id": run.organization_id,
        "model_name": run.model_name,
        "model_version": run.model_version,
        "config_hash": run.config_hash,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "rows_written": run.rows_written,
        "status": run.status,
        "error_text": run.error_text,
    }
