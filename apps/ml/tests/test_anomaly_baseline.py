"""The median/MAD baseline detector (plan e1.2 section 4.3, 4.5; ADR 0135 Amendment 5)."""

import ast
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

from bms_ml import anomaly_baseline as ab
from bms_ml.anomaly_baseline import (
    SKIP_NO_DATA_AT_HOUR,
    SKIP_REFERENCE_TOO_SPARSE,
    SKIP_SLOT_TOO_SPARSE,
    SLOT_MODE_DAY,
    SLOT_MODE_WEEK,
    contributing_points,
    evaluate_asset,
    fit_point,
    hour_of_week,
    percentile_strictly_below,
    score_baseline,
)

S = datetime(2026, 11, 16, 0, tzinfo=UTC)  # a Monday, slot 0
GRID_HOURS = ab.BASELINE_HOURS + 1  # [S - 2,184 h, S]
START = S - timedelta(hours=ab.BASELINE_HOURS)
NAN = float("nan")


def jitter(hours: int, level: float = 0.0, scale: float = 0.1) -> np.ndarray:
    """A deterministic series that moves, so no slot has MAD 0."""
    i = np.arange(hours)
    return level + scale * (((i * 7) % 5) - 2).astype(np.float64)


def grid_with(value_at_s: float, base: np.ndarray | None = None) -> np.ndarray:
    grid = jitter(GRID_HOURS) if base is None else base.copy()
    grid[-1] = value_at_s
    return grid


# --- constants -----------------------------------------------------------------


def test_the_constants_of_section_4_by_value():
    assert ab.REFERENCE_HOURS == 672
    assert ab.BASELINE_HOURS == 2184
    assert ab.SLOT_MIN_SAMPLES == 8
    assert ab.REFERENCE_MIN == 336
    assert ab.MAD_SCALE == 1.4826
    assert (ab.FLOOR_ABSOLUTE, ab.FLOOR_MEDIAN_FRACTION, ab.FLOOR_SPREAD_FRACTION) == (1e-6, 1e-4, 0.01)
    assert (ab.FLOOR_SPREAD_LOW_PERCENTILE, ab.FLOOR_SPREAD_HIGH_PERCENTILE) == (5, 95)
    assert ab.CONTRIBUTING_POINTS_MAX == 3
    assert ab.DETECTOR_BASELINE == "baseline_mad"
    assert ab.DETECTOR_FOREST == "isolation_forest"
    assert ab.ANOMALY_MODEL_NAME == "bms-anomaly"
    assert (SKIP_REFERENCE_TOO_SPARSE, SKIP_NO_DATA_AT_HOUR, SKIP_SLOT_TOO_SPARSE) == (
        "reference_too_sparse",
        "no_data_at_hour",
        "slot_too_sparse",
    )


def test_the_hash_constants_carry_every_constant_and_strict_ties():
    assert ab.BASELINE_HASH_CONSTANTS == {
        "reference_hours": 672,
        "baseline_hours": 2184,
        "slot_min_samples": 8,
        "reference_min": 336,
        "mad_scale": 1.4826,
        "floor_absolute": 1e-6,
        "floor_median_fraction": 1e-4,
        "floor_spread_fraction": 0.01,
        "floor_spread_percentiles": [5, 95],
        "contributing_points_max": 3,
        "ties": "strict",
    }


def test_the_module_does_not_import_sklearn():
    tree = ast.parse(Path(ab.__file__).read_text("utf-8"))
    names = [a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names]
    names += [n.module or "" for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)]
    assert not [n for n in names if n.split(".")[0] == "sklearn"]


# --- the percentile, worked values of 4.3 ----------------------------------------


