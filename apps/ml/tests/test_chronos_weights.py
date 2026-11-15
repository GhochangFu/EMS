"""The real model, from the weights baked at ML_MODEL_DIR (plan T4.2), marked `model`.

Skipped when ML_MODEL_DIR holds no MODEL.json, unless ML_REQUIRE_MODEL=1: the
image-build step in CI sets it and runs these inside the built image with
`--network none`, so a missing or incomplete bake fails the build instead of
skipping (the asymmetric rule of AGENTS.md §4.6).
"""

import os
import socket
from pathlib import Path

import numpy as np
import pytest

from bms_ml.forecasting import load_forecaster

pytestmark = pytest.mark.model
MODEL_DIR = os.environ.get("ML_MODEL_DIR", "/opt/bms-ml/model")


@pytest.fixture(scope="module")
def forecaster():
    if not (Path(MODEL_DIR) / "MODEL.json").is_file():
        if os.environ.get("ML_REQUIRE_MODEL") == "1":
            pytest.fail(f"ML_REQUIRE_MODEL=1 but {MODEL_DIR} holds no MODEL.json", pytrace=False)
        pytest.skip(f"no model baked at {MODEL_DIR}")
    return load_forecaster(MODEL_DIR)


def series(hours: int, gaps: bool = False) -> np.ndarray:
    t = np.arange(hours, dtype=np.float64)
    values = 4.0 + np.sin(t / 24 * 2 * np.pi) + 0.1 * np.cos(t / 168 * 2 * np.pi)
    if gaps:
        for day in range(15):
            values[day * 24 + 1 : day * 24 + 6] = np.nan
    return values


def test_shape_for_three_contexts_of_different_lengths(forecaster):
    out = forecaster.predict([series(400), series(1344), series(2016)], 48)
    assert out.shape == (3, 48, 3)
    assert np.isfinite(out).all()


def test_a_context_with_nan_gaps_returns_finite_quantiles(forecaster):
    out = forecaster.predict([series(1440, gaps=True)], 48)
    assert np.isfinite(out).all()
    # A daily sine around 4: the median stays near the level it was given.
    assert 2.0 < float(np.median(out[0, :, 1])) < 6.0


def test_the_same_input_twice_gives_the_same_output(forecaster):
    contexts = [series(1000), series(700, gaps=True)]
    assert np.array_equal(forecaster.predict(contexts, 24), forecaster.predict(contexts, 24))


def test_load_and_predict_with_the_network_refused(monkeypatch):
    if not (Path(MODEL_DIR) / "MODEL.json").is_file():
        if os.environ.get("ML_REQUIRE_MODEL") == "1":
            pytest.fail(f"ML_REQUIRE_MODEL=1 but {MODEL_DIR} holds no MODEL.json", pytrace=False)
        pytest.skip(f"no model baked at {MODEL_DIR}")

    def refuse(*_args, **_kwargs):
        raise OSError("network refused by the test")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    monkeypatch.setenv("TRANSFORMERS_OFFLINE", "1")
    fresh = load_forecaster(MODEL_DIR)
    assert fresh.predict([series(500)], 8).shape == (1, 8, 3)
