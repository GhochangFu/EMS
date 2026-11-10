# ADR 0124 — Isolated integration databases with testcontainers (`F4.5`)

## Status

**Accepted — 2026-11-10** (owner, in chat: "Accept ADR 0124, yes to the
plan"; proposed the same day). Drafted by an agent for backlog row `F4.5`
(*Integration tests w/ testcontainers: PG + Timescale + Redis*, P1), one of four
P1 rows drafted in parallel overnight (0122 `E3.1`, 0123 `E7.2`, 0125 `F4.17`).
The owner answered all nine open questions in chat the same day, one at a
time, each with the recommended option (listed under *Rulings*), so decisions
1–11 stand as written. The plan is
[`docs/plans/f4.5-testcontainers.md`](../plans/f4.5-testcontainers.md), approved
in the same message.

No figure in this record was measured. The container daemon was not reachable
in the drafting session, so clone times, template-build time, CI minutes and
memory are estimates and are labelled so. PR 1 of the plan measures them before
any suite moves.

## Rulings

Given by the owner in chat on 2026-11-10, one question at a time. Each picked
the recommended option, so decisions 1–10 below stand as written.

1. **Package** — `testcontainers` core only, `GenericContainer`, pinned
   exactly `12.2.1` (no caret). Not the `@testcontainers/postgresql` or
   `@testcontainers/redis` modules.
2. **Containers** — one TimescaleDB and one Redis container per test run.
3. **Databases** — one database per Vitest worker, copied from
   `bms_template`.
4. **CI** — the test step uses the container mode; the `services:` and the
   migrate/seed/refresh/Keycloak validation steps stay.
5. **Image** — `timescale/timescaledb:2.29.1-pg16`, the tag CI and compose
   pin.
6. **Fallback** — a set `DATABASE_URL` wins and still gets per-worker copies
   on that server; no Docker and no `DATABASE_URL` skips locally and refuses
   under `CI`; no container reuse between local runs in the first version.
7. **Rollout** — batches behind the `NOT_YET_ISOLATED` ratchet.
8. **Absorbed rows** — after the last PR re-measures them, close `F4.66`,
   `F4.70` and `F4.242` as absorbed; keep `F4.65` open for the external mode.
9. **`maxWorkers`** — `F4.71`'s rule: raise to 4 only if every measured run
   at 4 is green, `F4.271`'s timeouts counted.

## Context

**What runs today.** 318 integration files (255 in `apps/api`, 2 in
`apps/ingest`, 61 in the top-level `tests/` project) share **one** Postgres +
TimescaleDB database and **one** Redis:

- Locally, whatever `DATABASE_URL` names — normally the compose database on
  `:5432`, the same one the running stack and every worktree use.
- In CI (`.github/workflows/ci.yml`, job `build-and-migrate`), the job's
  `services:` containers `timescale/timescaledb:2.29.1-pg16` and
  `redis:7-alpine`, prepared by the steps `db:roles` → `db:migrate` →
  `db:seed` → one telemetry row → `db:refresh-aggregates` → Keycloak
  provisioning, then `pnpm test:coverage`.

Each suite gates itself through `requireIntegrationDb`
(`apps/api/src/testing/integration-db-gate.ts`, 327 files) and
`requireIntegrationRedis` (8 files): unset skips locally and **refuses under
`CI`**; set is a claim that the server exists. 185 integration files also read
`process.env.DATABASE_URL` directly. The role URLs (`bms_owner`, `bms_fleet`,
`bms_auth`, `bms_app`) are derived from `DATABASE_URL` by swapping only the user
and password, so the database name travels with it (ADR 0045).

**What sharing has cost.** `vitest.config.ts` caps `maxWorkers` at 2
(`F4.71`) because concurrent files on one database adopt, count or delete each
other's rows. The rows that record it:

| Row | Mechanism | Fixed by a per-worker database? |
|---|---|---|
| `F4.65` | a file's prefix sweep deletes a *concurrent instance of itself* (two runs on one database: worktrees, `test:watch` beside `test`) | **yes** in container mode — each run has its own server; **no** for a developer who points at a shared database |
| `F4.66` | whole-table counts read twice while another suite commits | **yes** — no other file writes the worker's database during the read |
| `F4.70` | an interrupted run leaves fixture organizations that sort before `ESKOM` | **yes** in container mode (a fresh server per run); **no** on a reused database |
| `F4.242` | nine suites write assets into the seeded `RSMOC-WC` location while others read it | **yes** for the cross-worker race; files in one worker still run one after another |
| `F4.71` (✅) | positional reads, a shared cap row, `55P03` on shared aggregates | its fixes stay; a per-worker database removes the cross-file half of `55P03` |
| `F4.160`, `F4.165` | web specs reach a live API / timing on CI | **no** — not a database; out of scope |
| `F4.271` | repo-scanning tests time out under a full parallel run | **no** — and raising `maxWorkers` would make it worse |

`F4.9` (coverage gates) depends on `F4.5`–`F4.10`; `F4.10` is done, so this row
is the last thing holding it.

**What isolation needs.** The expensive part of a database here is not the
server but its preparation: five roles, every migration as `bms_app`, then the
seed as `bms_owner` under `FORCE ROW LEVEL SECURITY`. Doing that per file or
per worker would cost minutes. PostgreSQL's `CREATE DATABASE … TEMPLATE`
copies a prepared database in one statement; roles are cluster-wide, grants and
RLS policies travel with the copy. So the design is: prepare once, copy per
worker.

## Decision

1. **One server pair per test run, prepared once.** A Vitest `globalSetup`
   starts one TimescaleDB container and one Redis container through
   `testcontainers`, on the exact tags CI and compose use
   (`timescale/timescaledb:2.29.1-pg16` with `max_worker_processes` raised as
   in `docker-compose.yml`; `redis:7-alpine` with `--maxmemory-policy
   noeviction`). Not a container per worker: each Timescale container costs
   startup time and memory, and the isolation comes from databases, not
   servers. *(Open question 2.)*

2. **A template database built by the same commands CI runs.** On the
   container, `globalSetup` runs `pnpm --filter @bms/db roles`, `pnpm
   db:migrate` and `pnpm db:seed` with the container's URLs (superuser as
   `bms_app`, seed as `bms_owner`), into a database named `bms_template`, then
   marks it `IS_TEMPLATE true, ALLOW_CONNECTIONS false` so no TimescaleDB
   background worker holds it open. The CLIs are spawned, not imported, so
   `packages/db` does not change and the template is built exactly as CI and a
   developer build theirs. Any CI preparation a suite depends on (the one
   telemetry row, `db:refresh-aggregates`) is added only if PR 1's inventory
   shows a suite needs it.

