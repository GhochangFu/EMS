"""The Chronos forecaster (ADR 0135 decision 5, Amendment 2 ruling 5; plan T4.2).

The only module that imports torch or chronos (`tests/test_chronos_model.py`):
`serve` stays a light parent and only a `run-once` child loads the model.

The weights are read from `ML_MODEL_DIR` with `local_files_only=True`. The
image also sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1`, so a missing
file fails loudly instead of being fetched (decision 7). Gaps reach the model
as NaN: both pipelines build their context mask from `isnan`.

The two pipelines return quantiles in different shapes. Chronos-2 returns a
list of `(n_variates, H, Q)` tensors, one per series; Chronos-Bolt returns one
`(n, H, Q)` tensor. Both become one `(n, H, Q)` array here.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
import torch

from bms_ml.forecasting import MODEL_KINDS, QUANTILES, installed_model


def stack_chronos2(quantiles: Sequence[torch.Tensor]) -> np.ndarray:
    arrays = []
    for tensor in quantiles:
        if tensor.ndim != 3 or tensor.shape[0] != 1:
            raise ValueError("Chronos-2 returned a multivariate forecast for a univariate context")
        arrays.append(tensor[0].detach().to(torch.float64).cpu().numpy())
    return np.stack(arrays)


def stack_bolt(quantiles: torch.Tensor) -> np.ndarray:
    return quantiles.detach().to(torch.float64).cpu().numpy()


class ChronosForecaster:
    def __init__(self, pipeline: Any, kind: str, name: str, version: str) -> None:
        self._pipeline = pipeline
        self._kind = kind
        self.name = name
        self.version = version

    def predict(self, contexts: Sequence[np.ndarray], horizon: int) -> np.ndarray:
        levels = list(QUANTILES)
        with torch.inference_mode():
            if self._kind == "chronos2":
                inputs = [np.asarray(context, dtype=np.float32) for context in contexts]
                quantiles, _ = self._pipeline.predict_quantiles(
                    inputs, prediction_length=horizon, quantile_levels=levels, limit_prediction_length=True
                )
                return stack_chronos2(quantiles)
            tensors = [torch.tensor(np.asarray(context, dtype=np.float32)) for context in contexts]
            quantiles, _ = self._pipeline.predict_quantiles(
                tensors, prediction_length=horizon, quantile_levels=levels, limit_prediction_length=True
            )
            return stack_bolt(quantiles)


def load(model_dir: str, threads: int | None = None) -> ChronosForecaster:
    """Load the baked model on the CPU. `threads` is ML_TORCH_THREADS."""
    repo, revision = installed_model(model_dir)
    if threads is not None:
        torch.set_num_threads(threads)
    from chronos import Chronos2Pipeline, ChronosBoltPipeline

    kind = MODEL_KINDS[repo]
    pipeline_class = Chronos2Pipeline if kind == "chronos2" else ChronosBoltPipeline
    pipeline = pipeline_class.from_pretrained(
        model_dir, local_files_only=True, device_map="cpu", torch_dtype=torch.float32
    )
    return ChronosForecaster(pipeline, kind, repo, revision)
