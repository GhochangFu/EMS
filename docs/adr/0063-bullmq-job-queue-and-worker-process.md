# ADR 0063 — A BullMQ job queue and a worker process, split out of the `F4.24` bundle

## Status

Accepted — drafted and ruled 2026-09-11. Five decisions carried an open
question (Q1–Q5, recorded at the end); the owner ruled all five as drafted, and
the rest were as drafted.

## Context

`F4.24` (Wave 0, P2, `Depends: —`) is the only row four P1 Track D rows wait
on: `F3.11` scheduled rule evaluation (Wave 1) and `F3.12` the two-way command
path (Wave 3) list it directly, and `F3.13` and `F3.14` list `F3.12`. No Track D
session can clear it, because the row is Track F and AGENTS.md §6 gates it. The
owner ruled on 2026-09-11 that the ADR is for **BullMQ only**: the row bundles
four separately deferred things — an `apps/worker` on BullMQ, EMQX, Traefik and
MinIO — and only the first has a dependant. MinIO is `F3.3`'s ADR (it *is*
object storage); EMQX and Traefik stay in §6 with nothing waiting on them.

Six things are true of the repository today, each read from source on
2026-09-11 rather than assumed.

**1. Redis is in the stack and is forbidden for this.** ADR 0002 added
`redis:7-alpine` for Socket.IO fan-out and closed with *"cache, queues, BullMQ
workers, and other Redis usages remain out of scope until their own
promotions"*. AGENTS.md carries it twice — §6 *"Redis must not be used for
unrelated caching or job queues until a later promotion"* and *"scheduler/job
queues … remain out of scope until their specific sprint is promoted"* — and
§9.7 *"Redis is only approved for Socket.IO fan-out"*. ADR 0041 (decision 1)
kept `F3.8`'s notification dispatch synchronous and off any queue for exactly
this reason, and recorded the follow-up: *"When `F4.24` lands, moving dispatch
onto BullMQ is a follow-up that changes the caller, not the transports."*
`docs/AGENTS.production.md` §2 names the target as *"NestJS BullMQ workers
(Redis-backed)"* and its layout tree carries `apps/worker/`.

**2. The API already runs five background loops in-process, and a second API
doubles them.** `apps/api/src/scheduling/sweep-loop.ts` is the shared shape
(ADR 0037 decision 7 — `for (;;)`, never `setInterval`, so a slow sweep delays
the next tick rather than overlapping it) and its docblock names the three
users: the calc scheduler (10 s), the health roll-up (60 s) and the alarm
lifecycle sweep (30 s). Two more start the same way: the streaming alarm engine
and the calc streaming host, both on `onModuleInit`. Six `onModuleInit` sites in
all — `alarm-engine.service.ts:64`, `alarm-lifecycle.service.ts:325`,
`health-rollup.service.ts:196`, `calc-scheduler.service.ts:522`,
`calc-streaming.service.ts:177` and the `LISTEN bms_telemetry` client in
`telemetry-notify.service.ts:86`. None is guarded against a second process.
`docker-compose.yml`'s `api-replica` comment (lines 188–212, written by
`F3.47`) concedes it: *"the real ceiling … is therefore TWO sweeps per bucket
per 30 s — one per process, and neither process can see the other's Map. Bring
another replica up under any profile and it is three."* ADR 0037 chose the
loop over `@nestjs/schedule` deliberately, and this ADR does not reverse that —
but it does mean a worker that boots the API's module graph starts a **third**
copy of every loop. `RulesModule` imports `AlarmsModule`, which imports
`TelemetryModule`, so importing "just the rules" pulls in the alarm engine, the
lifecycle sweep and the LISTEN client transitively.

**3. Nothing in `apps/api` is a library.** `apps/ingest` is a separate app under
ADR 0016 because it shares no service with the API. A worker is the opposite
case: its whole purpose is to run the API's own services — `RulesService`,
`NotificationsService`, the `DatabaseModule` with its tenant GUC — off the
request path. There is a precedent for a second entrypoint inside `apps/api`:
`rotate-credentials` runs `node dist/security/rotate-credentials.cli.js` from
the same package (`apps/api/package.json:9`, ADR 0062), and the compose
`migrate` service runs the API image with a `command:` override.

