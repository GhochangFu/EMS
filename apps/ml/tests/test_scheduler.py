import io
import json
import sys
import threading
import time
from datetime import UTC, datetime, timedelta

import pytest

from bms_ml.health import HealthState
from bms_ml.scheduler import (
    EXIT_CONFIG,
    EXIT_CYCLE_FAILED,
    EXIT_OK,
    RETRY_SECONDS,
    CycleResult,
    next_tick,
    retry_at,
    run_cycle_process,
    run_scheduler,
)
from tests.fakes import FakeClock

T0 = datetime(2026, 11, 15, 12, 59, 59, tzinfo=UTC)


@pytest.mark.parametrize(
    ("now", "interval", "expected"),
    [
        (datetime(2026, 11, 15, 12, 59, 59, tzinfo=UTC), 3600, datetime(2026, 11, 15, 13, 5, tzinfo=UTC)),
        (datetime(2026, 11, 15, 12, 4, 59, tzinfo=UTC), 3600, datetime(2026, 11, 15, 12, 5, tzinfo=UTC)),
        (datetime(2026, 11, 15, 12, 5, tzinfo=UTC), 3600, datetime(2026, 11, 15, 13, 5, tzinfo=UTC)),
        (datetime(2026, 11, 15, 23, 30, tzinfo=UTC), 3600, datetime(2026, 11, 16, 0, 5, tzinfo=UTC)),
        (datetime(2026, 11, 15, 12, 21, tzinfo=UTC), 900, datetime(2026, 11, 15, 12, 35, tzinfo=UTC)),
        (datetime(2026, 11, 15, 12, 0, tzinfo=UTC), 86400, datetime(2026, 11, 16, 0, 5, tzinfo=UTC)),
    ],
)
def test_next_tick_is_the_next_boundary_plus_five_minutes(now, interval, expected):
    assert next_tick(now, interval) == expected


class Recorder:
    """A wait() that records the requested sleeps and stops after `limit` waits."""

    def __init__(self, clock: FakeClock, limit: int):
        self.clock, self.limit, self.sleeps = clock, limit, []

    def __call__(self, seconds: float) -> bool:
        self.sleeps.append(seconds)
        if len(self.sleeps) > self.limit:
            return True
        self.clock.current += timedelta(seconds=seconds)
        return False


def health(clock: FakeClock) -> HealthState:
    return HealthState(3600, clock.current, 1, "fake", "1")


def test_the_loop_waits_for_the_tick_then_runs_one_cycle_per_tick():
    clock = FakeClock(T0, step=timedelta(0))
    wait = Recorder(clock, limit=2)
    calls = []
    code = run_scheduler(
        clock=clock,
        wait=wait,
        run_cycle_process=lambda: calls.append(clock.current) or CycleResult(EXIT_OK, {"scored": 1}),
        health=health(clock),
        interval_seconds=3600,
    )
    assert code == EXIT_OK
    assert calls == [datetime(2026, 11, 15, 13, 5, tzinfo=UTC), datetime(2026, 11, 15, 14, 5, tzinfo=UTC)]
    assert wait.sleeps[:2] == [301.0, 3600.0]


def test_a_failed_cycle_is_retried_in_300_seconds():
    clock = FakeClock(T0, step=timedelta(0))
    wait = Recorder(clock, limit=2)
    results = iter([CycleResult(EXIT_CYCLE_FAILED, None), CycleResult(EXIT_OK, {})])
    state = health(clock)
    run_scheduler(
        clock=clock, wait=wait, run_cycle_process=lambda: next(results), health=state, interval_seconds=3600
    )
    assert wait.sleeps[1] == RETRY_SECONDS
    assert state.cycles_failed == 1 and state.cycles_succeeded == 1


def test_exit_78_stops_the_loop():
    clock = FakeClock(T0, step=timedelta(0))
    calls = []
    code = run_scheduler(
        clock=clock,
        wait=Recorder(clock, limit=10),
        run_cycle_process=lambda: calls.append(1) or CycleResult(EXIT_CONFIG, None),
        health=health(clock),
        interval_seconds=3600,
    )
    assert code == EXIT_CONFIG
    assert calls == [1]


