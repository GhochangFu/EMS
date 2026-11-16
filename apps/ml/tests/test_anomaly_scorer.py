"""The anomaly cycle over a fake database and a fake forest (E1.2 plan T1.6, section 4)."""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime, timedelta
from uuid import UUID

import numpy as np
import pytest

from bms_ml import log
from bms_ml.anomaly_baseline import (
    ANOMALY_MODEL_NAME,
    BASELINE_HASH_CONSTANTS,
    BASELINE_HOURS,
    DETECTOR_BASELINE,
    DETECTOR_FOREST,
    REFERENCE_HOURS,
)
from bms_ml.anomaly_scorer import (
    ANOMALY_VERSIONED_PACKAGES,
    JOB_NAME,
    anomaly_package_versions,
    run_anomaly_cycle,
)
from bms_ml.config import anomaly_config_hash, load_config
from bms_ml.readiness import ANOMALY_THRESHOLDS, PointStats
from bms_ml.records import PointRef
from bms_ml.series import HourRow
from tests.fakes import FakeAnomalyDb, FakeClock, FakeForest

NOW = datetime(2026, 11, 16, 12, 5, tzinfo=UTC)
H = datetime(2026, 11, 16, 12, tzinfo=UTC)
S = H - timedelta(hours=1)
GRID_START = S - timedelta(hours=BASELINE_HOURS)
ORG_A = UUID("00000000-0000-0000-0000-00000000000a")
ORG_B = UUID("00000000-0000-0000-0000-00000000000b")
SECRET_DSN = "postgres://bms_fleet:hunter2-secret@db.internal:5432/bms"
KEYS = ("current_ir", "kva", "kw")
SUMMARY_KEYS = {
    "job",
    "as_of_hour",
    "scored_hour",
    "organizations",
    "eligible",
    "assets",
    "scored",
    "baseline_rows",
    "isolation_forest_rows",
    "rows_written",
    "runs_succeeded",
    "runs_failed",
    "organizations_already_scored",
    "duration_seconds",
    "skipped",
}


def config(**env: str):
    return load_config({"DATABASE_URL_FLEET": SECRET_DSN, **env})


def asset(n: int) -> UUID:
    return UUID(int=0xB000 + n)


def rows(level: float, *, seed: int, spike: float = 0.0, missing_at_s: bool = False) -> list[HourRow]:
    """2,185 hourly rows from GRID_START to S inclusive: a daily cycle plus a little noise."""
    rng = np.random.default_rng(seed)
    out = []
    for k in range(BASELINE_HOURS + 1):
        bucket = GRID_START + timedelta(hours=k)
        value = level + 0.5 * math.sin(2 * math.pi * k / 24) + 0.05 * float(rng.standard_normal())
        if bucket == S:
            if missing_at_s:
                continue
            value += spike
        out.append(HourRow(bucket, value, 1))
    return out


def point(org: UUID, n: int, key: str, *, last: datetime = S) -> PointStats:
    return PointStats(org, asset(n), f"MTR-{n}", key, GRID_START, last, BASELINE_HOURS + 1, 92)


class Planted:
    def __init__(self) -> None:
        self.db = FakeAnomalyDb()

    def add(
        self,
        org: UUID,
        n: int,
        keys: tuple[str, ...],
        *,
        spike: dict[str, float] | None = None,
        missing_at_s: tuple[str, ...] = (),
        stale: tuple[str, ...] = (),
    ) -> Planted:
        for index, key in enumerate(keys):
            last = H - timedelta(hours=6) if key in stale else S
            self.db.stats.append(point(org, n, key, last=last))
            self.db.histories[PointRef(asset(n), key)] = rows(
                10.0 * (index + 1),
                seed=n * 100 + index,
                spike=(spike or {}).get(key, 0.0),
                missing_at_s=key in missing_at_s,
            )
        return self


def cycle(db, forest=None, *, force=False, clock=None, cfg=None, as_of=None):
    return run_anomaly_cycle(
        db, forest or FakeForest(), clock or FakeClock(NOW), cfg or config(), force=force, as_of=as_of
    )


