"""The Isolation Forest wrapper (plan T1.4, section 4.4)."""

import numpy as np

from bms_ml import anomaly_forest as af


def cloud(rows=400, cols=3, seed=1):
    return np.random.default_rng(seed).normal(size=(rows, cols))


def spy_on_score_samples(monkeypatch):
    calls = []
    real = af.IsolationForest

    class Spy(real):
        def score_samples(self, X):
            out = super().score_samples(X)
            calls.append(out.copy())
            return out

    monkeypatch.setattr(af, "IsolationForest", Spy)
    return calls


def test_constructor_receives_exactly_the_spec_kwargs(monkeypatch):
    seen = []
    real = af.IsolationForest

    def spy(**kwargs):
        seen.append(kwargs)
        return real(**kwargs)

    monkeypatch.setattr(af, "IsolationForest", spy)
    af.score_hour(cloud(), np.zeros(3))
    assert seen == [
        {
            "n_estimators": 100,
            "max_samples": 256,
            "contamination": "auto",
            "max_features": 1.0,
            "bootstrap": False,
            "n_jobs": 1,
            "random_state": 135,
            "warm_start": False,
        }
    ]
    assert af.FOREST_KWARGS == seen[0]


def test_two_fits_on_the_same_data_give_the_same_statistics(monkeypatch):
    calls = spy_on_score_samples(monkeypatch)
    data, row = cloud(), np.array([0.5, -0.2, 1.0])
    first = af.score_hour(data, row)
    second = af.score_hour(data, row)
    assert first == second
    assert len(calls) == 4
    np.testing.assert_array_equal(calls[0], calls[2])
    np.testing.assert_array_equal(calls[1], calls[3])


def test_a_row_far_outside_the_cloud_scores_one():
    assert af.score_hour(cloud(), np.array([50.0, 50.0, 50.0])).score == 1.0


def test_identical_rows_score_zero_ties_count_strictly_below():
    data = np.full((400, 2), 7.0)
    assert af.score_hour(data, np.array([7.0, 7.0])).score == 0.0


def test_the_statistic_is_minus_score_samples(monkeypatch):
    calls = spy_on_score_samples(monkeypatch)
    row = np.array([2.0, 2.0, 2.0])
    result = af.score_hour(cloud(), row)
    reference, current = calls
    expected = np.count_nonzero(-reference < -current[0]) / reference.size
    assert result.score == expected
    assert 0.0 < result.score < 1.0


def test_rows_with_a_missing_value_are_not_training_rows():
    data = cloud(rows=400)
    data[:65, 1] = np.nan  # 335 complete rows left
    assert af.score_hour(data, np.zeros(3)).skip_reason == "if_too_few_rows"


def test_a_row_with_a_gap_is_not_filled_to_reach_the_minimum():
    data = cloud(rows=336)
    assert af.score_hour(data, np.zeros(3)).score is not None
    data[0, 0] = np.nan
    assert af.score_hour(data, np.zeros(3)).skip_reason == "if_too_few_rows"


def test_335_rows_skip_and_336_score():
    assert af.score_hour(cloud(rows=335), np.zeros(3)) == af.ForestResult(skip_reason="if_too_few_rows")
    assert af.score_hour(cloud(rows=336), np.zeros(3)).score is not None


def test_an_incomplete_scored_hour_skips():
    result = af.score_hour(cloud(), np.array([0.0, np.nan, 0.0]))
    assert result == af.ForestResult(skip_reason="if_incomplete_hour")


def test_the_version_is_scikit_learns():
    import sklearn

    assert af.SKLEARN_VERSION == sklearn.__version__