def test_a_stop_ends_the_sleep_promptly_and_runs_nothing():
    stop = threading.Event()
    threading.Timer(0.2, stop.set).start()
    calls = []
    began = time.monotonic()
    code = run_scheduler(
        clock=FakeClock(T0, step=timedelta(0)),
        wait=stop.wait,
        run_cycle_process=lambda: calls.append(1) or CycleResult(EXIT_OK, {}),
        health=health(FakeClock(T0)),
        interval_seconds=3600,
    )
    assert code == EXIT_OK
    assert calls == []
    assert time.monotonic() - began < 5


def test_the_process_runner_relays_output_and_keeps_the_summary():
    child = (
        "import json; base = {'ts': 't', 'level': 'info'}; "
        "print(json.dumps({**base, 'event': 'run_succeeded'})); "
        "print(json.dumps({'event': 'third_party', 'data': 'not ours'})); "
        "print(json.dumps({**base, 'event': 'cycle_summary', 'scored': 3, 'rows_written': 144}))"
    )
    out = io.StringIO()
    result = run_cycle_process([sys.executable, "-c", child], timeout_seconds=30, out=out)
    assert result.exit_code == EXIT_OK
    assert result.summary == {"scored": 3, "rows_written": 144}
    assert [json.loads(line)["event"] for line in out.getvalue().splitlines()] == [
        "run_succeeded",
        "cycle_summary",
    ]


def test_a_child_traceback_is_dropped_not_relayed():
    child = "raise RuntimeError('could not connect to postgres://bms_fleet:hunter2@db/bms')"
    out = io.StringIO()
    result = run_cycle_process([sys.executable, "-c", child], timeout_seconds=30, out=out)
    assert result.exit_code == EXIT_CYCLE_FAILED
    assert "hunter2" not in out.getvalue()
    assert "Traceback" not in out.getvalue()


def test_the_process_runner_passes_exit_78_through():
    result = run_cycle_process(
        [sys.executable, "-c", "raise SystemExit(78)"], timeout_seconds=30, out=io.StringIO()
    )
    assert result.exit_code == EXIT_CONFIG


def test_a_timeout_kills_the_child_and_counts_a_failure():
    began = time.monotonic()
    result = run_cycle_process(
        [sys.executable, "-c", "import time; time.sleep(60)"], timeout_seconds=1, out=io.StringIO()
    )
    assert result.exit_code == EXIT_CYCLE_FAILED
    assert result.timed_out
    assert time.monotonic() - began < 20


def test_a_stop_during_a_cycle_terminates_the_child():
    stop = threading.Event()
    threading.Timer(0.5, stop.set).start()
    began = time.monotonic()
    result = run_cycle_process(
        [sys.executable, "-c", "import time; time.sleep(60)"],
        timeout_seconds=50,
        out=io.StringIO(),
        stop=stop,
    )
    assert result.exit_code == EXIT_CYCLE_FAILED
    assert result.stopped and not result.timed_out
    assert time.monotonic() - began < 20


def test_a_stopped_cycle_ends_the_loop_and_is_not_counted_as_a_failure():
    clock = FakeClock(T0, step=timedelta(0))
    state = health(clock)
    code = run_scheduler(
        clock=clock,
        wait=Recorder(clock, limit=5),
        run_cycle_process=lambda: CycleResult(EXIT_CYCLE_FAILED, None, stopped=True),
        health=state,
        interval_seconds=3600,
    )
    assert code == EXIT_OK
    assert state.cycles_failed == 0


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (datetime(2026, 11, 15, 12, 30, tzinfo=UTC), datetime(2026, 11, 15, 12, 35, tzinfo=UTC)),
        (datetime(2026, 11, 15, 12, 54, 59, tzinfo=UTC), datetime(2026, 11, 15, 12, 59, 59, tzinfo=UTC)),
        # 300 s would land at 13:01, before HH:05: wait for the 13:05 tick instead.
        (datetime(2026, 11, 15, 12, 56, tzinfo=UTC), datetime(2026, 11, 15, 13, 5, tzinfo=UTC)),
        (datetime(2026, 11, 15, 12, 55, tzinfo=UTC), datetime(2026, 11, 15, 13, 5, tzinfo=UTC)),
    ],
)
def test_a_retry_never_crosses_into_the_next_hour_early(now, expected):
    assert retry_at(now, 3600) == expected
