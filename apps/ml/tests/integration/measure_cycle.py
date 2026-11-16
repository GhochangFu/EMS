"""Ruling 5's measurement and budget gate (ADR 0135 Amendment 5; E1.2 plan T1.10).

One hourly cycle is two children, the forecast (`run-once`) and then the
anomaly job (`run-anomaly`). This tool runs each child in a container of its
own, at the demo host's limits (one CPU, 1 GiB with no swap beyond it, a
read-only root, no capabilities), against the integration fixture planted at
the real shape, three times by default (`--runs`), and prints one table.

- **Peak memory** is the container's cgroup `memory.peak`, read inside the
  container after the child exits. The container holds one child, so it is
  that child's peak (page cache included, as the demo host counts it).
- **Wall time** is the whole `docker run`: start, imports, model load, reads,
  fit, write. A container start is in it too, so it errs high.
- **The stop rule (ruling 5).** Exit 1 when an anomaly child peaks above
  900 MiB, or a forecast child and the anomaly child after it take more than
  300 s together. Exit 1 as well when a child fails, when `memory.peak` cannot
  be read, or when a cycle scored less than the planted shape: a gate that did
  not measure the real workload proves nothing. Do not tune the detectors to
  pass it; the owner rules again.

The owner ruled (plan section 17 Q3) that this runs as a step of CI's `ml`
job, after the image build, and stays there as the budget's gate. CI runs it
once (`--runs 1`): the owner ruled one run to save Actions minutes (2026-11-16). Locally,
with the integration database of `apps/ml/README.md` and an image built:

    uv run python -m tests.integration.measure_cycle --image bms-ml --network host

`--network host` reaches a database published on the host's loopback (Linux).
On Docker Desktop, set ML_MEASURE_CONTAINER_URL_FLEET to the fleet URL as the
container sees it (host `host.docker.internal`) and pass `--network bridge`.
The fleet URL reaches the container through the environment, never argv.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

MIB = 1024 * 1024
ANOMALY_PEAK_LIMIT_BYTES = 900 * MIB
CYCLE_LIMIT_SECONDS = 300.0
CHILD_TIMEOUT_SECONDS = 900  # ML_CYCLE_TIMEOUT_SECONDS' default: past it the cycle has failed anyway
RUNS = 3
# 4 fixture rooms + 17 = 21 forecast series, 17 of them with a full 2,016-hour context.
EXTRA_READY = 17
EXPECTED_FORECAST_SERIES = 4 + EXTRA_READY
# measure_shapes(): 5 x 15 points + 5 x 3 + 28 x 1. Every asset gets a baseline
# row; the 10 with two points or more get a forest row too.
EXPECTED_ANOMALY_ASSETS = 38
EXPECTED_FOREST_ROWS = 10

FORECAST = "run-once"
ANOMALY = "run-anomaly"
CHILDREN = (FORECAST, ANOMALY)
PEAK_MARKER = "bms-ml-memory-peak-bytes="
# Inside the container: the child, then the cgroup's peak, then the child's exit code.
CONTAINER_SCRIPT = (
    'python -m bms_ml "$ML_MEASURE_CHILD" --force --as-of "$ML_MEASURE_AS_OF"; code=$?; '
    f"printf '\\n{PEAK_MARKER}%s\\n' \"$(cat /sys/fs/cgroup/memory.peak 2>/dev/null || echo unreadable)\"; "
    "exit $code"
)
CONTAINER_URL_VAR = "ML_MEASURE_CONTAINER_URL_FLEET"


@dataclass(frozen=True)
class ChildResult:
    run: int
    child: str
    exit_code: int
    wall_seconds: float
    peak_bytes: int | None
    summary: Mapping[str, object] | None


def docker_command(
    image: str,
    child: str,
    as_of: datetime,
    *,
    network: str,
    targets: Mapping[str, str],
    name: str | None = None,
) -> list[str]:
    """The `docker run` argv for one child. DATABASE_URL_FLEET is passed by name only."""
    if child not in CHILDREN:
        raise ValueError(f"unknown child {child!r}")
    command = [
        "docker", "run", "--rm", "--network", network,
        "--cpus", "1", "--memory", "1g", "--memory-swap", "1g", "--pids-limit", "256",
        "--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "-e", "DATABASE_URL_FLEET", "-e", "ML_TORCH_THREADS=1", "-e", "ML_ANOMALY_ENABLED=true",
        "-e", "LOG_LEVEL=info",
    ]  # fmt: skip
    for name, value in sorted(targets.items()):
        command += ["-e", f"{name}={value}"]
    command += ["-e", f"ML_MEASURE_CHILD={child}", "-e", f"ML_MEASURE_AS_OF={as_of.isoformat()}"]
    if name is not None:
        command += ["--name", name]
    return [*command, "--entrypoint", "sh", image, "-c", CONTAINER_SCRIPT]


def parse_memory_peak(output: str) -> int | None:
    """The cgroup peak the container printed last, in bytes; None when it could not be read."""
    found = None
    for line in output.splitlines():
        if line.startswith(PEAK_MARKER):
            value = line[len(PEAK_MARKER) :].strip()
            found = int(value) if re.fullmatch(r"[0-9]+", value) else None
    return found


def parse_summary(output: str) -> dict[str, object] | None:
    """The last `cycle_summary` JSON line a child logged, or None."""
    summary = None
    for line in output.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if isinstance(record, dict) and record.get("event") == "cycle_summary":
            summary = record
    return summary


def _count(summary: Mapping[str, object] | None, key: str) -> int | None:
    value = (summary or {}).get(key)
    return value if isinstance(value, int) else None


def breaches(results: Sequence[ChildResult]) -> list[str]:
    """Every reason the gate fails, in a fixed order; [] when ruling 5's budget holds."""
    reasons: list[str] = []
    for result in results:
        name = f"run {result.run} {result.child}"
        if result.exit_code != 0:
            reasons.append(f"{name}: the child exited {result.exit_code}")
        if result.peak_bytes is None:
            reasons.append(f"{name}: memory.peak could not be read")
        if result.summary is None:
            reasons.append(f"{name}: no cycle_summary line")
            continue
        if _count(result.summary, "runs_failed") != 0:
            reasons.append(f"{name}: runs_failed is {_count(result.summary, 'runs_failed')}")
        if result.child == FORECAST and _count(result.summary, "scored") != EXPECTED_FORECAST_SERIES:
            reasons.append(
                f"{name}: scored {_count(result.summary, 'scored')} series, "
                f"not the planted {EXPECTED_FORECAST_SERIES}"
            )
        if result.child == ANOMALY:
            if _count(result.summary, "scored") != EXPECTED_ANOMALY_ASSETS:
                reasons.append(
                    f"{name}: scored {_count(result.summary, 'scored')} assets, "
                    f"not the planted {EXPECTED_ANOMALY_ASSETS}"
                )
            if _count(result.summary, "isolation_forest_rows") != EXPECTED_FOREST_ROWS:
                reasons.append(
                    f"{name}: {_count(result.summary, 'isolation_forest_rows')} forest rows, "
                    f"not {EXPECTED_FOREST_ROWS}"
                )
    for result in results:
        if result.child == ANOMALY and result.peak_bytes is not None:
            if result.peak_bytes > ANOMALY_PEAK_LIMIT_BYTES:
                reasons.append(
                    f"run {result.run}: the anomaly child peaked at {result.peak_bytes / MIB:.1f} MiB, "
                    f"above the {ANOMALY_PEAK_LIMIT_BYTES // MIB} MiB of ruling 5"
                )
    for run, total in cycle_seconds(results).items():
        if total > CYCLE_LIMIT_SECONDS:
            reasons.append(
                f"run {run}: forecast + anomaly took {total:.1f} s, above the {CYCLE_LIMIT_SECONDS:.0f} s "
                "of ruling 5"
            )
    return reasons


