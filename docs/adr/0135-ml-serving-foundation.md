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

## Amendment 7 — `E1.2e`: water flow meters join the anomaly targets (2026-11-17)

**Status: Accepted — 2026-11-17** (owner, in chat: "accept all
recommended, mark Amendment 7 accepted"; proposed the same day). Drafted by
an agent from an owner request in chat ("why does BCPL get no ML results?").
Lines marked *(recommended)* were the agent's calls; the owner accepted the
amendment with them as written, so **every *(recommended)* line is now a
ruling**, and each question at the end took its recommended answer.

**Why BCPL gets nothing today.** The BCPL organization has 21
`water/flow_meter` assets with two real points each:
`treated_water_flow_klh` (a flow rate) and `outlet_flow_totalizer_kl` (a
counter that only climbs). Neither point is in `DEFAULT_TARGETS` or
`DEFAULT_ANOMALY_TARGETS` (`apps/ml/src/bms_ml/targets.py`), and Amendment 5
ruling 1 says a new class needs its own amendment. So the scorer never asks
whether a flow meter is ready. Even with a target, BCPL is not ready yet:
data starts on 2026-11-08 (step 0, decision 8: 8 days, 89 % coverage on
2026-11-15), and only 17 of the 21 RTUs report.

| Job | Days needed | BCPL ready about |
|---|---|---|
| Anomaly (`ANOMALY_MIN_DAYS`) | 28 | **2026-12-06** |
| Forecast (`FORECASTING_GOOD_DAYS`) | 56 | **2027-01-03** |

These dates assume each meter keeps at least 80 % hourly coverage
(`MIN_COVERAGE`). A meter below that waits by itself (`low_coverage`), and
the 4 meters that do not report stay `no_data`. Amendment 1 decision 2's
per-asset rule applies, as Amendment 5 ruling 1 says.

**What stays.** Every Amendment 5 ruling: the two detectors, the 28-day
reference window, the strict-below percentile (the ties correction), the
0.99 "unusual" line, advisory only, and ruling 5's budget. **No threshold or
detector constant changes** (the owner's one-week read of the detector rates
is due about 2026-11-23 and is untouched). No npm or Python package, no
migration, no API route, no screen change: the routes, the *Anomalies* page,
the chart marks and the `anomaly` widget already read every class.

**What changes (proposed):**

1. **One anomaly target** *(recommended)*:
   `water/flow_meter/treated_water_flow_klh` joins `DEFAULT_ANOMALY_TARGETS`
   (21 → 22 targets; `MAX_TARGETS` is 32). The list stays class-keyed, so a
   meter joins by itself when its own history passes. A flow meter has one
   scored point, so it gets the **baseline only** (Amendment 5 ruling 2: the
   Isolation Forest needs two or more points).

2. **Never the totalizer** *(recommended)*. `outlet_flow_totalizer_kl` is not
   a target in either job, for the same reason as `kwh_total` (Amendment 5
   ruling 1): a counter that only climbs has no normal level, so every new
   hour would be a new maximum, and every hour would read as unusual. A
   derived hourly increment (the `_1h` `max − min`) is **not** built here: it
   repeats what the flow rate already says, a counter reset or rollover would
   read as an anomaly, and the scorer has no derived-feature step today. A
   derived feature needs its own amendment.

3. **Flow forecasts: split out, still parked** *(recommended; question 3)*.
   The water-flow piece of `E1.4d` becomes its own row, **`E1.4f`**, parked
   ⬜. `E1.4d` keeps chemical dosing, utility demand and covariates. This
   amendment decides `E1.4f`'s target
   (`water/flow_meter/treated_water_flow_klh` in `DEFAULT_TARGETS`, never the
   totalizer), so `E1.4f` needs no further amendment. It starts only after
   the measurement below shows it fits ruling 5.

   **Why not now.** No BCPL meter can be forecast before about 2027-01-03,
   and the budget is not known at the new size:
   - **Series.** Forecasts today: 24 targeted series (19 cold rooms and 5
     PHEWB `kw`), 16 of them eligible on 2026-11-17; `kw` joins about
     2026-12-02. Flow would add 21 more (17
     reporting): **up to 45 series**, more than twice the 21 that were
     measured.
   - **Time.** The demo host ran 16 series in 27.3 s (Amendment 5 build
     record), about 1.7 s a series, so 45 series would take about 77 s. The
     laptop's one-CPU runs (80–149 s for 21 series, Amendment 2 build record)
     scale to about 170–320 s for 45. The worst end is above ruling 5's
     300 s for a whole cycle.
   - **Memory.** Every context goes to Chronos-2 in one `predict_quantiles`
     call. The forecast child peaked at 532–548 MiB for 16–21 series, under
     the 1 GiB container limit on a shared t4g.large. Its peak at 45 series
     has not been measured.

   **Start condition for `E1.4f`.** (a) The demo host's first cycle after
   PHEWB `kw` joins (about 2026-12-02) is recorded in this ADR's build record
   (series, `duration_seconds`, `docker stats` peak). (b) `E1.4f`'s PR widens
   the CI fixture to the 45-series shape, and ruling 5's gate passes on it.
   If either is over the line, the build stops and the owner rules again
   (Chronos-Bolt-small, ruling 5's fallback, or a smaller batch). The aim is
   to merge before 2027-01-03, so the meters join on the day they qualify.

4. **Zero flow (pump off)** *(recommended; question 4)*: **no special rule.**
   The current baseline already treats a stop at a fixed clock time as normal:
   - Median and MAD are taken per **hour of day (UTC)**. If the pump stops at
     the same time each day, that hour's median is about 0, so a stop there
     has a small z. IST has no daylight saving, so the UTC hour stays the
     same local hour all year.
   - A meter that is always 0 is flat; the strict-below rule scores it 0.
   - The MAD floor (1 % of the 5th–95th percentile spread) stops a
     divide-by-zero in a slot where the pump is always off.
   - A stop in an hour where the pump is normally on gives a large z, so it
     **is** marked unusual. So is a run in an hour where it is normally off.
     That is what an advisory detector should show.

   **Known gap.** A stop that falls on one weekday (for example, a weekly
   shutdown) or moves from day to day looks unusual in hour-of-day mode. A
   point moves to hour-of-week only when each of its 168 slots holds 8
   samples, which needs about 56 days of data (about 2027-01-03 for BCPL).
   From about 2026-12-06 to about 2027-01-03, a weekly stop would show as
   unusual on its stop day each week. A start or stop inside an hour gives an
   in-between hourly mean; if the time drifts by some minutes, the slot's
   MAD absorbs it.

   **Rejected alternatives:**
   - *Wait for hour-of-week* (a 56-day floor for this class only): four more
     weeks with no scores, and a per-class threshold the scorer does not have.
   - *An "off" mask* (hours below a cut-off are neither scored nor used in
     the baseline): it hides unplanned stops, the most useful thing a flow
     meter can show, and needs a new cut-off constant per class.

   The build proves the behaviour with fixture tests (made-up names only):
   a daily stop at a fixed hour gives no stop hour ≥ 0.99 after the 28-day
   reference fills; a stop in an hour that is normally on gives ≥ 0.99; a
   meter that is always 0 scores 0. The owner reads the first week of BCPL
   scores (about 2026-12-13) and rules again if stops fill the list.

5. **Budget for the anomaly job** *(recommended)*. Flow meters add up to 21
   baseline-only assets: 37 → up to 58 assets on the demo host (38 → 59 in
   the CI fixture). The anomaly child took 12.1 s for 37 assets on the demo
   host and 39.7 s for 38 assets (10 with a forest) in CI, at 159 MiB.
   Baseline-only assets are the cheap case, so the expected cost is a few
   seconds and a few MiB, far under 900 MiB and 300 s. `E1.2e` widens the
   ruling-5 fixture by 21 one-point flow-meter assets, so the CI gate
   measures the new shape. The `ml` job then takes about the same time as
   now (one run, as the owner ruled).

6. **Volume** *(recommended)*. One detector row per meter-hour: 21 × 24 ×
   365 ≈ **0.18 M rows a year**, so about 0.9 M in all for `ml.anomaly_scores`
   (Amendment 5 A-f). If `E1.4f` lands: 21 × 48 × 24 × 365 ≈ 8.8 M more
   `ml.forecasts` rows a year, about 19 M a year for 45 series, under
   Amendment 2 item 7's 50 M line.

7. **When to merge** *(recommended; question 5)*. The anomaly target list is
   part of the anomaly run's `config_hash` (`anomaly_config_hash`), so merging
   changes the hash of every anomaly run from that cycle, even though no
   existing asset's score changes (each asset is fitted alone). So `E1.2e`
   is built now but **merged after the owner's one-week read** (about
   2026-11-23). BCPL is not ready before about 2026-12-06 either way.

**Backlog.** `E1.2e` (⬜, P2) is added under the closed `E1.2` umbrella, as
`E1.4e` was added under `E1.4`; the umbrella stays ✅. `E1.4f` (⬜, parked)
is added because question 3 was ruled "split", and `E1.4d`'s row drops water
flow.

**Consequences.** After `E1.2e`, from about 2026-12-06, BCPL meters appear on
the *Anomalies* page, as chart marks and in the `anomaly` widget, all
advisory. With the detector's current measured rate (about 7 % of
asset-hours ≥ 0.99, against a design of about 1 %), 17 meters could add
about 29 unusual hours a day to the list until the owner rules on that rate.
AGENTS.md §2 *ML scoring* says "21 targets"; a `chore(agents):` catch-up
(§9.10, the owner's yes) changes it to 22 and names the flow-meter class.
This is not a §6 promotion.

**Not in this amendment:** any threshold or detector constant; the
totalizer, raw or derived; an Isolation Forest on flow meters; chemical
dosing, utility demand or covariates (`E1.4d`); the owed `bms_ml` role; a
change to the demo host's 1 vCPU / 1 GiB limit.

**Open questions for the owner (all ruled 2026-11-17, the recommended answer each time):**

1. **Anomaly target.** Add `water/flow_meter/treated_water_flow_klh` to the
   anomaly targets, baseline only? *Recommended: yes.* **Ruled: yes.**
2. **Totalizer.** Never use `outlet_flow_totalizer_kl` as a raw target in
   either job, and leave a derived increment for a later amendment?
   *Recommended: yes.* **Ruled: yes.**
3. **Flow forecasts.** (a) Keep them inside parked `E1.4d`; (b) split them
   out as `E1.4f`, parked until the start condition in item 3; or (c) build
   them now with `E1.2e`, with the CI fixture at 45 series.
   *Recommended: (b).* Nothing can be forecast before about 2027-01-03, and
   the time and memory at 45 series are not measured yet. **Ruled: (b),
   split out as `E1.4f`, parked.**
4. **Zero flow.** (a) No special rule, with the tests in item 4 and a
   review of the first week of BCPL scores; (b) a 56-day floor for this
   class; or (c) an "off" mask. *Recommended: (a).* If you know BCPL's pumps
   stop one day a week, (b) is the safer choice; please say so. **Ruled:
   (a), no special rule.**
5. **Merge timing.** Build `E1.2e` now and merge it after the one-week read
   (about 2026-11-23)? *Recommended: yes.* **Ruled: yes.**

## Amendment 8 — `E1.9`: plain-English findings and an organization + site filter on the ML pages (2026-11-17)

**Status: Accepted — 2026-11-17** (owner, in chat: "accept as
recommended"; proposed the same day in PR #1380). Drafted by an agent for
backlog row `E1.9` at the step 2 gate (AGENTS.md §10). Lines marked *(owner,
2026-11-17)* are the owner's answers given in chat that day. Lines marked
*(recommended)* were the drafter's calls; the owner accepted the amendment
with them as written, so **every *(recommended)* line is now a ruling**, and
Q1–Q4 are ruled as recommended (Q5 was ruled earlier the same day; see
§Rulings below).

**Owner answers on the draft (2026-11-17, in chat, after the first draft):**
- the daily cap (Q4) is a cap on the **AI paragraph** only;
- with no AI key or no AI balance, only the AI paragraph is missing and the
  facts stay (decision 5, confirmed);
- Q5 is ruled **(a) and (b) both in**: the control-room card *and* a
  dashboard widget (decision 13). The owner wrote "if possible, add the
  dashboard widget also"; the drafter reads "also" as a yes to (a) as well;
- after acceptance, a separate model may write the findings paragraph
  (`ML_FINDINGS_LLM_PROVIDER`, `ML_FINDINGS_LLM_MODEL`, e.g. a small model on
  OpenRouter), decision 4;
- every asset the summary names (in a fact line or the AI paragraph) is a
  **link to that asset's forecast and anomaly view**; assets that are only
  counted are not listed or linked (decision 14).

**Why.** The owner checked the Forecasts and Anomalies pages on the demo host
on 2026-11-17 and found them hard to read: a long table of scores and
quantiles, with every organization mixed in one list. They asked for each
organization's findings in simple English, with an organization and site
filter. The two tables stay; a summary goes above them.

**This reverses parts of earlier rulings, so it names them.**

- Amendment 3 R-g and Amendment 5 ruling 4 say no forecast or anomaly reaches
  "a copilot answer". This amendment lets the existing LLM path (ADR 0099 /
  ADR 0090 Amendment 1) **write one advisory paragraph from the summary
  facts**, on the surfaces in decision 9 only. It is not a copilot answer: no
  user types anything, there is no chat, no tool and no write.
- Amendment 3 R-g and Amendment 5 ruling 4 say no forecast or anomaly reaches
  "an alarm". This amendment lets the forecast summary **say** that a point's
  forecast is expected to cross that point's alarm-rule threshold. It
  **raises nothing**: no row in `bms.alarms`, no notification, no work
  order.
- Amendment 6 (ADR 0136) stays as it is; this amendment adds a second,
  separate exception and does not widen the alarm-panel line.
- Still forbidden, unchanged: a score or forecast raising an alarm, sending a
  notification, opening a work order, or appearing in a report, an export, the
  copilot chat or a copilot read tool; an accuracy figure; any threshold
  change. `ANOMALY_UNUSUAL_SCORE` stays 0.99 until the owner rules after the
  one-week read (about 2026-11-23).

**The calibration caveat shapes the words.** On the demo host the Baseline
detector (`baseline_mad`) marks about **7 %** of asset-hours as unusual
against a design of about 1 %; the Isolation Forest about 1.4 %. So every
surface here presents **a mark from the Baseline method alone as a weak
signal**, and **a mark where both detectors agree as the strongest signal**.
That wording is fixed text in the facts (decision 2) and a required word in
the AI paragraph (decision 5), not a choice the model makes.

### Owner rulings (2026-11-17, in chat)

1. **Summary text = facts plus an AI paragraph** *(owner, 2026-11-17)*.
   - **Facts**: fixed sentences built from the same numbers the summary
     shows. Always shown, one card per organization (decision 2).
   - **AI paragraph**: above the facts, labelled **"AI-written · advisory"**,
     written by the copilot LLM path in `apps/api`. The LLM gets **only the
     facts**, never raw telemetry or ids it does not need. Each number in its
     text must appear in the facts, or the paragraph is not shown and the
     facts stay. It fails closed: no LLM, an error or a timeout → facts only,
     no error banner. It is cached, so a page view does not call the LLM each
     time; the unit is one paragraph per organization (and site, if
     filtered) per ML cycle (decisions 4–7).
2. **Filter = organization + site** *(owner, 2026-11-17)*, reusing the shared
   `ScopeFilterBar` / `useScopeFilter` / `GET /filter-options`, as `/alarms`
   does, under the AGENTS.md §4.2 rule and its traps (URL state, a locked
   single organization, `isPending` not `isLoading`). "All" shows one summary
   card per organization. The API still filters by `readableAssetIds`
   (Amendment 3 S1) (decision 8).
3. **Forecast vs alarm limits = yes** *(owner, 2026-11-17)*. The forecast
   summary may say when a point's p50 (or band) is expected to cross that
   point's alarm-rule threshold, and when, labelled advisory. Thresholds come
   from the existing rules for that asset point. This text creates no alarm,
   notification or work order (decision 3).
4. **Built in a cloud session** *(owner, 2026-11-17)*.

### Decisions

1. **Where it shows** *(owner rulings 1–2; the control room and dashboards are
   question **Q5**)*. A **"Findings — advisory"** section at the top of
   `/forecasts` and `/anomalies`, under the `PageHeader` and the filter bar,
   above the existing `SectionCard` table. One card per organization in the
   filtered scope, sorted by organization code. The tables stay and obey the
   same filter. The same card also appears in the control room and as a
   dashboard widget (decision 13), and every asset it names is a link
   (decision 14). Mockups have no such screen, so it keeps the list language
   (AGENTS.md §5): `SectionCard`, `StatusPill tone="info"` for *Advisory*, the
   `ink` roles; never an alarm or severity colour.

2. **The facts** *(owner ruling 1; exact wording is the plan's, inside these
   lines)*. Built by **pure functions** on the server from the same reads that
   feed the page, so the web and the LLM see the same sentences. Times are in
   each site's zone (Amendment 3 C7); values keep the point's unit. At most
   **8 lines** per card; a card with nothing to say shows one line ("No
   forecast points for this organization." / "No unusual hours in the last
   7 days on N scored assets.").

   *Forecasts* (per organization, the latest succeeded run per point,
   Amendment 3 C3):
   - **F1 count and freshness**: "16 forecast points, issued at 14:05; 0
     stale." (Stale = Amendment 3 C3.)
   - **F2 lowest and highest expected p50**, per point key (values of two
     point keys are never compared): asset, value, time. For a `°C` point the
     words are *coldest / warmest*, else *lowest / highest*.
   - **F3 largest change from the last 24 h**: per point key, the point whose
     p50 moves furthest from **its own mean of the last 24 h of `_1h`
     actuals**, with the signed change, the unit and the hour. A point with
     fewer than 12 actual hours in that window is left out of F3.
   - **F4 least certain point**: per point key, the widest p10–p90 band in
     the next 48 h, with its width and hour.
   - **F5 limit crossings** (decision 3).
   - At most **3 point keys** per card, those with the most points first;
     the line "and N more point types" covers the rest.

   *Anomalies* (per organization, last 7 days, `score ≥
   ANOMALY_UNUSUAL_SCORE`, newest run wins as in the list, Amendment 5 A-e):
   - **A1 the size**: "21 unusual hours in the last 7 days, on 7 of 18
     scored assets." An *unusual hour* is one `(asset, hour)` with at least
     one detector at or above the line, so an hour both detectors mark counts
     once. *Scored assets* are the assets in scope with any score row in the
     window. This needs a count read, not the 500-row list (decision 10).
   - **A2 both detectors agree — named first, as the strongest signal**: each
     asset with an hour both detectors marked, its hours and last time. If
     none: no A2 line.
   - **A3 the top assets**: up to 5, by unusual hours, each with its hours,
     its last unusual time and its contributing points (the union of the top
     points, at most 3).
   - **A4 the method line**, always present when A1 > 0: either "All marks
     come from the Baseline method only. On their own they are a weak signal
     while that method's marking rate is being checked." or, when some come
     from both, "Marks from the Baseline method alone are a weak signal;
     marks from both methods are the strongest."
   - The *Detector* names on screen stay `detectorLabel`'s.

3. **Forecast vs alarm-rule limits** *(owner ruling 3; the covered shapes are
   recommended)*. Read from `bms.automation_rules` for the forecast's own
   `(asset_id, point_key)`, in the same organization.
   - **Covered**: `rule_type = 'threshold'`, `enabled`, `lifecycle_status =
     'published'`, `operator` one of `gt`, `gte`, `lt`, `lte`, a non-null
     `threshold_value`, condition `{ window: "latest" }`. If its `condition.unit`
     is set and differs from the point's unit, the rule is skipped.
   - **Skipped, said in the ADR so nobody expects them**: `eq` (an hourly mean
     "equals" a value only by chance; on/off points are not forecast);
     `time_window` rules (no threshold); draft, archived or disabled rules;
     rules on another point or asset; a maintenance window (ADR 0131) is not
     read, because nothing is raised.
   - **The test**: the first future hour where `compare(p50, op, threshold)`
     (the same `compare` as `rule-evaluation.ts`) is true → "expected to
     cross". If p50 never crosses but the band edge does (p90 for `gt/gte`,
     p10 for `lt/lte`) → "may cross (upper/lower band)". If the first hour
     already matches → "is forecast beyond the limit from now" — the Alarms
     page is where the live state is. One line per crossing, at most 3 per
     card, earliest first.
   - **The words**: "Advisory: [asset] [point] is expected to go above the
     limit of rule [rule] (−15 °C) at 03:00." The rule is named by its
     `name`, never its severity, and never in a severity colour.
   - **A known gap, stated in the line's tooltip**: the alarm engine compares
     each raw sample; the forecast is an hourly mean, so a short spike above
     the limit can raise an alarm the forecast never shows, and the reverse.
   - Access: a rule line is built only for an asset the caller can read; the
     rule read carries the organization id by hand on the fleet branch, as
     ADR 0059 decision 9 requires.

4. **The AI paragraph: which key, which switch** *(recommended, **Q1**,
   **Q2**)*. One paragraph per organization card. `LlmResolver.resolveForOrganization`
   for **that card's organization** picks the key (the organization's own,
   else the platform default); `guided` → no paragraph. It runs **only when
   that organization's copilot switch** (`bms.copilot_org_settings`,
   `orgEnabled()`) is on — the same switch that already means "this
   organization's data may go to its LLM provider". A multi-organization view
   makes one call per organization, never one call with two organizations'
   facts (ADR 0099 decision 10).
   - **A separate model for the findings paragraph** *(owner, 2026-11-17,
     after acceptance: "yes, add the OpenRouter setting as recommended")*.
     Two new, optional server variables: `ML_FINDINGS_LLM_PROVIDER`
     (`openai | openrouter | anthropic`) and `ML_FINDINGS_LLM_MODEL` (for
     example a small open-source model on OpenRouter). The key is that
     provider's **existing** variable (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`,
     `ANTHROPIC_API_KEY`); there is no new secret. A new method,
     `LlmResolver.resolveForFindings(organizationId)`, keeps `LlmResolver` the
     only reader of these variables, and decides in this order:
     1. The organization has its own `organization_llm_settings` row → that
        row decides, exactly as `resolveForOrganization` does today (its own
        key and model, or no paragraph). The findings variables never apply
        to it, so its data never goes to the platform key (ADR 0090
        Amendment 1 A4).
     2. No row, and `ML_FINDINGS_LLM_PROVIDER` is set → that provider with
        `ML_FINDINGS_LLM_MODEL` and that provider's key. If the model or the
        key is missing → **no paragraph** (facts only) and one boot warning
        naming the missing variable. It never falls back to the copilot's
        model, so a cheap choice never turns into a dearer one by accident.
     3. No row, and the findings variables are empty → the platform default
        (`LLM_PROVIDER`), as `resolveForOrganization` does.
     The copilot and the onboarding agent are unchanged. The two variables go
     into `.env.example` and the `api` service of both compose files
     (`docker-compose.yml`, `deploy/aws/docker-compose.yml`), in `E1.9c`.
     The organization copilot switch (Q2) is still the consent: with the
     switch on, the pseudonymised facts may go to whichever provider this
     order picks. **Data note:** OpenRouter forwards a request to the model's
     host; only placeholder text leaves the server, and the operator should
     turn off prompt logging and training in the OpenRouter account. A small
     model fails the guard more often; each failure shows the facts only.

