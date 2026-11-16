"""One anomaly cycle: pure orchestration over a `Db` and a `Forest` (E1.2 plan T1.6, section 4).

1. `H` (`as_of_hour`) is the clock or `--as-of`, floored; the scored hour is
   `S = H - 1 h`. The eligibility read (the forecast's SQL, with the anomaly
   targets) returns the real target points; each gets the anomaly verdict. An
   asset is scored only when every one of its points is `ready` (R5): otherwise
   it is skipped as `asset_not_ready` and each failing point is counted under
   its own reason.
2. Per organization, in its own `try`: skip when the anomaly ledger holds `S`
   (unless `force`); per asset, ONE history read from `S - 2,184 h` to `H` (R9);
   the baseline row; for an asset with two or more points, the forest row. An
   exception in one asset's forest skips that row only (`forest_failed`). The
   run row and its scores are written in one transaction. Any other exception
   writes a failed run with `error_text = "<stage>:<ExceptionClass>"`, never a
   message, and the cycle goes on with the next organization.
3. The summary holds counts only.

This module never imports scikit-learn: the forest is passed in (`run-anomaly`
imports `anomaly_forest` lazily, in the child). It never passes an
organization id with a score row: the INSERT takes it from `bms.assets`.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from importlib import metadata
from typing import Any, Protocol
from uuid import UUID, uuid4

import numpy as np

from bms_ml import log
from bms_ml.anomaly_baseline import (
    ANOMALY_MODEL_NAME,
    BASELINE_HASH_CONSTANTS,
    BASELINE_HOURS,
    DETECTOR_BASELINE,
    DETECTOR_FOREST,
    REFERENCE_HOURS,
    score_baseline,
)
from bms_ml.config import Config, anomaly_config_hash
from bms_ml.readiness import ANOMALY_THRESHOLDS, LOOKBACK_DAYS, PointStats, anomaly_verdict
from bms_ml.records import AnomalyRow, PointRef, RunRecord
from bms_ml.series import HourRow, floor_to_hour, hourly_grid
from bms_ml.targets import Target

JOB_NAME = "anomaly"
ERROR_TEXT_LIMIT = 500
FOREST_MIN_POINTS = 2
ANOMALY_VERSIONED_PACKAGES = ("bms-ml", "numpy", "scikit-learn", "scipy")

SKIP_ASSET_NOT_READY = "asset_not_ready"
SKIP_FOREST_FAILED = "forest_failed"
SKIP_NON_FINITE_SCORE = "non_finite_score"


class Clock(Protocol):
    def now(self) -> datetime: ...


class ForestOutcome(Protocol):
    @property
    def score(self) -> float | None: ...

    @property
    def skip_reason(self) -> str | None: ...


class Forest(Protocol):
    """`anomaly_forest.IsolationForestDetector` in the child; `FakeForest` in the tests."""

    @property
    def kwargs(self) -> Mapping[str, object]: ...

    @property
    def min_training_rows(self) -> int: ...

    def score_hour(self, reference: np.ndarray, current: np.ndarray) -> ForestOutcome: ...


class Db(Protocol):
    def eligibility(
        self, targets: Sequence[Target], lookback_from: datetime, as_of_hour: datetime
    ) -> list[PointStats]: ...

    def history(
        self, points: Sequence[PointRef], from_hour: datetime, as_of_hour: datetime
    ) -> dict[PointRef, list[HourRow]]: ...

    def anomaly_already_scored(
        self,
        organization_id: UUID,
        model_name: str,
        model_version: str,
        config_hash: str,
        scored_hour: datetime,
    ) -> bool: ...

    def write_succeeded_anomaly_run(self, run: RunRecord, rows: Sequence[AnomalyRow]) -> int: ...

    def write_failed_run(self, run: RunRecord) -> None: ...


@dataclass
class AnomalySummary:
    as_of_hour: datetime
    scored_hour: datetime
    organizations: int = 0
    eligible: int = 0  # target points the eligibility read returned
    assets: int = 0  # assets those points belong to
    scored: int = 0  # assets with at least one row written
    baseline_rows: int = 0
    isolation_forest_rows: int = 0
    rows_written: int = 0
    runs_succeeded: int = 0
    runs_failed: int = 0
    organizations_already_scored: int = 0
    duration_seconds: float = 0.0
    # The readiness reasons count points; `asset_not_ready` counts assets; every
    # other reason counts a score row that was not written.
    skipped: Counter[str] = field(default_factory=Counter)

    def counts(self) -> dict[str, Any]:
        """Counts only: no asset id, code or organization (they reach logs, never health)."""
        return {
            "job": JOB_NAME,
            "as_of_hour": self.as_of_hour.isoformat(),
            "scored_hour": self.scored_hour.isoformat(),
            "organizations": self.organizations,
            "eligible": self.eligible,
            "assets": self.assets,
            "scored": self.scored,
            "baseline_rows": self.baseline_rows,
            "isolation_forest_rows": self.isolation_forest_rows,
            "rows_written": self.rows_written,
            "runs_succeeded": self.runs_succeeded,
            "runs_failed": self.runs_failed,
            "organizations_already_scored": self.organizations_already_scored,
            "duration_seconds": round(self.duration_seconds, 3),
            "skipped": dict(sorted(self.skipped.items())),
        }


def anomaly_package_versions() -> dict[str, str]:
    """Installed versions from package metadata: reading them imports nothing."""
    versions = {}
    for name in ANOMALY_VERSIONED_PACKAGES:
        try:
            versions[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            versions[name] = "absent"
    return versions


def model_version(versions: Mapping[str, str]) -> str:
    return f"bms-ml={versions['bms-ml']};scikit-learn={versions['scikit-learn']}"


def anomaly_fingerprint(config: Config, forest: Forest, versions: Mapping[str, str]) -> str:
    """Section 4.5's config hash: the job, targets, thresholds, constants, forest and versions."""
    return anomaly_config_hash(
        job=JOB_NAME,
        targets=config.anomaly_targets,
        thresholds=ANOMALY_THRESHOLDS,
        constants={
            **BASELINE_HASH_CONSTANTS,
            "forest_min_points": FOREST_MIN_POINTS,
            "forest_min_training_rows": forest.min_training_rows,
        },
        forest_kwargs=forest.kwargs,
        package_versions=versions,
    )


