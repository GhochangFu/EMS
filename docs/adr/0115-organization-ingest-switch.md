# ADR 0115 — An ingest switch per organization, applied at the reload (`F4.330`)

## Status

**Accepted — 2026-11-07** (owner, in chat: "Accept"; proposed the same day). Raised by the owner on 2026-11-07 after the BCPL
onboarding: the global admin needs a front-end option to stop, and later
restart, the ingestion of one organization's data. The owner gave seven
rulings in chat on 2026-11-07, one at a time, before this record was written
(listed under *Rulings*). Lines marked *(drafter)* are drafter calls that the
`F4.330` plan may refine; the others are rulings.

Promotes nothing out of AGENTS.md §6 and adds no dependency (§9.4). It is a
scope change because it adds a schema column, a new admin route and a new
ingest-host behaviour.

**Amends [ADR 0016](./0016-ingest-adapter-framework.md)** — the host's
"reload refreshes point mappings only" rule and its decision not to reconcile
the endpoint set (recorded in `apps/ingest/src/main.ts:106-133` and
`docs/ingest-host.md` "The device list is fixed at start-up" and *Known
limits*). The disk-buffer bounds of ADR 0016 Amendment 4 do **not** change.
Code citations are to `main` at `d7f4b9dc`.

## Context

**What exists today.**

- The only ingest control is the per-RTU box `bms.rtus.ingest_enabled`
  (`boolean not null default false`), shown as "Ingest enabled" in
  `apps/web/src/components/admin/rtu-wizards.tsx`. Anyone who can manage the
  RTU's location may change it (`canManageLocation` in
  `apps/api/src/admin/rtus/rtus.service.ts`). Stopping BCPL today means 21
  separate edits.
- The ingest host reads its bindings with one query, `BINDING_QUERY`
  (`apps/ingest/src/host/bindings.ts`), filtered by
  `WHERE r.ingest_enabled = true`. It does not join `bms.organizations`, and
  it ignores `rtus.active` and `organizations.active`. The host connects as
  `bms_owner` and reads every organization.
- One supervisor runs per `(protocol, endpointKey)`; MQTT groups a whole
  broker into one endpoint. A supervisor's `plan.bindings`, connection and
  disk-buffer handle are fixed when it is built (`createSupervisor`,
  `apps/ingest/src/host/supervisor.ts`). It exposes `start()`, `stop()` and
  `health()`.
- Every `INGEST_RELOAD_MS` (default 60 s) the host re-plans and swaps the
  point index only (`apps/ingest/src/main.ts:253-313`). So a disabled RTU's
  writes stop, but its broker subscription and health-roster entry stay until
  it reads `stale`; a newly enabled RTU, or a new endpoint, receives nothing
  until a host restart. The host logs `endpoint device set changed; restart
  required to apply` and `new endpoint requires a restart to serve`.
- `bms.organizations` has `id, code, name, active, meta, currency, timezone,
  colour_profile, created_at` — no ingest column. Organization PATCH,
  deactivate and reactivate are global-admin only (`assertAdminRole`) and
  write a platform audit row (`organizationId: null`). Deactivating an
  organization does not touch ingest (and needs zero active locations, so it
  cannot pause a live customer).
- No "communication lost" alarm exists in the alarm engine; when samples stop,
  threshold rules simply see no new values.

## Rulings

Given by the owner in chat on 2026-11-07, one question at a time.

| # | Question | Ruling |
|---|---|---|
| R1 | Column name and default | `organizations.ingest_enabled`, `boolean not null default true` |
| R2 | Who may flip it | Global admin only |
| R3 | How RTU box and org switch combine | Both must be on; the org switch never rewrites RTU boxes |
| R4 | Alarms on switch-off | Ingest only; alarms, rules and escalations untouched |
| R5 | How the reload applies changes | Replace the endpoint's supervisor (stop the old, start a new one) |
| R6 | Disk buffer of a stopped endpoint | Keep on disk; replay when that endpoint next starts |
| R7 | What users see while off | Data stays visible, plus an "Ingest off" badge |

## Decision