@pytest.mark.parametrize(
    ("reference", "value", "expected"),
    [
        ([0, 0, 0, 0], 0, 0.0),
        ([1, 2, 3, 4], 5, 1.0),
        ([1, 2, 3, 4], 4, 0.75),
        ([1, 2, 3, 4], 2.5, 0.5),
    ],
)
def test_percentile_worked_values(reference, value, expected):
    assert percentile_strictly_below(np.array(reference, dtype=np.float64), value) == expected


def test_percentile_at_n_672_crosses_099_at_666_strictly_below():
    reference = np.arange(1, 673, dtype=np.float64)
    assert percentile_strictly_below(reference, 666.5) == 666 / 672
    assert percentile_strictly_below(reference, 666.5) == pytest.approx(0.99107, abs=1e-5)
    assert percentile_strictly_below(reference, 665.5) == 665 / 672
    assert percentile_strictly_below(reference, 665.5) == pytest.approx(0.98958, abs=1e-5)
    assert percentile_strictly_below(reference, 666.5) >= 0.99 > percentile_strictly_below(reference, 665.5)


def test_percentile_refuses_an_empty_or_undefined_reference():
    with pytest.raises(ValueError):
        percentile_strictly_below(np.array([], dtype=np.float64), 1.0)
    with pytest.raises(ValueError):
        percentile_strictly_below(np.array([1.0, NAN]), 1.0)


# --- slot index and mode ----------------------------------------------------------


def test_the_two_slot_indexes_of_section_4_3():
    assert hour_of_week(datetime(2026, 11, 16, 0, tzinfo=UTC)) == 0
    assert hour_of_week(datetime(2026, 11, 22, 23, tzinfo=UTC)) == 167
    week = ab.hour_of_week_slots(datetime(2026, 11, 16, 0, tzinfo=UTC), 168)
    assert week.tolist() == list(range(168))


def test_the_vectorised_slots_agree_with_the_calendar_across_a_year():
    first = datetime(2026, 1, 1, 0, tzinfo=UTC)
    slots = ab.hour_of_week_slots(first, 24 * 366)
    expected = [hour_of_week(first + timedelta(hours=i)) for i in range(24 * 366)]
    assert slots.tolist() == expected


def test_8_samples_in_all_168_slots_is_hour_of_week():
    values = jitter(8 * 168)
    assert fit_point(values, S).mode == SLOT_MODE_WEEK


def test_one_slot_at_7_is_hour_of_day():
    values = jitter(8 * 168)
    values[5] = NAN
    fit = fit_point(values, S)
    assert fit.mode == SLOT_MODE_DAY
    assert len(fit.medians) == 24


def test_28_days_of_data_is_hour_of_day():
    values = np.full(ab.BASELINE_HOURS, NAN)
    values[-672:] = jitter(672)
    assert fit_point(values, START).mode == SLOT_MODE_DAY


# --- windows: 91 days for median/MAD, 28 for the percentile ---------------------


def level_change_40_days_ago(value_at_s: float) -> np.ndarray:
    grid = jitter(GRID_HOURS)
    grid[-1 - 40 * 24 : -1] += 10.0
    grid[-1] = value_at_s
    return grid


def test_a_level_change_40_days_ago_moves_the_median_not_the_reference():
    asset = evaluate_asset({"p": level_change_40_days_ago(0.0)}, START, S)
    fit = asset.points["p"]
    assert fit.mode == SLOT_MODE_WEEK
    # 13 samples per slot, 5 or 6 after the change: the median stays on the old level
    assert np.all(np.abs(fit.medians) < 1.0)
    assert asset.reference.size == ab.REFERENCE_HOURS


def test_the_old_level_scores_0_against_a_91_day_median():
    outcome = score_baseline({"p": level_change_40_days_ago(0.0)}, START, S)
    assert outcome.score == 0.0
    assert outcome.reference_size == 672


