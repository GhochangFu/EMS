"""Test doubles: a clock, a forecaster, a forest and two databases. No torch, sklearn or socket."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import UUID

import numpy as np

from bms_ml.readiness import PointStats
from bms_ml.records import AnomalyRow, ForecastRow, PointRef, RunRecord
from bms_ml.series import HourRow
from bms_ml.targets import Target


@dataclass
class FakeClock:
    """Returns `current`, then advances by `step` on every call."""

    current: datetime
    step: timedelta = timedelta(seconds=1)

    def now(self) -> datetime:
        value = self.current
        self.current = value + self.step
        return value


@dataclass
class FakeForecaster:
    """Deterministic: p50 is the context's last finite value, p10/p90 are one below/above.

    `crossed=True` returns the three quantiles in the wrong order, to prove the
    scorer sorts them. `fail_with` raises from predict. `non_finite_for` makes
    the listed context positions return NaN.
    """

    name: str = "fake-forecaster"
    version: str = "test-1"
    crossed: bool = False
    fail_with: BaseException | None = None
    fail_on_calls: frozenset[int] = frozenset({0})
    non_finite_for: frozenset[int] = frozenset()
    seen: list[np.ndarray] = field(default_factory=list)
    calls: int = 0

    def predict(self, contexts: Sequence[np.ndarray], horizon: int) -> np.ndarray:
        call, self.calls = self.calls, self.calls + 1
        if self.fail_with is not None and call in self.fail_on_calls:
            raise self.fail_with
        out = np.empty((len(contexts), horizon, 3), dtype=np.float64)
        for i, context in enumerate(contexts):
            self.seen.append(np.array(context, copy=True))
            finite = context[np.isfinite(context)]
            level = float(finite[-1]) if finite.size else 0.0
            triple = (level + 1, level, level - 1) if self.crossed else (level - 1, level, level + 1)
            out[i, :, :] = triple
            if i in self.non_finite_for:
                out[i, 0, 1] = np.nan
        return out


@dataclass
class FakeDb:
    """In-memory `Db`. `eligibility` returns `stats` as given: the scorer must score
    only what it returns, so `histories` may hold series it must never see."""

    stats: list[PointStats] = field(default_factory=list)
    histories: dict[PointRef, list[HourRow]] = field(default_factory=dict)
    fail_history_with: BaseException | None = None
    runs: list[RunRecord] = field(default_factory=list)
    forecasts: list[tuple[UUID, datetime, ForecastRow]] = field(default_factory=list)
    history_requests: list[list[PointRef]] = field(default_factory=list)
    preflight_error: BaseException | None = None

    def preflight(self) -> tuple[int, str]:
        if self.preflight_error is not None:
            raise self.preflight_error
        return 1, "bms_fleet"

    def eligibility(
        self, targets: Sequence[Target], lookback_from: datetime, as_of_hour: datetime
    ) -> list[PointStats]:
        return list(self.stats)

    def history(
        self, points: Sequence[PointRef], from_hour: datetime, as_of_hour: datetime
    ) -> dict[PointRef, list[HourRow]]:
        self.history_requests.append(list(points))
        if self.fail_history_with is not None:
            raise self.fail_history_with
        return {point: list(self.histories.get(point, [])) for point in points}

    def already_scored(
        self,
        organization_id: UUID,
        model_name: str,
        model_version: str,
        config_hash: str,
        as_of_hour: datetime,
    ) -> bool:
        return any(
            run.status == "succeeded"
            and run.organization_id == organization_id
            and (run.model_name, run.model_version, run.config_hash)
            == (model_name, model_version, config_hash)
            and min(
                (row.horizon_bucket for run_id, _, row in self.forecasts if run_id == run.id), default=None
            )
            == as_of_hour
            for run in self.runs
        )

    def write_succeeded_run(self, run: RunRecord, forecasts: Sequence[ForecastRow]) -> int:
        self.runs.append(run)
        self.forecasts.extend((run.id, run.started_at, row) for row in forecasts)
        return len(forecasts)

    def write_failed_run(self, run: RunRecord) -> None:
        self.runs.append(run)


@dataclass(frozen=True)
class FakeForestResult:
    score: float | None = None
    skip_reason: str | None = None


@dataclass
class FakeForest:
    """The forest seam of `run_anomaly_cycle`, without scikit-learn.

    It keeps the real detector's two refusals (fewer than `min_training_rows`
    complete rows; a missing value in the scored hour), records every call, and
    returns `score`. `fail_on_calls` raises `fail_with` on those call numbers.
    """

    score: float = 0.5
    kwargs: dict[str, object] = field(default_factory=lambda: {"fake_forest": 1})
    min_training_rows: int = 336
    fail_with: BaseException | None = None
    fail_on_calls: frozenset[int] = frozenset({0})
    calls: list[tuple[np.ndarray, np.ndarray]] = field(default_factory=list)

    def score_hour(self, reference: np.ndarray, current: np.ndarray) -> FakeForestResult:
        call = len(self.calls)
        self.calls.append((np.array(reference, copy=True), np.array(current, copy=True)))
        if self.fail_with is not None and call in self.fail_on_calls:
            raise self.fail_with
        complete = reference[~np.isnan(reference).any(axis=1)]
        if complete.shape[0] < self.min_training_rows:
            return FakeForestResult(skip_reason="if_too_few_rows")
        if np.isnan(current).any():
            return FakeForestResult(skip_reason="if_incomplete_hour")
        return FakeForestResult(score=self.score)


@dataclass
class FakeAnomalyDb:
    """In-memory anomaly `Db`: the eligibility and history reads, the anomaly ledger and writes."""

    stats: list[PointStats] = field(default_factory=list)
    histories: dict[PointRef, list[HourRow]] = field(default_factory=dict)
    fail_history_for: dict[UUID, BaseException] = field(default_factory=dict)
    runs: list[RunRecord] = field(default_factory=list)
    scores: list[tuple[UUID, AnomalyRow]] = field(default_factory=list)
    history_requests: list[tuple[list[PointRef], datetime, datetime]] = field(default_factory=list)
    eligibility_requests: list[tuple[tuple[Target, ...], datetime, datetime]] = field(default_factory=list)
    preflight_error: BaseException | None = None

    def preflight(self) -> tuple[int, str]:
        if self.preflight_error is not None:
            raise self.preflight_error
        return 1, "bms_fleet"

    def eligibility(
        self, targets: Sequence[Target], lookback_from: datetime, as_of_hour: datetime
    ) -> list[PointStats]:
        self.eligibility_requests.append((tuple(targets), lookback_from, as_of_hour))
        return list(self.stats)

    def history(
        self, points: Sequence[PointRef], from_hour: datetime, as_of_hour: datetime
    ) -> dict[PointRef, list[HourRow]]:
        self.history_requests.append((list(points), from_hour, as_of_hour))
        for point in points:
            if point.asset_id in self.fail_history_for:
                raise self.fail_history_for[point.asset_id]
        return {
            point: [row for row in self.histories.get(point, []) if from_hour <= row.bucket < as_of_hour]
            for point in points
        }

    def anomaly_already_scored(
        self,
        organization_id: UUID,
        model_name: str,
        model_version: str,
        config_hash: str,
        scored_hour: datetime,
    ) -> bool:
        return any(
            run.status == "succeeded"
            and run.organization_id == organization_id
            and (run.model_name, run.model_version, run.config_hash)
            == (model_name, model_version, config_hash)
            and max((row.bucket for run_id, row in self.scores if run_id == run.id), default=None)
            == scored_hour
            for run in self.runs
        )

    def write_succeeded_anomaly_run(self, run: RunRecord, rows: Sequence[AnomalyRow]) -> int:
        self.runs.append(run)
        self.scores.extend((run.id, row) for row in rows)
        return len(rows)

    def write_failed_run(self, run: RunRecord) -> None:
        self.runs.append(run)