**4. Redis has no persistence and no eviction policy set.** The compose service
is eleven lines: image, port, healthcheck. No `command:`, no `volumes:`. Lost
Socket.IO fan-out on a Redis restart costs nothing — the next event fans out.
A lost *queued command* (`F3.12`) is a command the operator believes was sent.
BullMQ also documents that `maxmemory-policy` must be `noeviction`; the image's
default is `noeviction`, but nothing in the repository says so.

**5. CI has no Redis.** `.github/workflows/ci.yml` declares one service, the
TimescaleDB image pinned to match compose under ADR 0023 decision 4. A queue
integration spec would therefore either skip in CI or need a service added, and
`docs/BACKLOG.md` already records what a `DATABASE_URL`-gated skip looks like
from the inside — a green run that ran nothing.

**6. The API holds one Redis client already, and BullMQ brings another.**
`@socket.io/redis-adapter` runs on `redis` (node-redis 5). BullMQ is built on
`ioredis` and accepts no other client. Two client libraries in one process is
the cost of the pairing and is recorded rather than hidden.

## Decision

1. **Promote a job queue on BullMQ, and nothing else from the bundle.** Redis's
   approved uses become two: Socket.IO fan-out (ADR 0002) and this queue. Caching
   stays out of scope. EMQX, Traefik and MinIO stay in AGENTS.md §6; MinIO's
   promotion is `F3.3`'s ADR. The `F4.24` row narrows to what this ADR ships and
   says so in its Feature cell, in the same PR as this record; the AGENTS.md
   §6 softening is the separate `chore(agents):` sweep.

2. **The worker is a second entrypoint of `apps/api`, not a new package**
   (ruled, Q1). `apps/api/src/worker.ts` builds to `dist/worker.js`; a
   `WorkerModule` composes the graph. The compose service and the process are
   named `worker`, so the rulebook's *"NestJS BullMQ workers"* sentence stays
   true and its `apps/worker/` tree line is amended to
   `apps/api/src/worker.ts` in the promotion sweep. Rationale is Context 3: a
   separate package would either import from `apps/api/dist` or force the API's
   modules into a library, and neither is a smaller change than one file.

3. **The worker process starts no loop that the API process starts.** No sweep,
   no streaming engine, no `LISTEN`. This is an invariant of the module graph
   the entrypoint composes, **not an environment flag** — a flag is the inert
   path this repository keeps recording (ADR 0062: an unconfigured key reported
   a stored credential while decrypting nothing, until `E8.4` made it refuse). The
   plan finds the carve (Context 2 shows a naive `imports: [RulesModule]` fails
   it), and a spec boots `WorkerModule` against a fake database and asserts
   that `runSweepLoop` is never entered and no `LISTEN` is issued. The three
   existing sweeps **stay in the API process** under this ADR; moving them to
   the worker is the natural fix for Context 2's doubling and is filed as its
   own row rather than absorbed here (ruled, Q5).

4. **One `QueueModule` in `apps/api/src/queue/`, one typed registry.** A queue
   is declared once, with its name, its payload type, its tenancy (decision 6)
   and its retry policy (decision 7); producers call
   `enqueue(queue, payload, { jobId })` and processors are registered against
   the same declaration. The plain `bullmq` package, without `@nestjs/bullmq`:
   the wrapper adds a second §9.4 package for decorators the registry replaces,
   and ADR 0037 already declined the framework's scheduling wrapper on the same
   grounds. BullMQ keys carry the prefix `bms` so they never collide with the
   adapter's `socket.io#` keys on the same instance.