def test_the_baseline_reads_up_to_2184_hours_only():
    longer = np.concatenate([np.full(500, 1e6), jitter(GRID_HOURS)])
    longer[-1] = 0.0
    a = evaluate_asset({"p": longer}, START - timedelta(hours=500), S)
    b = evaluate_asset({"p": grid_with(0.0)}, START, S)
    assert np.array_equal(a.points["p"].medians, b.points["p"].medians)
    assert a.points["p"].floor == b.points["p"].floor


def test_hours_after_the_scored_hour_are_not_read():
    grid = np.concatenate([grid_with(0.0), np.full(50, 1e6)])
    assert score_baseline({"p": grid}, START, S) == score_baseline({"p": grid_with(0.0)}, START, S)


# --- the scored hour is not in its own reference -------------------------------


def test_a_new_maximum_scores_exactly_1():
    outcome = score_baseline({"p": grid_with(1000.0)}, START, S)
    assert outcome.score == 1.0
    assert outcome.reference_size == 672


# --- undefined slots and missing hours -----------------------------------------


def day_mode_grid(samples_at_hour_5: int, value_at_s: float) -> tuple[np.ndarray, datetime, datetime]:
    """28 days of data (hour-of-day mode), hour 5 holding `samples_at_hour_5` samples."""
    scored = S + timedelta(hours=5)
    start = scored - timedelta(hours=ab.BASELINE_HOURS)
    grid = np.full(GRID_HOURS, NAN)
    grid[-1 - 672 : -1] = jitter(672)
    hours = (np.arange(GRID_HOURS) + 5) % 24  # start is at hour 5
    at_five = np.flatnonzero((hours == 5) & np.isfinite(grid))
    grid[at_five[: at_five.size - samples_at_hour_5]] = NAN
    grid[-1] = value_at_s
    return grid, start, scored


def test_a_slot_with_7_samples_is_undefined():
    grid, start, scored = day_mode_grid(7, 0.0)
    asset = evaluate_asset({"p": grid}, start, scored)
    fit = asset.points["p"]
    assert fit.mode == SLOT_MODE_DAY
    assert fit.counts[5] == 7
    assert np.isnan(fit.medians[5]) and np.isnan(fit.mads[5])
    assert asset.z_at_hour == {"p": None}
    outcome = score_baseline({"p": grid}, start, scored)
    assert (outcome.score, outcome.skip_reason) == (None, SKIP_SLOT_TOO_SPARSE)


def test_a_slot_with_8_samples_is_defined():
    grid, start, scored = day_mode_grid(8, 0.0)
    outcome = score_baseline({"p": grid}, start, scored)
    assert outcome.skip_reason is None
    assert outcome.score is not None


def test_a_missing_hour_is_never_a_number_in_the_statistics():
    values = jitter(8 * 168, level=5.0)
    gapped = values.copy()
    gapped[::5] = NAN
    fit = fit_point(gapped, S)
    assert fit.mode == SLOT_MODE_DAY
    hours = np.arange(gapped.size) % 24
    for k in range(24):
        present = gapped[(hours == k) & np.isfinite(gapped)]
        assert fit.counts[k] == present.size
        assert fit.medians[k] == np.median(present)
    finite = gapped[np.isfinite(gapped)]
    assert fit.floor == max(
        1e-6, 1e-4 * float(np.median(np.abs(finite))), 0.01 * float(np.ptp(np.percentile(finite, [5, 95])))
    )


def test_a_value_missing_at_the_scored_hour_has_no_z():
    asset = evaluate_asset({"p": grid_with(NAN)}, START, S)
    assert asset.z_at_hour == {"p": None}
    assert asset.b_at_hour is None
    outcome = score_baseline({"p": grid_with(NAN)}, START, S)
    assert (outcome.score, outcome.skip_reason, outcome.contributing_points) == (
        None,
        SKIP_NO_DATA_AT_HOUR,
        (),
    )


@pytest.mark.parametrize("bad", [float("inf"), float("-inf")])
def test_a_non_finite_value_is_missing(bad):
    outcome = score_baseline({"p": grid_with(bad)}, START, S)
    assert outcome.skip_reason == SKIP_NO_DATA_AT_HOUR


