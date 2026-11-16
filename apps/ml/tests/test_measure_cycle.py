"""The pure parts of ruling 5's measurement tool (E1.2 plan T1.10), without Docker.

The containers themselves run only in CI's `ml` job; what is held here is the
argv each child runs with, how the tool reads a child's output, the verdict
against 900 MiB and 300 s, and the fixture's measurement shape.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from tests.integration import fixture
from tests.integration import measure_cycle as m

AS_OF = datetime(2027, 3, 1, 12, 5, tzinfo=UTC)
TARGETS = {"ML_FORECAST_TARGETS": "facility/a/b", "ML_ANOMALY_TARGETS": "facility/c/d"}


def forecast(
    run: int, *, wall: float = 60.0, peak: int | None = 500 * m.MIB, **summary: object
) -> m.ChildResult:
    counts = {"event": "cycle_summary", "scored": m.EXPECTED_FORECAST_SERIES, "runs_failed": 0, **summary}
    return m.ChildResult(run, m.FORECAST, 0, wall, peak, counts)


def anomaly(
    run: int, *, wall: float = 10.0, peak: int | None = 200 * m.MIB, **summary: object
) -> m.ChildResult:
    counts = {
        "event": "cycle_summary",
        "job": "anomaly",
        "scored": m.EXPECTED_ANOMALY_ASSETS,
        "isolation_forest_rows": m.EXPECTED_FOREST_ROWS,
        "runs_failed": 0,
        **summary,
    }
    return m.ChildResult(run, m.ANOMALY, 0, wall, peak, counts)


def within(runs: int = 3) -> list[m.ChildResult]:
    return [r for run in range(1, runs + 1) for r in (forecast(run), anomaly(run))]


# --- the limits are ruling 5's, by value -------------------------------------------------


def test_the_limits_are_ruling_5s():
    assert m.ANOMALY_PEAK_LIMIT_BYTES == 943_718_400  # 900 MiB
    assert m.CYCLE_LIMIT_SECONDS == 300.0
    assert m.RUNS == 3


# --- the docker argv ----------------------------------------------------------------------


@pytest.mark.parametrize("child", [m.FORECAST, m.ANOMALY])
def test_each_child_runs_alone_at_the_demo_hosts_limits(child: str):
    argv = m.docker_command("bms-ml:ci", child, AS_OF, network="host", targets=TARGETS)
    text = " ".join(argv)
    assert argv[:3] == ["docker", "run", "--rm"]
    for flags in (
        "--network host",
        "--cpus 1",
        "--memory 1g",
        "--memory-swap 1g",
        "--read-only",
        "--tmpfs /tmp",
        "--cap-drop ALL",
        "--security-opt no-new-privileges",
        "-e ML_TORCH_THREADS=1",
        "-e ML_ANOMALY_ENABLED=true",
        "-e ML_FORECAST_TARGETS=facility/a/b",
        "-e ML_ANOMALY_TARGETS=facility/c/d",
        f"-e ML_MEASURE_CHILD={child}",
        f"-e ML_MEASURE_AS_OF={AS_OF.isoformat()}",
        "--entrypoint sh bms-ml:ci -c",
    ):
        assert flags in text, flags
    assert argv[-1] == m.CONTAINER_SCRIPT


def test_the_fleet_url_goes_by_name_never_in_argv():
    argv = m.docker_command("img", m.FORECAST, AS_OF, network="host", targets=TARGETS)
    index = argv.index("DATABASE_URL_FLEET")
    assert argv[index - 1] == "-e"
    assert not any("postgres://" in part for part in argv)


def test_the_container_reads_its_own_cgroup_peak_after_the_child_and_keeps_its_exit_code():
    script = m.CONTAINER_SCRIPT
    assert script.index("python -m bms_ml") < script.index("/sys/fs/cgroup/memory.peak")
    assert '--force --as-of "$ML_MEASURE_AS_OF"' in script
    assert script.endswith("exit $code")


def test_an_unknown_child_is_refused():
    with pytest.raises(ValueError):
        m.docker_command("img", "serve", AS_OF, network="host", targets=TARGETS)


# --- reading a child's output -------------------------------------------------------------


def test_memory_peak_is_read_from_the_marker_line():
    out = '{"event":"cycle_summary"}\n\nbms-ml-memory-peak-bytes=548405248\n'
    assert m.parse_memory_peak(out) == 548_405_248


@pytest.mark.parametrize(
    "out",
    [
        "",
        "bms-ml-memory-peak-bytes=unreadable\n",
        "bms-ml-memory-peak-bytes=\n",
        "bms-ml-memory-peak-bytes=12 MiB\n",
    ],
)
def test_an_unreadable_memory_peak_is_none(out: str):
    assert m.parse_memory_peak(out) is None


def test_the_last_cycle_summary_wins_and_other_lines_are_ignored():
    out = "\n".join(
        [
            "not json",
            '{"event":"preflight_ok"}',
            '{"event":"cycle_summary","scored":1}',
            "{broken",
            '{"event":"cycle_summary","scored":2}',
        ]
    )
    assert m.parse_summary(out) == {"event": "cycle_summary", "scored": 2}
    assert m.parse_summary('{"event":"cycle_failed"}') is None


# --- the verdict ----------------------------------------------------------------------------


def test_within_budget_exits_0():
    text, code = m.report(within())
    assert code == 0
    assert m.breaches(within()) == []
    assert "Within ruling 5's budget" in text


def test_an_anomaly_peak_at_900_mib_passes_and_one_byte_more_fails():
    at_line = [forecast(1), anomaly(1, peak=m.ANOMALY_PEAK_LIMIT_BYTES)]
    over = [forecast(1), anomaly(1, peak=m.ANOMALY_PEAK_LIMIT_BYTES + 1)]
    assert m.report(at_line)[1] == 0
    text, code = m.report(over)
    assert code == 1
    assert "anomaly child peaked at 900.0 MiB" in text


def test_the_forecast_childs_peak_is_not_held_to_900_mib():
    # Ruling 5's memory line is the anomaly child's; the forecast child is held by the 1 GiB limit.
    assert m.report([forecast(1, peak=950 * m.MIB), anomaly(1)])[1] == 0


def test_a_cycle_is_forecast_plus_anomaly_and_300_s_is_the_line():
    assert m.report([forecast(1, wall=250.0), anomaly(1, wall=50.0)])[1] == 0
    text, code = m.report([forecast(1, wall=250.0), anomaly(1, wall=50.5)])
    assert code == 1
    assert "forecast + anomaly took 300.5 s" in text


def test_one_slow_run_of_three_fails_the_gate():
    results = within()
    results[4] = forecast(3, wall=299.0)
    assert m.cycle_seconds(results)[3] == pytest.approx(309.0)
    assert m.report(results)[1] == 1


@pytest.mark.parametrize(
    "result, reason",
    [
        (m.ChildResult(1, m.ANOMALY, 137, 5.0, 200 * m.MIB, None), "exited 137"),
        (anomaly(1, peak=None), "memory.peak could not be read"),
        (anomaly(1, runs_failed=1), "runs_failed is 1"),
        (anomaly(1, scored=37), "scored 37 assets"),
        (anomaly(1, isolation_forest_rows=0), "0 forest rows"),
        (forecast(1, scored=17), "scored 17 series"),
        (m.ChildResult(1, m.FORECAST, 0, 5.0, 1, None), "no cycle_summary line"),
    ],
)
def test_a_cycle_that_did_not_measure_the_real_workload_fails(result: m.ChildResult, reason: str):
    others = [anomaly(1)] if result.child == m.FORECAST else [forecast(1)]
    text, code = m.report([result, *others])
    assert code == 1
    assert reason in text


def test_the_table_carries_every_child_and_each_cycle_total():
    text, _ = m.report(within(2))
    table = m.render_table(within(2))
    assert table in text
    rows = [line for line in table.splitlines() if line.startswith("| ") and "---" not in line]
    assert len(rows) == 1 + 4 + 2  # header, four children, two cycle totals
    assert "| 1 | run-anomaly | 0 | 10.0 | 200.0 |" in table
    assert "| 2 | **cycle** | | **70.0** |" in table


# --- the fixture's measurement shape --------------------------------------------------------


def test_the_measurement_shape_is_the_real_one():
    shapes = fixture.measure_shapes()
    sizes = sorted(len(shape.points) for shape in shapes)
    assert sizes == [1] * 28 + [3] * 5 + [15] * 5
    assert len(shapes) == m.EXPECTED_ANOMALY_ASSETS
    assert sum(1 for shape in shapes if len(shape.points) >= 2) == m.EXPECTED_FOREST_ROWS
    assert all(
        shape.code.startswith("MLFX-") and shape.mqtt and shape.stale_point is None for shape in shapes
    )
    assert len({shape.code for shape in shapes}) == len(shapes)
    assert fixture.MEASURE_HOURS == 2184
    assert len(fixture.MEASURE_TARGETS.split(",")) == 15 + 3 + 1


def test_the_measurement_classes_are_apart_from_every_suites_targets():
    measured = set(fixture.MEASURE_TARGETS.split(","))
    assert measured.isdisjoint(fixture.ANOMALY_TARGETS.split(","))
    assert fixture.TARGET not in measured
    prefixes = {prefix for _, _, prefix, _, _ in fixture.MEASURE_CLASSES}
    existing = {
        s.code for s in (*fixture.SHAPES, *fixture.ANOMALY_SHAPES, *fixture.extra_shapes(m.EXTRA_READY))
    }
    assert not any(code.startswith(prefix) for code in existing for prefix in prefixes)


def test_every_planted_hour_stays_ahead_of_now():
    now = datetime(2026, 11, 16, 23, 59, tzinfo=UTC)
    as_of = fixture.as_of_for(now, fixture.MEASURE_AHEAD_DAYS)
    assert as_of - timedelta(hours=fixture.MEASURE_HOURS) > now
    # The extra rooms' 90 days too.
    assert as_of - timedelta(hours=max(fixture.hours_for("MLFX-X00", as_of))) > now


def test_the_suites_keep_their_70_days_ahead():
    now = datetime(2026, 11, 16, 10, 30, tzinfo=UTC)
    assert fixture.AHEAD_DAYS == 70
    assert fixture.as_of_for(now, fixture.AHEAD_DAYS) == datetime(2027, 1, 25, 10, tzinfo=UTC)


def test_the_measured_values_move_and_repeat():
    shape = fixture.measure_shapes()[0]
    values = [fixture.measure_value(shape, shape.points[3], h) for h in range(1, 169)]
    assert len(set(values)) > 100
    assert values == [fixture.measure_value(shape, shape.points[3], h) for h in range(1, 169)]


def test_only_json_lines_and_the_peak_marker_are_relayed():
    output = "\n".join(
        [
            '{"event": "cycle_summary", "rows_written": 3}',
            "Traceback (most recent call last):",
            "psycopg.OperationalError: password authentication failed for user x",
            f"{m.PEAK_MARKER}123",
            "",
        ]
    )
    assert m.relayable_lines(output) == [
        '{"event": "cycle_summary", "rows_written": 3}',
        f"{m.PEAK_MARKER}123",
    ]


def test_the_childrens_database_name_is_read_from_the_url_without_connecting():
    assert m.container_database_name("postgres://u:p@host.docker.internal:5432/bms_ml_test") == (
        "bms_ml_test"
    )
    assert m.container_database_name("postgres://u:p@db:5432/bms") == "bms"


def test_main_refuses_a_childrens_database_that_is_not_the_throwaway_one(monkeypatch):
    monkeypatch.setenv("ML_TEST_DATABASE_URL_SUPERUSER", "postgres://s:p@localhost:5432/bms_ml_test")
    monkeypatch.setenv("ML_TEST_DATABASE_URL_FLEET", "postgres://f:p@localhost:5432/bms")
    monkeypatch.delenv(m.CONTAINER_URL_VAR, raising=False)
    assert m.main(["--image", "bms-ml:ci", "--runs", "1"]) == 78


def test_docker_errors_are_relayed_too():
    assert m.relayable_lines("docker: Error response from daemon: no such image.\nother") == [
        "docker: Error response from daemon: no such image."
    ]


def test_a_named_child_container_carries_its_name():
    as_of = datetime(2026, 11, 16, 5, tzinfo=UTC)
    command = m.docker_command("img", m.CHILDREN[0], as_of, network="host", targets={}, name="c1")
    assert command[command.index("--name") + 1] == "c1"
    assert command.index("--name") < command.index("--entrypoint")


def test_zero_runs_is_refused():
    assert m.main(["--image", "bms-ml:ci", "--runs", "0"]) == 2


def test_the_other_model_fixture_runs_are_cleaned():
    assert "ml-fixture-other-model" in fixture.FIXTURE_RUN_NAMES
