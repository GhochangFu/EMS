# ADR 0135 — ML serving foundation: a self-built Python scoring service on open models

## Status

**Accepted — 2026-11-15** (owner, in chat: "accepted, mark ADR 0135
accepted"; proposed the same day). Drafted by an agent for backlog row `E1.1`
from an owner request on 2026-11-15. Lines marked *(owner, 2026-11-15)* are
owner statements made in chat. Lines marked *(recommended)* were the agent's
calls; the owner accepted the ADR with them as written, so **every
*(recommended)* line is now a ruling**, question 4's included. The owner ruled
open questions 1–3 in chat before accepting; those rulings are folded into
decisions 2, 3 and 5.

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

2. **A new app, `apps/ml`, in Python 3.12** *(owner, 2026-11-15: "go with
   Python"; ONNX run from Node was the alternative and is rejected)*. It is a
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
   is absent. It connects as **`bms_fleet`** *(owner, 2026-11-15: "reuse
   bms_fleet")*, the role the worker and the ingest host already use, through
   `DATABASE_URL_FLEET`. The migration grants `bms_fleet` `SELECT` and
   `INSERT` on `ml.*`. A dedicated `bms_ml` role, limited to the reads above
   and writes on `ml.*`, is **owed rather than dropped**, the same way
   `bms_ingest` is owed for the ingest host. Until it exists, `apps/ml`'s
   database layer contains only `SELECT` statements on its inputs and
   `INSERT` statements on `ml.*`, and a test holds that, because the role
   itself does not.

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

   A detector is **advisory** *(owner, 2026-11-15: "keep anomaly advisory")*:
   an anomaly score does **not** raise an alarm in `bms.alarms`, notify
   anyone, or open a work order. Routing scores into the alarm lifecycle needs
   its own amendment or ADR, made once real scores have been looked at.

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

   **First run, 2026-11-15** (on `bms.demosites.co.in` through the read-only
   API; the session had no database access): [`docs/plans/ml-data-readiness-2026-11-15.txt`](../plans/ml-data-readiness-2026-11-15.txt).
   Six classes hold real data and fifteen are simulator-only.
   - **PHEWB pumping stations**: energy meters, pump breakers, chlorine pumps
     and RTU health, 5 assets each. They have 40 days of history (from
     2026-10-07) at 99–100 % hourly coverage. Anomaly detection is **READY**;
     forecasting is **PARTIAL** until about 2026-12-02, when they reach 56 days.
   - **BCPL water flow meters** (21) and **WBLDC cold rooms** (19) have only
     7–8 days. They are **NOT READY** for anything yet. They pass 28 days
     around 2026-12-06. *WBLDC superseded the same day by Amendment 1: after
     a history import, the cold rooms are READY for both jobs.*
   - Battery health is **NOT READY** everywhere: no real asset carries battery
     voltage or temperature, and every UPS asset is simulated.
   - RUL is **NOT READY** everywhere: no real asset has a closed work order.

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
  *Layout* gain `apps/ml` (and `bms_fleet` as its role) through a `chore(agents):` PR
  (§9.10). The `E1.1` backlog row's A2 note is replaced by this ADR. The
  roadmap row flips when the build starts. This is **not a §6 promotion**: no
  §6 line names ML.

## Open questions for the owner (all ruled)

1. ~~Python as a second language~~: **ruled 2026-11-15, Python** (decision 2).
2. ~~A dedicated `bms_ml` role~~: **ruled 2026-11-15, reuse `bms_fleet`**;
   `bms_ml` is owed (decision 3).
3. ~~Anomaly stays advisory~~: **ruled 2026-11-15, advisory** (decision 5).
4. ~~Which asset class first~~: **ruled 2026-11-15 by acceptance, PHEWB
   pumping stations first.** WBLDC cold rooms may join if their MySQL history
   import brings them past 28 days. *They did (Amendment 1): WBLDC cold rooms
   join PHEWB as a first class.* The decision 8 run *(recommended)* points to
   the **PHEWB pumping stations**, the only real data with enough history. The
   model would be anomaly detection on energy meter and pump signals, with
   Chronos forecasting added as the history grows past 56 days.

## Amendment 1 — WBLDC cold-room history import (2026-11-15)

**What changed.** The owner imported the WBLDC cold rooms' past readings from
the WBLDC MySQL database into `bms.demosites.co.in` on 2026-11-15. The import
ran from a session on the owner's own computer, because the connector route
did not work and cloud sessions cannot reach that MySQL server. It used the
existing `F1.9` import (`/admin/telemetry/import`) and followed
[`docs/plans/wbldc-history-import.md`](../plans/wbldc-history-import.md), with
these owner rulings:

- **Window:** 4 months, from 2026-07-09 00:00 IST to each room's first live
  day (exclusive), the same window for every room. Old and live data do not
  overlap.
- **Volume:** 15-minute averages rather than 1-minute, because the importer
  caps a file at 20,000 rows. That gave 168,877 rows in 9 files, 0 rejected.
- **Values:** `attribute_value_clibrated` (raw plus each sensor's offset),
  which matches the live points' `scale_offset`.
- **Time:** device time, IST.
- **Source gaps:** the WBLDC server clock ran on UTC from 2026-07-08 to
  2026-07-23, so each of those 15 days has a 5.5 h gap. The VAP device has no
  source data from 2026-06-04 to 2026-10-14.
- **Dropped:** PORK device rows with a 1970 clock, 5 GOAT dropout minutes,
  and 252 VAP_Blast_Freezer_2 readings above 50 °C. Same-minute duplicates
  were averaged.

**Re-run** (read-only API, same rules; hourly coverage measured over each
point's full span, as the CLI's SQL does):
[`docs/plans/ml-data-readiness-2026-11-15-wbldc.txt`](../plans/ml-data-readiness-2026-11-15-wbldc.txt).

| WBLDC cold rooms | Days | Hourly coverage |
|---|---|---|
| GOAT (4 rooms) | 130 | 96.9 % |
| CHK (7) | 117 | 85.1 % |
| PORK (5) | 113 | 81.9 % |
| VAP_Chiller_Room_3, VAP_Deep_Freezer_2 | 33 | 97.3 % |
| VAP_Blast_Freezer_2 | 17 | 17.1 % |

As a class this gives 130 days and 84 % coverage, so **forecasting and
anomaly detection are both READY**. RUL stays NOT READY (no closed work
orders).

**Decisions:**

1. **WBLDC cold rooms join the PHEWB pumping stations as a first class**
   (question 4's condition is met). Cold rooms are the first class with enough
   history for forecasting today. PHEWB reaches 56 days around 2026-12-02.
2. **Readiness is judged per room, not only per class** *(recommended)*. The
   class verdict uses the best point's days, so it hides weak rooms. The
   scorer runs a model on a room only if that room itself meets the
   threshold. As of this run:
   - The 16 CHK, PORK and GOAT rooms take both jobs.
   - The two 33-day VAP rooms take anomaly only, until 56 days
     (about 2026-12-09).
   - VAP_Blast_Freezer_2 (17 % coverage) takes neither until live data fills
     it.
   The per-room check belongs in `apps/ml`'s input step; the readiness CLI
   stays a class-level report.
3. **The imported gaps are data, not anomalies** *(recommended)*. The anomaly
   baseline is trained only on hours that have data. The 5.5 h July gaps and
   the VAP gap are skipped rather than filled. Missing data is reported by
   device health (`F3.16`), not by `ml.anomaly_scores`.

## Amendment 2 — build-plan rulings (2026-11-15)

The step-3 plan is [`docs/plans/e1.1-ml-serving-foundation.md`](../plans/e1.1-ml-serving-foundation.md).
The owner answered its seven questions (section 15) in chat on 2026-11-15:
"accept all recommended". Each answer below is now a ruling.

1. **First host: the AWS demo host** (ADR 0096: 2 vCPU, 7.6 GiB shared).
   `apps/ml` runs there behind an opt-in `ml` compose profile, started with
   `bms-ctl ml start`, with a CPU and memory limit. Decision 6's 4 vCPU /
   16 GB instance stays the production size. This row does not provision it.
2. **PHEWB forecast target: `electrical/energy_meter/kw` only.**
   `breaker_main` and `chlorine_pump_on` are on/off states and go to the
   anomaly row (`E1.2`). The first targets are
   `facility/cold_room/cold_room_temp_c` and `electrical/energy_meter/kw`.
   A `kw` point becomes eligible on its own when it reaches 56 days (around
   2026-12-02).
3. **Decision 3's read list gains `bms.rtus`** (the "real data" rule needs
   `ingest_enabled`, as step 0 already does) **and `ml.model_runs`** (the
   check that skips an hour that is already scored).
4. **`ml.anomaly_scores` key is `(asset_id, bucket, detector, model_run_id)`.**
   Without the run id, a re-run could only overwrite, which decision 4
   forbids.
5. **Fallback rule:** Chronos-2, unless one cycle takes longer than 300 s at
   `--cpus 2` or exceeds the first host's memory limit. Then
   `chronos-bolt-small`. This widens decision 5's "CPU time" trigger to
   include memory. The choice is made from the measurement in plan PR 4 and
   recorded below in the build record.
6. **Who builds:** plan PR 1 and the static halves of PR 2 can be built in a
   cloud session. **PRs 3–5 and their checks run in a session on the owner's
   machine**, because cloud sessions cannot reach the Hugging Face Hub or the
   PyTorch wheel index and have no Docker daemon or Postgres.
7. **Volume accepted:** hourly runs with a 48 h horizon, never dropped, give
   about 8.8 M `ml.forecasts` rows a year for 21 points. Cadence or retention
   is revisited by amendment before 50 M rows, or when a class above 100
   points is targeted.

**Plan refinements adopted with the plan** (R-numbers are the plan's
section 3; the owner accepted the plan without vetoing any):

- R1: the migration creates the `ml` schema itself.
- R2: the schema version is a `COMMENT ON SCHEMA ml`
  (`bms-ml-schema-version=N`). The scorer requires `stored ≥ expected`.
- R3: plain tables, not hypertables.
- R4: `ml.model_runs` is insert-once, written in the same transaction as its
  forecasts. A failed run gets a fixed-vocabulary error, never an exception
  message.
- R5: one run row per organization per cycle. `organization_id` comes from
  `bms.assets` in SQL, and composite foreign keys enforce it.
- R6: the forecast key uses the run's start instant.
- R8: the per-point eligibility order.
- R9: 48 h horizon, 1 h buckets, hourly at HH:05, 2,016 h of context.
- R10: gaps are passed as NaN, never filled.
- R11: each cycle runs in a child process.
- R12: an hour that is already scored is skipped unless `--force` is given.
- R13: quantiles are kept in order, with a CHECK on the table.
- R14: the `ml` service sits on an internal-only network with Postgres.
- R15: the dependency gate covers `pyproject.toml` and `uv.lock`.
- R16: the `ml` CI job runs only when relevant paths change.
- R17: Python naming follows Python conventions; recorded in the
  `chore(agents):` PR.

**Build record** (to be filled as the PRs land): package pins, the model
revision SHAs and their licences (checked against decision 1), and the plan
PR 4 CPU and memory measurement that settles ruling 5.

- **Plan PR 3, package pins (2026-11-15).** Written by `uv 0.8.13` (the CI
  job installs the same version) for Python 3.12 (`apps/ml/.python-version`).
  Every artifact comes from PyPI; `apps/ml/uv.lock` holds its hash, and the
  lock has `cp312` wheels for `linux x86_64` and `linux aarch64`.
  - Build backend: `uv_build>=0.8.13,<0.9.0` (`[build-system] requires`,
    written by `uv init --package`; Apache 2.0 or MIT, from the uv project).
  - Runtime: `psycopg[binary]==3.3.9` (`psycopg 3.3.9`, `psycopg-binary
    3.3.9`, LGPL 3.0, used unmodified as a library; with `typing-extensions
    4.16.0` on Python below 3.13 and `tzdata 2026.6` on Windows only) and
    `numpy 2.5.4` (BSD-3-Clause, with bundled 0BSD, MIT, Zlib and CC0
    parts).
  - Development group, never in an image: `pytest 9.2.0` (MIT; with
    `iniconfig 2.3.1`, `packaging 26.3`, `pluggy 1.7.0`, `pygments 2.21.0`,
    and `colorama 0.4.6` on Windows only) and `ruff 0.17.5` (MIT).
  - Not yet: `torch` and `chronos-forecasting` are plan PR 4's (`pandas`
    arrives with them, transitively); `scikit-learn` is `E1.2`'s.