3. **One database per Vitest worker.** A `setupFiles` entry, run before each
   test file is imported, creates `bms_w<VITEST_POOL_ID>` from the template the
   first time a worker needs it and points every variable at it:
   `DATABASE_URL`, `DATABASE_URL_SUPERUSER`, `DATABASE_URL_FLEET`,
   `DATABASE_URL_AUTH`, `DATABASE_URL_TENANT`. Files in one worker run one after
   another on that database, as files on today's shared database already do in
   between their siblings; their per-run ids and cleanup rules stay. A database
   per **file** is the fallback if PR 1 measures the copy as cheap enough or the
   migration batches find files that leak into the next one. *(Open question 3.)*

4. **Redis isolated by database index.** The same setup file sets
   `REDIS_URL=redis://host:port/<VITEST_POOL_ID>`. BullMQ accepts a database
   index on a standalone server; the suites' per-run queue prefixes stay.
   `maxWorkers` stays at or under 15 (indexes 1–15; 0 is unused).

5. **Mode is chosen once, and the CI asymmetry is kept.** `globalSetup` reads
   one verdict, as a pure function with a spec, in this order:
   - `BMS_TEST_DB=external` **or** `DATABASE_URL` set → **external**: use that
     server. With a superuser URL available it still builds the template and
     the per-worker copies there (isolation on the compose server too);
     `BMS_TEST_DB=shared` keeps today's single shared database as an escape
     hatch.
   - otherwise, Docker answers → **containers**.
   - otherwise → **skip** locally, with one message naming Docker and the
     `DATABASE_URL` alternative; **refuse under `CI`**, as both gates do today.

   `requireIntegrationDb` and `requireIntegrationRedis` keep their contract
   unchanged: by the time a suite calls them, the variables are set or the run
   was refused. *(Open question 6.)*