5. **The guard — what makes a paragraph shown** *(owner ruling 1;
   details recommended)*. A pure function `checkFindingsParagraph(text,
   facts)` returns `ok` or a fixed reason. Shown only when **all** hold:
   - **Numbers**: every numeric token in the text (`-?\d+(\.\d+)?%?`, after
     the placeholders below are removed) is equal, as a string after
     normalising `−` to `-`, to a number that appears in the facts text that
     was sent. Spelled-out numbers (*one*…*twenty*, *dozen*, *half*,
     *twice*, *double*, *triple*, *percent*) are refused, so the rule cannot
     be dodged.
   - **Names**: every placeholder in the text (decision 6) is one that was
     sent; no other bracketed token.
   - **The weak/strong rule**: if the facts carry A4's Baseline-only
     sentence, the text contains the word **"weak"**; if they carry an A2
     line, the A2 asset's placeholder appears before any other asset's.
   - **Tone**: none of *emergency, danger, dangerous, urgent, immediately,
     failure, failed, fault, faulty, broken, critical* (case-folded).
   - **Shape**: plain text, one paragraph, at most 600 characters, no URL,
     no markdown, no line break.
   - The provider returned `final` (a `tool_calls` reply is refused), within
     the **15 s** timeout (`AbortSignal`), with no exception.
   Any failure → **no paragraph, facts only, no banner**.
   - **The facts never depend on the LLM** *(owner, 2026-11-17: "only the AI
     advisory will not be there … the normal advisory will be there")*. They
     come from a separate route (decision 10) that makes no LLM call, so they
     render the same whether or not any AI exists. Each of these shows the
     facts and no paragraph, with no error text to any reader: no platform
     key and no organization key (`guided`); the organization's copilot switch
     off; an organization LLM row that is `off` or incomplete; the provider
     refusing the key (401/403); **no balance or quota left** (the provider's
     402, 429 or credit-balance error); a rate limit; a 5xx or network error;
     the 15 s timeout; a reply the guard refuses; the daily cap (Q4) reached.
   - An administrator who wants to know why there is no paragraph checks the
     organization's LLM settings page (ADR 0090 Amendment 1 A5); the page
     itself never says. A provider error is stored as `failed` and retried for
     that key after 30 min (decision 7); a refused call is not billed by the
     provider, so a dead key costs nothing but the retry.
   The outcome is
   logged with the fixed reason and the organization id only (§9.6: never the
   text, never the facts). The prompt tells the model the same rules, but the
   check is what holds them.

6. **What leaves the host** *(recommended, **Q3**)*. Before sending, the
   facts are **pseudonymised**: each site, asset (`assetLabelOf`) and rule
   name becomes a placeholder (`[S1]`, `[A1]`, `[R1]`), and each clock time
   `[T1]`, all from a deterministic map kept on the host. The reply is
   checked (decision 5) and the placeholders are put back on the host.
   - **Sent**: the fixed sentence templates; point keys (`cold_room_temp_c`,
     `kw` — generic vocabulary); units; numbers; counts; the detector names
     *Baseline* and *Isolation Forest*; placeholders.
   - **Never sent**: organization, site, asset, RTU or rule names; any id;
     raw `_1h` rows or score rows; user names, e-mail or role; credentials or
     keys. The organization's name is not in the prompt at all.
   - The provider is the organization's own (its key, its account) or the
     platform default the operator configured; its retention terms apply to
     what is sent. With pseudonymised facts, what it holds is numbers next to
     generic point keys.
   - The cache (decision 7) stores the **placeholder form**, so the table
     holds no customer names either.

7. **The cache and its storage** *(owner ruling 1; storage and grants
   recommended)*.
   - **Key = `(organization_id, kind, facts_hash)`**, `kind` ∈
     `forecasts | anomalies`, `facts_hash` = SHA-256 of the canonical
     pseudonymised facts. Facts change when a new ML cycle lands, so this is
     one paragraph per organization (and site, and access scope) per cycle.
     **Keying by the facts, not only by organization and site, is a security
     property**: a location-scoped user's facts differ from an organization
     admin's, so they can never be served a paragraph written from assets
     they cannot read.
   - **When it is made**: lazily, on the first read of that key — no
     background job, no new queue. The facts route never waits for it: the
     paragraph has **its own route** (decision 10), as ADR 0136 decision 4
     keeps a slow suggestion from delaying the panel. A miss starts at most
     one call per key in the API process (single-flight); concurrent readers
     get "pending" and the page shows the facts.
   - **A failed or refused attempt is stored too** (status `rejected` or
     `failed`, no text), so a bad key is not retried on every view. A
     `failed` row is retried after 30 min; a `rejected` row is not, for that
     hash.
   - **New table `bms.ml_finding_paragraphs`** — in `bms`, not `ml`, because
     the API writes it and Amendment 3 ruling 2 / A-d keep `bms_tenant` from
     writing anywhere in `ml`. Columns: `id`, `organization_id`, `kind`,
     `facts_hash char(64)`, `status` (`ok | rejected | failed`), `paragraph
     text` (placeholder form, ≤ 600, null unless `ok`), `reason` (fixed
     vocabulary), `provider`, `model`, `created_at`. Unique
     `(organization_id, kind, facts_hash)`. CHECKs on `kind`, `status`,
     the length, and "text iff ok". `organization_id` NOT NULL, RLS ENABLE +
     FORCE, the `tenant_isolation` policy shape of 0157 (the GUC, no `IS NULL`,
     no `OR`).
   - **Grants**: `bms_tenant` `SELECT`, `INSERT`, `DELETE` on that table only
     (`INSERT … ON CONFLICT DO NOTHING`; no `UPDATE` — a retry of a `failed`
     row deletes it and inserts). `bms_fleet` `SELECT` (the multi-org read).
     `bms_auth` nothing. Writes always run in `withTenant(organizationId)` of
     the card's organization, even for a global admin. The migration proves
     itself in a `DO $$` block in the 0158 style.
   - **Retention**: each insert deletes that organization's rows older than
     14 days in the same transaction. At the worst case below that is about
     5,000 rows per organization (~5 MB), small enough not to need a job.
   - **No `ml` schema change**; the `bms-ml-schema-version` marker stays 3;
     `apps/ml` is untouched.

8. **The filter** *(owner ruling 2)*.
   - `ScopeFilterBar` gains an optional `pickers` prop (default: all four, so
     `/alarms` and `/rules` are unchanged); the ML pages pass
     `["organizationId", "locationId"]`. The labels stay *Organization* and
     *Location*, as on `/alarms` (a location covers its subtree, ADR 0098 B5);
     *Site* in this ADR means that picker *(recommended)*.
   - `useScopeFilter` is reused as is: URL state, a single organization
     shown locked and never sent, `ready` gating the reads, `isPending` not
     `isLoading`.
   - `GET /ml/forecasts` and `GET /ml/anomalies` gain optional
     `organizationId` and `locationId` query keys, applied **after**
     `readableAssetIds` the way `/alarms` does (`locationFilter`,
     `alarmLocationIds`): they **narrow and never widen**; an organization or
     location outside scope answers an empty list, not 403 (ADR 0130 P2).
   - "All organizations" → one card per organization that has any row in
     scope; an organization with none gets no card. A locked single
     organization → one card.

9. **Who sees what** *(recommended, **Q1**)*. The facts: everyone who can
   open the page (every signed-in user, rows filtered by access), as today.
   The AI paragraph: the same readers, when it exists. The user sends nothing
   to the LLM and gets back fixed-scope advisory text, so this is not the
   "general AI copilot for operators and viewers" that AGENTS.md §6 keeps out
   — but it **does put LLM-written text in front of operators and viewers for
   the first time**, so Q1 asks the owner to rule it explicitly, and the
   closure records it in §6 through the `chore(agents):` PR.

10. **The API** *(recommended)*. In `apps/api/src/ml/`, under the
    controller's `JwtAuthGuard`, the same `withReadScope` / S1 / S3 / S4 rules:
    - `GET /ml/forecasts/summary?organizationId=&locationId=` and
      `GET /ml/anomalies/summary?…` →
      `{ asOf, cards: [{ organizationId, organizationCode, organizationName,
      facts: [{ id, segments }], assets: [{ ref, assetId, label, href }] }] }`
      (decision 14). Facts only; no LLM. The facts hash stays on the server.
    - `GET /ml/findings/paragraph?kind=&organizationId=&locationId=` → per
      card `{ organizationId, state: "ok" | "none" | "pending", segments }`,
      the paragraph as text segments and asset references (decision 14). It
      recomputes the facts for the caller (never trusts a hash from the
      browser), reads the cache, and on a miss starts the single-flight call.
      `none` covers every fail-closed case without saying which.
    - Contracts in `packages/shared/src/contracts/ml-findings.ts`, types by
      `z.infer` (ADR 0030). New reads: an anomaly **count** statement (unusual
      hours and scored assets per organization, 7 days, bounded like the list),
      the forecast band/peak per point from the current run (the list's read
      gives p50 min/max only), a 24 h `_1h` mean per forecast point, and the
      rule read. Each is bounded by window and scope; the plan shows `EXPLAIN`
      for each and adds an index only if one shows a need.
    - Nothing here is in the copilot catalog or a copilot read tool.

11. **Budget on the demo host** (t4g.large, 2 vCPU / 8 GiB, shared;
    *recommended*). Everything runs in the **existing API process**, on
    request. No new container, compose service, queue, worker job, Python
    code or dependency; the `ml` container's 1 vCPU / 1 GiB is untouched.
    - **CPU/memory**: the summary is a handful of indexed, bounded queries
      and pure string building; target p95 < 300 ms for the facts route on
      the demo host's real rows. The paragraph route is I/O wait on the
      provider, at most one call in flight per key.
    - **LLM cost** (Anthropic list prices read 2026-11-17: Claude Sonnet 5.5,
      the resolver's default Anthropic model, USD 2 / 10 per million input /
      output tokens): one call ≈ 1,500 input + up to ~1,000 output and
      thinking tokens ≈ **USD 0.01–0.013**. Typical day on the demo (two real
      organizations, a few views a day): tens of calls, **under USD 1 a day**.
      Worst case with every key viewed every hour: 24 cycles × 2 kinds ×
      (organizations × (1 + sites) × scope variants) — for the two real
      organizations and their sites about 400 calls, **about USD 5 a day**.
    - **The cap on the AI paragraph** (**Q4**; the facts are never capped):
      at most **200 AI-paragraph attempts per organization per UTC day**,
      counted from that table's own rows (no new counter), about **USD 2.60
      per organization per day** at most. Over the cap → facts only, until
      00:00 UTC. Not counted against the copilot's daily turns.
    - **Egress**: the API already reaches the provider host for the copilot;
      nothing new is opened. If `LLM_PROVIDER` is not set on the demo host,
      every paragraph is `none` and the pages show facts only.

12. **Testing without a live LLM** *(recommended)*.
    - **Unit (Vitest)**: the fact builders against fixtures shaped like the
      real 17 Nov demo data with **made-up names** (repository is public):
      an organization with 16 cold-room forecasts and 21 unusual hours on 7 of
      18 assets, all Baseline; an organization with no forecast points and
      6 unusual hours on 4 of 19 assets, one RTU marked by both detectors
      (A2 first, A4's mixed sentence). Crossings: each covered operator, band
      only, already beyond, each skipped shape. The guard: every refusal
      reason, numbers in a time, a spelled number, an unknown placeholder, a
      missing "weak", the A2 order, the tone list, the length.
    - **Fake `LlmProvider`** (as `agent-loop.spec.ts`): a good reply, a reply
      with an invented number, an exception, a never-resolving promise
      (timeout), a `tool_calls` reply — each leaves `state: "none"` except the
      good one. The prompt sent is asserted to hold no organization, site,
      asset, rule name or id.
    - **Integration (Postgres)**: the migration's proof; RLS and a two-tenant
      fixture (no row of B reaches A's card or cache); a location-scoped user
      gets a different `facts_hash` from the organization admin; filters
      narrow and never widen; the cap.
    - **Web (jsdom)**: the filter shows two pickers and keeps the URL;
      cards per organization; the "AI-written · advisory" label only with
      `ok`; `none` and `pending` show no banner; the table obeys the filter;
      each asset reference renders as a link to the `href` the facts carry
      (forecast: the point charted; anomaly: the hour window), and a paragraph
      reference renders the same link; the control-room cards; the widget's
      config arms and its `paragraph: false` (no paragraph request).
    - **Browser and demo host**: `browser-verifier` locally; the owner's
      demo-host checks at closure.

13. **The control room and a dashboard widget** *(owner, 2026-11-17, Q5:
    both; details recommended)*. One web component, `MlFindingsCard`,
    renders a card from the two routes of decision 10 for a given scope. The
    pages, the control room and the widget all use it, so they read the same
    words and share the cache (decision 7) when the scope is the same.
    - **Control room** (no migration): on the organization page
      (`/control-room/:organizationId`), after *Asset health*, scope = that
      organization; on the site page, in its body (not the wall), scope =
      that location. Compact: the AI paragraph when one exists, else the top
      fact line of each kind (A1, or A2 when present; F1, or F5 when present),
      and links to `/forecasts` and `/anomalies` with the filter set.
    - **Dashboard widget `ml_findings`**, the sixteenth widget kind:
      - **Scope = its dashboard's own scope**, read from `bms.dashboards`:
        the organization, plus the one of `location_id`, `asset_group_id` or
        `asset_id` that is set (`dashboards_scope_check`). The widget binds
        **no point and no source** (`WIDGET_POINT_CARDINALITY` and
        `WIDGET_SOURCE_CARDINALITY` `{0, 0}`, as the `F3.73` site widgets),
        so ADR 0047 decision 3 holds: nothing to bind, options only in JSON.
      - **Config** (renderer options only, `.strict()`): `show`:
        `"both" | "forecasts" | "anomalies"` (default `"both"`) and
        `paragraph`: `true | false` (default `true`; `false` shows facts only
        and never asks for a paragraph, so it adds no LLM cost).
      - **Access is still the viewer's.** The summary routes also accept
        `assetGroupId` and `assetId` (`ScopeFilter`'s other two keys, the
        `/alarms` shape), and each one narrows `readableAssetIds`; none
        widens. A viewer who can open the dashboard but not every asset in its
        scope sees only their own facts: a different facts hash, so a
        different (or no) paragraph.
      - **Migration**: widens `dashboard_widgets_widget_type_check` to sixteen
        kinds, `ml_findings` last, as `0159` and `0161` did; the number is
        taken at build. No other table changes.
      - **Builder palette only**: refused in both template surfaces and in no
        stock template (the rule Amendment 3 R12 set for `forecast`). It binds
        no `kw` point, so ADR 0133 Amendment 2's kW-only hiding leaves it
        drawn. Default size 6×4; the inspector says "Advisory. Forecast and
        anomaly findings for this dashboard's scope."
      - It reads every 15 minutes, the pages' pace; the paragraph route is
        called only while the widget is on screen.
    - Neither surface is on the control-room wall, in a report, an export or
      a notification.

14. **Every asset in a summary is a link** *(owner, 2026-11-17; targets
    recommended)*. Wherever a fact line or the AI paragraph names an asset,
    the name is a link that opens that asset's own forecast or anomaly view
    straight away:
    - **Which assets**: exactly the assets the summary **names** — in a fact
      line or in the AI paragraph — and every one of them. An asset that is
      only counted ("on 7 of 18 scored assets") is not named, so it gets no
      link and the card does not list it. The same asset named twice is
      linked both times.
    - **The target is the asset history page**, `/asset-history/:assetId`,
      where that asset's forecast band (Amendment 3 R-d) and unusual-hour
      marks (Amendment 5 4(b)) are drawn. There is no separate per-asset
      forecast or anomaly page, and this amendment adds none.
    - **A forecast line** (F2–F5) links with **that point charted** on a live
      window, so the band, the p50 and the "Forecast issued … · advisory"
      caption draw (the Forecasts table's own link,
      `assetHistoryPath` + `points=`).
    - **An anomaly line** (A2, A3) links to **the window around that asset's
      last unusual hour, with its contributing points charted** — the
      Anomalies table row's own `historyHref` (t − 24 h to min(t + 24 h, now),
      `fn=avg`), so the marks draw.
    - **In the AI paragraph**, each `[A1]` placeholder (decision 6) is put
      back on the host as the same link the fact line that named that asset
      carries. The browser never builds a link from model text: the route
      returns the paragraph as text segments and asset references, and the web
      renders the reference from the facts' own asset list. A placeholder the
      facts do not hold is already a refusal (decision 5).
    - **"Allowed" is the reader's access, and it already holds.** Facts only
      name assets the reader can read (decision 8), so every link opens; the
      history page still runs its own `canReadAsset` (403 for anyone else).
    - The contract carries it as structured data, not markup: each fact is
      `{ id, segments: [{ text } | { assetRef }] }` plus a card-level
      `assets: [{ ref, assetId, label, href }]`, `href` built on the server
      from the rules above.
    - Site names in a line link to the page itself filtered to that location
      (`?locationId=`), the filter's own URL state *(recommended)*.

### Open questions for the owner

1. **Q1 — Who sees the AI paragraph?** (a) Everyone who can open the page,
   operators and viewers included; (b) the four administrator roles only, the
   facts for everyone. **Recommended: (a).** No user input reaches the LLM,
   the text is checked against the facts and labelled advisory, and the facts
   it rewords are already shown to the same people. It is still the first
   LLM text operators and viewers see, so it needs your explicit yes; the
   closure then records it beside the §6 copilot line.
2. **Q2 — Which switch turns the paragraph on?** (a) The existing
   organization copilot switch; (b) a new per-organization switch just for
   this. **Recommended: (a)** — that switch already means "this
   organization's data may go to its LLM provider", and (b) needs another
   migration and an admin screen. With (a), an organization that has the
   copilot off sees facts only.
3. **Q3 — Pseudonymise names before sending?** **Recommended: yes**
   (decision 6). Site, asset and rule names never leave the host; the model
   writes placeholders that are put back locally. The cost is a slightly
   stiffer paragraph. If no, the labels as shown on screen are sent.
4. **Q4 — The daily cap on the AI paragraph** (the facts are never capped).
   **Recommended: 200 attempts per organization per UTC day** (about USD 2.60
   at most). Why not 48, the first draft's number: the facts change every
   hourly cycle, and the guard needs the paragraph's numbers to match the
   current facts, so each scope that is viewed needs a new paragraph each
   cycle — 24 cycles × 2 kinds = 48 for the organization view alone. The site
   filter, the control-room site cards and dashboard widgets (each its own
   scope, decision 13) add keys. Above the cap → facts only. Say a different
   number if you want one.
5. ~~**Q5 — The control room and dashboards**~~ **Ruled 2026-11-17: (a) and
   (b) both in** (decision 13; the text below is kept as drafted). (Raised by
   the owner while this was drafted: "see whether it can be added in the control room or dashboards
   as well for the relevant organizations and relevant locations").
   - **(a) Control room — recommended yes, in this row.** A compact
     *Findings — advisory* card on the organization page
     (`/control-room/:organizationId`, after *Asset health*) for that
     organization, and on the site page for that location (its body, not the
     wall). It shows the AI paragraph when one exists, else the top fact line
     of each kind (A1/A2, F1/F5), and links to `/forecasts` and `/anomalies`
     with the filter set. It calls the same summary and paragraph routes with
     `organizationId` / `locationId`, so it **shares the cache** and adds no
     LLM call for the same scope. No migration.
   - **(b) A dashboard widget — recommended later, its own row and
     amendment.** A new `ml_findings` widget kind would take the dashboard's
     own organization/location scope (`bms.dashboards.location_id`), which no
     widget kind does today (they bind points or sources, ADR 0047 decision
     3); it needs a sixteenth widget-kind migration and a binding rule. The
     existing `forecast` and `anomaly` widgets already cover one point.
   - If (a) is no, the summary lives on the two pages only.

### Rulings

| # | Question | Ruling (owner, 2026-11-17) |
|---|----------|----------------------------|
| **Q1** | Who sees the AI paragraph | **As recommended:** everyone who can open the page, operators and viewers included; recorded beside AGENTS.md §6's copilot line at closure |
| **Q2** | Which switch | **As recommended:** the organization's existing copilot switch |
| **Q3** | Pseudonymise names before sending | **As recommended:** yes (decision 6) |
| **Q4** | Daily cap on the AI paragraph | **As recommended:** 200 attempts per organization per UTC day; facts never capped |
| **Q5** | Control room and dashboards | **Both in** (decision 13), ruled before acceptance |

### PR split *(recommended; the plan confirms)*

| Child | Scope | Reviews |
|---|---|---|
| `E1.9a` | Contracts, fact builders (pure), the forecast-vs-limit rule, the count/band/24 h/rule reads, both summary routes, `organizationId`/`locationId` on both list routes. No LLM, no migration | code, compliance, security |
| `E1.9b` | Web: `ScopeFilterBar` `pickers`, the filter on both pages, the facts cards | code, compliance |
| `E1.9c` | Migration (`bms.ml_finding_paragraphs`, grants, proof), the guard, pseudonymisation, the paragraph route, cache, single-flight, cap | code, compliance, **security**, **migration** |
| `E1.9d` | Web: the "AI-written · advisory" paragraph slot | code, compliance |
| `E1.9e` | `MlFindingsCard` on the control-room organization and site pages (decision 13) | code, compliance |
| `E1.9f` | The `ml_findings` widget kind: its migration, the write arm and cardinality, the renderer, the builder palette (decision 13) | code, compliance, **migration** |

Then the closure docs PR and the `chore(agents):` PR (§3 *Layout*: the new
routes, contract and table; §4.2: the `pickers` prop; §6: the Q1 ruling).
This is **not a §6 promotion of the copilot**: no chat, no tool, no write
reaches operators or viewers.

**Not in this amendment:** an alarm, notification, work order, report or
export from a finding; the copilot chat or a copilot read tool over findings;
the widget in a stock template or on the control-room wall; a new per-asset
forecast or anomaly page (decision 14); any threshold or detector change; an accuracy
figure; a new Python job or any `apps/ml` change; a new asset class; the owed
`bms_ml` role.

**Demo-host checks the owner runs after deploy** (this session cannot reach
the host): `/forecasts` and `/anomalies` as a global admin with "All" (one card
per organization; the WBLDC-like card says 16 points, the PHEWB-like card says
no forecast points; anomaly cards say 21 on 7 of 18 and 6 on 4 of 19, the
both-detector RTU named first), then filtered to one organization and one site
(the table follows; the URL survives a reload); as a location-scoped user (only
that site's facts; a paragraph different from the admin's); whether
`LLM_PROVIDER` is set and an organization's copilot switch is on (paragraph
shown with the label, or facts only with no banner); the facts route p95 and
the paragraph route's first and cached times; a row count in
`bms.ml_finding_paragraphs` after a day; `docker stats` for `api` unchanged
in shape and `ml` untouched; an asset link in a forecast line and in an
anomaly line (and in the AI paragraph, when shown) opens that asset's history
with the band or the marks drawn; the control-room cards on one organization
and one site; an `ml_findings` widget added on a temporary dashboard of each
scope kind (organization, location, asset group), saved, and drawn after a
hard reload; a widget with `paragraph: false` makes no paragraph request; and
with `LLM_PROVIDER` unset (or the switch off), every surface shows facts and
no banner.

## Amendment 9 — pointer: anomaly history beside the asset health score (2026-11-17)

**Status: Proposed — 2026-11-17**, with [ADR 0050 Amendment 5](./0050-asset-health-score.md)
(`E1.8`). This is a pointer, so a reader of Amendment 5 here finds the
exception. The decision itself lives in ADR 0050 Amendment 5.

If accepted, it adds a **third** exception to Amendment 5 ruling 4, after
Amendment 6 (the alarm-panel context line) and Amendment 8 (the findings):
an asset's health read may show an **advisory figure** equal to its rule-based
health score minus a capped anomaly penalty, and a **"Bad actors — advisory"**
list ranked by unusual hours. Until the owner's one-week detector read (about
2026-11-23) only hours **both** detectors mark count, and the penalty is
capped at 0.05. `E1.3`'s score, bands, donut and the `assets.health.score`
metric do not change. A score still raises no alarm, sends no notification,
opens no work order, and appears in no report, export or copilot answer. No
threshold or detector constant changes, and `apps/ml` does not change.