@dataclass(frozen=True)
class _Asset:
    asset_id: UUID
    point_keys: tuple[str, ...]  # ascending: the forest's column order


def run_anomaly_cycle(
    db: Db,
    forest: Forest,
    clock: Clock,
    config: Config,
    *,
    force: bool = False,
    as_of: datetime | None = None,
) -> AnomalySummary:
    started = clock.now()
    as_of_hour = floor_to_hour(as_of if as_of is not None else started)
    summary = AnomalySummary(as_of_hour=as_of_hour, scored_hour=as_of_hour - timedelta(hours=1))

    stats = db.eligibility(config.anomaly_targets, as_of_hour - timedelta(days=LOOKBACK_DAYS), as_of_hour)
    summary.eligible = len(stats)
    by_asset: dict[UUID, list[PointStats]] = {}
    for point in stats:
        by_asset.setdefault(point.asset_id, []).append(point)
    summary.assets = len(by_asset)

    ready: dict[UUID, list[_Asset]] = {}
    for asset_id in sorted(by_asset, key=str):
        points = by_asset[asset_id]
        failing = [(point, anomaly_verdict(point, as_of_hour)) for point in points]
        failing = [(point, verdict) for point, verdict in failing if verdict != "ready"]
        if failing:
            summary.skipped[SKIP_ASSET_NOT_READY] += 1
            for point, verdict in failing:
                summary.skipped[verdict] += 1
                log.event(
                    "point_skipped",
                    "debug",
                    job=JOB_NAME,
                    asset_code=point.asset_code,
                    point_key=point.point_key,
                    reason=verdict,
                )
            continue
        keys = tuple(sorted({point.point_key for point in points}))
        ready.setdefault(points[0].organization_id, []).append(_Asset(asset_id, keys))
    summary.organizations = len(ready)

    versions = anomaly_package_versions()
    fingerprint = anomaly_fingerprint(config, forest, versions)
    version = model_version(versions)
    for organization_id in sorted(ready, key=str):
        _score_organization(
            db, forest, clock, summary, organization_id, ready[organization_id], fingerprint, version, force
        )

    summary.duration_seconds = (clock.now() - started).total_seconds()
    return summary


def _finite(score: float | None) -> bool:
    return score is not None and math.isfinite(score)


@dataclass
class _Stage:
    """The stage a failed run names: `<stage>:<ExceptionClass>`."""

    name: str = "ledger"


