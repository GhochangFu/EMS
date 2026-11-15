"""One scoring cycle: pure orchestration over a `Db` and a `Forecaster` (plan T3.8).

1. `as_of_hour` is the clock floored to the hour. The eligibility read returns
   the target points that are real (step 0's rule, in SQL); each gets the R8
   verdict, and the `ready` ones are grouped by organization.
2. Per organization, in its own `try`: skip when the ledger says this hour is
   already scored (unless `force`); read the history; build each context;
   drop `context_too_sparse`; predict; sort and check the quantiles; write the
   run row and its forecasts in one transaction. On any exception a failed run
   row is written with `error_text = "<stage>:<ExceptionClass>"`, never the
   exception's message, and the cycle continues with the next organization.
3. The summary holds counts only.

The scorer scores only what `eligibility` returns, so a simulated point can
never reach the model. It never passes an organization id with a forecast
row: the INSERT takes it from `bms.assets` (plan R5).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from importlib import metadata
from typing import Any, Protocol
from uuid import UUID, uuid4

from bms_ml import log
from bms_ml.config import Config, config_hash
from bms_ml.forecasting import QUANTILES, Forecaster, finalise_quantiles
from bms_ml.readiness import LOOKBACK_DAYS, MIN_CONTEXT_HOURS, THRESHOLDS, PointStats, forecast_verdict
from bms_ml.records import ForecastRow, PointRef, RunRecord
from bms_ml.series import HourRow, build_context, floor_to_hour, non_missing_hours
from bms_ml.targets import Target

ERROR_TEXT_LIMIT = 500
VERSIONED_PACKAGES = ("bms-ml", "numpy", "psycopg")


class Clock(Protocol):
    def now(self) -> datetime: ...


class Db(Protocol):
    def eligibility(
        self, targets: Sequence[Target], lookback_from: datetime, as_of_hour: datetime
    ) -> list[PointStats]: ...

    def history(
        self, points: Sequence[PointRef], from_hour: datetime, as_of_hour: datetime
    ) -> dict[PointRef, list[HourRow]]: ...

    def already_scored(
        self,
        organization_id: UUID,
        model_name: str,
        model_version: str,
        config_hash: str,
        as_of_hour: datetime,
    ) -> bool: ...

    def write_succeeded_run(self, run: RunRecord, forecasts: Sequence[ForecastRow]) -> int: ...

    def write_failed_run(self, run: RunRecord) -> None: ...


@dataclass
class CycleSummary:
    as_of_hour: datetime
    organizations: int = 0
    eligible: int = 0
    scored: int = 0
    rows_written: int = 0
    runs_succeeded: int = 0
    runs_failed: int = 0
    duration_seconds: float = 0.0
    skipped: Counter[str] = field(default_factory=Counter)

    def counts(self) -> dict[str, Any]:
        """Counts only: no asset id, code or organization (they reach logs, never health)."""
        return {
            "as_of_hour": self.as_of_hour.isoformat(),
            "organizations": self.organizations,
            "eligible": self.eligible,
            "scored": self.scored,
            "rows_written": self.rows_written,
            "runs_succeeded": self.runs_succeeded,
            "runs_failed": self.runs_failed,
            "duration_seconds": round(self.duration_seconds, 3),
            "skipped": dict(sorted(self.skipped.items())),
        }


def package_versions() -> dict[str, str]:
    versions = {}
    for name in VERSIONED_PACKAGES:
        try:
            versions[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            versions[name] = "absent"
    return versions


def run_cycle(
    db: Db,
    forecaster: Forecaster,
    clock: Clock,
    config: Config,
    *,
    force: bool = False,
    as_of: datetime | None = None,
) -> CycleSummary:
    started = clock.now()
    as_of_hour = floor_to_hour(as_of if as_of is not None else started)
    summary = CycleSummary(as_of_hour=as_of_hour)

    stats = db.eligibility(config.forecast_targets, as_of_hour - timedelta(days=LOOKBACK_DAYS), as_of_hour)
    summary.eligible = len(stats)
    ready: dict[UUID, list[PointStats]] = {}
    for point in stats:
        verdict = forecast_verdict(point, as_of_hour)
        if verdict == "ready":
            ready.setdefault(point.organization_id, []).append(point)
        else:
            summary.skipped[verdict] += 1
            log.event(
                "point_skipped",
                "debug",
                asset_code=point.asset_code,
                point_key=point.point_key,
                reason=verdict,
            )
    summary.organizations = len(ready)

    fingerprint = config_hash(
        config,
        model_name=forecaster.name,
        model_version=forecaster.version,
        thresholds=THRESHOLDS,
        quantiles=QUANTILES,
        package_versions=package_versions(),
    )
    for organization_id in sorted(ready, key=str):
        _score_organization(
            db,
            forecaster,
            clock,
            config,
            summary,
            organization_id,
            ready[organization_id],
            fingerprint,
            force,
        )

    summary.duration_seconds = (clock.now() - started).total_seconds()
    return summary


def _score_organization(
    db: Db,
    forecaster: Forecaster,
    clock: Clock,
    config: Config,
    summary: CycleSummary,
    organization_id: UUID,
    points: list[PointStats],
    fingerprint: str,
    force: bool,
) -> None:
    as_of_hour = summary.as_of_hour
    horizon = config.forecast_horizon_hours
    run_id = uuid4()
    started_at = clock.now()
    stage = "ledger"
    try:
        if not force and db.already_scored(
            organization_id, forecaster.name, forecaster.version, fingerprint, as_of_hour
        ):
            summary.skipped["already_scored"] += 1
            log.event("organization_already_scored", organization_id=str(organization_id))
            return

        stage = "history"
        refs = [PointRef(point.asset_id, point.point_key) for point in points]
        history = db.history(refs, as_of_hour - timedelta(hours=config.context_hours), as_of_hour)

        stage = "context"
        contexts, kept = [], []
        for ref in refs:
            context = build_context(history.get(ref, []), as_of_hour, config.context_hours)
            if non_missing_hours(context) < MIN_CONTEXT_HOURS:
                summary.skipped["context_too_sparse"] += 1
                continue
            contexts.append(context)
            kept.append(ref)

        rows: list[ForecastRow] = []
        scored = 0
        if contexts:
            stage = "predict"
            raw = forecaster.predict(contexts, horizon)
            stage = "finalise"
            ordered, ok = finalise_quantiles(raw, len(contexts), horizon)
            for index, ref in enumerate(kept):
                if not ok[index]:
                    summary.skipped["non_finite_output"] += 1
                    continue
                scored += 1
                for step in range(horizon):
                    p10, p50, p90 = (float(value) for value in ordered[index, step])
                    bucket = as_of_hour + timedelta(hours=step)
                    rows.append(ForecastRow(ref.asset_id, ref.point_key, bucket, p10, p50, p90))

        stage = "write"
        run = RunRecord(
            id=run_id,
            organization_id=organization_id,
            model_name=forecaster.name,
            model_version=forecaster.version,
            config_hash=fingerprint,
            started_at=started_at,
            finished_at=clock.now(),
            rows_written=len(rows),
            status="succeeded",
            error_text=None,
        )
        written = db.write_succeeded_run(run, rows)
        summary.rows_written += written
        summary.scored += scored
        summary.runs_succeeded += 1
        log.event("run_succeeded", organization_id=str(organization_id), points=scored, rows_written=written)
    except Exception as exc:  # noqa: BLE001 - one organization's failure never stops the next
        summary.runs_failed += 1
        error_text = f"{stage}:{type(exc).__name__}"[:ERROR_TEXT_LIMIT]
        log.event("run_failed", "error", organization_id=str(organization_id), error=error_text)
        failed = RunRecord(
            id=run_id,
            organization_id=organization_id,
            model_name=forecaster.name,
            model_version=forecaster.version,
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
                organization_id=str(organization_id),
                error=f"write_failed_run:{type(write_exc).__name__}",
            )