6. **Suites move in batches behind a ratchet, not in one switch.** A list
   `NOT_YET_ISOLATED` (in the repo's `NOT_YET_PER_RUN` style) names the files
   that still get a single shared copy, `bms_shared`, which reproduces today's
   behaviour on the new server. A `tests/` invariant fails in both directions:
   a listed file that no longer exists, and an unlisted file added to the list.
   Each batch PR removes a set of files from the list and proves them green.
   *(Open question 7.)*

7. **CI runs the container mode; the services stay for the validation steps.**
   The test step of `build-and-migrate` unsets nothing it needs for the
   Keycloak/MinIO/Mosquitto specs, sets `BMS_TEST_DB=containers`, and lets
   `globalSetup` start its own pair. The image tags are the ones the
   `services:` already pulled, so no second pull. Ryuk (testcontainers' reaper
   container) is disabled in CI with `TESTCONTAINERS_RYUK_DISABLED=true`: the
   runner is discarded, and it saves a Docker Hub pull. The services and the
   `db:migrate`/`db:seed`/`refresh-aggregates`/Keycloak steps stay as the
   migration gate; folding them into the template build is a later row.
   *(Open question 4.)*

8. **`maxWorkers` stays 2 until measured.** The last PR measures the full
   suite at 2 and at 4 on the container mode and applies `F4.71`'s owner rule
   (4 only if every run at 4 is green), with `F4.271`'s timeouts counted.

9. **Coverage must not move.** The denominator (`coverage.include`) is not
   touched. Each batch PR records `test:coverage` before and after; a drop
   beyond noise means a suite stopped running and blocks the PR.

10. **The fixture rules stay.** `tests/integration-fixture-isolation.test.ts`,
    the `F4.53` ordering rule and per-run ids still guard the external mode and
    every real database the suites run against. `F4.65`, `F4.66`, `F4.70` and
    `F4.242` are re-measured in the last PR and the owner decides, per row,
    whether to close it as absorbed or keep it for the external mode.
    *(Open question 8.)*

11. **Docs.** `docs/local-setup.md`, `README.md` and
    `.claude/skills/verify/SKILL.md` §1 describe the three modes. AGENTS.md
    §4.6's "Integration suites gate on `DATABASE_URL`" paragraph is owed a
    `chore(agents):` edit after the build (§10.1), tracked in
    `docs/BACKLOG.md` §5.

## Dependencies

All in the **root** `package.json` `devDependencies` (the `globalSetup` is in
the root `vitest.config.ts`); none ships in an image.

- **`testcontainers` `12.2.1`** (published 2026-10-13; `engines.node >=
  22.22`, inside the repo's `>=24.22.1`). MIT. Its direct dependencies come
  with it: `dockerode`, `docker-compose`, `undici`, `tar-fs`, `archiver`,
  `get-port`, `proper-lockfile`, `async-lock`, `ssh-remote-port-forward`,
  `properties-reader`, `byline`, `tmp`, `debug`, `@balena/dockerignore`,
  `@types/dockerode`.
- **Not** `@testcontainers/postgresql` or `@testcontainers/redis` (both
  `12.2.1`): `GenericContainer` with an explicit wait strategy is enough, and
  it keeps one package fewer. *(Open question 1.)*
- **One new image at run time, locally only:** `testcontainers/ryuk`, pulled
  by the library to remove containers when the process dies. CI disables it.

## Consequences

- **Good.** Suites on different workers can no longer see each other's rows,
  so the shared-database flake family loses its cause rather than another
  symptom. `pnpm test` works on a machine with Docker and no compose stack.
  Two runs (worktrees, watch beside a full run) no longer share a database.
  `F4.9` is unblocked.
- **CI minutes (estimate, unmeasured).** Added: container start (~10 s, images
  cached) and one template build (roles + migrate + seed; estimated 1–2 min).
  Possibly recovered: a higher `maxWorkers` if decision 8 allows it. The
  `docs-only-tests` job is unchanged. PR 1 measures the real cost before the
  owner commits to the CI switch.
- **Memory (estimate).** One Timescale server with N small databases plus one
  Redis: roughly 0.5–1 GB, inside Docker Desktop's default WSL2 limit and a
  GitHub runner's 7 GB. A container per worker would multiply it.
- **TimescaleDB background workers.** Each database with the extension runs
  its own scheduler and its own jobs, so N worker databases need
  `timescaledb.max_background_workers` and `max_worker_processes` raised with
  N. PR 1 measures that every worker database's policies still start, because
  a silently failed policy is the `F4.2` failure `docker-compose.yml` records.
- **Risks the spike must clear first.** `CREATE DATABASE … TEMPLATE` with
  TimescaleDB installed (hypertables, continuous aggregates, jobs) must produce
  a working copy; `VITEST_POOL_ID` must still be set by Vitest 4.1's pools;
  a suite may depend on CI-only preparation or on a database being literally
  named `bms`. If any fails, the plan stops and comes back to the owner.
- **What it does not fix.** Leaks between files that share one worker,
  `F4.160`, `F4.165` and `F4.271`.
- **Owed.** The AGENTS.md §4.6 edit (decision 11) and, if decision 7's later
  row is taken, removing the CI `services:`.

## Open questions for the owner (in order)

All nine answered 2026-11-10 (see *Rulings*). Kept as asked, for the record.

1. **Package.** (a) `testcontainers` core only, `GenericContainer` — *recommended*;
   (b) core plus `@testcontainers/postgresql` and `@testcontainers/redis`;
   (c) no library: `docker run` from a script. Pin exactly `12.2.1` (*recommended*,
   test infrastructure talking to the Docker API) or caret `^12.2.1` as the
   repo usually does?
2. **Container granularity.** (a) one Timescale + one Redis per run —
   *recommended*; (b) one pair per worker; (c) one pair per file.
3. **Database granularity.** (a) one database per worker, copied from a
   template — *recommended*; (b) one database per file (complete isolation,
   cost measured in PR 1); (c) no template, migrate + seed per worker.
4. **CI.** (a) the test step uses the container mode; the `services:` and
   validation steps stay — *recommended*; (b) the test step clones on the
   existing service (external mode), so testcontainers runs only locally;
   (c) as (a) and remove the services in the same row. Accept an estimated
   +1–2 min per full run before measurement, or only after PR 1's number?
5. **Timescale image.** Keep `timescale/timescaledb:2.29.1-pg16`, the tag CI
   and compose pin — *recommended*; or `-ha`, or a later tag (a separate
   decision under ADR 0023).
6. **No Docker / a set `DATABASE_URL`.** (a) as decision 5: `DATABASE_URL`
   wins and gets per-worker copies on that server, no Docker skips locally and
   refuses in CI — *recommended*; (b) containers always, `DATABASE_URL`
   ignored by the suites; (c) per-worker copies only in container mode, the
   external mode stays shared. Also: allow container reuse between local runs
   (`withReuse`, faster, risk of stale state) — *recommended no* for the first
   version.
7. **Migration path.** (a) ratchet list, batches by project and directory as in
   the plan — *recommended*; (b) one switch for all 318 files.
8. **Rows it absorbs.** After the last PR's measurement, close `F4.66`, `F4.70`
   and `F4.242` as absorbed and keep `F4.65` for the external mode —
   *recommended*; or keep all four open until each is fixed at its own site.
9. **`maxWorkers`.** Keep `F4.71`'s rule (raise to 4 only if every measured
   run at 4 is green) — *recommended*; or stay at 2 regardless.