1. **Schema (R1).** A forward-only migration adds
   `bms.organizations.ingest_enabled boolean not null default true`. Every
   existing organization keeps flowing; no backfill is needed. Drizzle field
   `ingestEnabled` in `packages/db/src/schema/bms-schema.ts`. No RLS or grant
   change *(drafter: the ingest host already reads `bms.organizations` as
   `bms_owner`; the plan confirms the grant)*.

2. **Effective rule (R3).** An RTU is ingested only when
   `rtus.ingest_enabled = true` **and** its organization's
   `ingest_enabled = true`. Switching the organization off or on never writes
   any `rtus` row, so switching it back on restores each RTU's own setting
   exactly.

3. **Admin route (R2).** `PUT /api/v1/admin/organizations/:id/ingest` with
   body `{ "ingestEnabled": boolean }` (Zod, strict). Gated by
   `assertAdminRole` — global admin only; an `organization_admin` gets 403.
   It writes one audit row, `master.organization.ingest.enable` or
   `master.organization.ingest.disable`, as a platform event
   (`organizationId: null`, `fleetDb`), the same shape as deactivate. A write
   that does not change the value returns the row and writes no audit row
   *(drafter)*. The organization `PATCH` strict body keeps refusing the field,
   so this route is the only writer.

4. **Contracts (ADR 0030).** `adminOrganizationDtoSchema` and
   `adminOrganizationSummaryDtoSchema` in `packages/shared/src/contracts/admin.ts`
   gain `ingestEnabled: boolean`. The RTU admin DTO gains a read-only
   `organizationIngestEnabled: boolean` so the RTU form can say its box is
   overridden *(drafter: field name)*.

5. **Binding query and skip reason.** `BINDING_QUERY` joins
   `bms.organizations` and returns its `ingest_enabled`; the SQL keeps
   `r.ingest_enabled = true`. `planEndpoints` leaves out every row whose
   organization is switched off with the named skip reason
   **`organization-ingest-disabled`** (detail: the organization code), so the
   health endpoint's `skipped` lines say why each one is missing. An RTU with
   its own box off stays out of the query and out of `skipped`, as today
   *(drafter)*.

6. **Reload rebinding (R5) — amends ADR 0016.** At each reload the host
   compares the new plan with the running supervisors, per
   `endpointGroupKey(protocol, endpointKey)`:
   - **New endpoint** (in the plan, not running): build and start a
     supervisor.
   - **Device set changed** (same key, different `deviceKey` set): `stop()`
     the old supervisor, then build and `start()` a new one from the new plan.
     That broker alone reconnects; other endpoints are not touched.
   - **Gone** (running, not in the plan — e.g. no enabled RTU left): `stop()`
     the supervisor, which closes its broker connection, and drop it from the
     health roster.
   - **Same device set:** swap the point index only, as today.

   The `restart required to apply` and `new endpoint requires a restart`
   warnings are replaced by info lines naming what was started, replaced or
   stopped. A reload never runs while the previous one is still applying
   *(drafter)*. A change of connection config or credential on a running
   endpoint with the same device set is not newly handled here and still
   needs a restart *(drafter; the plan may widen it)*.

   **Time to effect:** within one `INGEST_RELOAD_MS` (60 s by default) plus
   the reconnect, with no restart — for the org switch and for the per-RTU
   box alike.

7. **Disk buffer of a stopped endpoint (R6).** Stopping a supervisor does not
   delete its disk segments. They replay when a supervisor for the same
   `(protocol, endpointKey)` next starts — at a re-enable or a host restart —
   through the same `DiskBufferStore.handle` (which already returns one handle
   per key). ADR 0016 Amendment 4's bounds are unchanged: a segment older than
   the 1 h receipt-time bound, or over the 256 MiB host-wide cap, is still
   swept and counted as today, so an organization switched off for longer
   than an hour loses what was buffered *before* the switch-off. The health
   endpoint names a stopped endpoint that still holds buffered bytes
   *(drafter: line format)*, so nothing is hidden.

8. **Alarms (R4).** Nothing in `apps/api/src/alarms` or `apps/api/src/rules`
   changes. A switched-off organization gets no new samples, so no new
   threshold alarms; open alarms stay open and can be acknowledged and
   cleared; escalations run as configured.