def test_missing_reference_hours_are_not_in_the_reference():
    grid = grid_with(0.0)
    grid[-1 - 100 : -1] = NAN
    assert evaluate_asset({"p": grid}, START, S).reference.size == 672 - 100


def test_the_input_grid_is_not_modified():
    grid = grid_with(NAN)
    grid[10:20] = NAN
    before = grid.copy()
    score_baseline({"p": grid}, START, S)
    assert np.array_equal(grid, before, equal_nan=True)


# --- the floor -------------------------------------------------------------------


def test_the_floor_of_a_constant_point_is_1e_4():
    fit = fit_point(np.full(ab.BASELINE_HOURS, 1.0), START)
    assert fit.floor == 1e-4


def test_the_floor_of_an_on_off_point_is_a_hundredth_of_the_spread():
    values = (np.arange(ab.BASELINE_HOURS) % 10 < 3).astype(np.float64)  # on 30 %
    fit = fit_point(values, START)
    assert fit.floor == 0.01


def test_the_floor_of_a_noisy_point_follows_the_formula():
    values = np.random.default_rng(135).normal(1000.0, 0.05, ab.BASELINE_HOURS)
    fit = fit_point(values, START)
    p05, p95 = np.percentile(values, [5, 95])
    assert fit.floor == max(1e-6, 1e-4 * float(np.median(np.abs(values))), 0.01 * float(p95 - p05))
    assert fit.floor == pytest.approx(0.1, rel=1e-3)  # 1e-4 x median |x| wins
    spread = np.linspace(0.0, 100.0, ab.BASELINE_HOURS)
    assert fit_point(spread, START).floor == pytest.approx(0.9)  # 0.01 x (P95 - P05) wins


def test_the_floor_of_a_zero_point_is_1e_6():
    assert fit_point(np.zeros(ab.BASELINE_HOURS), START).floor == 1e-6


def test_a_constant_point_at_its_level_scores_0():
    grid = np.full(GRID_HOURS, 1.0)
    asset = evaluate_asset({"p": grid}, START, S)
    assert asset.z_at_hour == {"p": 0.0}
    assert score_baseline({"p": grid}, START, S).score == 0.0


def test_a_constant_point_at_098_has_z_134_9_and_scores_1():
    grid = np.full(GRID_HOURS, 1.0)
    grid[-1] = 0.98
    asset = evaluate_asset({"p": grid}, START, S)
    assert asset.z_at_hour["p"] == pytest.approx(0.02 / (1.4826 * 1e-4))
    assert asset.z_at_hour["p"] == pytest.approx(134.9, abs=0.05)
    assert score_baseline({"p": grid}, START, S).score == 1.0


# --- b(t) is the maximum over the points present ------------------------------


def test_b_is_the_maximum_z_over_the_points_present():
    grids = {"a": grid_with(3.0), "b": grid_with(7.0)}
    asset = evaluate_asset(grids, START, S)
    assert asset.b_at_hour == asset.z_at_hour["b"] > asset.z_at_hour["a"] > 0
    grids["b"] = grid_with(NAN)
    asset = evaluate_asset(grids, START, S)
    assert asset.z_at_hour["b"] is None
    assert asset.b_at_hour == asset.z_at_hour["a"]


def test_the_reference_is_the_per_hour_maximum_over_points():
    a = grid_with(0.0)
    b = grid_with(0.0, base=jitter(GRID_HOURS, scale=0.3) * -1)
    b[-100:-50] = NAN  # these hours take only a's z
    asset = evaluate_asset({"a": a, "b": b}, START, S)
    za = asset.points["a"].z(a[-673:-1], S - timedelta(hours=672))
    zb = asset.points["b"].z(b[-673:-1], S - timedelta(hours=672))
    assert np.array_equal(asset.reference, np.fmax(za, zb))


