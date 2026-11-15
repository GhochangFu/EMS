"""The Chronos adapter without weights: stub pipelines, the MODEL.json identity, and the import rule."""

import ast
import json
from pathlib import Path

import numpy as np
import pytest
import torch

from bms_ml.chronos_model import ChronosForecaster, stack_bolt, stack_chronos2
from bms_ml.forecasting import QUANTILES, NoModelError, installed_model

SRC = Path(__file__).resolve().parents[1] / "src" / "bms_ml"
CHRONOS_2 = ("amazon/chronos-2", "29ec3766d36d6f73f0696f85560a422f50e8498c")
BOLT = ("amazon/chronos-bolt-small", "772f3d25d38aec6d914c8949dab4462e2d46f5d8")


class StubChronos2:
    """predict_quantiles returns a list of (1, H, Q) tensors, as Chronos2Pipeline does."""

    def __init__(self):
        self.calls = []

    def predict_quantiles(self, inputs, prediction_length, quantile_levels, **kwargs):
        self.calls.append((inputs, prediction_length, quantile_levels, kwargs))
        out = [torch.arange(prediction_length * 3, dtype=torch.float32).reshape(1, prediction_length, 3) + i
               for i, _ in enumerate(inputs)]  # fmt: skip
        return out, [o[..., 1] for o in out]


class StubBolt:
    """predict_quantiles returns one (n, H, Q) tensor, as ChronosBoltPipeline does."""

    def __init__(self):
        self.calls = []

    def predict_quantiles(self, inputs, prediction_length, quantile_levels, **kwargs):
        self.calls.append((inputs, prediction_length, quantile_levels, kwargs))
        out = torch.zeros(len(inputs), prediction_length, 3)
        return out, out[..., 1]


def contexts():
    return [np.array([1.0, np.nan, 3.0]), np.array([5.0] * 10), np.array([np.nan, 2.0])]


def test_stack_chronos2_list_of_1xHxQ_to_nxHxQ():
    stacked = stack_chronos2([torch.ones(1, 4, 3), torch.zeros(1, 4, 3)])
    assert stacked.shape == (2, 4, 3) and stacked.dtype == np.float64
    assert stacked[0].sum() == 12 and stacked[1].sum() == 0


def test_stack_chronos2_refuses_a_multivariate_output():
    with pytest.raises(ValueError):
        stack_chronos2([torch.ones(2, 4, 3)])


def test_stack_bolt_tensor_to_array():
    assert stack_bolt(torch.ones(3, 4, 3)).shape == (3, 4, 3)


@pytest.mark.parametrize(("stub", "kind"), [(StubChronos2, "chronos2"), (StubBolt, "bolt")])
def test_predict_passes_the_contract_to_the_pipeline(stub, kind):
    pipeline = stub()
    forecaster = ChronosForecaster(pipeline, kind, "amazon/x", "a" * 40)
    out = forecaster.predict(contexts(), 4)
    assert out.shape == (3, 4, 3)
    ((inputs, horizon, levels, kwargs),) = pipeline.calls
    assert horizon == 4
    assert levels == list(QUANTILES)
    assert kwargs == {"limit_prediction_length": True}
    # Gaps reach the model as NaN, never as a number (Amendment 1 decision 3).
    first = np.asarray(inputs[0], dtype=np.float64)
    assert np.isnan(first[1]) and first[0] == 1.0 and first[2] == 3.0
    assert [len(x) for x in inputs] == [3, 10, 2]


def test_name_and_version_are_the_baked_identity():
    forecaster = ChronosForecaster(StubBolt(), "bolt", *BOLT)
    assert (forecaster.name, forecaster.version) == BOLT


def _model_dir(tmp_path, content):
    (tmp_path / "MODEL.json").write_text(
        json.dumps(content) if isinstance(content, dict) else content, "utf-8"
    )
    return str(tmp_path)


@pytest.mark.parametrize("identity", [CHRONOS_2, BOLT])
def test_installed_model_reads_model_json(tmp_path, identity):
    assert installed_model(_model_dir(tmp_path, {"repo": identity[0], "revision": identity[1]})) == identity


@pytest.mark.parametrize(
    "content",
    [
        {"repo": "amazon/chronos-2", "revision": "main"},
        {"repo": "amazon/chronos-2", "revision": "29EC3766D36D6F73F0696F85560A422F50E8498C"},
        {"repo": "salesforce/moirai", "revision": "a" * 40},
        {"repo": "amazon/chronos-2"},
        "not json",
    ],
)
def test_installed_model_refuses_a_bad_identity(tmp_path, content):
    with pytest.raises(NoModelError):
        installed_model(_model_dir(tmp_path, content))


def test_installed_model_refuses_an_empty_directory(tmp_path):
    with pytest.raises(NoModelError, match="no model installed"):
        installed_model(str(tmp_path))


HEAVY = ("torch", "chronos", "transformers", "accelerate", "huggingface_hub", "safetensors")


def heavy_importers() -> set[str]:
    found = set()
    for path in SRC.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text("utf-8"))):
            names = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            if any(name.split(".")[0] in HEAVY for name in names):
                found.add(path.relative_to(SRC).as_posix())
    return found


def test_only_chronos_model_imports_torch_or_chronos():
    # serve is a light parent (plan R11): nothing it imports may pull torch in.
    assert heavy_importers() == {"chronos_model.py"}