def rows_of(db: FakeAnomalyDb, n: int) -> dict[str, float]:
    return {row.detector: row.score for _, row in db.scores if row.asset_id == asset(n)}


# --- the scored hour -------------------------------------------------------------------------


def test_every_row_is_on_the_scored_hour_h_minus_one():
    db = Planted().add(ORG_A, 1, KEYS, spike={"kw": 50.0}).add(ORG_A, 2, ("kw",)).db
    summary = cycle(db)
    assert db.scores, "the cycle wrote nothing: the scored hour holds no data"
    assert {row.bucket for _, row in db.scores} == {S}
    assert (summary.as_of_hour, summary.scored_hour) == (H, S)
    # S's own value is what is scored: the spike at S is a new maximum.
    assert rows_of(db, 1)[DETECTOR_BASELINE] == 1.0


def test_as_of_is_floored_and_overrides_the_clock():
    db = Planted().add(ORG_A, 1, ("kw",)).db
    summary = cycle(db, clock=FakeClock(NOW + timedelta(days=3)), as_of=H + timedelta(minutes=42))
    assert summary.scored_hour == S
    assert {row.bucket for _, row in db.scores} == {S}
    assert db.eligibility_requests[0][1:] == (H - timedelta(days=400), H)


# --- which detectors run ---------------------------------------------------------------------


def test_a_one_point_asset_gets_only_a_baseline_row_and_a_three_point_asset_gets_two():
    db = Planted().add(ORG_A, 1, ("kw",)).add(ORG_A, 2, KEYS).db
    forest = FakeForest(score=0.25)
    summary = cycle(db, forest)
    assert rows_of(db, 1).keys() == {DETECTOR_BASELINE}
    assert rows_of(db, 2) == {**rows_of(db, 2), DETECTOR_FOREST: 0.25}
    assert rows_of(db, 2).keys() == {DETECTOR_BASELINE, DETECTOR_FOREST}
    assert len(forest.calls) == 1
    assert (summary.baseline_rows, summary.isolation_forest_rows, summary.rows_written) == (2, 1, 3)


def test_the_forest_gets_the_reference_window_without_s_and_s_as_the_current_row():
    db = Planted().add(ORG_A, 1, ("kw", "current_ir", "kva")).db
    forest = FakeForest()
    cycle(db, forest)
    ((reference, current),) = forest.calls
    assert reference.shape == (REFERENCE_HOURS, 3)
    # Columns in ascending point-key order; the last reference row is S - 1 h, never S.
    grid = {key: {r.bucket: r.sum_value for r in db.histories[PointRef(asset(1), key)]} for key in KEYS}
    assert list(current) == [grid[key][S] for key in KEYS]
    assert list(reference[-1]) == [grid[key][S - timedelta(hours=1)] for key in KEYS]
    assert list(reference[0]) == [grid[key][S - timedelta(hours=REFERENCE_HOURS)] for key in KEYS]


def test_a_point_missing_at_s_keeps_the_baseline_row_and_drops_the_forest_row():
    db = Planted().add(ORG_A, 1, KEYS, spike={"kw": 40.0, "kva": 20.0}, missing_at_s=("current_ir",)).db
    summary = cycle(db)
    assert rows_of(db, 1).keys() == {DETECTOR_BASELINE}
    assert summary.skipped["if_incomplete_hour"] == 1
    (row,) = (row for _, row in db.scores)
    assert "current_ir" not in row.contributing_points
    assert row.contributing_points[0] == "kw"


def test_contributing_points_are_the_same_on_both_rows_of_the_hour():
    db = Planted().add(ORG_A, 1, KEYS, spike={"kva": 30.0, "kw": 60.0}).db
    cycle(db)
    lists = {row.detector: row.contributing_points for _, row in db.scores}
    assert lists[DETECTOR_BASELINE] == lists[DETECTOR_FOREST]
    assert lists[DETECTOR_BASELINE][:2] == ("kw", "kva")


# --- all or nothing (R5) ---------------------------------------------------------------------


