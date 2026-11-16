"""The `serve` loop: sleep to the next tick, run one cycle as a child process, repeat (plan R11).

A sleep-loop, never a timer thread per tick. The tick is the next multiple of
the interval since the epoch plus five minutes (hourly: HH:05, when the
previous hour is complete in the live branch of `_1h`). A failed cycle is
retried in 300 s; a cycle that exits 78 (configuration or preflight) stops
the loop, and `serve` exits 78 too. A start after this hour's tick scores the
hour at once (`catch_up_on_start`): a restart at 10:06 used to wait for 11:05,
and the 10:00 hour went unscored.

Each cycle is `python -m bms_ml run-once` in a child process, so a hard
timeout really kills a hung inference and the model's memory returns to the
host between cycles. The parent never imports torch. Only the child's JSON
lines are relayed: anything else (a traceback, which carries an exception
message) is counted and dropped (AGENTS.md §9.6).
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol, TextIO

from bms_ml import log

EXIT_OK = 0
EXIT_CYCLE_FAILED = 1
EXIT_CONFIG = 78
RETRY_SECONDS = 300
TICK_OFFSET_SECONDS = 300
_POLL_SECONDS = 0.5
_TERMINATE_GRACE_SECONDS = 10


@dataclass(frozen=True)
class CycleResult:
    exit_code: int
    summary: dict[str, Any] | None
    timed_out: bool = False
    stopped: bool = False  # ended by SIGTERM: not a failure, and not recorded


class Clock(Protocol):
    def now(self) -> datetime: ...


class Recorder(Protocol):
    def record(self, result: CycleResult, at: datetime) -> None: ...


def next_tick(now: datetime, interval_seconds: int) -> datetime:
    """The first `k * interval + 5 min` instant strictly after `now`."""
    epoch = now.timestamp()
    k = int((epoch - TICK_OFFSET_SECONDS) // interval_seconds) + 1
    return datetime.fromtimestamp(k * interval_seconds + TICK_OFFSET_SECONDS, UTC)


def retry_at(now: datetime, interval_seconds: int) -> datetime:
    """When to retry a failed cycle: in 300 s, unless that crosses into the next hour.

    A retry at 13:01 would score as_of_hour 13:00 before HH:05, when the previous
    hour is complete, and the ledger would then skip the 13:05 tick (code review,
    PR 3). Across an hour boundary the retry waits for the next tick instead."""
    retry = now + timedelta(seconds=RETRY_SECONDS)
    hour = now.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    if retry >= hour + timedelta(hours=1):
        return next_tick(now, interval_seconds)
    return retry


def catch_up_on_start(now: datetime, interval_seconds: int) -> bool:
    """Whether `serve`, starting at `now`, should run a cycle at once instead of waiting.

    True when this hour's tick has already passed and the run would still start five
    minutes before the next hour, the same margin `retry_at` keeps. A deploy recreates the
    container, and one that lands just after HH:05 used to skip the hour: the AWS demo's
    10:04-10:06 deploy left 10:00 with no forecast (E1.4 demo checks, 2026-11-16). The run
    is safe to repeat: the ledger skips an hour that is already scored."""
    hour = now.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    last_tick = next_tick(now, interval_seconds) - timedelta(seconds=interval_seconds)
    return last_tick >= hour and now + timedelta(seconds=RETRY_SECONDS) < hour + timedelta(hours=1)


def run_scheduler(
    *,
    clock: Clock,
    wait: Callable[[float], bool],
    run_cycle_process: Callable[[], CycleResult],
    health: Recorder,
    interval_seconds: int,
) -> int:
    """Loop until `wait` reports a stop (returns True) or a cycle exits 78."""
    retry = False
    first = True
    while True:
        now = clock.now()
        if first and catch_up_on_start(now, interval_seconds):
            hour = now.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
            log.event("cycle_catch_up", as_of_hour=hour.isoformat())
            target = now
        elif retry:
            target = retry_at(now, interval_seconds)
        else:
            target = next_tick(now, interval_seconds)
        first = False
        if wait(max(0.0, (target - now).total_seconds())):
            return EXIT_OK
        result = run_cycle_process()
        if result.stopped:
            return EXIT_OK
        health.record(result, clock.now())
        if result.exit_code == EXIT_CONFIG:
            log.event("scheduler_stopped", "error", reason="the cycle exited 78")
            return EXIT_CONFIG
        retry = result.exit_code != EXIT_OK
        log.event("cycle_finished", exit_code=result.exit_code, timed_out=result.timed_out)


def _relay(stream: TextIO, out: TextIO, found: dict[str, Any]) -> None:
    dropped = 0
    for line in stream:
        try:
            record = json.loads(line)
        except ValueError:
            record = None
        # Only our own log records (log.py's shape) are relayed; anything else, a
        # traceback or a third-party library's JSON, is counted and dropped.
        if not (isinstance(record, dict) and {"ts", "level", "event"} <= record.keys()):
            dropped += 1
            continue
        out.write(line if line.endswith("\n") else line + "\n")
        out.flush()
        if record.get("event") == "cycle_summary":
            found["summary"] = {k: v for k, v in record.items() if k not in ("ts", "level", "event")}
    found["dropped"] = dropped


def _end(process: subprocess.Popen[str], *, gracefully: bool) -> None:
    if gracefully:
        process.terminate()
        try:
            process.wait(timeout=_TERMINATE_GRACE_SECONDS)
            return
        except subprocess.TimeoutExpired:
            pass
    process.kill()
    process.wait()


def run_cycle_process(
    argv: Sequence[str],
    timeout_seconds: float,
    *,
    out: TextIO | None = None,
    stop: threading.Event | None = None,
) -> CycleResult:
    """Run one cycle as a child; relay its JSON lines; keep its final `cycle_summary`."""
    sink = out if out is not None else sys.stdout
    process = subprocess.Popen(
        list(argv),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    found: dict[str, Any] = {}
    reader = threading.Thread(target=_relay, args=(process.stdout, sink, found), daemon=True)
    reader.start()
    deadline = time.monotonic() + timeout_seconds
    timed_out = False
    stopped = False
    code: int | None = None
    while code is None:
        try:
            code = process.wait(timeout=_POLL_SECONDS)
        except subprocess.TimeoutExpired:
            if stop is not None and stop.is_set():
                _end(process, gracefully=True)
                stopped = True
                code = EXIT_CYCLE_FAILED
            elif time.monotonic() >= deadline:
                _end(process, gracefully=False)
                timed_out = True
                code = EXIT_CYCLE_FAILED
    reader.join(timeout=5)
    if found.get("dropped"):
        log.event("child_output_dropped", "warning", lines=found["dropped"])
    if timed_out:
        log.event("cycle_timed_out", "error", timeout_seconds=timeout_seconds)
    exit_code = code if code in (EXIT_OK, EXIT_CONFIG) else EXIT_CYCLE_FAILED
    return CycleResult(exit_code, found.get("summary"), timed_out, stopped)
