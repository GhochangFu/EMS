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
    Job,
    catch_up_on_start,
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


def forecast(run, state) -> list[Job]:
    """The single forecast job the scheduler ran before E1.2: these cases keep their assertions."""
    return [Job("forecast", lambda _hour: run(), state)]


def test_the_loop_waits_for_the_tick_then_runs_one_cycle_per_tick():
    clock = FakeClock(T0, step=timedelta(0))
    wait = Recorder(clock, limit=2)
    calls = []
    code = run_scheduler(
        clock=clock,
        wait=wait,
        jobs=forecast(
            lambda: calls.append(clock.current) or CycleResult(EXIT_OK, {"scored": 1}), health(clock)
        ),
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
    run_scheduler(clock=clock, wait=wait, jobs=forecast(lambda: next(results), state), interval_seconds=3600)
    assert wait.sleeps[1] == RETRY_SECONDS
    assert state.cycles_failed == 1 and state.cycles_succeeded == 1


def test_exit_78_stops_the_loop():
    clock = FakeClock(T0, step=timedelta(0))
    calls = []
    code = run_scheduler(
        clock=clock,
        wait=Recorder(clock, limit=10),
        jobs=forecast(lambda: calls.append(1) or CycleResult(EXIT_CONFIG, None), health(clock)),
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
        jobs=forecast(lambda: calls.append(1) or CycleResult(EXIT_OK, {}), health(FakeClock(T0))),
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
        jobs=forecast(lambda: CycleResult(EXIT_CYCLE_FAILED, None, stopped=True), state),
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


# A restart after this hour's tick used to wait for the next one, so the hour went
# unscored: the AWS demo's deploy at 10:04-10:06 lost the 10:00 forecast (E1.4 demo
# checks, 2026-11-16). `serve` now scores the current hour at once when it starts
# between the tick and five minutes before the next hour (the `retry_at` margin);
# the ledger makes that a no-op when the hour is already scored.
@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (datetime(2026, 11, 16, 10, 4, 59, tzinfo=UTC), False),  # before the tick: the tick will run
        (datetime(2026, 11, 16, 10, 5, tzinfo=UTC), True),
        (datetime(2026, 11, 16, 10, 6, tzinfo=UTC), True),  # the demo's restart
        (datetime(2026, 11, 16, 10, 54, 59, tzinfo=UTC), True),
        (datetime(2026, 11, 16, 10, 55, tzinfo=UTC), False),  # would cross into 11:00 before HH:05
        (datetime(2026, 11, 16, 10, 59, 59, tzinfo=UTC), False),
    ],
)
def test_catch_up_on_start_only_between_the_tick_and_the_retry_margin(now, expected):
    assert catch_up_on_start(now, 3600) is expected


def test_a_daily_interval_catches_up_only_in_its_own_tick_hour():
    assert catch_up_on_start(datetime(2026, 11, 16, 0, 30, tzinfo=UTC), 86400) is True
    assert catch_up_on_start(datetime(2026, 11, 16, 10, 30, tzinfo=UTC), 86400) is False


def test_a_start_after_the_tick_scores_the_current_hour_at_once():
    start = datetime(2026, 11, 16, 10, 6, tzinfo=UTC)
    clock = FakeClock(start, step=timedelta(0))
    wait = Recorder(clock, limit=2)
    calls = []
    run_scheduler(
        clock=clock,
        wait=wait,
        jobs=forecast(lambda: calls.append(clock.current) or CycleResult(EXIT_OK, {}), health(clock)),
        interval_seconds=3600,
    )
    assert calls == [start, datetime(2026, 11, 16, 11, 5, tzinfo=UTC)]
    assert wait.sleeps[:2] == [0.0, 3540.0]


def test_a_start_before_the_tick_waits_for_it():
    clock = FakeClock(datetime(2026, 11, 16, 10, 3, tzinfo=UTC), step=timedelta(0))
    calls = []
    run_scheduler(
        clock=clock,
        wait=Recorder(clock, limit=1),
        jobs=forecast(lambda: calls.append(clock.current) or CycleResult(EXIT_OK, {}), health(clock)),
        interval_seconds=3600,
    )
    assert calls == [datetime(2026, 11, 16, 10, 5, tzinfo=UTC)]


def test_only_the_first_wait_catches_up():
    # After a successful catch-up the loop waits for the next tick; it never re-runs the hour.
    start = datetime(2026, 11, 16, 10, 30, tzinfo=UTC)
    clock = FakeClock(start, step=timedelta(0))
    calls = []
    run_scheduler(
        clock=clock,
        wait=Recorder(clock, limit=3),
        jobs=forecast(lambda: calls.append(clock.current) or CycleResult(EXIT_OK, {}), health(clock)),
        interval_seconds=3600,
    )
    assert calls == [
        start,
        datetime(2026, 11, 16, 11, 5, tzinfo=UTC),
        datetime(2026, 11, 16, 12, 5, tzinfo=UTC),
    ]