def test_an_asset_with_one_stale_point_gets_nothing_and_the_others_are_scored():
    db = Planted().add(ORG_A, 1, KEYS, stale=("kva",)).add(ORG_A, 2, KEYS).add(ORG_A, 3, ("kw",)).db
    summary = cycle(db)
    assert {row.asset_id for _, row in db.scores} == {asset(2), asset(3)}
    assert summary.skipped["asset_not_ready"] == 1
    assert summary.skipped["stale"] == 1
    assert asset(1) not in {ref.asset_id for refs, _, _ in db.history_requests for ref in refs}
    (run,) = db.runs
    assert run.status == "succeeded" and run.rows_written == 3


def test_an_organization_with_no_ready_asset_writes_no_run():
    db = Planted().add(ORG_A, 1, ("kw",)).add(ORG_B, 2, ("kw",), stale=("kw",)).db
    summary = cycle(db)
    assert {run.organization_id for run in db.runs} == {ORG_A}
    assert summary.organizations == 1


# --- runs, failures and the ledger -----------------------------------------------------------


def test_two_organizations_two_runs_named_bms_anomaly():
    db = Planted().add(ORG_A, 1, KEYS).add(ORG_B, 2, ("kw",)).db
    summary = cycle(db)
    assert sorted((str(r.organization_id), r.status, r.rows_written) for r in db.runs) == [
        (str(ORG_A), "succeeded", 2),
        (str(ORG_B), "succeeded", 1),
    ]
    for run in db.runs:
        assert run.model_name == ANOMALY_MODEL_NAME
        assert run.model_version == "bms-ml={};scikit-learn={}".format(
            anomaly_package_versions()["bms-ml"], anomaly_package_versions()["scikit-learn"]
        )
        assert run.rows_written == sum(1 for run_id, _ in db.scores if run_id == run.id)
        assert run.finished_at >= run.started_at
    assert summary.runs_succeeded == 2


def test_a_failure_in_one_organization_writes_a_failed_run_and_the_other_succeeds():
    db = Planted().add(ORG_A, 1, ("kw",)).add(ORG_B, 2, ("kw",)).db
    db.fail_history_for[asset(1)] = ConnectionError(f"could not connect to {SECRET_DSN}")
    summary = cycle(db)
    by_org = {run.organization_id: run for run in db.runs}
    assert (by_org[ORG_A].status, by_org[ORG_A].error_text, by_org[ORG_A].rows_written) == (
        "failed",
        "history:ConnectionError",
        0,
    )
    assert by_org[ORG_A].model_name == ANOMALY_MODEL_NAME
    assert by_org[ORG_B].status == "succeeded"
    assert {row.asset_id for _, row in db.scores} == {asset(2)}
    assert (summary.runs_failed, summary.runs_succeeded) == (1, 1)


def test_a_forest_exception_skips_only_that_row_and_logs_the_class(capsys):
    log.configure("info")
    db = Planted().add(ORG_A, 1, KEYS).add(ORG_A, 2, KEYS).db
    forest = FakeForest(fail_with=ValueError(f"bad input near {SECRET_DSN}"), fail_on_calls=frozenset({0}))
    summary = cycle(db, forest)
    assert summary.skipped["forest_failed"] == 1
    assert sorted(row.detector for _, row in db.scores) == [
        DETECTOR_BASELINE,
        DETECTOR_BASELINE,
        DETECTOR_FOREST,
    ]
    (run,) = db.runs
    assert run.status == "succeeded"
    out = capsys.readouterr().out
    assert "hunter2" not in out and "bad input" not in out
    events = [json.loads(line) for line in out.splitlines()]
    assert {"event": "forest_failed", "error": "forest:ValueError"}.items() <= next(
        e for e in events if e["event"] == "forest_failed"
    ).items()


def test_a_non_finite_score_is_not_written():
    db = Planted().add(ORG_A, 1, KEYS).db
    summary = cycle(db, FakeForest(score=float("nan")))
    assert rows_of(db, 1).keys() == {DETECTOR_BASELINE}
    assert summary.skipped["non_finite_score"] == 1
    assert db.runs[0].rows_written == 1