5. **Every job id is deterministic and supplied by the caller, and it is a
   guard on the enqueue path — not the processor's idempotency.** BullMQ does
   not add a job whose `jobId` already exists in the queue, which stops a
   double enqueue of one rule at one scheduled instant (`F3.11`) or of one
   command row (`F3.12`). That holds only **while the earlier job is still
   retained** — once decision 7's `removeOnComplete`/`removeOnFail` counts have
   evicted it, the same id is accepted again. So a processor must be idempotent
   on its own row (the execution row, the `commands` row's state), and the plan
   for each queue says how. A queue that cannot name its job has not finished
   designing it; the registry refuses an `enqueue` without one.

6. **Every queue declares its tenancy, and the worker enforces it.** A queue is
   `tenant` — its payload carries `organizationId` and the processor runs inside
   the same tenant transaction helper the API uses, so FORCE ROW LEVEL SECURITY
   binds the worker exactly as it binds a request (ADR 0043, 0045) — or `fleet`,
   run as `bms_fleet` for cross-organization sweeps. There is no default. A
   processor for a `tenant` queue never sees a payload without an
   `organizationId`; the registry rejects it at `enqueue`.

7. **Retry and retention are declared per queue, with one set of defaults:**
   `attempts: 3`, exponential backoff from 1 s, `removeOnComplete: { count:
   1000 }`, `removeOnFail: { count: 5000 }`. A failed job after its last attempt
   stays in Redis for the operator to see, which is what the counts are for.
   **These numbers are chosen starting points, not measurements** — nothing in
   the repository has been loaded against them, and a later row moves them
   with a number rather than by re-ruling this decision. Decision 5 depends on
   the counts: they bound how long an id de-duplicates.

8. **Redis persists, and evicts nothing** (ruled, Q2). The compose `redis`
   service gains `command: ["redis-server", "--appendonly", "yes",
   "--maxmemory-policy", "noeviction"]` and a named volume `redis-data`. A
   Redis restart then replays the queue instead of dropping it.

9. **Without `REDIS_URL` the API still boots, the queue refuses, and the
   worker does not start.** ADR 0002's native-dev path — omit `REDIS_URL`, get a
   warn and in-process Socket.IO — stays. The `QueueModule` then reports
   `unconfigured`; `enqueue` rejects with a named `QueueUnavailableError`; the
   caller decides what that means for its own surface. **There is no in-memory
   queue stand-in** — a skipped job is a lost command once `F3.12` lands, and a
   fallback that makes it look delivered is the failure ADR 0041's
   `skipped_unconfigured` exists to avoid. The worker process refuses to start
   at all without `REDIS_URL`, on ADR 0062's boot-refusal shape.

10. **`F4.24` ships one queue, `heartbeat`, and it is not a placeholder.** The
    worker registers a repeatable job every 60 s with a fixed `jobId`; the
    processor writes the tick to Redis. That exercises the exact primitive
    `F3.11` will build on — a BullMQ repeatable job — and gives both processes
    something true to report: the API's `GET /health` gains a `queue` section
    (`configured`, `connected`, per-queue `waiting`/`active`/`failed` depths,
    `lastHeartbeatAt`); the worker serves the same section on its own
    `GET /health` at `WORKER_PORT` (default 4100). A heartbeat older than three
    ticks degrades both — three is a starting point on the same terms as
    decision 7's counts. `F3.11`, `F3.12` and the ADR 0041 dispatch follow-up
    each add their own queue under their own row; none of them is this ADR's.

11. **Queue depth and outcomes are Prometheus metrics** on the existing
    `/metrics` registry (ADR 0004): `bms_queue_depth{queue,state}` as a gauge
    sampled with the health read, `bms_queue_jobs_total{queue,outcome}` as a
    counter incremented by the worker. No Bull Board or other queue UI — that is
    a further dependency with no row.

12. **The worker joins the `core`, `pilot` and `phe` profiles** (ruled, Q4).
    Same image as `api`, `command: ["node", "dist/worker.js"]`, `depends_on`
    `redis` and `migrate`, `WORKER_PORT` published on 4100. A queue with no
    consumer grows silently, and both dependants expect the consumer to be
    there whenever the API is. `pnpm --filter api worker` is the fourth dev
    process.

13. **CI gains a pinned Redis service, and the queue spec is a gate** (ruled,
    Q3). `ci.yml` adds `redis:7-alpine` beside the pinned TimescaleDB, on ADR
    0023 decision 4's reasoning — CI must run the engine compose runs — and
    exports `REDIS_URL`. The queue integration spec (enqueue → worker → health
    reports the completion) runs in CI rather than skipping there. Locally it
    skips without `REDIS_URL` and the skip is reported as a skip, not a pass.

## Dependencies

- `bullmq` (5.x) in `apps/api` — §9.4-gated, and this ADR is its justification.
  It vendors `ioredis`; the API keeps `redis` for the Socket.IO adapter, so the
  process holds two Redis client libraries (Context 6). Consolidating on one is
  possible only by replacing the adapter's client, which is ADR 0002's to
  reopen and is not worth it for this.
  Resolved 2026-09-11 to bullmq 5.81.5, vendoring ioredis 5.11.1.
- No schema change. No migration. The queue's state lives in Redis by design;
  the rows a job acts on (`F3.11`'s executions, `F3.12`'s `commands` and
  `command_results`) are those rows' own ADRs.
- CI: one `services:` entry (decision 13). Compose: one new service, one
  changed service, one volume (decisions 8 and 12).

## Consequences

- **What this unblocks.** `F3.11` (Wave 1, P1) and `F3.12` (Wave 3, P1) become
  eligible on the board the day the row flips; `F3.13` and `F3.14` follow
  `F3.12`. ADR 0041's dispatch follow-up becomes possible and is still not a
  row — file one when someone wants it.
- **What stays deferred, and where.** EMQX and Traefik: AGENTS.md §6, no
  dependant, no row of their own until one appears. MinIO: `F3.3` and its ADR.
  Caching on Redis: still out of scope. The `F4.24` row must stop naming the
  three so a reader does not take its title as the scope.
- **The doubling in Context 2 is not fixed by this ADR.** It is filed as
  `F4.128` (Wave 1, `Depends: F4.24`), per Q5: the worker is the obvious single
  home for the three sweeps, and moving them changes ADR 0037's Consequences
  sentence about where the loop lives. Until then `api-replica` still doubles
  them, exactly as the compose comment says.
- **Two Redis clients in one process** (Context 6) — recorded, accepted.
- **A worker is a deployment surface.** It needs the same `DATABASE_URL`,
  `CREDENTIAL_ENCRYPTION_KEY` window (ADR 0062 — it will decrypt channel
  secrets once dispatch moves) and OIDC-free configuration as `api`;
  `docs/local-setup.md` and the runbooks gain a process. The ingest host's
  boot-refusal on a dead key window applies to the worker the day it first
  decrypts anything, and not before.
- **Promotion follow-ups (AGENTS.md §10.1), owed in a separate
  `chore(agents):` PR after the feature lands:** soften §6's two Redis/queue
  sentences and §9.7's *"only approved for Socket.IO fan-out"*; amend
  `docs/AGENTS.production.md`'s tree line per decision 2; mirror into
  `docs/roadmap.md`. One owed promotion per PR. The `F4.24` row itself is
  narrowed in this PR (decision 1), and the sweep doubling is filed as
  `F4.128` (decision 3, Q5).

## The five questions, and the rulings (2026-09-11)

All five were ruled **as drafted**, one at a time, in the order below. The
alternatives are kept so a later reader can see what was declined and why.

| # | Decision | As drafted (ruled) | The alternative, and what it costs |
|---|---|---|---|
| Q1 | 2 | Second entrypoint of `apps/api`, service named `worker` | A new `apps/worker` package matching the production tree. It cannot import the API's Nest modules without either reaching into `apps/api/dist` or first extracting them into a package — a refactor with no row. |
| Q2 | 8 | AOF persistence + named volume + explicit `noeviction` | Leave Redis ephemeral. Cheaper compose, and every queued job is lost on a Redis restart — acceptable for a heartbeat, not for `F3.12`'s commands. Deciding it now stops `F3.12` inheriting a silent default. |
| Q3 | 13 | Add a pinned Redis service to CI; the spec gates | Gate the spec on `REDIS_URL` and let CI skip it. Zero CI change, and the only test of the thing four P1 rows build on never runs where merges are decided. |
| Q4 | 12 | Worker in `core`/`pilot`/`phe` | Its own `worker` profile, opt-in. Keeps `core` unchanged for anyone not using queues — which after `F3.11` is nobody, and a queue nobody drains grows until Redis is full. |
| Q5 | 3 | Sweeps stay in `api`; the doubling is filed as its own row | Move the three sweeps into the worker under this ADR. Fixes the replica doubling now, and turns an infra row into a change to three services' lifecycles, ADR 0037's shape and their specs — the scope creep the `F2.9`/`F2.22` split was cut to avoid. |

## Amendment 1 — decision 3's spec cannot be written here, and Context 6 was wrong about the client (2026-09-11)

Raised at the step-3 plan (`docs/plans/f4.24-bullmq-worker.md` §14 Q4 and
Q7), the same day the record was accepted, and ruled by the owner before any
code.

**Decision 3 described a test this repository cannot run.** It said *"a spec
boots `WorkerModule` against a fake database and asserts that `runSweepLoop` is
never entered and no `LISTEN` is issued"*. No spec in `apps/api` instantiates a
Nest module: the one `createTestingModule` hit is a comment in
`zod-error.filter.spec.ts` explaining why a source scan is used instead, and
AGENTS.md §4.6 (`F4.20`) records the cause — vitest runs specs through esbuild,
which emits no `design:paramtypes`, so Nest's constructor injection cannot
resolve. Making it resolve is an swc transform, a §9.4 dependency ADR of its
own and not this row's.

**The gate is substituted, not dropped.** Two halves, each necessary:

1. **A static import-closure invariant** —
   `tests/f4.24-worker-imports-no-api-loop.test.ts` walks the relative
   `import`/`export … from` closure of `apps/api/src/worker.ts` and asserts it
   contains none of the six `onModuleInit` loop sites, `scheduling/sweep-loop.ts`,
   `telemetry/telemetry-listener.ts`, the five loop-bearing modules
   (`alarms`, `calc`, `asset-health`, `telemetry`, `rules`), `app.module.ts` or
   `main.ts`. The same walk over `main.ts` must contain **every one** of them —
   the positive control without which a walker that follows nothing passes
   vacuously. This is what fences `F3.11`: the day `WorkerModule` imports
   `RulesModule`, the test reddens and forces the split then, under that row.
2. **A runtime measurement on the stack** — `pg.Pool` connects lazily, so a
   worker that runs only the heartbeat opens zero Postgres backends.
   `pg_stat_activity` filtered to the worker container's address must be empty
   after two minutes while the API's `LISTEN bms_telemetry` backend is present;
   `docker compose logs worker` must carry no sweep line. Recorded in the
   closure row with the numbers, not asserted from the code.

The invariant in decision 3 — the worker starts no loop the API starts, by
construction of the module graph and never by a flag — is unchanged. Only the
proof moved.

**Context 6 said BullMQ "accepts no other client". It does not.** `bullmq`
5.81.5 (the pin this row resolves to; 6.x exists and is not taken) vendors
`ioredis@5.11.1` **and** lists `redis: >=5.0.0` as an optional peer, so it can
be handed the node-redis client the Socket.IO adapter already holds. This ADR
stays on the ioredis path — BullMQ creates the connection from options — because
changing which client library the API runs on is a decision, not a build
detail, and the two-client cost in the Dependencies section stands as accepted.
Consolidating on one client is a possible follow-up row with no dependant; it is
not owed.

**Five smaller rulings from the same plan gate, recorded so they are not
re-asked:** `GET /health` answers 200 with `status: "degraded"` in the body (a
liveness probe must not let a dead worker eject an API that serves traffic);
the queue section carries a `heartbeatStale` boolean beyond decision 10's list,
so `degraded` names its cause; `infra/observability/prometheus.yml` gains a
`bms-worker` scrape target, without which decision 11's counter reaches no
panel; a configured, connected queue with no heartbeat ever written reads
`heartbeatStale: true` → `degraded` (fail closed — a queue with no consumer is
what Q4 exists to make visible); and the manifest commit stages a one-line pin
note in this ADR's Dependencies section, which is what `.githooks/pre-commit.mjs`
requires of a `package.json` change.
