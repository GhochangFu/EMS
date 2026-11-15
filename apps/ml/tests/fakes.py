"""Test doubles: a clock, a forecaster and a database. No test here touches torch or a socket."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import UUID

import numpy as np

from bms_ml.readiness import PointStats
from bms_ml.records import ForecastRow, PointRef, RunRecord
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