def cycle_seconds(results: Sequence[ChildResult]) -> dict[int, float]:
    """Wall seconds of each run's forecast child plus its anomaly child."""
    totals: dict[int, float] = {}
    for result in results:
        totals[result.run] = totals.get(result.run, 0.0) + result.wall_seconds
    return totals


def render_table(results: Sequence[ChildResult]) -> str:
    """A Markdown table: readable in a log and rendered in $GITHUB_STEP_SUMMARY."""

    def cell(value: object) -> str:
        return "-" if value is None else str(value)

    lines = [
        "| Run | Child | Exit | Wall s | Peak MiB | In-process s | Scored | Rows | Forest rows |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        peak = None if r.peak_bytes is None else f"{r.peak_bytes / MIB:.1f}"
        inner = (r.summary or {}).get("duration_seconds")
        forest = _count(r.summary, "isolation_forest_rows") if r.child == ANOMALY else None
        row = (r.run, r.child, r.exit_code, f"{r.wall_seconds:.1f}", peak, inner,
               _count(r.summary, "scored"), _count(r.summary, "rows_written"), forest)  # fmt: skip
        lines.append("| " + " | ".join(cell(value) for value in row) + " |")
    for run, total in sorted(cycle_seconds(results).items()):
        lines.append(f"| {run} | **cycle** | | **{total:.1f}** | | | | | |")
    return "\n".join(lines)


def report(results: Sequence[ChildResult]) -> tuple[str, int]:
    """The table and the verdict as text, and the exit code (0 within budget, 1 otherwise)."""
    found = breaches(results)
    limits = (
        f"Limits (ADR 0135 Amendment 5 ruling 5): anomaly child <= {ANOMALY_PEAK_LIMIT_BYTES // MIB} MiB, "
        f"forecast + anomaly <= {CYCLE_LIMIT_SECONDS:.0f} s, at --cpus 1 --memory 1g."
    )
    if found:
        verdict = "**Over the budget: the build stops and the owner rules again.**\n\n" + "\n".join(
            f"- {reason}" for reason in found
        )
    else:
        verdict = "**Within ruling 5's budget.**"
    title = "### Ruling 5: one cycle at the demo host's limits"
    text = f"{title}\n\n{render_table(results)}\n\n{limits}\n\n{verdict}\n"
    return text, 1 if found else 0


def relayable_lines(output: str) -> list[str]:
    """The lines that may reach the CI log: JSON objects, the peak marker, and docker's own
    `docker: ...` errors (they name the image or a flag, never the child's data)."""
    kept = []
    for raw in output.splitlines():
        line = raw.strip()
        if (
            line.startswith(PEAK_MARKER)
            or line.startswith("docker: ")
            or (line.startswith("{") and line.endswith("}"))
        ):
            kept.append(line)
    return kept


def container_database_name(url: str) -> str:
    """The database a container URL names, read without connecting (it may not resolve here)."""
    from psycopg.conninfo import conninfo_to_dict

    return str(conninfo_to_dict(url).get("dbname", ""))


def run_child(
    image: str,
    child: str,
    run: int,
    as_of: datetime,
    *,
    network: str,
    targets: Mapping[str, str],
    container_url: str,
) -> ChildResult:
    # A name, so a timed-out child's container can be removed: killing the docker
    # client on timeout does not stop the container it started.
    name = f"bms-ml-measure-{os.getpid()}-{run}-{child}"
    command = docker_command(image, child, as_of, network=network, targets=targets, name=name)
    env = {**os.environ, "DATABASE_URL_FLEET": container_url}
    started = time.monotonic()
    try:
        done = subprocess.run(  # noqa: S603 - a fixed argv, no shell on the host
            command, env=env, capture_output=True, text=True, timeout=CHILD_TIMEOUT_SECONDS, check=False
        )
        exit_code, output = done.returncode, done.stdout + "\n" + done.stderr
    except subprocess.TimeoutExpired:
        exit_code, output = 124, ""
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, check=False)  # noqa: S603, S607
    wall = time.monotonic() - started
    summary = parse_summary(output)
    # Only the child's JSON log lines (counts and fixed reasons, bms_ml.log) and the
    # peak marker reach the CI log, as `scheduler._relay` keeps only JSON: a raw
    # traceback would carry an exception message (AGENTS.md 9.6).
    for line in relayable_lines(output):
        sys.stdout.write(f"  [{run} {child}] {line}\n")
    return ChildResult(run, child, exit_code, wall, parse_memory_peak(output), summary)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m tests.integration.measure_cycle")
    parser.add_argument("--image", required=True, help="the runtime image, built (CI: bms-ml:ci)")
    parser.add_argument("--network", default="host", help="the containers' network (default: host)")
    parser.add_argument("--runs", type=int, default=RUNS)
    parser.add_argument("--summary-file", default=os.environ.get("GITHUB_STEP_SUMMARY", ""))
    args = parser.parse_args(argv)
    if args.runs < 1:
        sys.stderr.write("--runs must be at least 1: a gate that measured nothing proves nothing\n")
        return 2

    superuser = os.environ.get("ML_TEST_DATABASE_URL_SUPERUSER", "").strip()
    fleet = (
        os.environ.get(CONTAINER_URL_VAR, "").strip()
        or os.environ.get("ML_TEST_DATABASE_URL_FLEET", "").strip()
    )
    if not (superuser and fleet):
        sys.stderr.write(
            "ML_TEST_DATABASE_URL_SUPERUSER and ML_TEST_DATABASE_URL_FLEET "
            f"(or {CONTAINER_URL_VAR}) are required\n"
        )
        return 78

    import psycopg  # here, so the unit tests of the pure parts need no driver call

    from tests.integration.fixture import (
        MEASURE_AHEAD_DAYS,
        MEASURE_TARGETS,
        REQUIRED_DATABASE,
        TARGET,
        plant,
    )

    # The children run with --force, so their database must be the throwaway one too,
    # not only the one the fixture plants into.
    if container_database_name(fleet) != REQUIRED_DATABASE:
        sys.stderr.write(f"refusing to measure: the children's database is not {REQUIRED_DATABASE!r}\n")
        return 78

    with psycopg.connect(superuser, autocommit=True) as conn:
        planted = plant(conn, extra_ready=EXTRA_READY, ahead_days=MEASURE_AHEAD_DAYS, anomaly_shape=True)
    # HH:05 of the planted hour, as `serve` ticks: the anomaly child scores the hour before.
    as_of = planted.as_of + timedelta(minutes=5)
    targets = {"ML_FORECAST_TARGETS": TARGET, "ML_ANOMALY_TARGETS": MEASURE_TARGETS}
    sys.stdout.write(f"planted: as_of {planted.as_of.isoformat()}, image {args.image}, {args.runs} runs\n")

    results: list[ChildResult] = []
    for run in range(1, args.runs + 1):
        for child in CHILDREN:
            results.append(
                run_child(
                    args.image, child, run, as_of, network=args.network, targets=targets, container_url=fleet
                )
            )

    text, code = report(results)
    sys.stdout.write("\n" + text)
    if args.summary_file:
        with open(args.summary_file, "a", encoding="utf-8") as summary:
            summary.write(text)
    return code


if __name__ == "__main__":
    sys.exit(main())