def test_the_ledger_skips_a_scored_hour_and_force_writes_a_new_run():
    db = Planted().add(ORG_A, 1, ("kw",)).db
    clock = FakeClock(NOW)
    cycle(db, clock=clock)
    again = cycle(db, clock=clock)
    assert len(db.runs) == 1
    assert again.organizations_already_scored == 1 and again.rows_written == 0
    forced = cycle(db, clock=clock, force=True)
    assert forced.runs_succeeded == 1
    first, second = db.runs
    assert first.id != second.id
    assert len(db.scores) == 2
    # The next hour is not the scored one.
    later = cycle(db, clock=clock, as_of=H + timedelta(hours=1))
    assert later.organizations_already_scored == 0


def test_a_changed_target_list_is_a_new_config_hash():
    db = Planted().add(ORG_A, 1, ("kw",)).db
    clock = FakeClock(NOW)
    cycle(db, clock=clock)
    cycle(db, clock=clock, cfg=config(ML_ANOMALY_TARGETS="electrical/energy_meter/kw"))
    assert len(db.runs) == 2
    assert db.runs[0].config_hash != db.runs[1].config_hash


def test_the_config_hash_covers_section_4_5():
    db = Planted().add(ORG_A, 1, ("kw",)).db
    forest = FakeForest()
    cfg = config()
    cycle(db, forest, cfg=cfg)
    assert ANOMALY_VERSIONED_PACKAGES == ("bms-ml", "numpy", "scikit-learn", "scipy")
    expected = anomaly_config_hash(
        job=JOB_NAME,
        targets=cfg.anomaly_targets,
        thresholds=ANOMALY_THRESHOLDS,
        constants={
            **BASELINE_HASH_CONSTANTS,
            "forest_min_points": 2,
            "forest_min_training_rows": forest.min_training_rows,
        },
        forest_kwargs=forest.kwargs,
        package_versions=anomaly_package_versions(),
    )
    assert db.runs[0].config_hash == expected
    assert BASELINE_HASH_CONSTANTS["ties"] == "strict"


# --- reads (R9) and the summary --------------------------------------------------------------


def test_history_is_read_once_per_asset_over_the_baseline_window_and_s():
    db = Planted().add(ORG_A, 1, KEYS).add(ORG_A, 2, ("kw",)).add(ORG_B, 3, ("kva", "kw")).db
    cycle(db)
    assert len(db.history_requests) == 3
    for refs, from_hour, as_of_hour in db.history_requests:
        assert len({ref.asset_id for ref in refs}) == 1
        assert (from_hour, as_of_hour) == (S - timedelta(hours=BASELINE_HOURS), H)
    assert sorted(len(refs) for refs, _, _ in db.history_requests) == [1, 2, 3]
    assert db.eligibility_requests[0][0] == config().anomaly_targets


def test_the_summary_holds_counts_only():
    db = Planted().add(ORG_A, 1, KEYS, stale=("kw",)).add(ORG_A, 2, KEYS).add(ORG_B, 3, ("kw",)).db
    counts = cycle(db).counts()
    assert set(counts) == SUMMARY_KEYS
    assert counts["job"] == "anomaly"
    flat = json.dumps(counts)
    for secret in ("MTR-", str(ORG_A), str(ORG_B), str(asset(1)), "hunter2"):
        assert secret not in flat
    assert (counts["eligible"], counts["assets"], counts["scored"]) == (7, 3, 2)
    assert (counts["baseline_rows"], counts["isolation_forest_rows"], counts["rows_written"]) == (2, 1, 3)
    assert counts["skipped"] == {"asset_not_ready": 1, "stale": 1}
    assert counts["scored_hour"] == S.isoformat()


@pytest.mark.parametrize("reason", ["reference_too_sparse"])
def test_a_baseline_skip_is_counted_and_writes_no_row(reason):
    db = Planted().add(ORG_A, 1, ("kw",)).db
    ref = PointRef(asset(1), "kw")
    # 300 hours of reference only: fewer than 336.
    db.histories[ref] = [row for row in db.histories[ref] if row.bucket >= S - timedelta(hours=300)]
    summary = cycle(db)
    assert summary.skipped[reason] == 1
    assert db.scores == []
    assert db.runs[0].status == "succeeded" and db.runs[0].rows_written == 0
