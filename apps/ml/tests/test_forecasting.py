import numpy as np
import pytest

from bms_ml.forecasting import (
    QUANTILES,
    Forecaster,
    ForecastShapeError,
    NoModelError,
    finalise_quantiles,
    installed_model,
    load_forecaster,
)
from tests.fakes import FakeForecaster


def test_quantiles_are_p10_p50_p90():
    assert QUANTILES == (0.1, 0.5, 0.9)


def test_the_fake_satisfies_the_protocol():
    forecaster: Forecaster = FakeForecaster()
    assert forecaster.predict([np.array([1.0, 2.0])], 4).shape == (1, 4, 3)


def test_a_crossing_is_repaired_by_sorting_each_bucket():
    raw = np.array([[[3.0, 1.0, 2.0], [5.0, 5.0, 4.0]]])
    ordered, ok = finalise_quantiles(raw, 1, 2)
    assert ordered.tolist() == [[[1.0, 2.0, 3.0], [4.0, 5.0, 5.0]]]
    assert ok.tolist() == [True]


@pytest.mark.parametrize("bad", [np.nan, np.inf, -np.inf])
def test_a_non_finite_value_refuses_only_that_point(bad):
    raw = np.ones((3, 2, 3))
    raw[1, 1, 2] = bad
    ordered, ok = finalise_quantiles(raw, 3, 2)
    assert ok.tolist() == [True, False, True]
    assert ordered.shape == (3, 2, 3)


@pytest.mark.parametrize(
    ("shape", "n", "horizon"),
    [
        ((2, 4, 3), 3, 4),  # wrong point count
        ((3, 5, 3), 3, 4),  # wrong horizon
        ((3, 4, 9), 3, 4),  # nine quantiles
        ((3, 4), 3, 4),  # missing quantile axis
    ],
)
def test_the_shape_is_checked(shape, n, horizon):
    with pytest.raises(ForecastShapeError):
        finalise_quantiles(np.zeros(shape), n, horizon)


def test_the_input_is_not_modified():
    raw = np.array([[[3.0, 1.0, 2.0]]])
    finalise_quantiles(raw, 1, 1)
    assert raw.tolist() == [[[3.0, 1.0, 2.0]]]


def test_this_build_installs_no_model():
    with pytest.raises(NoModelError, match="no model installed in this build"):
        load_forecaster("/opt/bms-ml/model")
    with pytest.raises(NoModelError, match="no model installed in this build"):
        installed_model("/opt/bms-ml/model")