9. **What users see (R7).** All existing data stays readable — history,
   dashboards, reports, alarms. Login and users are not affected. The
   organization admin page (`apps/web/src/pages/admin/organizations-page.tsx`)
   gets the switch (global admin only, with a confirm step) and an
   **"Ingest off"** badge on a switched-off row. The RTU form shows that its
   "Ingest enabled" box is overridden while the organization is off.

10. **Organization `active` is not coupled.** Deactivating or reactivating an
    organization does not change `ingest_enabled`, and the ingest host does
    not read `organizations.active` *(drafter: kept out of scope; the two
    flags answer different questions)*.

## Dependencies

None.

## Consequences

- The ingest host gains the endpoint reconciliation ADR 0016 declined. It is
  kept to start / stop / replace whole supervisors, reusing their existing
  `start()` and `stop()`, rather than a second state machine inside the
  adapter. The cost is a reconnect gap of a few seconds on the one broker
  whose device set changed — for MQTT that is every RTU on that broker,
  including other organizations' RTUs that share it.
- `docs/ingest-host.md` ("The device list is fixed at start-up", *Reloads*,
  *Known limits*) must be rewritten with the build.
- The build touches `apps/ingest` (bindings, main/reload, health),
  `packages/db` (migration), `packages/shared` (contracts), `apps/api`
  (organizations route, RTU DTO) and `apps/web` (organizations page, RTU
  form). Ingest and auth changes go through the `security-reviewer` agent;
  the migration through the `migration-reviewer` agent.
- `F4.326` (plain MQTT, ADR 0114) also edits `apps/ingest/src/host/bindings.ts`
  and `apps/ingest/src/adapters/mqtt.ts`; whichever lands second rebases.
- An organization switched off for more than the 1 h buffer bound loses
  samples buffered before the switch-off (decision 7). Samples published by
  the devices *while* the organization is off are never received and are not
  recoverable from this platform.
- **AGENTS.md:** no §6 item moves. A later `chore(agents):` sweep may index
  this ADR (§10.1); nothing in AGENTS.md is wrong until then.

## Amendment 1 — 2026-11-07

Recorded during the `F4.330` PR 2 review. The decisions above are not edited;
this section corrects and extends them.

1. **Owner ruling on the stopped endpoint's backlog (decision 7).** Given in
   chat on 2026-11-07, after the review found two gaps:
   - **Fixed — visibility after a restart.** The health body's `stopped` list
     was built from the reloads of the running process only, so after a host
     restart the backlog of an endpoint the boot plan does not start (an
     organization still switched off) was invisible until the bounds swept it.
     The host now seeds that list at boot from every endpoint the disk-buffer
     start-up scan found holding samples (`DiskBufferStore.backlog()`); one the
     boot plan starts leaves the list as it starts.
   - **Documented, not changed — loss on a shared broker.** When a switched-off
     organization's RTUs share a broker with another organization's, the
     reload is a `replace`, not a `stop`. The new supervisor replays the old
     segments through the same disk-buffer handle against the new point index,
     the switched-off organization's samples resolve as `unknownDevice`, and
     the segment is committed and deleted. Decision 7's "keep on disk; replay
     when that endpoint next starts" therefore holds only for an endpoint that
     is stopped outright. `docs/ingest-host.md` *Known limits* says so.
2. **Correction — the database role.** The *Context* and decision 1 say the
   ingest host connects as `bms_owner`. It connects as **`bms_fleet`**
   (`docker-compose.yml`, the `ingest` service's `DATABASE_URL`). `0039`
   grants `bms_fleet` `SELECT, INSERT, UPDATE, DELETE` on every `bms` table and `bms.organizations`
   has no row-level security, so the conclusion — no grant or policy change —
   stands (plan §2).
3. **The health `stopped` line counts samples, not bytes.** Decision 7 left the
   line format to the drafter and spoke of "buffered bytes". The owner answered
   plan §9 Q1 for samples: `stopped protocol=<p> key=<endpointKey>
   buffered=<n>`, with `n` in samples, the same unit as every other
   `buffered=` on the body, because `DiskBufferHandle` exposes only the sample
   gauge.
