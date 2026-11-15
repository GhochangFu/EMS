# ADR 0135 — ML serving foundation: a self-built Python scoring service on open models

## Status

**Proposed — 2026-11-15.** Drafted by an agent for backlog row `E1.1` from an
owner request on 2026-11-15. Lines marked *(owner, 2026-11-15)* are owner
statements made in chat; lines marked *(recommended)* are the agent's calls and
become rulings only if the owner accepts the ADR with them as written. Open
questions are listed at the end.

Builds on [ADR 0023](./0023-telemetry-continuous-aggregates.md) (the `_1h` and
`_1d` aggregates are the model input), [ADR 0043](./0043-multi-tenant-architecture.md)
/ [ADR 0045](./0045-non-superuser-table-owner.md) (tenant tables under RLS),
[ADR 0030](./0030-shared-api-contracts.md) (response contracts) and
[ADR 0063](./0063-bullmq-job-queue-and-worker-process.md) (the worker process). Adds **one new
app** (`apps/ml`, Python), **one** read-only CLI in `packages/db`, and **no**
npm dependency. The tables in decision 4 come with a later migration in the
build, not with this ADR.

## Context

`E1.1` is the foundation that every ML row waits on: `E1.2` anomaly,
`E1.4` forecasting, `E1.5` RUL, `E1.6` advisories and `E1.8` the ML health
score. Its row says *"ADR first (stack choice)"*. The stack stayed open because
of client answer A2 (*"AI algos can be IEIL scope; REST API enabled"*), and the
backlog asked this ADR to carry both call directions until A2 closed.

**A2 is now closed the other way.** Ion Exchange will provide no models and no
REST API; we build our own or use open-source models *(owner, 2026-11-15)*.
So this ADR picks a stack instead of an integration surface.

Facts that shape the choice:

- **The input is already summarized.** `telemetry.point_values_1h` / `_1d`
  hold `sum/count/min/max` per `(asset_id, point_key, bucket)`. Hourly scoring
  of aggregates is a small CPU workload. Raw-sample scoring is not needed for
  any row in the ML track.
- **The open forecasting models are Python-only.** Chronos (Amazon, Apache
  2.0), TimesFM (Google, Apache 2.0) and BatteryML (Microsoft, MIT) ship as
  Python packages on PyTorch. None has a maintained Node runtime.
- **Foundation models are strong at forecasting, not at anomaly detection.**
  An ICLR 2026 study of MOMENT, Chronos, TimesFM, Time-MoE and TSPulse found
  that their reconstruction- and forecast-based anomaly assumptions do not
  hold. Simple statistical baselines match or beat them.
- **Most history is simulated.** Only RTUs with `ingest_enabled` carry field
  data. A model trained on `apps/sim` output learns the simulator's formulas.
  How much real history exists per asset class has not been measured, so
  decision 8 measures it first.

## Decision

1. **Self-built, open models only** *(owner, 2026-11-15)*. No hosted model API
   and no client-supplied model. A model is admitted only if its **code and
   weights** carry a licence that allows commercial use (Apache 2.0, MIT, BSD).
   *(recommended)* Salesforce Moirai is **excluded until its weight licence is
   confirmed**, because some of its released weights are non-commercial.

2. **A new app, `apps/ml`, in Python 3.12** *(recommended)*. It is a
   **batch scorer, not a web service**: a long-running process that wakes on a
   schedule, reads aggregates, scores, writes results and sleeps. It has no
   HTTP API apart from `GET /health`. The NestJS API stays the only thing the
   browser talks to. Python is chosen because decision 5's models exist only
   there (see *Context*).

3. **Database access is the contract** *(recommended)*. `apps/ml` reads
   `telemetry.point_values_1h` / `_1d`, `bms.assets`, `bms.asset_points` and
   `bms.asset_templates`, and writes only the `ml.*` tables in decision 4. It
   **never runs DDL**: Drizzle migrations in `packages/db` stay the only schema
   owner, and `apps/ml` fails at start-up if the `ml` schema version it expects
   is absent. It connects as a **new role `bms_ml`** with `SELECT` on those
   inputs and `INSERT/UPDATE` on `ml.*` only. It does not use `bms_fleet`,
   because `bms_fleet`'s write grants are wider than a scorer needs.

4. **Three tenant tables in a new `ml` schema** *(recommended)*, each with
   `organization_id` under RLS (ADR 0043 decision 5):
   - `ml.model_runs` — one row per scoring run: model name, model version
     (Hugging Face revision or package version), config hash, started/finished,
     rows written, status, error text (no payloads, §9.6).
   - `ml.forecasts` — `(asset_id, point_key, horizon_bucket, issued_at)` →
     `p10`, `p50`, `p90`, `model_run_id`.
   - `ml.anomaly_scores` — `(asset_id, bucket, detector)` → `score` (0..1),
     `contributing_points` (top point keys), `model_run_id`.
   Retention follows `_1h` (ADR 0023 decision 7). A row is never rewritten in
   place; a re-run writes new rows under a new `model_run_id`.

