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
- **Plan PR 4, package pins (2026-11-15).** Same uv, same lock.
  - `torch==2.15.0` from `https://download.pytorch.org/whl/cpu`, an
    `explicit = true` index used by `torch` alone (`[tool.uv.sources]`): the
    lock holds `2.15.0+cpu` wheels for `linux x86_64`, `linux aarch64` and
    Windows, and **no `nvidia-*` or `triton` package** (decision 6;
    `tests/e1.1-ml-image.test.ts`). Licence: Apache-2.0 with bundled BSD, MIT,
    BSL-1.0, ISC and Zlib parts. The tool-time dependency hook refused the
    `explicit = true` line (uv has no flag for it); the owner approved writing
    that one line from the shell, in chat on 2026-11-15.
  - `chronos-forecasting==2.3.2` (Apache-2.0), which brings `accelerate
    1.15.0`, `transformers 5.23.0`, `huggingface-hub 2.4.0`, `safetensors
    0.8.0`, `tokenizers 0.23.3` and `hf-xet 1.8.0` (Apache-2.0), `einops
    0.8.2` (MIT) and `pandas 3.1.1` (BSD-3-Clause). Their own dependencies are
    MIT, BSD, Apache-2.0, ISC or PSF, except `tqdm 4.70.1` (MPL-2.0 and MIT, a
    file-level licence, used unmodified). The full list with versions is
    `apps/ml/uv.lock`.