def _score_asset(
    db: Db, forest: Forest, summary: AnomalySummary, asset: _Asset, stage: _Stage
) -> list[AnomalyRow]:
    """The rows of one asset at S: the baseline row, then (two or more points) the forest row."""
    as_of_hour, scored_hour = summary.as_of_hour, summary.scored_hour
    grid_start = scored_hour - timedelta(hours=BASELINE_HOURS)
    refs = [PointRef(asset.asset_id, key) for key in asset.point_keys]
    stage.name = "history"
    history = db.history(refs, grid_start, as_of_hour)

    stage.name = "baseline"
    grids = {ref.point_key: hourly_grid(history.get(ref, []), grid_start, BASELINE_HOURS + 1) for ref in refs}
    outcome = score_baseline(grids, grid_start, scored_hour)
    listed = outcome.contributing_points
    rows: list[AnomalyRow] = []
    if outcome.skip_reason is not None:
        summary.skipped[outcome.skip_reason] += 1
    elif not _finite(outcome.score):
        summary.skipped[SKIP_NON_FINITE_SCORE] += 1
    else:
        rows.append(AnomalyRow(asset.asset_id, scored_hour, DETECTOR_BASELINE, float(outcome.score), listed))

    if len(asset.point_keys) < FOREST_MIN_POINTS:
        return rows
    stage.name = "forest"
    matrix = np.column_stack([grids[key] for key in asset.point_keys])
    reference = matrix[BASELINE_HOURS - REFERENCE_HOURS : BASELINE_HOURS]  # W = [S - 672 h, S)
    current = matrix[BASELINE_HOURS]  # S
    try:
        result = forest.score_hour(reference, current)
    except Exception as exc:  # noqa: BLE001 - one asset's forest never stops its baseline row
        summary.skipped[SKIP_FOREST_FAILED] += 1
        log.event("forest_failed", "warning", job=JOB_NAME, error=f"forest:{type(exc).__name__}")
        return rows
    if result.skip_reason is not None:
        summary.skipped[result.skip_reason] += 1
    elif not _finite(result.score):
        summary.skipped[SKIP_NON_FINITE_SCORE] += 1
    else:
        rows.append(AnomalyRow(asset.asset_id, scored_hour, DETECTOR_FOREST, float(result.score), listed))
    return rows


def _score_organization(
    db: Db,
    forest: Forest,
    clock: Clock,
    summary: AnomalySummary,
    organization_id: UUID,
    assets: list[_Asset],
    fingerprint: str,
    version: str,
    force: bool,
) -> None:
    run_id = uuid4()
    started_at = clock.now()
    stage = _Stage()
    try:
        if not force and db.anomaly_already_scored(
            organization_id, ANOMALY_MODEL_NAME, version, fingerprint, summary.scored_hour
        ):
            summary.organizations_already_scored += 1
            log.event("organization_already_scored", job=JOB_NAME, organization_id=str(organization_id))
            return

        rows: list[AnomalyRow] = []
        scored = 0
        for asset in assets:
            asset_rows = _score_asset(db, forest, summary, asset, stage)
            rows.extend(asset_rows)
            scored += 1 if asset_rows else 0
        stage.name = "write"
        run = RunRecord(
            id=run_id,
            organization_id=organization_id,
            model_name=ANOMALY_MODEL_NAME,
            model_version=version,
            config_hash=fingerprint,
            started_at=started_at,
            finished_at=clock.now(),
            rows_written=len(rows),
            status="succeeded",
            error_text=None,
        )
        written = db.write_succeeded_anomaly_run(run, rows)
        summary.rows_written += written
        summary.scored += scored
        summary.baseline_rows += sum(1 for row in rows if row.detector == DETECTOR_BASELINE)
        summary.isolation_forest_rows += sum(1 for row in rows if row.detector == DETECTOR_FOREST)
        summary.runs_succeeded += 1
        log.event(
            "run_succeeded",
            job=JOB_NAME,
            organization_id=str(organization_id),
            assets=scored,
            rows_written=written,
        )
    except Exception as exc:  # noqa: BLE001 - one organization's failure never stops the next
        summary.runs_failed += 1
        error_text = f"{stage.name}:{type(exc).__name__}"[:ERROR_TEXT_LIMIT]
        log.event("run_failed", "error", job=JOB_NAME, organization_id=str(organization_id), error=error_text)
        failed = RunRecord(
            id=run_id,
            organization_id=organization_id,
            model_name=ANOMALY_MODEL_NAME,
            model_version=version,
            config_hash=fingerprint,
            started_at=started_at,
            finished_at=clock.now(),
            rows_written=0,
            status="failed",
            error_text=error_text,
        )
        try:
            db.write_failed_run(failed)
        except Exception as write_exc:  # noqa: BLE001
            log.event(
                "failed_run_not_recorded",
                "error",
                job=JOB_NAME,
                organization_id=str(organization_id),
                error=f"write_failed_run:{type(write_exc).__name__}",
            )