def test_a_failed_catch_up_is_retried_in_300_seconds_then_waits_for_the_tick():
    start = datetime(2026, 11, 16, 10, 6, tzinfo=UTC)
    clock = FakeClock(start, step=timedelta(0))
    results = iter([CycleResult(EXIT_CYCLE_FAILED, None), CycleResult(EXIT_OK, {}), CycleResult(EXIT_OK, {})])
    calls = []
    run_scheduler(
        clock=clock,
        wait=Recorder(clock, limit=3),
        jobs=forecast(lambda: calls.append(clock.current) or next(results), health(clock)),
        interval_seconds=3600,
    )
    retry = start + timedelta(seconds=RETRY_SECONDS)
    assert calls == [start, retry, datetime(2026, 11, 16, 11, 5, tzinfo=UTC)]


# --- E1.2: two jobs in one tick (plan T1.7, R6, R7) -------------------------------------------


class Calls:
    """A job's run: records (job, clock instant, tick hour) and returns its scripted results."""

    def __init__(self, clock: FakeClock, log: list, name: str, results=None, takes=timedelta(0)):
        self.clock, self.log, self.name, self.takes = clock, log, name, takes
        self.results = iter(results) if results is not None else None

    def __call__(self, hour: datetime) -> CycleResult:
        self.log.append((self.name, self.clock.current, hour))
        self.clock.current += self.takes
        return next(self.results) if self.results is not None else CycleResult(EXIT_OK, {})


def two_jobs(
    clock: FakeClock,
    state: HealthState,
    log: list,
    *,
    forecast_results=None,
    anomaly_results=None,
    forecast_takes=timedelta(0),
):
    return [
        Job("forecast", Calls(clock, log, "forecast", forecast_results, forecast_takes), state),
        Job("anomaly", Calls(clock, log, "anomaly", anomaly_results), state.recorder("anomaly")),
    ]


def test_one_tick_runs_the_forecast_then_the_anomaly_job_with_the_ticks_hour():
    clock = FakeClock(T0, step=timedelta(0))
    calls: list = []
    state = HealthState(3600, T0, 1, "fake", "1", anomaly_enabled=True)
    run_scheduler(
        clock=clock, wait=Recorder(clock, limit=1), jobs=two_jobs(clock, state, calls), interval_seconds=3600
    )
    tick = datetime(2026, 11, 15, 13, 5, tzinfo=UTC)
    hour = datetime(2026, 11, 15, 13, tzinfo=UTC)
    assert calls == [("forecast", tick, hour), ("anomaly", tick, hour)]


def test_a_failed_anomaly_job_is_retried_in_300_seconds_without_a_forecast_run():
    clock = FakeClock(T0, step=timedelta(0))
    calls: list = []
    state = HealthState(3600, T0, 1, "fake", "1", anomaly_enabled=True)
    failed = CycleResult(EXIT_CYCLE_FAILED, None)
    wait = Recorder(clock, limit=2)
    run_scheduler(
        clock=clock,
        wait=wait,
        jobs=two_jobs(clock, state, calls, anomaly_results=[failed, CycleResult(EXIT_OK, {})]),
        interval_seconds=3600,
    )
    tick = datetime(2026, 11, 15, 13, 5, tzinfo=UTC)
    hour = datetime(2026, 11, 15, 13, tzinfo=UTC)
    retry = tick + timedelta(seconds=RETRY_SECONDS)
    assert calls == [("forecast", tick, hour), ("anomaly", tick, hour), ("anomaly", retry, hour)]
    assert wait.sleeps[1] == RETRY_SECONDS
    assert (state.cycles_succeeded, state.cycles_failed) == (1, 0)
    _, body = state.snapshot(retry)
    assert (body["anomaly"]["cyclesSucceeded"], body["anomaly"]["cyclesFailed"]) == (1, 1)


def test_a_failed_forecast_job_is_retried_alone():
    clock = FakeClock(T0, step=timedelta(0))
    calls: list = []
    state = HealthState(3600, T0, 1, "fake", "1", anomaly_enabled=True)
    results = [CycleResult(EXIT_CYCLE_FAILED, None), CycleResult(EXIT_OK, {})]
    run_scheduler(
        clock=clock,
        wait=Recorder(clock, limit=2),
        jobs=two_jobs(clock, state, calls, forecast_results=results),
        interval_seconds=3600,
    )
    assert [name for name, _, _ in calls] == ["forecast", "anomaly", "forecast"]


def test_retries_of_the_anomaly_job_stay_inside_the_ticks_hour():
    start = datetime(2026, 11, 16, 10, 56, tzinfo=UTC)
    clock = FakeClock(start, step=timedelta(0))
    calls: list = []
    state = HealthState(3600, start, 1, "fake", "1", anomaly_enabled=True)
    failed = CycleResult(EXIT_CYCLE_FAILED, None)
    run_scheduler(
        clock=clock,
        wait=Recorder(clock, limit=3),
        jobs=two_jobs(clock, state, calls, anomaly_results=[failed, failed, CycleResult(EXIT_OK, {})]),
        interval_seconds=3600,
    )
    eleven = datetime(2026, 11, 16, 11, tzinfo=UTC)
    assert calls == [
        ("forecast", datetime(2026, 11, 16, 11, 5, tzinfo=UTC), eleven),
        ("anomaly", datetime(2026, 11, 16, 11, 5, tzinfo=UTC), eleven),
        ("anomaly", datetime(2026, 11, 16, 11, 10, tzinfo=UTC), eleven),
        ("anomaly", datetime(2026, 11, 16, 11, 15, tzinfo=UTC), eleven),
    ]


