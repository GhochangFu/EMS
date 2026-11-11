# ADR 0123 — Edge gateway runtime: store-and-forward over an authenticated uplink (`E7.2`)

## Status

**Accepted — 2026-11-10** (owner, in chat: "all as recommended, accept ADR
0123"; proposed the same day). Every question under *Rulings* — Q1 to Q14
and the sub-questions Q3a, Q3b, Q4a, Q7a, Q9a and Q13a — is ruled as
recommended, so each numbered item under *Decision* stands as written.
**Nothing is built until the plan is approved.**

Backlog row `E7.2` (Track A, Wave 4, P1, 8–12, depends on `F1.1` ✅ and
`F1.10` ✅). Plan: [`docs/plans/e7.2-edge-store-and-forward.md`](../plans/e7.2-edge-store-and-forward.md).
Code citations are to `main` at `0bc360c`.

**Adds no npm dependency** (§9.4): the recommendation uses Node core only
(`node:fs`, `node:http`, `node:zlib`, `node:crypto`, global `fetch`).
**Adds one table, one column and one migration.** **Adds no database role and
writes no `GRANT`.** **Adds no app** (Q2: a second entry point in `apps/ingest`).

AGENTS.md §6 does not name the edge runtime, so nothing is removed from it.
The `chore(agents):` sweep owed after the build (§10.1) is listed under
*Consequences*.

**Amends** (each amendment's text lands in the code PR that changes the
behaviour, as the plan orders them):

- [ADR 0016](./0016-ingest-adapter-framework.md) §6 commit 4 — the repo
  invariant "one entry point in `apps/ingest/src`" becomes "one entry point
  that can reach Postgres" (Q2).
- ADR 0016 Amendment 4 decision 5 — "Replayed rows are notified like any
  upsert" becomes "only rows inside the live window are notified" (Q9).
- ADR 0016 Amendment 4 decision 11 — discharged: this is the `E7.2` that
  "extends decision 7's format".
- ADR 0016 Amendment 8 decision 2 — the ingest container stops being
  reachable from `postgres` only: it also joins a new `edge-uplink` network
  shared with the public nginx container, and its health listener binds to
  loopback (Q3b).
- [ADR 0061](./0061-ingest-receive-time-and-device-time.md) decision 2 as
  narrowed by its Amendment 2 — for an edge-forwarded sample the receive time
  is the arrival at the **edge**, not at the cloud host (Q7).

## Context

### What the client asked for

The 2026-08-22 reply mail names "EDGE (hardware / software)" a deliverable and
the feature sheet's row 1 names "edge store-and-forward" (BACKLOG §8). Our own
reply mail puts "edge gateway software with store-and-forward and offline
buffering" in the six-month list. BACKLOG §6 keeps edge **hardware** out of
this backlog: the gateway box is procurement scope.

### What exists

The pipeline today is `device → broker → cloud ingest host → Postgres`. The
host (`apps/ingest`, ADR 0016) dials each broker itself.

| Outage | Today | Record |
|---|---|---|
| Database down | Buffered on the host's disk, 1 h / 256 MiB, replayed idempotently | `F1.10`, ADR 0016 Amendment 4 |
| Broker down, or the site's uplink down | **Lost.** Nothing reaches the host | `docs/ingest-host.md` *Known limits*: "that is `E7.2`" |
| Cloud ingest host down | **Lost.** The MQTT subscription is QoS 0 (`adapters/mqtt.ts:405`) | — |

`F1.10` left three things this row can stand on:

1. **A segment format made to be extended.** One JSON line per sample:
   `sourceKey`, `value`, `deviceKey`, `at` (device time, only when the device
   sent one), `rx` (receive time, always), `good`. Stored **before**
   normalisation, so the point mapping is applied at write time (ADR 0016
   Amendments 4 and 5).
2. **A clean writer seam.** `createSupervisor` takes `writeSamples(samples:
   ReceivedSample[])` and a disk-buffer handle (`supervisor.ts:216-231`). The
   spill, the breaker, the backoff probe and "live before backlog" all sit
   behind that one function. A supervisor whose `writeSamples` posts to the
   cloud instead of writing Postgres is an edge runtime with the whole `F1.10`
   state machine unchanged.
3. **An idempotent row key.** `telemetry.point_values` has primary key
   `(time, asset_id, point_key)`, `time` is the receive time (ADR 0061), and
   the upsert is `ON CONFLICT DO UPDATE` (`normaliser.ts:474`). A sample that
   keeps its `rx` writes the same row however many times it is sent.

### Four facts that shape the design, each read from source

**F1. A late row raises alarms as if it were live.** `writeResolved` notifies
every row it writes (`normaliser.ts:545-553`). `AlarmEngineService` evaluates
only off that `NOTIFY`, and it does not read a reading's `time`. So a replayed
backlog is evaluated as *now*. `F1.10` bounds this at one hour. A multi-day
edge backlog would raise, clear and page on values that are days old, and the
live tiles would show them as current. The API's own writer already solved
this for manual entry and import: `NOTIFY_LIVE_WINDOW_MS` (5 minutes) in
`apps/api/src/admin/telemetry-entry/telemetry-write.service.ts` notifies only
rows whose own timestamp is recent. The ingest normaliser has no such gate.

**F2. A late row older than three hours never reaches the continuous
aggregates on its own.** The refresh policies (migration `0027`) re-cover
3 h (`_1m`), 12 h (`_5m`), 3 d (`_1h`) and 30 d (`_1d`). Rows written behind
those windows stay out of the stored buckets until someone calls
`refresh_continuous_aggregate`. `refreshAggregatesFrom(client, from, to)`
(`packages/db/src/refresh-aggregates.ts:292`) does exactly that, under
`bms_rollup`, and manual entry already uses it. Ingest never calls it.

**F3. Raw chunks compress after seven days** (migration `0028`). A backlog
older than that writes into compressed chunks, which is slow and is not a
path anything here has measured.

**F4. `time` is whatever clock stamped `rx`.** ADR 0061 moved `time` off the
device clock because device clocks were up to 3 h wrong. An edge box is ours,
but a box with no battery-backed clock that reboots while offline starts with
a wrong clock, and every row it stamps lands at a wrong `time` for good.

### What this ADR does not reopen

The `IngestAdapter` interface (ADR 0016 §1) does not change. No protocol
adapter is added: each still needs its own ADR (AGENTS.md §6). No broker is
introduced (EMQX stays out of scope). `telemetry.*` gets no
`organization_id` and no RLS (ADR 0043 decision 9).

## Decision

1. **Scope is the data plane** (Q1). The edge runtime collects, buffers and
   forwards. It starts and runs with no cloud and no database. It evaluates no
   rules, serves no dashboard and sends no commands.

2. **A second entry point in `apps/ingest`** (Q2):
   `apps/ingest/src/edge-main.ts`, started as `node dist/edge-main.js` from
   the same image. It builds the same registry, adapters, supervisor and
   `DiskBufferStore`. Its `writeSamples` is the uplink client (decision 4). It
   never imports `pg`, `host/normaliser.ts`, `host/bindings.ts` or
   `rtu-config.js`; a static test in `tests/` holds that, and
   `tests/repo-invariants.test.ts` changes from "exactly one entry point" to
   "exactly `main.ts` and `edge-main.ts`, and only `main.ts` reaches
   Postgres".

3. **Edge configuration is a local file** (Q5). `EDGE_CONFIG_FILE` (absolute
   path, JSON, validated by a Zod schema in `@bms/shared/ingest`): a list of
   endpoints, each `{ protocol, config, devices: [{ deviceKey, device,
   sourceKeys? }] }`, validated by the adapter's own `configSchema` and
   `deviceSchema`. Device credentials come from the box's environment
   (`EDGE_CRED_<NAME>`), never from the file and never from the cloud. The
   edge holds no point mapping: samples leave un-normalised, as they sit in an
   `F1.10` segment.

4. **The uplink is HTTPS, edge to cloud, one route** (Q3):
   `POST /edge/v1/batches`, served by the **cloud ingest host** on a second
   listener (`INGEST_UPLINK_PORT`, unset = receiver off), reached through the
   existing public nginx origin (`deploy/aws/nginx.conf` gains one
   `location /edge/`). The body is gzip JSON
   `{ v: 1, sentAt, backlog, buffered, clock, samples: [...] }` (`buffered` is
   the edge's sample count on disk, `clock` is `synced` or `unsynced`), at most 500 samples and
   256 KiB compressed; each sample is the segment line (`sourceKey`, `value`,
   `deviceKey`, `at?`, `rx`, `good?`) plus `protocol`. The schema lives in
   `packages/shared/src/ingest-uplink.ts` so both ends parse one definition.
   The receiver feeds the batch to the same `resolveSamples` → `writeResolved`
   path the supervisor uses, with each sample's `rx` as its receive time. It
   answers `200 { accepted, rejected }` only after the rows are committed. A
   failed write answers `503` and the edge keeps the batch in its own buffer
   (Q3a). `401`/`403` mean the token or the organization is refused;
   `429`/`503` carry `Retry-After`. The edge retries all four on its backoff.

5. **Each gateway has its own bearer token, bound to its own RTUs** (Q4). A
   new table `bms.edge_gateways` holds the SHA-256 of a 256-bit random token;
   the token is shown once at mint and never stored, logged or audited
   (§9.6). `bms.rtus` gains a nullable `edge_gateway_id`. The receiver accepts
   a sample only when its `deviceKey` belongs to an RTU of the calling
   gateway; anything else counts as `foreignDevice` and is dropped. This is
   the `F1.7` topic-binding rule on a new transport. TLS is mandatory: the
   edge refuses an `http://` uplink URL and has no switch to lower
   certificate verification. Comparison of the hash is constant-time.

6. **An RTU has one writer.** The cloud host's binding plan skips an RTU
   whose `edge_gateway_id` is set, so the cloud never dials a device the edge
   serves. Assigning an RTU to a gateway keeps the `telemetrySource`
   invariant `F4.59` protects, so the simulator stays off those assets.
   The organization ingest switch (ADR 0115) applies: the receiver answers
   `403 ingest-disabled` for a gateway whose organization is off, and the
   edge keeps buffering under its bounds.

7. **The edge buffer is the `F1.10` store with edge bounds** (Q6). Same
   module, same segment format, same crash rules, `0700`/`0600`. New
   defaults, read from `EDGE_BUFFER_DIR`, `EDGE_BUFFER_MAX_AGE_MS` (default
   72 h, hard ceiling 6 d) and `EDGE_BUFFER_MAX_BYTES` (default 1 GiB). Both
   bounds drop oldest first and count every loss. Spill happens on a failed
   send, as in `F1.10`; the edge does not write every sample to disk first.

8. **The row key is the idempotency key** (Q7). `rx` is stamped once at the
   edge when the sample arrives, is written on the segment line and on the
   wire, and becomes `time`. A retried or re-replayed batch upserts the same
   `(time, asset_id, point_key)`. There is no batch ledger table.
   `device_time` keeps what the device claimed, as today. Two clock guards:
   - **Edge:** the runtime persists a high-water mark of its wall clock. If
     the clock at start is behind the mark, it stamps `rx` as mark + monotonic
     elapsed, reports `clock=unsynced` on its health page, and returns to the
     wall clock once that passes the mark.
   - **Cloud:** the receiver rejects a sample whose `rx` is more than 60 s
     ahead of its own clock or older than 6 d 12 h, counts it
     (`futureRx`, `tooOld`) and still answers `200`, so one bad sample cannot
     block a gateway's queue for ever.

9. **Live first, backlog throttled** (Q8). Live batches post at once. The
   replay loop drains oldest-first, one batch at a time, and is capped by
   `EDGE_REPLAY_MAX_SAMPLES_PER_S` (default 500). A `429`/`503` is honoured on
   the existing §5 backoff. Each batch says `backlog: true|false`.

10. **Only live rows are notified** (Q9). `writeResolved` sends `pg_notify`
    for a row only when its `time` is within `INGEST_NOTIFY_LIVE_WINDOW_MS`
    (default 5 minutes, the API's existing constant moved to `@bms/shared`).
    The rule is keyed on the row's time, not on the path, so it also applies
    to an `F1.10` replay. Older rows land in history silently: no alarm is
    raised, cleared or re-notified from them, and live tiles do not move
    backwards. Alarms are **not** evaluated retrospectively.

11. **The cloud repairs the aggregates** (Q10). The upsert and an update of
    the gateway's `backfill_dirty_from` / `backfill_dirty_to` share one
    transaction. A loop in the cloud host calls `refreshAggregatesFrom` over
    each dirty window (at most once a minute per gateway, and when the
    backlog drains) and clears it only on success. A host that crashes
    between write and refresh still finds the window on restart.
    `apps/ingest` gains a workspace dependency on `@bms/db` for that one
    import. The 6 d ceiling of decision 7 keeps a backlog out of compressed
    chunks.

12. **Gateways are fleet-managed** (Q12). API routes under
    `/api/v1/admin/edge-gateways` (list, create, rename, revoke, mint/rotate
    token, assign RTUs), global `admin` only, audited through the audit
    middleware, contracts in `packages/shared/src/contracts/` (ADR 0030). One
    admin page lists gateways with last-seen time, reported backlog and clock
    state. The cloud host's health body gains one line per gateway.

13. **Hardware stays out** (Q13). This ADR ships a container image and its
    documented requirements (a battery-backed clock or NTP, a writable volume,
    outbound HTTPS). Box selection, OS, fieldbus cards, modems, remote access
    (`E7.4`), over-the-air updates and an `arm64` image build are not here.

### Schema change (one migration, next free number at build time)

```sql
CREATE TABLE bms.edge_gateways (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES bms.organizations (id),
  location_id         uuid REFERENCES bms.locations (id),
  code                varchar(64) NOT NULL,
  name                varchar(128) NOT NULL,
  status              varchar(16) NOT NULL DEFAULT 'active',  -- CHECK: active | revoked
  token_hash          bytea,           -- sha256, NULL until first mint
  token_last4         varchar(4),
  token_rotated_at    timestamptz,
  last_seen_at        timestamptz,
  reported_backlog    integer,
  clock_state         varchar(16),     -- CHECK: synced | unsynced
  backfill_dirty_from timestamptz,
  backfill_dirty_to   timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);
ALTER TABLE bms.rtus ADD COLUMN edge_gateway_id uuid REFERENCES bms.edge_gateways (id);
```

`ENABLE` + `FORCE ROW LEVEL SECURITY` and the standard `tenant_isolation`
policy, as every tenant table since ADR 0043/0045. **No `GRANT` is written:**
the default privileges set by `0041_bms_owner_and_force_rls.sql` cover a new
`bms.*` table (the reasoning migration `0124` records). **No new role:** the
cloud host connects as `bms_fleet` today (compose calls that a stopgap; this
ADR does not change it) and `bms_fleet` is already a member of `bms_rollup`,
which `refreshAggregatesFrom` needs. The plan re-verifies both claims against
a real database before the migration is written.

### New environment values

| Where | Name | Default |
|---|---|---|
| cloud host | `INGEST_UPLINK_PORT` | unset (receiver off) |
| cloud host | `INGEST_NOTIFY_LIVE_WINDOW_MS` | `300000` |
| edge | `EDGE_CONFIG_FILE` | required |
| edge | `EDGE_UPLINK_URL` | required, `https://` only |
| edge | `EDGE_GATEWAY_TOKEN` | required |
| edge | `EDGE_BUFFER_DIR` | `/var/lib/bms-edge` |
| edge | `EDGE_BUFFER_MAX_AGE_MS` | `259200000` (72 h; ceiling 6 d) |
| edge | `EDGE_BUFFER_MAX_BYTES` | `1073741824` |
| edge | `EDGE_REPLAY_MAX_SAMPLES_PER_S` | `500` |
| edge | `EDGE_CRED_<NAME>` | per device credential |

## Rulings (owner, 2026-11-10)

The questions as they were put at the §10 gate, with their options. **The
owner ruled every one as recommended**, so in each the line that starts
"Recommend" is the ruling.

**Q1. What does "offline ops" mean for this row?**
- A. Data plane only: collect, buffer, forward; start and run with no cloud.
- B. A plus local alarm evaluation at the site.
- C. B plus a local dashboard (a small EMS on the box).
- **Recommend A.** B and C need the rules engine, a local database and a UI
  on the box. That is on-prem packaging (`E7.3`), and the client's 2026-08-22
  answer was "cloud + edge", not hybrid. Two-way commanding is §6 out of
  scope.

**Q2. Where does the edge runtime live in the monorepo?**
- A. New app `apps/edge`, with the shared host code moved to a new package
  `packages/ingest-core`.
- B. A second entry point `apps/ingest/src/edge-main.ts` in the existing app
  and image.
- C. A separate repository.
- **Recommend B.** The supervisor already takes its writer as a parameter, so
  the edge is one new composition file and no file moves. A is cleaner as a
  dependency boundary but moves about 80 files that many `tests/` invariants
  name by path, in the same tree the `F1.2`–`F1.6` adapters will land in. B
  costs one amended invariant (ADR 0016 §6 commit 4): the test must now prove
  that `edge-main.ts` cannot reach Postgres.

**Q3. How does the edge send to the cloud?**
- A. HTTPS batches to a receiver in the cloud **ingest host**.
- B. HTTPS batches to a route in **`apps/api`**.
- C. MQTT publish to a broker the cloud host subscribes to.
- D. A direct Postgres connection from the edge.
- **Recommend A.** The normaliser (mapping, scaling, quality policy, range
  checks — ADR 0056) and the `F1.10` buffer live in the ingest host; B would
  copy them into the API or proxy to them. C needs a broker we operate (§6
  keeps EMQX out) and gives no end-to-end acknowledgement that a row was
  stored. D puts database credentials on a field box. A's cost: the ingest
  host gets its first public listener, behind nginx, and the security review
  must treat it as an internet-facing surface.

- **Sub-question Q3a.** When the cloud database is down, does the receiver
  (a) spill the batch to the cloud host's own `F1.10` buffer and answer `200`,
  or (b) answer `503` so the edge keeps it? **Recommend (b).** Nothing is lost
  either way, a sample then waits in one place only, and (a) needs a replay
  loop the host does not have outside a supervisor.
- **Sub-question Q3b.** The ingest container is isolated today: only
  `postgres` can reach it (ADR 0016 Amendment 8,
  `tests/f4.61-ingest-network-isolation.test.ts`). The route needs nginx to
  reach it. (a) A third compose network `edge-uplink` joined by the nginx
  container and `ingest` only, with the health listener bound to loopback;
  (b) `web` joins the `ingest` network, which would also let it reach
  Postgres. **Recommend (a).**

**Q4. How is the edge link secured?**
- A. One bearer token per gateway over TLS, stored hashed, bound to that
  gateway's RTUs, rotatable and revocable.
- B. Mutual TLS with a client certificate per gateway.
- C. A Keycloak service account per gateway (client-credentials).
- D. Reuse the API service-account tokens of [ADR 0125](./0125-rate-limits-and-service-account-tokens.md)
  (`F4.17`, accepted 2026-11-10, not built yet).
- **Recommend A.** B needs a certificate authority and renewal on boxes that
  may be offline for days. C widens Keycloak beyond what §9.7 approves and
  makes the edge depend on a second service to post. With A, a stolen token
  can write telemetry for that one gateway's RTUs and nothing else, and one
  click revokes it. D authenticates a caller to `apps/api` as a user with a
  role; a gateway token must be bound to RTUs and checked in the ingest host.
  If Q3 is ruled B (the route in `apps/api`), D becomes the natural choice and
  `E7.2` would then wait for `F4.17`.
- **Sub-question Q4a.** Should a gateway's token expire on a schedule?
  **Recommend no** for v1: rotation on demand, `token_rotated_at` shown on the
  admin page.

**Q5. Where does the edge get its configuration and device credentials?**
- A. A local JSON file plus environment variables on the box.
- B. Pulled from the cloud and cached on the box's disk.
- **Recommend A for this row.** B means the cloud decrypts ADR 0012 device
  credentials and sends them to a field box that then stores them. That
  deserves its own ADR. A keeps every credential where it is entered. Its cost
  is manual provisioning per site; a follow-up row can add B.

**Q6. Buffer store and size limits at the edge.**
- Store: A. the `F1.10` JSON-lines store; B. SQLite; C. a queue library.
  **Recommend A** — no dependency, one format, already hardened by two review
  rounds.
- Age bound: 24 h / **72 h** / 6 d. **Recommend 72 h default, 6 d hard
  ceiling.** 72 h covers a weekend. Seven days is where raw chunks compress
  (F3), so the ceiling stays under it.
- Byte bound: **Recommend 1 GiB default.** About 120 bytes a line: 500 points
  a minute is ~86 MB a day.
- When full: A. drop oldest; B. refuse newest. **Recommend A**, as `F1.10`:
  the newest reading is the one an operator needs first.
- Spill: A. on failed send (as `F1.10`); B. write every sample to disk first.
  **Recommend A.** B survives a crash with no loss but writes flash storage
  constantly. A loses at most the in-memory queue (10 000 samples) on a
  crash.

**Q7. What is the idempotency key, and whose clock is `time`?**
- A. `time` = arrival at the edge (`rx`), carried unchanged; the primary key
  dedupes; no ledger.
- B. A plus a `(gateway, batch id)` ledger table for exactly-once batches.
- C. `time` = arrival at the cloud; the edge time goes to `device_time`.
- **Recommend A**, with the two clock guards in decision 8. C lands a whole
  backlog at "now", which defeats the row. B adds a table to prevent
  something the upsert already prevents.
- **Sub-question Q7a.** A sample with a future or too-old `rx`: A. reject and
  count; B. shift by the measured clock offset; C. accept. **Recommend A.** B
  assumes the offset was constant across the whole outage, which a clock that
  stepped mid-outage breaks.

**Q8. Backfill versus live ordering.**
- A. Live first; backlog oldest-first, rate-capped; honour `429`/`503`.
- B. Strict time order: nothing live until the backlog has drained.
- **Recommend A.** A dashboard shows now before the days it missed, and the
  cap stops many sites returning at once from saturating the cloud.

**Q9. What does late data do to alarms, rules and live tiles?**
- A. Rows older than a live window (5 min) are written but not notified. No
  alarm is raised or cleared from them. Applies to every ingest write.
- B. As A, but only for edge backlog; `F1.10` replay keeps notifying.
- C. Evaluate rules over the backlog and create alarms dated in the past.
- D. Notify everything (today's behaviour).
- **Recommend A.** D pages people about values that are days old (F1). C
  needs backdated raises, which the alarm lifecycle (ADR 0057) and the
  notification ledger (ADR 0041) were not built for. B leaves two rules for
  one question. **Cost of A, stated:** a threshold crossed during an outage
  shows in the trend but never becomes an alarm, and scheduled rules that ran
  during the gap are not re-run.
- **Sub-question Q9a.** Is a "what happened while the site was offline"
  report wanted as a follow-up row? **Recommend yes, as a new P2 row**, not
  in `E7.2`.

**Q10. What does late data do to the continuous aggregates and compression?**
- A. The cloud host refreshes the aggregates over each backfilled window,
  tracked durably on the gateway row; backlog is capped at 6 d.
- B. Widen the refresh policies' `start_offset` to cover the buffer.
- C. Do nothing; an operator refreshes by hand.
- **Recommend A.** B makes every policy run re-scan days of buckets for
  every asset, for ever. C leaves reports silently wrong (F2).

**Q11. Derived (calculated) points during the gap.** Streaming formulas are
fed by the same `NOTIFY`, so under Q9-A they produce nothing for the
backfilled window.
- A. Accept for this row; open a follow-up row for a calc backfill.
- B. Build the calc backfill inside `E7.2`.
- **Recommend A.** It touches the calc engine (ADR 0037/0055/0070), which
  this row otherwise leaves alone.

**Q12. Who manages gateways, and is there a screen?**
- Who: A. global `admin` only; B. also `organization_admin` for their own
  organization. **Recommend A** for v1: a token is fleet infrastructure.
- Screen: A. API routes plus one admin page; B. API only; C. a CLI script.
  **Recommend A**, built last, so the feature is reachable without `curl`.

**Q13. What is hardware and stays out?** Box selection, OS image, clock
battery, serial and fieldbus cards, modem, watchdog, VPN (`E7.4`),
over-the-air updates.
- **Sub-question Q13a.** Build an `arm64` image in CI? **Recommend no** until
  the box is named: a multi-arch build costs Actions minutes on every push.
  The doc carries the `docker buildx` command.

**Q14. Does this start before a field adapter exists?** Only the MQTT adapter
is built; `F1.2`–`F1.6` wait on client answer A4. So v1 can be proved against
a site-local MQTT source and a test double, not against Modbus or BACnet.
- A. Build now; any later adapter runs at the edge unchanged.
- B. Wait for the first poll adapter.
- **Recommend A.** The interface is frozen, the runtime is adapter-agnostic,
  and the client lists it for six months. **Stated plainly:** on day one the
  edge can only serve devices that speak MQTT to a broker the box can reach.

## Dependencies

No npm package. One new workspace edge: `apps/ingest` → `@bms/db`, for
`refreshAggregatesFrom` only (decision 11). `apps/ingest` already depends on
`@bms/shared`, `pg`, `mqtt`, `zod` and `dotenv`; the edge entry point uses
`@bms/shared`, `mqtt`, `zod` and Node core.

## Consequences

- A site whose uplink fails keeps its readings for up to 72 h (6 d at most)
  and they arrive at their true times, once, with the aggregates repaired.
- A cloud ingest host outage stops being a loss for edge-served RTUs: the
  edge sees failed posts and buffers. Broker-served RTUs are unchanged.
- An outage produces no alarms for what happened inside it (Q9), and no
  derived points (Q11). Both are visible limits with follow-up rows, not
  silent ones.
- `F1.10` replay stops notifying rows older than five minutes. That is a
  behaviour change to shipped code and needs the ADR 0016 amendment named in
  *Status*.
- The ingest host becomes reachable from the internet on one route. Body
  size, sample count, rate and authentication failures are all bounded and
  counted; the health port stays on loopback (ADR 0016 Amendment 8).
- A gateway token on a stolen box can write false telemetry for that
  gateway's RTUs until revoked. It cannot read anything.
- A box with no working clock and no network stamps `rx` from its last known
  time plus elapsed time. Rows are ordered correctly and may be offset; the
  health page and the admin page say `unsynced`.
- Provisioning is manual per site (Q5-A).
- **Owed after the build, as separate `chore(agents):` PRs (§9.10, §10.1):**
  AGENTS.md §2 *Ingest adapters* row and §3 layout (the second entry point,
  the uplink route, `bms.edge_gateways`); §6's ingest bullet (the receiver is
  in scope, brokers still are not); `docs/roadmap.md`. ADR 0016 and ADR 0061
  each gain the amendment named in *Status*, in the PR that changes the
  behaviour. `docs/ingest-host.md` is updated with the feature, not the sweep.
- **Not decided here:** the cloud host's database role (`bms_fleet` stopgap),
  the compose `restart:` policy `F1.10` left open, and device health /
  last-seen (`F3.16`), which will want the per-gateway counters this adds.

## Amendment 1 — as built in PR 2 and PR 3 (2026-11-10)

**Confirmed by the owner — 2026-11-11** (in chat, delegating the review: "Do
item number 3 and item number 4 fast. You do it from your side."). Drafted by
the build session; confirmed as written after a review of (a)–(d): (a) and (b)
record facts and only tighten decision 4, (c) is closed by #1241 and #1243,
and (d) stays accepted risk, with the audit of late overwrites still owed
(`docs/ingest-host.md` *Known limits*). It records what PR 2 and PR 3 built
where that differs from, or adds to, the text above. No decision above is
reworded.

**(a) Three migrations, not one.** The plan's `0140` was taken by another row,
so the numbers moved:

- `0141_edge_gateways.sql` — the table and `bms.rtus.edge_gateway_id`, as
  sketched, plus the plan's C8 keys and CHECKs.
- `0142_edge_gateways_tenant_read_only.sql` — `REVOKE INSERT, UPDATE, DELETE`
  on the table from `bms_tenant` (PR 2 security review). "No `GRANT` is
  written" still holds: a REVOKE narrows the default privileges, it grants
  nothing.
- `0143_edge_gateways_backfill_seq.sql` — `backfill_dirty_seq`, a generation
  counter, so decision 11's clear cannot miss a late write that lands inside
  the window while a refresh runs.

**(b) Decision 4, additions from the PR 3 security review.**

- The write transaction re-checks, at commit, the presented token's hash, the
  gateway's `status` and the organization's ingest switch. A revoke, rotation
  or switch-off then takes effect at once, not only at the next snapshot
  reload.
- A per-gateway sample-rate bucket (`INGEST_UPLINK_MAX_SAMPLES_PER_S`) and a
  global cap on concurrent writes answer `429` with `Retry-After`.
- The write transaction sets a server-side `statement_timeout` and
  `lock_timeout`, so Postgres cancels a stalled write rather than leaving a
  backend running after the receiver gives up.

**(c) Decision 11 is built but not started.** `apps/ingest` does not yet
depend on `@bms/db`, because only the owner may edit a `package.json` (plan
P8). The repair pass exists and is tested with its refresh injected. Until the
dependency line is added and the loop is wired in `main.ts`, dirty windows
accumulate on `bms.edge_gateways`. They are durable, so nothing is lost, but
the aggregates are not repaired.

*2026-11-11:* the owner approved the manifest edit (plan P8). `apps/ingest`
now depends on `@bms/db` (`workspace:*`), gains the `start:edge` script
(`node dist/edge-main.js`), and its Dockerfile copies and builds `@bms/db`.
The loop is still not wired in `main.ts`, so the sentence above still holds
until that PR merges.

*2026-11-11, later:* the loop is wired. `main.ts` starts the repair pass on a
10 s tick whenever the uplink listener starts, with `createRepairStore(pool)`
and `refreshAggregatesFrom(pool, from, to)`, and clears the timer on
shutdown. Decision 11 is now started, and the warning is gone. Merging a
pass's windows into one refresh range (security review L3) is still owed.

*2026-11-11, L3:* a pass now merges its due windows that overlap or lie
within one hour of each other into one range, refreshes each range once, and
clears each window on its own compare-and-clear. Decision 11's guarantees are
unchanged: a window is cleared only after a refresh that covered it succeeded,
and one that moved during the refresh is kept.

**(d) Accepted risk, as built.**

- A stolen token can overwrite up to 6.5 days of its own gateway's points,
  with no audit trail of the overwrite.
- Which RTUs a gateway may write is checked against the in-memory binding
  plan, so for up to one reload tick a gateway can still write an RTU that
  was just reassigned.

## Amendment 2 — the edge clock guard and delete rules, as built in PR 5 (2026-11-10)

**Confirmed by the owner — 2026-11-11** (in chat, delegating the review: "Do
item number 3 and item number 4 fast. You do it from your side."). Drafted by
the build session; confirmed as written. The semantics in (a) 1 — trusting
the receiver's `Date` header, only on a schema-valid `200` over the verified
TLS connection and only within 30 s of the wall clock — were a drafter's call
and are now ruled: they fix the two failures the PR 5 reviews reproduced, and
the one weak case (a TLS-inspecting proxy that stamps `Date` from the same
wrong clock) is recorded under *Known limits*. The follow-up at the end of
this amendment (a cloud-disciplined clock while `skewed`) is **not ruled and
not built**. No decision above is reworded; this records what PR 5 built
where it adds to decisions 4 and 8.

**Why.** The PR 5 code and security reviews reproduced two failures of the
guard as first written (decision 8's text, read literally): a mark even
slightly ahead of a correct wall clock (a 2 s chrony step back, a mark 30 s
ahead at boot) **never** returned to `synced`, because the estimate and the
wall clock advance at the same rate; and a mark far ahead (an RTC kept in
local time and read as UTC) stamped every `rx` more than 60 s into the
future, so the cloud refused every sample as `futureRx` until the clock
caught up.

**(a) Decision 8, the edge guard, as built** (`apps/ingest/src/host/edge-clock.ts`):

1. `unsynced` ends when the wall clock reaches the estimate, **or** when a
   trusted cloud time says the wall clock is right: on a `200` whose body
   passes `uplinkResponseSchema`, the response's `Date` header, if it is
   within 30 s of the wall clock. The guard then returns to the wall clock
   and resets the mark to it. That is the one case `rx` steps backwards; any
   step over a second is logged at `warn` with its size. An absent or
   unparseable header, or a `200` whose body is not the receiver's, changes
   nothing.
2. While `synced`, a trusted cloud time more than 60 s from the wall clock
   reports `clock=skewed` on the health line, which degrades the verdict.
3. A wall clock that steps back while running goes `unsynced` as before and
   converges at the next trusted response under 1.
4. A crash cannot re-issue an `rx` already sent. A periodic mark is written
   at most a minute apart and offered every 15 s, so on load the estimate
   starts at `mark + 75 s`. A mark written by a clean shutdown carries
   `"clean": true` and needs no margin, because nothing was stamped after
   it; on load such a mark is **replaced at once** by an unclean one (the
   same time, forced), so a kill later in that run makes the next boot apply
   the margin. All writes go through one serial chain (a periodic write in
   flight cannot land after a resync's), each to a unique temp file,
   `fsync`ed, then renamed. A mark that is not a finite time within a
   four-digit year is refused with a warning and treated as none. Deleting
   `clock-mark.json` is the manual reset.

**What stays ruled:** Q7a. The edge never shifts `rx` by a measured offset;
the cloud rejects and counts. `skewed` is reported, not corrected.

**(b) Decision 4, the edge client's outcomes, as built**
(`apps/ingest/src/host/uplink-client.ts`). Only the receiver, refusing the
**content**, can make the edge drop a batch:

- A batch is dropped (counted `uplinkRefused`) **only** on the receiver's
  own `400 bad-schema`. Every sample is checked against the same
  `uplinkSampleSchema` before it is sent (a device time that does not fit is
  left off; a sample that still does not fit is dropped alone and counted),
  so `bad-schema` should only happen on a version mismatch between the ends.
  The codes and statuses are one constant, `UPLINK_REFUSAL_STATUS` in
  `packages/shared/src/ingest-uplink.ts`, which the listener answers from.
- The receiver's transport refusals — `400 bad-encoding`, `400 bad-gzip`,
  `400 bad-json`, `413 too-large` — are retry-later: a middlebox rewriting
  the body must not drain the backlog. So are `422`, any `400`/`413` with
  another body (a proxy page) and a `200` whose body fails
  `uplinkResponseSchema`. Bodies are split to at most 500 samples by count
  and 256 KiB compressed.
- A schema-valid `200` is **delivered**, whatever its reject counts — Q7a as
  ruled: "one bad sample cannot block a gateway's queue for ever". When it
  reports `futureRx` or `tooOld`, the edge degrades its health for ten
  minutes and logs one throttled line with the counts.
- **Tried and withdrawn:** for one review round a `200` in which every
  sample was `futureRx` was treated as retry-later, to keep a wrong clock
  from deleting telemetry. It retained data that could only ever land at a
  wrong time, could wedge replay behind segments that never aged out, and
  mixed badly with batches that were also partly foreign. The protection
  that remains is (a) 1 — a box whose mark is ahead loses at most the
  batches before its first good reply — and (a) 2, which makes a wrong clock
  visible.

**Known limits, for the owner.**

- A box whose RTC is more than 60 s ahead, with the cloud reachable, shows
  `clock=skewed` (degraded) and **its samples are rejected by the cloud until
  the clock is fixed**. That is ruling Q7a working as ruled.
- The trusted-`Date` rule trusts what arrives over the verified TLS
  connection. A TLS-inspecting proxy at the site that stamps `Date` from the
  same wrong site clock would make a wrong wall clock look right.
- A possible follow-up, **not built, for the owner to rule on**: while
  `skewed`, stamp `rx` from a cloud-disciplined clock (the last trusted
  `Date` plus monotonic elapsed time) instead of the wall clock.
