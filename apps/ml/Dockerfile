# apps/ml — the batch scorer (ADR 0135; plan T4.3). Build context is the repo
# root, like every image here: docker build -f apps/ml/Dockerfile .
#
# Stages:
#   uv          the uv binary at the version that wrote apps/ml/uv.lock
#   deps        the locked environment (no dev group), then the package itself
#   weights     the model at an exact Hugging Face revision, plus MODEL.json
#   base        what runs: the venv, the weights, offline, non-root
#   model-test  base + pytest + tests/, for CI's `--network none` model check
#   runtime     the image that ships (final stage, identical to base)
#
# Decision 7: weights are fetched here, at build time, by exact revision, and a
# running scorer makes no outbound call. HF_HUB_OFFLINE and TRANSFORMERS_OFFLINE
# make a missing file fail loudly instead of being fetched. Both models are
# ungated, so no token is ever passed (tests/e1.1-ml-image.test.ts).

FROM ghcr.io/astral-sh/uv:0.8.13 AS uv

FROM python:3.12.13-slim-bookworm AS deps
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/bms-ml/venv
WORKDIR /build
COPY apps/ml/pyproject.toml apps/ml/uv.lock apps/ml/README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/ml/src ./src
RUN uv sync --frozen --no-dev --no-editable

FROM deps AS weights
# Amendment 2 ruling 5: Chronos-2 unless one cycle exceeds 300 s at --cpus 2 or
# the first host's memory limit; then amazon/chronos-bolt-small at
# 772f3d25d38aec6d914c8949dab4462e2d46f5d8. Change both ARGs together, and the
# build record in ADR 0135 with them.
ARG ML_MODEL_REPO=amazon/chronos-2
ARG ML_MODEL_REVISION=29ec3766d36d6f73f0696f85560a422f50e8498c
RUN case "$ML_MODEL_REPO" in amazon/chronos-2|amazon/chronos-bolt-small) ;; \
      *) echo "ML_MODEL_REPO is not on the ADR 0135 allowlist" >&2; exit 1 ;; esac \
 && echo "$ML_MODEL_REVISION" | grep -Eq '^[0-9a-f]{40}$' \
      || { echo "ML_MODEL_REVISION must be a 40-hex commit, never a branch" >&2; exit 1; }
RUN /opt/bms-ml/venv/bin/python -c "import json, os, shutil; \
from huggingface_hub import snapshot_download; \
target = '/opt/bms-ml/model'; \
snapshot_download(repo_id=os.environ['ML_MODEL_REPO'], revision=os.environ['ML_MODEL_REVISION'], \
                  local_dir=target, allow_patterns=['config.json', 'model.safetensors']); \
shutil.rmtree(os.path.join(target, '.cache'), ignore_errors=True); \
open(os.path.join(target, 'MODEL.json'), 'w').write(json.dumps( \
    {'repo': os.environ['ML_MODEL_REPO'], 'revision': os.environ['ML_MODEL_REVISION']}))"

FROM python:3.12.13-slim-bookworm AS base
RUN groupadd --system --gid 10001 bmsml \
 && useradd --system --uid 10001 --gid bmsml --no-create-home --shell /usr/sbin/nologin bmsml
COPY --from=deps /opt/bms-ml/venv /opt/bms-ml/venv
COPY --from=weights /opt/bms-ml/model /opt/bms-ml/model
ENV PATH=/opt/bms-ml/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    ML_MODEL_DIR=/opt/bms-ml/model
WORKDIR /opt/bms-ml
USER bmsml
HEALTHCHECK --interval=60s --timeout=10s --start-period=60s --retries=3 \
  CMD ["python", "-m", "bms_ml", "health"]
ENTRYPOINT ["python", "-m", "bms_ml"]
CMD ["serve"]

FROM base AS model-test
USER root
COPY --from=uv /uv /usr/local/bin/uv
COPY apps/ml/pyproject.toml apps/ml/uv.lock /opt/bms-ml/project/
RUN cd /opt/bms-ml/project \
 && UV_PROJECT_ENVIRONMENT=/opt/bms-ml/venv UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy \
    uv sync --frozen --inexact --no-install-project --only-group dev
COPY apps/ml/tests /opt/bms-ml/tests
USER bmsml
ENV ML_REQUIRE_MODEL=1
ENTRYPOINT ["python", "-m", "pytest", "-p", "no:cacheprovider", "--rootdir", "/opt/bms-ml", \
            "-c", "/opt/bms-ml/project/pyproject.toml", "-W", "error::pytest.PytestUnknownMarkWarning"]
CMD ["-m", "model", "/opt/bms-ml/tests"]

FROM base AS runtime