def test_a_slow_forecast_does_not_move_the_anomaly_jobs_hour_and_a_late_failure_waits_for_the_tick():
    # R6: the forecast child takes 50 minutes; the anomaly child still scores the tick's hour.
    # Its failure at 13:55 cannot retry before 14:00, so the 14:05 tick runs every job.
    clock = FakeClock(datetime(2026, 11, 16, 12, 56, tzinfo=UTC), step=timedelta(0))
    calls: list = []
    state = HealthState(3600, clock.current, 1, "fake", "1", anomaly_enabled=True)
    results = [CycleResult(EXIT_CYCLE_FAILED, None), CycleResult(EXIT_OK, {})]
    run_scheduler(
        clock=clock,
        wait=Recorder(clock, limit=2),
        jobs=two_jobs(clock, state, calls, anomaly_results=results, forecast_takes=timedelta(minutes=50)),
        interval_seconds=3600,
    )
    thirteen, fourteen = datetime(2026, 11, 16, 13, tzinfo=UTC), datetime(2026, 11, 16, 14, tzinfo=UTC)
    assert [(name, at.strftime("%H:%M"), hour) for name, at, hour in calls] == [
        ("forecast", "13:05", thirteen),
        ("anomaly", "13:55", thirteen),
        ("forecast", "14:05", fourteen),
        ("anomaly", "14:55", fourteen),
    ]


def test_a_retry_that_lands_in_a_later_hour_runs_every_job_for_that_hour():
    # The forecast takes an hour: the anomaly child fails at 14:05 for the 13:00 tick. Its
    # retry at 14:10 is in hour 14, whose forecast has not run: every job runs, for 14:00.
    clock = FakeClock(datetime(2026, 11, 16, 12, 56, tzinfo=UTC), step=timedelta(0))
    calls: list = []
    state = HealthState(3600, clock.current, 1, "fake", "1", anomaly_enabled=True)
    results = [CycleResult(EXIT_CYCLE_FAILED, None), CycleResult(EXIT_OK, {})]
    run_scheduler(
        clock=clock,
        wait=Recorder(clock, limit=2),
        jobs=two_jobs(clock, state, calls, anomaly_results=results, forecast_takes=timedelta(hours=1)),
        interval_seconds=3600,
    )
    thirteen, fourteen = datetime(2026, 11, 16, 13, tzinfo=UTC), datetime(2026, 11, 16, 14, tzinfo=UTC)
    assert [(name, at.strftime("%H:%M"), hour) for name, at, hour in calls] == [
        ("forecast", "13:05", thirteen),
        ("anomaly", "14:05", thirteen),
        ("forecast", "14:10", fourteen),
        ("anomaly", "15:10", fourteen),
    ]


def test_exit_78_from_the_anomaly_job_stops_the_loop():
    clock = FakeClock(T0, step=timedelta(0))
    calls: list = []
    state = HealthState(3600, T0, 1, "fake", "1", anomaly_enabled=True)
    code = run_scheduler(
        clock=clock,
        wait=Recorder(clock, limit=10),
        jobs=two_jobs(clock, state, calls, anomaly_results=[CycleResult(EXIT_CONFIG, None)]),
        interval_seconds=3600,
    )
    assert code == EXIT_CONFIG
    assert [name for name, _, _ in calls] == ["forecast", "anomaly"]


def test_exit_78_from_the_forecast_job_runs_no_anomaly_job():
    clock = FakeClock(T0, step=timedelta(0))
    calls: list = []
    state = HealthState(3600, T0, 1, "fake", "1", anomaly_enabled=True)
    code = run_scheduler(
        clock=clock,
        wait=Recorder(clock, limit=10),
        jobs=two_jobs(clock, state, calls, forecast_results=[CycleResult(EXIT_CONFIG, None)]),
        interval_seconds=3600,
    )
    assert code == EXIT_CONFIG
    assert [name for name, _, _ in calls] == ["forecast"]


def test_a_catch_up_passes_the_current_hour_to_every_job():
    start = datetime(2026, 11, 16, 10, 6, tzinfo=UTC)
    clock = FakeClock(start, step=timedelta(0))
    calls: list = []
    state = HealthState(3600, start, 1, "fake", "1", anomaly_enabled=True)
    run_scheduler(
        clock=clock, wait=Recorder(clock, limit=1), jobs=two_jobs(clock, state, calls), interval_seconds=3600
    )
    ten = datetime(2026, 11, 16, 10, tzinfo=UTC)
    assert calls == [("forecast", start, ten), ("anomaly", start, ten)]