def test_one_point_missing_at_the_hour_is_scored_from_the_others():
    outcome = score_baseline({"a": grid_with(1000.0), "b": grid_with(NAN)}, START, S)
    assert outcome.score == 1.0
    assert outcome.contributing_points == ("a",)


def test_value_present_in_one_point_with_an_undefined_slot_is_slot_too_sparse():
    grid, start, scored = day_mode_grid(7, 0.0)
    missing = grid.copy()
    missing[-1] = NAN
    outcome = score_baseline({"a": missing, "b": grid}, start, scored)
    assert outcome.skip_reason == SKIP_SLOT_TOO_SPARSE


# --- contributing points --------------------------------------------------------


def test_four_points_list_the_top_3_by_z():
    grids = {"w": grid_with(2.0), "x": grid_with(9.0), "y": grid_with(5.0), "z": grid_with(7.0)}
    assert score_baseline(grids, START, S).contributing_points == ("x", "z", "y")


def test_a_tie_in_z_is_broken_by_point_key():
    grids = {"d": grid_with(5.0), "b": grid_with(5.0), "c": grid_with(5.0), "a": grid_with(1.0)}
    assert score_baseline(grids, START, S).contributing_points == ("b", "c", "d")
    assert contributing_points({"q": 2.0, "p": 2.0, "r": 3.0, "s": 2.0}) == ("r", "p", "q")


def test_a_point_missing_at_the_hour_is_not_listed():
    grids = {"a": grid_with(NAN), "b": grid_with(2.0), "c": grid_with(NAN)}
    assert score_baseline(grids, START, S).contributing_points == ("b",)
    assert contributing_points({"a": None, "b": 1.0, "c": NAN}) == ("b",)


def test_z_0_is_not_listed():
    constant = np.full(GRID_HOURS, 1.0)
    grids = {"flat": constant, "moved": grid_with(4.0)}
    assert score_baseline(grids, START, S).contributing_points == ("moved",)
    assert contributing_points({"a": 0.0}) == ()


def test_contributing_points_are_returned_when_the_score_is_skipped():
    grid = grid_with(1000.0)
    grid[-1 - 672 : -1 - 300] = NAN
    outcome = score_baseline({"p": grid}, START, S)
    assert outcome.skip_reason == SKIP_REFERENCE_TOO_SPARSE
    assert outcome.contributing_points == ("p",)


# --- reference minimum -----------------------------------------------------------


def reference_of(n: int) -> np.ndarray:
    grid = grid_with(1000.0)
    grid[-1 - 672 : -1 - n] = NAN
    return grid


def test_a_reference_of_335_is_too_sparse():
    outcome = score_baseline({"p": reference_of(335)}, START, S)
    assert (outcome.score, outcome.skip_reason, outcome.reference_size) == (
        None,
        SKIP_REFERENCE_TOO_SPARSE,
        335,
    )


def test_a_reference_of_336_scores():
    outcome = score_baseline({"p": reference_of(336)}, START, S)
    assert (outcome.score, outcome.skip_reason, outcome.reference_size) == (1.0, None, 336)


# --- input checks ---------------------------------------------------------------


def test_inputs_are_checked():
    with pytest.raises(ValueError):
        score_baseline({}, START, S)
    with pytest.raises(ValueError):
        score_baseline({"p": grid_with(0.0)}, START.replace(tzinfo=None), S)
    with pytest.raises(ValueError):
        score_baseline({"p": grid_with(0.0)}, START + timedelta(minutes=30), S)
    with pytest.raises(ValueError):
        score_baseline({"p": grid_with(0.0), "q": jitter(10)}, START, S)
    with pytest.raises(ValueError):
        score_baseline({"p": grid_with(0.0)}, START, S + timedelta(hours=1))
    with pytest.raises(ValueError):
        score_baseline({"p": grid_with(0.0)}, START, START - timedelta(hours=1))