- **Plan PR 4, model revisions (read from the Hub on 2026-11-15).** Both are
  ungated, so no token is needed at build time.
  - `amazon/chronos-2` at `29ec3766d36d6f73f0696f85560a422f50e8498c`,
    licence `apache-2.0` on the model card (decision 1: allowed), weights
    478 MB, `model.safetensors` sha256
    `ddcda3c7508bf2528087723e98a20707cc04b7f370ae275a9fd88078ddba4f42`.
  - `amazon/chronos-bolt-small` at `772f3d25d38aec6d914c8949dab4462e2d46f5d8`,
    licence `apache-2.0` (allowed), weights 191 MB, sha256
    `06a6a19bbe74bc10a9cd193bd4bf2bf638ae07f7e0d51653ae7ab8ea968a21dd`.
  - The image build checks the downloaded weights against the pinned sha256
    (the Hub's LFS hash, which matched a local download of each) and writes
    it into `MODEL.json`: the revision pins the tree, the hash pins the
    content.
- **Plan PR 4, the ruling 5 measurement (2026-11-15).** One `run-once --force`
  cycle per container run, the whole process timed (start, model load,
  eligibility, history, inference, write), with `--memory 2g`,
  `ML_TORCH_THREADS` equal to the CPU limit, and the integration fixture's
  class with a full 2,016-hour context. Three runs each, on the owner's
  laptop (Docker Desktop, amd64, 8 CPUs in the VM). Peak memory is the
  container's `memory.peak`.

  | Model | `--cpus` | 8 series | 21 series | Peak memory |
  |---|---|---|---|---|
  | Chronos-2 | 2 | 26–65 s | 39–66 s | 584 MB |
  | Chronos-2 | 4 | 30–38 s | 27–28 s | 546 MB |
  | Chronos-Bolt-small | 2 | 17–32 s | 18–26 s | 488 MB |
  | Chronos-Bolt-small | 4 | 13–19 s | 17–19 s | 481 MB |

  The slowest cycle (66 s, the first, with a cold cache) is under a quarter
  of ruling 5's 300 s, and no run came near the 2 GB limit, so **Chronos-2
  ships** at the revision above. The demo host is arm64 (Graviton), not
  measured here; plan PR 5 reads its first cycles' `duration_seconds` from
  the `cycle_summary` line and records them below. For the first host's
  limits (plan PR 5), Chronos-2 at `--cpus 1 --memory 1g`, read-only and
  without capabilities, 21 series: 80–149 s, peak 522 MB, three runs; the
  demo host runs it at one of its two vCPUs and 1 GiB. The image is 2.83 GB
  unpacked (amd64), above the 1–2 GB estimate in *Consequences*: PyTorch
  CPU, transformers and pandas, plus the 478 MB of weights.

  **The demo host, measured (2026-11-16).** The first live cycle on the
  arm64 (Graviton, t4g.large) host at `cpus: 1`, `mem_limit: 1g`, one torch
  thread: `duration_seconds` 33.9 for 16 series (24 eligible, 8
  `too_few_days`), 768 rows, peak 532 MiB in `docker stats`. That is
  faster than the laptop's one-CPU runs above, which held 21 series with
  a full 2,016-hour context each.

## Amendment 3 — `E1.4`: the forecast read path and its screens (2026-11-16)

**Status: Accepted — 2026-11-16** (owner, in chat: "3 is accepted"). Drafted
by an agent for backlog row `E1.4`. Lines marked *(owner, 2026-11-16)* are
owner answers given in chat that day. Lines marked *(recommended)* were the
agent's calls; the owner accepted the amendment with them as written, so
**every *(recommended)* line is now a ruling**.

**What changes.** Decision 9 gives `E1.4` the read API and the screens for
forecasts. This amendment sets their shape. It adds **no** npm or Python
package. It needs two migrations: a grant (`E1.4a`) and a widget kind
(`E1.4c`).

**Owner rulings (2026-11-16):**

1. **Form.** This amendment, not a new ADR *(owner, 2026-11-16)*.
2. **Grant.** `bms_tenant` gets `USAGE` on schema `ml` and `SELECT` on
   `ml.forecasts` and `ml.model_runs` only *(owner, 2026-11-16)*. It gets
   nothing on `ml.anomaly_scores` (that is `E1.2`'s), and no `INSERT`,
   `UPDATE`, `DELETE` or `TRUNCATE` anywhere in `ml`. `bms_auth` gets nothing.
   Migration 0157's `tenant_isolation` policies (FORCE, `organization_id`
   only, no NULL disjunct) are already in place, so the grant is safe the
   moment it lands. A global-admin or multi-organization read goes through
   `fleetDb` (`bms_fleet`), which already holds `SELECT`.
3. **Three surfaces** *(owner, 2026-11-16: "all three")*:
   - (a) the forecast on the existing trend chart of `/asset-history/:assetId`;
   - (b) a new **Forecasts** list page;
   - (c) a new `forecast` dashboard widget kind.
4. **How a forecast is drawn** *(owner, 2026-11-16)*. A shaded p10–p90 band
   and a dashed p50 line for the next 48 h, from the **latest succeeded run
   only**, with a "now" marker. A caption names the issue time, the model and
   the word "advisory" ("Forecast issued 14:05 · Chronos-2 · advisory"). A
   forecast issued more than **3 h** ago is marked **stale**. No forecast is
   drawn when the chart's range ends in the past. Past forecasts are **not**
   drawn over the actual line: that reads as an accuracy claim, which
   *Consequences* says we do not make yet.
5. **The row splits into four children** *(owner, 2026-11-16)*:

   | Child | Scope | Depends |
   |---|---|---|
   | `E1.4a` | Grant migration, Drizzle mirror, contracts, `apps/api/src/ml/` (both routes), surface (a) | `E1.1` |
   | `E1.4b` | Surface (b), the Forecasts page and its navigation item | `E1.4a` |
   | `E1.4c` | Surface (c), the `forecast` widget kind and its migration | `E1.4a` |
   | `E1.4d` | More targets in `apps/ml` (water flow, chemical dosing, utility demand) and covariates, when step 0 shows them READY. Parked ⬜; needs its own amendment when it starts | `E1.4a` |

   The `E1.4` umbrella closes when `E1.4a`–`c` are done. `E1.4d` stays open
   on its own row. `E1.6` keeps its edge on the umbrella.

**Recommended calls** *(recommended)*:

- **R-a. The Drizzle mirror.** `packages/db/src/schema/ml-schema.ts` declares
  `pgSchema("ml")` and mirrors **all three** tables exactly (columns,
  keys, checks). `drizzle.config.ts`'s `schemaFilter` gains `"ml"`. A partial
  mirror would make `drizzle-kit` read the unmirrored table as drift. The
  mirror is read-only documentation of the SQL: migrations under `ml` stay
  hand-written, as 0157 is.
- **R-b. The schema marker.** The grant migration re-issues
  `COMMENT ON SCHEMA ml IS 'bms-ml-schema-version=2'` (Amendment 2, R2). The
  scorer requires `stored ≥ expected`, so the running scorer (expects 1)
  stays valid. 0157's own proof block (bms_tenant holds no `ml` privilege)
  stays true at its own place in the chain; the tests that assert it after
  the chain ends change in `E1.4a`.
- **R-c. The API.** A new `MlModule` in `apps/api/src/ml/`, two `GET` routes:
  - `GET /ml/points/:pointRef/forecast` — the current forecast for one point.
    `pointRef` is the same `encodePointRef` value the telemetry routes take.
    A point with no current forecast returns **200** with `forecast: null`,
    not 404, so a screen shows nothing quietly.
  - `GET /ml/forecasts` — one row per forecast point the caller can read:
    site, asset, point key, unit, issue time, model name and version, the
    stale flag, the p50 minimum and maximum over the next 48 h, and the hour
    of the p50 maximum. It feeds surface (b).
  - **Access is the same as for that asset's telemetry.** One point:
    `canReadAsset`. The list: `readableAssetIds`, then
    `withReadScope` (`apps/api/src/database/tenant-read-scope.ts`) — `withTenant` for a single-organization actor,
    `fleetDb` for a global admin or a multi-organization actor (the `E7.1b`
    shape). No new permission.
  - **The read rule.** "Current" means the rows of the newest `issued_at` for
    that `(asset_id, point_key)` whose `ml.model_runs` row is `succeeded`,
    and only buckets after the hour now ends in. This **replaces** plan §14's
    `DISTINCT ON (horizon_bucket)` rule, which mixes runs. The query is
    bounded by an `issued_at` lower limit (no run older than 48 h has a future
    bucket), so it is served by `forecasts_pkey` and `model_runs_org_started_idx`.
    The `E1.4a` plan shows `EXPLAIN` for both routes. If it shows a need for an
    index, the index goes into the grant migration and is recorded here.
  - **Stale** is computed on the server from the server clock (issue time
    older than 3 h), so every surface agrees.
  - Contracts in `packages/shared/src/contracts/ml-forecasts.ts`, response
    types by `z.infer` (ADR 0030). Times are ISO UTC; screens format them in
    the site zone, as the history page does.
- **R-d. Surface (a).** `buildHistoryChartOption` gains an optional forecast
  per charted point. It is drawn only when the range ends within the last
  hour (a live preset). Colours come from role tokens (ADR 0078); no new hex.
  The legend gains "Forecast p50" and "Forecast p10–p90". The forecast is
  fetched per charted point and refetched every 15 min. There is no WebSocket
  push: the scorer writes hourly (*Consequences*).
- **R-e. Surface (b).** Route `/forecasts`. A **Forecasts** item in the
  *Operations* group after *Energy Analytics*, in `navigation-model.ts`, with
  a Lucide key in `NAV_ICONS` that no other item uses (AGENTS.md §5). Every
  signed-in user sees the item; the rows are filtered by access. The mockups
  have no forecast screen, so the page keeps the existing list language
  (§5): shared shell, `PageHeader`, a `SectionCard` table with columns
  *Site · Asset · Point · Next 48 h (p50 min–max) · Peak at · Issued ·
  Model · Status* (a Fresh / Stale pill). A row links to
  `/asset-history/:assetId` with that point charted. Empty state: "No
  forecasts yet. A point gets a forecast when it has 56 days of real data."
- **R-f. Surface (c).** A `forecast` value in `widgetTypeSchema`, config
  `{ assetId, pointKey }` (one point, the same point picker as `chart`). It
  draws the last 24 h of actual `_1h` values with the band and p50 of
  ruling 4. Its migration widens `dashboard_widgets_widget_type_check` the way
  0118 did for `trend_strip` (ADR 0108). It is in the builder palette only;
  no stock template changes (`SMOC_STANDARD_SITE_TEMPLATE` keeps its
  version). ADR 0047's widget rules apply.
- **R-g. Advisory everywhere.** Every surface says "advisory". In `E1.4` no
  alarm, notification, report, export or copilot answer carries a forecast,
  and no accuracy figure is shown.

**Review additions (2026-11-16, PR #1356 security review).** These make
R-b and R-c stricter. They change no ruling.

- **S1. The asset filter is always applied.** RLS on `ml.*` isolates by
  organization only. So every `ml.forecasts` read applies
  `asset_id = ANY(readableAssetIds)` when that list is not null, on **both**
  branches of `withReadScope`. On the `fleetDb` branch it is the only control.
  The `E1.4a` integration tests prove three cases: a location-scoped user sees
  only that location's forecasts; a multi-organization user who is not an
  admin sees no other organization's rows; a global admin sees all rows.
- **S2. The one-point route uses the guarded decoder.** It decodes
  `pointRef`, then checks that the asset id is a UUID (400), then runs
  `canReadAsset` (403), then reads. It uses the same guard as the telemetry
  routes (`decodeGuardedPointRef`, moved to a shared helper), never the bare
  decoder. `pointKey` is capped at 128 characters, the column width.
- **S3. Only named run fields go on the wire.** The contracts carry only the
  model name, the model version and the issue time from `ml.model_runs`.
  `error_text`, `config_hash` and `rows_written` are never selected.
- **S4. The pool is named.** The one-point read runs through
  `withReadScope(…, [assetId], …)` after `canReadAsset`, so a user who is not
  an admin also gets the RLS check.
- **S5. The grant migration proves itself**, with a `DO $$` block in the 0157
  style. It checks that `bms_tenant` holds `USAGE` on `ml` and `SELECT` on
  exactly `ml.forecasts` and `ml.model_runs`. It also checks that `bms_tenant`
  holds nothing on `ml.anomaly_scores` and no write privilege anywhere in
  `ml`, that `bms_auth` holds nothing, and that the marker reads
  `bms-ml-schema-version=2`.

**Review corrections (2026-11-16, PR #1356 code review).** Each one replaces
the line it names. Where a correction and an earlier line disagree, the
correction wins. They fix defects in the text; no owner ruling changes.

- **C1 (replaces R-f's config).** The `forecast` widget binds its one point
  through `bms.dashboard_widget_points`, the way `chart` does. Its point
  cardinality is `{ min: 1, max: 1 }` and its source cardinality is
  `{ min: 0, max: 0 }` (`WIDGET_POINT_CARDINALITY` /
  `WIDGET_SOURCE_CARDINALITY`). `config` holds renderer options only. This
  is ADR 0047 decision 3 ("point references are rows and foreign keys;
  options are JSON"). The `config { assetId, pointKey }` line is withdrawn.
- **C2 (adds to R-d).** The chart's x axis today ends at the request's `to`
  in two places: `asset-history-chart-option.ts` and `trend-chart.tsx`. When
  a forecast is drawn, both extend `max` to the last forecast bucket, or the
  forecast is clipped off the chart. The option and the chart have no legend
  today, so `E1.4a` adds one. On short presets (under 24 h) the axis extends
  by at most the preset's own length, so the actual line stays readable. The
  plan states the exact rule.
- **C3 (replaces R-c's "newest `issued_at`").** A run started with
  `run-once --as-of <past hour>` has the newest `issued_at` but only past
  buckets. So "current" is **the newest succeeded run that still has a
  bucket at or after the current hour** for that `(asset_id, point_key)`.
  "Stale" means that run's **first bucket** (the hour it scored) is more than
  3 h before the current hour, not its `issued_at`.
- **C4 (replaces R-c's bucket rule).** Bucket 0 is the hour in progress. The
  read returns buckets `>= date_trunc('hour', now(), 'UTC')`, so the p50
  line joins the actual line with no gap.
- **C5 (corrects R-b's test list).** The marker bump and the grant change
  these tests in `E1.4a`:
  - `tests/e1.1-ml-schema.integration.test.ts`: the marker and the
    `bms_tenant` refusal;
  - `tests/e1.1-ml-schema.test.ts`: it forbids `"ml"` in `drizzle.config.ts`,
    which R-a adds;
  - `apps/ml/tests/integration/test_scorer_postgres.py`: it asserts marker 1.

  The `ml` CI job runs on any `packages/db/` change, so that last edit is
  required. *Not in this amendment* is narrowed to "any change to
  `apps/ml/src`": the one test edit is allowed, and the scorer's code does not
  change.
- **C6 (corrects R-c's index sentence).** `forecasts_pkey` serves the
  one-point read (two equalities, then a range on `horizon_bucket`). The list
  is served by `model_runs_org_started_idx`, then `forecasts_model_run_idx`
  (both in 0157), not by `forecasts_pkey`. `EXPLAIN` in the plan proves both.
- **C7 (adds to R-c's list).** Each list row carries the IANA `timeZone` of
  its site, resolved the same way the history page resolves it, so the list
  shows times in each row's site zone.
- **C8 (replaces R-e's empty-state copy).** "No forecasts yet. Forecasts are
  made for a few point types with enough recent real data." The page does
  not promise a forecast to a point type the scorer does not target.
- **C9 (corrects R-a's reason).** `packages/db/drizzle/meta` holds only
  `_journal.json`, and nothing here runs `drizzle-kit` introspection, so there
  is no drift check to trip. All three tables are still mirrored, so the
  mirror is complete and `E1.2` reads `ml.anomaly_scores` through it.

**Not in this amendment:** the anomaly read path (`E1.2`), forecasts in
exports, reports or the copilot, an accuracy view, the owed `bms_ml` role, a
per-organization switch for forecasts, and any change to `apps/ml/src`
(`E1.4d`'s; C5 allows the one test edit).

**Consequences.** `E1.4a` waits for `E1.1` to be ✅ on `main`. After the build,
AGENTS.md §3 *Layout* gains `apps/api/src/ml/` and the `ml` Drizzle mirror
through a `chore(agents):` PR (§9.10). This is not a §6 promotion.

**Build record — `E1.4a` PR 1 (2026-11-16).** Migration `0158_ml_tenant_read_grant`
grants exactly ruling 2 and moves the marker to 2; its proof block also checks
column-level grants, refuses a grant option, and reads each `tenant_isolation`
predicate (the GUC, no `IS NULL`, no `OR`), not only the policy's name (PR 1
security review). **No index was added** (R-c, C6): the two `0157` indexes
serve both reads. Measured on a scratch TimescaleDB 2.29.1 / Postgres 16 with
the seeded organizations and 60 days of hourly runs (2 organizations × 13
points, **1,797,216 forecast rows**, 357 MB), `ANALYZE`d, warm, `EXPLAIN
(ANALYZE)` as `bms_fleet` and as `bms_tenant` under its GUC: the one-point read
is `forecasts_pkey` (three equalities) → `model_runs` by key → the run's rows,
**1.3–1.6 ms**; the list is `model_runs_org_started_idx` (tenant) or a scan of
`ml.model_runs` (fleet) → per run `forecasts_model_run_idx`, **82–136 ms**,
bounded by the runs in the 64 h window × rows per run, whatever the table's age.
Without `OFFSET 0` the list plans `Seq Scan on forecasts` for an admin (66–95 ms
at this size, growing with the table), and at about 140,000 rows a full walk of
`forecasts_pkey` on `horizon_bucket` alone. The integration case
(`apps/api/src/ml/ml-forecasts.integration.spec.ts`) therefore fails any scan
of `ml.forecasts` not bound to a run id or an asset id, not only a sequential
scan, on runs planted up to the current hour. **Plan N3: it is a smoke check,
not the mutation gate.** Removing `OFFSET 0` turned it red in only 3–5 runs of
6, even with full-size statistics, because at that size the flattened join and
the per-run path cost about the same. The deterministic gate is a text check
in `tests/e1.4a-ml-read-containment.test.ts` that the lateral subquery keeps
`OFFSET 0`. Limits: an x86 cloud VM, synthetic rows; the demo host's real rows
are a step-6 check after deploy. One correction to the plan's one-point SQL:
its second step read the run's rows from the current hour, so the first row
was always the current hour and `stale` (C3, the run's *first* bucket) could
never be true; it reads from the 64 h look-back start instead, the pure step
drops the earlier buckets (C4) as plan §5 T1.8 describes, and an integration
case holds it (a run that scored 4 h ago reads `stale`).

**Build record — `E1.4a` PR 2 (2026-11-16), the chart.** Three calls the plan
left open, recorded so a later reader does not mistake them for drift:
`forecastApplies(range, nowMs)` reads `range.fn` rather than taking `fn` as a
separate argument; the history chart now carries a legend whether or not a
forecast is drawn (R9 asks for one "whenever a series is plotted"); and while a
forecast is drawn beside a **preset**, the window's own reads refresh every
15 minutes too. Without that the window's `to` froze at load, the server's
`asOf` moved on, and an hour later N11's live rule dropped the band from a page
left open (PR 2 code review). A failed forecast refetch drops the last forecast
rather than drawing it on with its old `stale: false`, and a 403 stops that
point's re-poll. The "now" line sits on the first actual series, so hiding the
p50 in the legend keeps it.

**Build record — the list row (`E1.4a` PR 1, recorded 2026-11-16).** The plan's
`forecastListRowSchema` named the asset's place `locationName`. The row carries
`assetRtuName` (nullable) and `assetLocationName` instead, so the page names the
asset through `assetLabelOf` like every other asset-naming row (ADR 0111's gate
fails a DTO that names an asset without them).

**Build record — `E1.4b` PR 3 (2026-11-16), the page.** `/forecasts` lives in a
new `pages/extra-routes.tsx` that `app.tsx` renders inside `<Routes>` (R13, N7),
because `app.tsx` sits at the AGENTS.md §4.5 cap. To make room, the legacy
`/assets/:assetId/history` redirect's element moved to its own file; its route
line stays in `app.tsx` (B5), and the moved redirect now encodes the id. Each
row's times are drawn in that row's own site zone (C7); a zone the browser does
not know falls back to UTC instead of throwing.

**Build record — `E1.4c` PR 4 (2026-11-16), the widget.** Migration
`0159_forecast_widget_type` rewrites `dashboard_widgets_widget_type_check` to
fourteen types, `forecast` last. The renderer's `hourlyMeans` seeds every UTC
hour of the 24 h window as empty before it averages, so an hour with no
samples is a gap in the line, not a join across it (R10). R12 is held twice: both
template surfaces refuse the kind, and the stock catalog spec fails a stock
template that carries it. `dashboard-builder.ts` made room under the §4.5 cap by
moving its binding messages to `dashboard-binding-messages.ts`, and the
builder's tab helpers moved out move-only (R14). Step 6's browser layer for the
widget (palette → add → bind → save → hard reload) was not run in the build
session; it is owed on the demo host with the other demo-host checks. *Done
on the demo host 2026-11-17 (`b4c22dc1`): a widget saved on a temporary WBLDC
dashboard drew the actual line, the past forecast and the 48 h band on the
viewer page on a fresh page load.*

**Defect fix — `serve` scores the current hour when it starts after the tick
(2026-11-16).** The `E1.4` demo checks found the 10:00 hour unscored: a deploy
at 10:04–10:06 recreated `ml` at its run time, and a fresh `serve` only ever
waited for the next tick (11:05). Every merge to `main` recreates `ml`, so a
deploy near HH:05 could lose an hour again. The screens still read "Fresh",
because C3's stale limit is 3 hours. `run_scheduler` now runs a cycle at once
when it starts after this hour's tick and at least five minutes before the next
hour (`catch_up_on_start`, the margin `retry_at` keeps, so a run never scores
the next hour before HH:05). Outside that window it waits for the tick as
before. A catch-up is safe to repeat: the ledger skips an hour that is already
scored, at the cost of one model load. `tests/test_scheduler.py` holds the
window and the loop. Two mutations, the catch-up removed and the margin
removed, turned 2 and 5 cases red.

## Amendment 4 — `E1.4e`: the past forecast beside the actual line (2026-11-16)

**Status: Accepted — 2026-11-16** (owner, in chat). Drafted by an agent for
backlog row `E1.4e`. Lines marked *(owner, 2026-11-16)* are the owner's
answers to four questions asked in chat that day; each was the option the
agent recommended except ruling 4, where the owner chose the wider one. Lines
marked *(drafter)* are the agent's calls inside those answers. The owner asked
for the build to go straight through and merge on green CI.

**Why.** After the `E1.4` demo checks the owner asked to see, on the streamed
history chart, the actual values together with the forecast values for the
earlier hours of whatever window is selected, in two colours. Ruling 4 of
Amendment 3 said past forecasts are **not** drawn over the actual line,
because that reads as an accuracy claim. This amendment reverses that one
sentence of ruling 4 and nothing else: the live 48 h band, the "now" line, the
stale rule and the caption stay as they are.

**What changes.** One new read route and two screens draw its answer. No npm
or Python package, no migration, no new grant (`0158` already lets
`bms_tenant` read `ml.forecasts` and `ml.model_runs`).

**Rulings.**

1. **Which past forecast: the one made 1 hour ahead** *(owner, 2026-11-16)*.
   For each whole UTC hour `t` in the window, the p50 of the forecast row for
   bucket `t` that was issued **before `t`** and **no more than 3 hours before
   it** (`PAST_FORECAST_MAX_LEAD_HOURS`), from a succeeded run; when several
   qualify, the newest. With hourly runs at HH:05 that is the run scored at
   (t−1h):05, a 55-minute lead. The 3-hour cap *(drafter)* covers a missed
   hour; past it the hour is a **gap**, never a day-old forecast and never a
   filled value.
2. **How it looks: a p50 line in a second colour** *(owner, 2026-11-16)*. A
   dashed p50 line, no band over the past. Its colour *(drafter)* comes from
   the chart's spare series roles (`series-2` onward), which no actual line
   uses, so a past line never shares a colour with an actual line however many
   points are charted; with more than one charted point each past line carries
   the point key, as the live forecast's do (R9). An hour with no forecast
   breaks the line.
3. **No accuracy number** *(owner, 2026-11-16)*. No error figure, score or
   percentage anywhere. The screens still say **advisory**, and a caption names
   what the line is: "Past forecast: made 1 h ahead of each hour · advisory".
   *Consequences*' "accuracy claims are not made" stands for numbers.
4. **Where: the asset history chart and the `forecast` widget** *(owner,
   2026-11-16)*. The chart draws it over its own window; the widget over its
   last-24-hours actual line.

**Drafter choices inside the rulings.**

- **Route** `GET /ml/points/:pointRef/forecast/past?from=&to=`, the same guard
  and order as the live forecast (S2): the bounded decode (400), the query
  (400: `from` and `to` ISO instants with an offset, `from` before `to`, at
  most `PAST_FORECAST_MAX_SPAN_DAYS` = 366 days apart, no other key), then
  `canReadAsset` (403), then the read through `withReadScope`. Response
  `{ asOf, buckets: [{ t, p50 }] }` (`pastForecastResponseSchema`): buckets
  from the hour `from` falls in, up to `to` and strictly before the current
  hour, which the live forecast owns. Only `t` and `p50` reach the wire.
- **When it is asked for**: beside the hourly mean (`avg`) only, as the live
  forecast is (R7), but on **any** window, a past custom range included,
  because the point is to look back. On a long window whose actual buckets are
  wider than an hour, the line stays hourly beside the coarser means; ruling 4
  asks for every window, so that is accepted. The browser asks for the window
  rounded to whole hours, so a live window reads it again only when the hour
  turns.
- **The read** is one range scan of `forecasts_pkey`
  `(asset_id, point_key, horizon_bucket, issued_at)` with `DISTINCT ON
  (horizon_bucket)`, at most one row per hour of the window.

**Not in this amendment:** an accuracy figure of any kind, a 24-hour-ahead or
user-chosen lead, a band over the past, past forecasts on the Forecasts page,
in exports, reports or the copilot.

**Consequences.** AGENTS.md §3 says `src/ml/` serves **two** GET routes; after
`E1.4e` it is three. A `chore(agents):` catch-up is queued in BACKLOG §5 and
waits for the owner's yes (§9.10), as Amendment 3's did.

**Build record — `E1.4e` (2026-11-16).** Built in one PR: the route (API
half by an implementer, then the web half), tests first. The integration
suite ran against a real Postgres: the forecast issued 30 minutes ahead wins
over 2½ h, 4 h, one issued after the hour began and a newer failed run; an hour
whose only forecast is 4 h ahead, or issued after it began, is absent; exactly
3 h ahead is kept; the current hour and later never return; a second
organization's rows never appear on the tenant branch and are filtered by asset
on the fleet branch; the `EXPLAIN` case holds the new read to no unbound scan of
`ml.forecasts`. Eight API mutations (the lead rule, the 3 h cap, the succeeded
join, the newest-first order, the current-hour clip, the floor of `from`, an
inclusive `to`, a 2 h cap) and four web mutations (a shared colour, gaps joined,
drawn beside `max`, past colours that wrap into the actual palette) each turned
cases red. The demo-host check (the line on a real point after deploy) follows
the deploy.

**Ruling 2 revised, and a colour for the live forecast — `F4.377`
(owner, 2026-11-16).** This revises Amendment 4 ruling 2's palette and the
`E1.4` plan's "p50 in the point's own series colour". The owner's demo check found the
live band and p50 still drawn in the point's own colour (Amendment 3's plan
drew them so; R-d only asked for role tokens). **Ruling (owner, 2026-11-16, in
chat): three colours** — the actual line, the past forecast and the live
forecast each in its own colour. The live band and p50 take `forecastPalette`
(`series-3`, `series-4`, `series-5`); the past line keeps ruling 2's spare roles,
now `series-2`, `series-6`, `series-7`, `series-8`, so the two forecast palettes
share no role with each other or with the actual palette. With one point:
actual `series-1`, past `series-2`, live `series-3`. Each point's lines are
traced by the legend's point key (R9). Roles only, no new hex. With more
points than a palette holds the colours repeat within their own kind (the live
forecast from the fourth point, the past line from the fifth; the chart takes
up to 8 points), never across kinds; the legend's point key still tells them
apart.

**The three colours distinct in every profile — `F4.381` (owner, 2026-11-16).**
The owner's demo check of `6bec61f6` found the past line nearly the actual
line's colour under the `sand` profile (`#155E75` and `#0F766E`, ΔE2000 16.6).
Measured over all 13 profiles in both themes, 14 of 26 blocks had two of the
three first colours under ΔE2000 20, and no fixed role pair held 20 everywhere.
**Ruling (owner, 2026-11-16, in chat): pick the roles in code, no token
change.** The rule: the first actual, past and live colours are each at least
ΔE2000 20 apart, in every profile and theme. `forecastRoles`
(`apps/web/src/lib/forecast-colours.ts`) keeps `series-2` for the past line and
`series-3` for the live forecast wherever they hold, and else takes the next role
of the same palette that holds; the palettes keep their own roles, so the three
kinds still share none. So "with one point: `series-2`, `series-3`" above is
true only where the rule holds (for example the default light theme's live
forecast is `series-4`, and `sand` light's past line is `series-6`).
`tests/f4.381-forecast-colours-distinct.test.ts` holds every profile.


## Amendment 5 — `E1.2`: advisory anomaly scores, end to end (2026-11-16)

**Status: Accepted — 2026-11-16** (owner, in chat: "accepted, mark
Amendment 5 accepted and merge"). Drafted by an agent for backlog row `E1.2`.
Lines marked *(owner, 2026-11-16)* are the owner's answers to five questions
asked in chat that day; three were the option the agent recommended, and
questions 1 and 4 took the wider option. Lines marked *(drafter)* are the
agent's calls inside those answers; the owner accepted the amendment with them
as written, so **every *(drafter)* line and every A-a to A-h call is now a
ruling**.

**What stays.** Decision 5 stays as written: a robust baseline (median/MAD per
point) plus an Isolation Forest (scikit-learn) over an asset's points
together, and the scores are **advisory**. No score writes a row in
`bms.alarms`, sends a notification, or opens a work order. Routing into alarms
still needs its own amendment, after the owner has looked at real scores.
Amendment 1 decision 3 stays: a gap is data, not an anomaly. Amendment 2
item 4 stays: `ml.anomaly_scores` is keyed `(asset_id, bucket, detector,
model_run_id)` and a row is never rewritten.

**What changes.** `apps/ml` writes `ml.anomaly_scores`; the API reads it;
three screens draw it. This amendment adds **one Python package**
(`scikit-learn`, already in the *Dependencies* first-package list) and **no**
npm package. It needs two migrations: a grant and a widget kind.

**Owner rulings (2026-11-16):**

1. **First points** *(owner, 2026-11-16: "PHEWB + WBLDC + RTU health")*.
   Real points only (step 0's rule, the same predicate as forecasting). An
   asset is scored only when each of its scored points itself meets the
   anomaly threshold: 28 days and 80 % hourly coverage (`ANOMALY_MIN_DAYS`,
   `MIN_COVERAGE`), and fresh within 3 h. Amendment 1 decision 2's per-room
   rule applies to every class here.

   | Class (`domain/asset_type`) | Points scored | Assets now |
   |---|---|---|
   | `electrical/energy_meter` (PHEWB) | the 15 meter points; **not** `kwh_total`, a counter that only climbs *(drafter)* | 5 |
   | `electrical/pump_breaker` (PHEWB) | `breaker_main` (Amendment 2 item 2) | 5 |
   | `electrical/chlorine_pump` (PHEWB) | `chlorine_pump_on` (Amendment 2 item 2) | 5 |
   | `environment/rtu_health` (PHEWB) | `battery_charge_pct`, `network_strength`, `controller_power_status` | 5 |
   | `facility/cold_room` (WBLDC) | `cold_room_temp_c` | 18 (VAP_Blast_Freezer_2 waits by itself) |

   The list is class-keyed, as `ML_FORECAST_TARGETS` is: a new asset of a
   listed class joins by itself when its own history passes. A **new class**
   (for example BCPL flow meters, which pass 28 days around 2026-12-06) needs
   its own amendment. RTU health scores a value (a low battery, a weak
   signal); a **missing** value stays device health's (`F3.16`), as
   Amendment 1 decision 3 says. An on/off point is scored on its hourly mean,
   which is the fraction of the hour it was on *(drafter)*.

2. **Where the Isolation Forest runs** *(owner, 2026-11-16)*. The baseline
   scores **every** scored point. The Isolation Forest runs only on an asset
   with **two or more** scored points (today the 5 meters and the 5 RTU
   health assets). An asset with one point gets the baseline only: an
   Isolation Forest over one feature adds nothing to it. Each asset is fitted
   on its own points; nothing is pooled across assets or sites.

3. **How a score is made** *(owner, 2026-11-16: percentile, 0.99)*.
   - **Fitted every cycle, in memory, from the database.** No fitted model is
     stored: there is no model file, no pickle and no volume. The fit is
     deterministic (a fixed `random_state`), and the hyper-parameters go into
     the run's `config_hash`, so one run can be reproduced from its inputs.
     Decision 7's "no download at run time" holds: scikit-learn has no
     weights.
   - **The scored hour** is the last complete hour, `as_of_hour − 1 h`
     *(drafter)*. The feature of a point for an hour is its `_1h` mean
     (`sum / count`). An hour where a point has no data is not scored for
     that point, and an Isolation Forest hour needs all of the asset's
     points; a gap is never filled (R10).
   - **The reference window** is the 28 days (672 h) before the scored hour.
     The Isolation Forest is fitted on it, and both detectors' percentiles
     are taken against it.
   - **The baseline slot.** Per point, the median and MAD are taken per
     **hour of day** (UTC). A point moves to **hour of week** only when every
     one of its 168 slots holds at least 8 samples. For that test, and only
     for the median/MAD, the baseline may read up to 91 days back
     *(drafter: 28 days give 4 samples per hour-of-week slot, which is too
     few)*. The MAD has a floor, so a flat or on/off point does not divide by
     zero *(drafter; the exact floor is the plan's)*.
   - **The score** of a detector for an hour is its **percentile against the
     reference window**: the share of the window's hours whose statistic is
     at or below this hour's. The baseline's statistic is the largest robust
     z over the asset's points; the Isolation Forest's is its
     `score_samples` value, negated so that higher means more unusual. So
     every score is in 0..1 and the two detectors share one scale.
   - **"Unusual"** means a score **≥ 0.99**. By construction that is about
     1 % of normal hours, about 7 hours a month per asset. It is a shared
     constant (`ANOMALY_UNUSUAL_SCORE`), applied at read time: the scorer
     writes **every** scored hour, so the chart and the widget can draw the
     score line, not only the marks.
   - **Contributing points** are the up to 3 points with the largest robust
     z in that hour, on both detectors' rows *(drafter)*. The Isolation
     Forest has no per-point attribution of its own; the baseline gives the
     explanation per point that decision 5 asks for.
   - **Detectors** (the `detector` column): `baseline_mad` and
     `isolation_forest` *(drafter)*.

4. **Three surfaces** *(owner, 2026-11-16: "List + chart + widget")*. The
   mockups have no anomaly screen, so each keeps the existing language
   (AGENTS.md §5), as Amendment 3's surfaces do.
   - (a) An **Anomalies** list page, route `/anomalies`, in *Operations*
     after *Forecasts*, with a Lucide key in `NAV_ICONS` that no other item
     uses, for every signed-in user; the API filters the rows. A
     `SectionCard` table of the unusual hours in the last 7 days *(drafter)*:
     *Site · Asset · Hour · Score · Detector · Top points · Status* (an
     *Advisory* pill). A row links to `/asset-history/:assetId` at that hour.
   - (b) **Marks on the asset history chart** at each unusual hour of the
     charted asset, with the score and the contributing points in the
     tooltip. They are drawn beside the hourly mean (`avg`) only, as the
     forecast is (R-d).
   - (c) An **`anomaly` dashboard widget kind**: the asset's hourly score
     (the larger of the two detectors) over the last 7 days, with the 0.99
     line and the unusual hours marked *(drafter)*. It binds **one point**
     through `bms.dashboard_widget_points`, and the asset is that point's
     (Amendment 3 C1, ADR 0047 decision 3). Its migration widens
     `dashboard_widgets_widget_type_check` as `0159` did. Builder palette
     only; no stock template changes.
   - Every surface says **advisory**. No anomaly reaches an alarm, a
     notification, a report, an export or a copilot answer, and no accuracy
     figure is shown.

5. **The budget** *(owner, 2026-11-16)*. The anomaly job runs in the
   **existing `ml` service**, in the same HH:05 cycle, in **its own child
   process after the forecast** child, so the two peaks never add. The demo
   host's limit stays **1 vCPU, 1 GiB** (Amendment 2 item 1). The parent
   still imports neither torch nor scikit-learn. The plan measures one cycle
   at `--cpus 1 --memory 1g`; if the anomaly child peaks above **900 MiB**,
   or a whole cycle takes more than **300 s**, the build stops and the owner
   rules again. No new compose service, so `DISCOVERY_BLOCKED_HOSTNAMES` does
   not change.

**Recommended calls** *(drafter; accepted with the amendment)*:

- **A-a. One run row per organization per job.** An anomaly run is its own
  `ml.model_runs` row, `model_name = 'bms-anomaly'`, `model_version` = the
  `bms-ml` and `scikit-learn` versions. The ledger skips a scored hour when a
  succeeded `bms-anomaly` run already holds that bucket, unless `--force`.
  The forecast reads join `ml.forecasts` by run id, so an anomaly run (no
  forecast rows) never reads as a forecast; the plan proves it with a test.
- **A-b. SQL stays in `db/sql.py`.** The new statements are a `SELECT` on the
  inputs and an `INSERT INTO ml.anomaly_scores`; the SQL guard and
  `PREFLIGHT_ROLE_SQL` gain the table's `INSERT` check. `organization_id`
  comes from `bms.assets` in SQL (R5). The owed `bms_ml` role stays owed.
- **A-c. Configuration.** `ML_ANOMALY_TARGETS`, the same
  `domain/asset_type/point_key` shape as `ML_FORECAST_TARGETS`, defaulting to
  ruling 1's list. `ML_ANOMALY_ENABLED` (default on) lets the operator stop
  the job without stopping forecasts.
- **A-d. The grant.** `bms_tenant` gets `SELECT` on `ml.anomaly_scores`,
  nothing else. No write anywhere in `ml`; `bms_auth` gets nothing. The
  migration moves the marker to `bms-ml-schema-version=3` and proves itself
  in a `DO $$` block, as `0158` does (Amendment 3 S5). The tests that assert
  "`bms_tenant` holds nothing on `ml.anomaly_scores`" change with it.
- **A-e. The API.** Two `GET` routes in `apps/api/src/ml/`, the same guards
  and pools as the forecast routes (S1, S2, S4):
  - `GET /ml/assets/:assetId/anomalies?from=&to=` — one asset's scores
    (hour, detector, score, contributing points) in a window of at most 31
    days. UUID check (400), `canReadAsset` (403), then `withReadScope`.
  - `GET /ml/anomalies?since=` — the unusual hours (score ≥ 0.99) of every
    asset the caller can read, at most the last 7 days, newest first, with
    the site, its IANA time zone and the asset label (`assetLabelOf`).
    `readableAssetIds` is applied on **both** branches (S1).
  - Only the hour, detector, score, contributing points, model name and
    version reach the wire; never `error_text` or `config_hash` (S3). Each
    read is bounded by the window and served by `anomaly_scores_pkey` or
    `anomaly_scores_model_run_idx`; the plan shows `EXPLAIN` for both and
    adds an index to the grant migration only if it shows a need.
  - Contracts in `packages/shared/src/contracts/ml-anomalies.ts`, types by
    `z.infer` (ADR 0030).
- **A-f. Volume.** Two detectors at most per asset per hour: about 38 assets
  × 24 × 365 × 2 ≈ **0.7 M rows a year**, far under Amendment 2 item 7's
  50 M line. Retention follows `_1h`, as decision 4 says.
- **A-g. The lock step.** `uv add scikit-learn` from Bash, with this ADR's
  build record staged in the same commit (§9.4, the dependency gate). Its
  transitive packages (`scipy`, `joblib`, `threadpoolctl`, all BSD-3-Clause)
  and exact pins go into the build record. A cloud session cannot reach the
  PyTorch wheel index; if the lock needs it, the owner allows
  `download.pytorch.org` for the session or runs the step on their machine
  (Amendment 2 item 6).
- **A-h. The row splits into four children**, serial:

  | Child | Scope | Depends |
  |---|---|---|
  | `E1.2a` | `apps/ml`: scikit-learn, the two detectors, the anomaly child process, the ledger, the measurement of ruling 5 | `E1.1` |
  | `E1.2b` | The grant migration, contracts, both API routes, surface (b) | `E1.2a` |
  | `E1.2c` | Surface (a), the Anomalies page and its navigation item | `E1.2b` |
  | `E1.2d` | Surface (c), the `anomaly` widget kind and its migration | `E1.2b` |

  The `E1.2` umbrella closes when all four are done. `E2.3` and `E1.6` keep
  their edge on the umbrella.

**Not in this amendment:** alarms, notifications or work orders from a score;
a new asset class (BCPL flow meters included); per-station or cross-asset
models; a stored or versioned fitted model (MLflow stays deferred, decision
7); anomaly scores in exports, reports or the copilot; an accuracy or
precision figure; the owed `bms_ml` role; a change to the demo host's
1 vCPU / 1 GiB limit.

**Consequences.** After the build, AGENTS.md §3 *Layout* (`src/ml/` routes)
and §5 (the *Anomalies* item) are caught up through a `chore(agents):` PR
(§9.10), queued in BACKLOG §5. This is not a §6 promotion.

**Correction after acceptance — ties (owner, 2026-11-16).** Ruling 3 says a
score is the share of the window's hours whose statistic is "at or below"
this hour's. With those words a point that does not move (an on/off point,
`controller_power_status`) has every statistic equal, so every hour would
score 1.0 and show as unusual. The owner ruled, while approving the `E1.2`
plan ([`docs/plans/e1.2-anomaly-detection.md`](../plans/e1.2-anomaly-detection.md)
§17 Q1): **count only the hours strictly below**. A flat hour then scores 0, a
new maximum scores 1.0, and for a point that moves the result does not change.
This replaces "at or below" in ruling 3; nothing else changes.

**Build record — `E1.2a` PR 1, package pins (2026-11-16).** Written by
`uv 0.8.13` (the CI and Dockerfile version), `uv add --no-sync
"scikit-learn==1.9.1"` from Bash, Python 3.12. The lock's `revision = 3` is
unchanged, and **no existing pin moved** (the lock diff only adds lines).
Every new package comes from PyPI (`registry = "https://pypi.org/simple"`)
with its hash in `apps/ml/uv.lock`. The owner allowed `download.pytorch.org`
and `download-r2.pytorch.org` for this session's environment, because `uv`
re-reads the CPU torch index when it re-locks (Amendment 5 A-g, plan §17 Q2).
- `scikit-learn==1.9.1` (BSD-3-Clause), the one direct addition.
- Transitive: `scipy 1.18.1` (BSD-3-Clause; its wheels bundle OpenBLAS,
  BSD-3-Clause, with LAPACK, BSD-3-Clause-Open-MPI; the GCC runtime,
  GPL-3.0-or-later WITH GCC-exception-3.1, which permits use in any
  program; and `libquadmath`, LGPL-2.1-or-later, a shared library used
  unmodified), `joblib 1.6.0` (BSD-3-Clause), `threadpoolctl 3.8.0`
  (BSD-3-Clause), `cloudpickle 3.1.2` (BSD-3-Clause, a `joblib` dependency)
  and `narwhals 2.28.0` (MIT, a `scikit-learn` dependency). The plan named
  the first three; `cloudpickle` and `narwhals` are new to this list.

**Owner ruling — the budget step runs once in CI (2026-11-16).** The `E1.2a`
builder estimated three runs of the ruling-5 measurement at 8–10 Actions
minutes for each PR that runs the `ml` job (the forecast child alone takes
80–149 s at one CPU), not the plan's "about 3". The owner ruled **one run in
CI** (`measure_cycle --runs 1`). The step still fails above 900 MiB for the
anomaly child or 300 s for forecast + anomaly. The demo host's first cycles
after the deploy are the second sample.

**Build record — the ruling-5 measurement, `E1.2a` (2026-11-16).** CI's `ml`
job on #1370 (head `ba07e3b`, run 43915761883), an amd64 GitHub runner, one run
at `--cpus 1 --memory 1g`, read-only, no capabilities, against the fixture at
the real shape (21 forecast series, of which 4 have about 1,440 h of context
rather than 2,016 h; 38 anomaly assets, 10 of them with an Isolation Forest).
Peak memory is the container's `memory.peak`.

| Child | Wall s | Peak MiB | Scored | Rows |
|---|---|---|---|---|
| Forecast (`run-once`) | 11.1 | 547.6 | 21 series | 1,008 |
| Anomaly (`run-anomaly`) | 39.7 | 159.1 | 38 assets | 48 (10 forest) |
| **Cycle** | **50.8** | | | |

Both are inside ruling 5 (anomaly ≤ 900 MiB, forecast + anomaly ≤ 300 s), so
the build goes on. `E1.2a` merged as `947f0d0`. The demo host (arm64) is the
second sample: its first anomaly `cycle_summary` lines and the `docker stats`
peak are recorded here after the deploy.

**Build record — `E1.2` closed (2026-11-16).** `E1.2a`–`d` merged in #1370,
#1372, #1373 and #1374 (plan build record §20). Two calls made in the build,
recorded so a reader does not take them for drift:
- **The `anomaly` widget is exempt from ADR 0133 Amendment 2's kW-only hiding**
  on the site page *(drafter, E1.2d code review; **kept by the owner, 2026-11-16**, in chat: "keep the exception")*.
  Its one point only names the asset (plan R16) and it draws a unitless score,
  so "never had fresh data to show" does not apply to it.
- **The widget's time axis is UTC and says so**: the anomaly read carries no
  site zone, so the axis, its tooltip and its caption all name UTC.
**The arm64 demo-host sample of ruling 5 (2026-11-17, `b4c22dc1`, t4g.large):**

| Child | Wall s | Scored | Rows |
|---|---|---|---|
| Forecast | 27.3 | 16 series | 768 |
| Anomaly | 12.1 | 37 assets | 46 (9 forest) |
| **Cycle** | **39.4** | | |

The `ml` container peaked at 674.7 MiB in `docker stats` (1 s samples over
02:04–02:09 UTC, scheduler and both children together), so the anomaly child
is below 900 MiB and the cycle below 300 s. Ruling 5 holds on the demo host.

## Amendment 6 — pointer: one anomaly context line on the alarm panel (2026-11-17)

**Status: Accepted — 2026-11-17**, with [ADR 0136](./0136-alarm-root-cause-suggestions.md)
(`E2.3`, its question Q4). This is a pointer, so a reader of Amendment 5
finds the exception. The decision itself lives in ADR 0136 decisions 3 and 7.

Amendment 5 ruling 4 says no anomaly reaches an alarm, a notification, a
report, an export or a copilot answer. **One exception:** the alarm details
panel's *Possible causes — advisory* section may show one context line when
the alarm's asset has an hour ≥ `ANOMALY_UNUSUAL_SCORE` in the 6 h before the
alarm. That line has **zero weight**: it creates no candidate cause and
raises no candidate's strength. A score still raises no alarm, sends no
notification, opens no work order, and appears in no report, export or
copilot answer. No threshold changes, and the owner's one-week read of the
detector rates (due about 2026-11-23) is untouched.
