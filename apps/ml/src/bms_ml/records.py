"""Row shapes passed between the scorer and the database gateway.

They live here, not in `db/gateway.py`, so the scorer can name them without
importing the module that imports `psycopg` (`tests/test_sql_guard.py`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class PointRef:
    asset_id: UUID
    point_key: str


@dataclass(frozen=True)
class RunRecord:
    """One `ml.model_runs` row. Written once, after inference (plan R4)."""

    id: UUID
    organization_id: UUID
    model_name: str
    model_version: str
    config_hash: str
    started_at: datetime
    finished_at: datetime
    rows_written: int
    status: str
    error_text: str | None


@dataclass(frozen=True)
class ForecastRow:
    """One `ml.forecasts` row. Deliberately no organization_id: the INSERT takes
    it from `bms.assets` in SQL, so Python can never stamp a wrong one (plan R5).
    `issued_at` and `model_run_id` come from the run it is written under."""

    asset_id: UUID
    point_key: str
    horizon_bucket: datetime
    p10: float
    p50: float
    p90: float