5. **First models, by job** *(recommended)*:

   | Job | Row | Model | Why |
   |---|---|---|---|
   | Demand forecasting (energy, water, chemicals) | `E1.4` | **Chronos-2**, falling back to **Chronos-Bolt** if CPU time is too high | Zero-shot: works without training on our data; accepts covariates |
   | Early anomaly, per asset class | `E1.2` | **Robust baseline** (median/MAD by hour-of-week per point) + **Isolation Forest** (scikit-learn) over each asset's points together | Matches the study above; cheap; explainable per point |
   | Battery / UPS health | later `E1.x` | **BatteryML** features | Only once decision 8 shows the signals exist |
   | RUL | `E1.5` | **Not chosen here** | Needs failure history from `E3.1` work orders; decided in its own ADR |

   A detector is **advisory**: an anomaly score does **not** raise an alarm in
   `bms.alarms` under this ADR. Routing scores into the alarm lifecycle is
   `E1.2`'s decision, made once real scores have been looked at.

6. **CPU only** *(recommended)*. No GPU instance is provisioned. A first
   production size is **one 4 vCPU / 16 GB instance** for `apps/ml`. That is
   about USD 150 a month on demand in ap-south-1 (an unverified list-price
   estimate), against about USD 1,494 for the smallest tier in
   `docs/aws-capacity-and-cost-plan-2026-08-30.html`. Fine-tuning on a GPU, if
   ever needed, is rented by the hour and is outside this ADR.

7. **Model versions are pinned, not downloaded at run time** *(recommended)*.
   Weights are fetched at **image build** by exact Hugging Face revision and
   baked into the `apps/ml` image. A running scorer makes no outbound call.
   `ml.model_runs` is the registry for now. MLflow or a similar registry is
   **deferred** until there is more than one version of a model to compare.

8. **Step 0: measure the data before building models.**
   `pnpm --filter @bms/db ml:readiness`
   (`packages/db/src/ml-data-readiness-cli.ts`, rules in
   `ml-data-readiness.ts` with a spec) is a read-only report. For each
   `domain × asset_type × (real | simulated)` it gives assets, points, days of
   `_1h` history, hourly coverage, the battery signal families present and the
   closed work-order count. For each job it gives a READY / PARTIAL / NOT READY
   verdict. Simulator data is never READY. It connects as
   `DATABASE_URL_FLEET` because the report spans organizations, and runs one
   `SELECT` in a `READ ONLY` transaction. **The first models are built for
   whichever asset class it shows READY first**. The plan's assumption is
   pumps, which needs confirming.

9. **Scope of `E1.1` under this ADR**: decisions 2–4 and 7, plus one model
   from decision 5 (forecasting, the one that needs no training) running end
   to end on one READY asset class. Reading the scores through the API
   (`apps/api/src/ml/`, Zod contracts in `packages/shared/src/contracts/`) and
   any screen are **`E1.4` / `E1.2`'s**. They are not this row's.

## Dependencies

- **No npm package.** The readiness CLI uses `pg` and `tsx`, which
  `packages/db` already has.
- **New Python toolchain in `apps/ml`**, the first non-Node app in the repo
  *(recommended)*. Managed with `uv`, using a committed `uv.lock` with hashes.
  First packages: `chronos-forecasting`, `torch` (CPU wheel), `numpy`,
  `pandas`, `scikit-learn`, `psycopg[binary]`. Exact versions are pinned in the
  lockfile at build time. Each later package needs this ADR amended, the same
  way §9.4 gates an npm package.
- **CI** gains a Python job (`uv sync --frozen`, `pytest`, `ruff`). The pnpm
  pipeline is untouched.

## Consequences

- A second language in the monorepo, with its own lint, test and image. The
  `.claude/hooks` dependency gate watches `package.json`, so it **does not see
  `uv.lock`**. Extending the gate is follow-up work owed before the first
  Python dependency lands.
- The `apps/ml` image is large (PyTorch CPU plus weights, roughly 1–2 GB). The
  build is slower; the running cost is not affected.
- Scores are written to tables, not pushed. The UI sees them on its next
  read, at the scoring cadence (hourly). Live per-sample anomaly detection is
  **not** delivered by this design and would need a new ADR.
- Simulator-only asset classes can test the pipeline but cannot validate a
  model. Until decision 8 shows real history, accuracy claims are not made.
- **Follow-ups owed** (not done by this ADR): AGENTS.md §2 *Stack* and §3
  *Layout* gain `apps/ml` and the `bms_ml` role through a `chore(agents):` PR
  (§9.10). The `E1.1` backlog row's A2 note is replaced by this ADR. The
  roadmap row flips when the build starts. This is **not a §6 promotion**: no
  §6 line names ML.

## Open questions for the owner

1. **Python as a second language** (decision 2). The alternative is ONNX models
   run from Node. That keeps one language, but Chronos and BatteryML would have
   to be exported and kept in step by hand.
2. **A dedicated `bms_ml` role** (decision 3), or reuse `bms_fleet` for the
   first build, as the ingest host still does (`bms_ingest` is owed there too).
3. **Anomaly stays advisory** (decision 5). Confirm no alarm is raised from a
   score until `E1.2`.
4. **Which asset class first.** This waits on the decision 8 report from a
   database with real pilot data.
