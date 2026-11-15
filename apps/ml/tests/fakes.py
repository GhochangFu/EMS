"""Test doubles: a clock, a forecaster and a database. No test here touches torch or a socket."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import numpy as np


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
    non_finite_for: frozenset[int] = frozenset()
    seen: list[np.ndarray] = field(default_factory=list)

    def predict(self, contexts: Sequence[np.ndarray], horizon: int) -> np.ndarray:
        if self.fail_with is not None:
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
