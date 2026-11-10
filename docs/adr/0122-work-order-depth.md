# ADR 0122 — Work-order depth: SLA, checklists, root cause, closure approval, timeline, references (`E3.1`)

## Status

**Proposed — 2026-11-10.** Drafted by the agent for backlog row `E3.1`
(`docs/BACKLOG.md` §2 Track M). **Nothing here is decided.** The owner rules
the twelve *Gate questions* at the end; every line in *Decision* is the
drafter's recommendation and names the question it hangs on. No code, schema
or contract changes until this record is Accepted and the plan
(`docs/plans/e3.1-work-order-depth.md`) is approved.

Builds on ADR 0006 (work-order foundation). Would amend **ADR 0017** (a third
write class) and **ADR 0106** (what the copilot's `workOrder.close` means) if
Q10 is ruled as recommended.

## Context

`E3.1` asks for *maintenance checklists, root-cause documentation, closure
approval, richer audit*. BACKLOG §7 (client reference layouts) adds three
things the row did not name: **SLA as an elapsed-time field** (`SLA 30 mins`,
`SLA 1h`, and an SLA column in the open-work-order table), a **five-step
stepper** (Alarm Triggered → Work Order Created → Assigned → In Progress →
Completed), and **domain-prefixed ids** (`WO #ELEC-…`, `WO #WATER-…`,
`WO #STP-…`). `E3.2`, `E3.3` and `E1.5` depend on this row; `E3.4` overlaps it.

What exists on `main` at `0bc360c` (read 2026-11-10):

| Asked for | Today |
| --- | --- |
| Checklists | `bms.work_order_tasks` (`title`, `status`, `sort_order`, `completed_at`) exists since migration `0003` and is **seeded but never read or written by the API or the web app**. `bms.maintenance_task_templates` is a per-asset schedule definition, not a checklist. |
| Root cause | No column on `bms.work_orders`. `bms.alarm_enrichments` (ADR 0034) holds `root_cause` / `corrective_actions` for the **alarm**, not the ticket. |
| Closure approval | None. `POST /work-orders/:id/close` and `PATCH /:id/status` with `closed` are both `operational` class (ADR 0017), so an `operator` closes their own work. The status route takes `closed` with no reason (noted in ADR 0106). |
| Richer audit | Four `bms.audit_log` actions (`work_order_create`, `work_order_status_update`, `work_order_reorder`, plus the close reason). The payload is small and hand-picked. `audit_log` is readable only by `admin` and `organization_admin` (ADR 0021 / 0046), so an operator cannot see a ticket's history. |
| SLA | Nothing. `due_at` is a free planned date. |
| Stepper | Nothing. The page is a Kanban of five status columns; there is no work-order detail view. Only `resolved_at` and `closed_at` are stamped — there is no assigned or started time. |
| Prefixed ids | The id is a uuid; cards show the title. Asset domains are data (`bms.asset_domains`: `electrical`, `hvac`, `it`, `environment`, `water`, `mechanical`, `ups`, `facility`); there is no `STP` or `ETP` domain. |

Fixed points this record must respect: tenant tables run under `FORCE ROW
LEVEL SECURITY` with the `bms_tenant` / `bms_fleet` pools (ADR 0043 / 0045);
API response types are Zod contracts in `packages/shared/src/contracts`
(ADR 0030); the work-order write bodies already live there
(`operations-writes.ts`, ADR 0106 decision 7); every mutating route carries
`assertOperationsWriteRole` before the scope check (ADR 0017); every new route
needs a copilot catalog entry or a named exclusion (ADR 0099).

**A scope reading the owner must confirm (Q1).** AGENTS.md §6 lists
"Two-way commanding with approval workflows" and, under identity governance,
"approval workflows". Both are about device commands and access reviews. The
drafter reads work-order closure approval as neither, so no §6 item moves.
If the owner reads it otherwise, this is a §10 promotion and the closure part
waits for it.

## Decision (recommended — each line waits on its question)

### 1. Scope *(Q1, Q2)*

One record for all seven items, built as six small PRs. `E3.4` (alarm
enrichment → work order) stays its own row: this record adds the ticket's
**own** root-cause fields and does not copy or read the alarm's enrichment.
The column names below are chosen so `E3.4` can add a snapshot or a
read-through later without a rename.

### 2. Human-readable reference *(Q3, Q4)*

1. The uuid `id` stays the primary key and stays in every URL, route and
   contract. Nothing existing breaks.
2. New columns `work_orders.seq integer` and `work_orders.reference
   varchar(32)`, both `NOT NULL` after backfill, `UNIQUE (organization_id,
   reference)`. `reference` is `<PREFIX>-<seq, six digits>`, for example
   `ELEC-000042`, shown as `WO #ELEC-000042`. It is **written once at create
   and never changes**, even if the asset later moves domain.
3. One counter **per organization** (not per domain), in a new table
   `bms.work_order_counters (organization_id PK, next_seq)`, taken with a row
   lock inside the create transaction. The number alone is unique within an
   organization; the prefix is a label.
4. The prefix is a new nullable column `bms.asset_domains.work_order_prefix
   varchar(8)`, seeded `ELEC`, `HVAC`, `IT`, `ENV`, `WATER`, `MECH`, `UPS`,
   `FAC`; a domain with none uses `GEN`. Global-`admin` write, like every
   other catalog field.
5. `STP` and `ETP` are not domains today. Release 1 gives a sewage-plant asset
   `WATER-…` *(Q4)*.
6. Backfill: existing rows get `seq` in `created_at` order per organization
   and a reference from their asset's current domain.

### 3. SLA *(Q5, Q6, Q7)*

1. Stored as **whole minutes**: `work_orders.sla_minutes integer` (nullable,
   `CHECK > 0`) and `work_orders.sla_due_at timestamptz` (= `created_at +
   sla_minutes`, written at create). Shown as `30 mins`, `1h`, `1d 4h`.
2. The source is a per-organization, per-priority policy:
   `bms.work_order_sla_policies (organization_id, priority,
   resolution_minutes)`, `UNIQUE (organization_id, priority)`. Create looks up
   the row for the ticket's priority and **snapshots** the minutes onto the
   ticket; a later policy edit does not move open tickets. The create body may
   carry an explicit `slaMinutes` that wins.
3. With no policy row the platform default applies, as constants in
   `packages/shared`: critical 30, high 60, medium 240, low 1440 *(Q6)*.
4. The SLA measures **creation to `resolved`** — one clock, wall time, no
   pause, no business-hours calendar.
5. State is **computed on read**, not stored: `on_track`, `at_risk` (under 20%
   of the window left), `breached`, `met`, `missed`, `none`. No scheduler job,
   no breach notification and no escalation in this record.
6. `due_at` stays as the planned date. Existing rows keep `sla_minutes NULL`
   and read `none`.

### 4. Checklists *(Q8)*

1. A ticket's checklist **is** `bms.work_order_tasks`. It gains `mandatory
   boolean`, `result varchar(16)` (`pending` / `done` / `not_applicable`,
   `CHECK`), `note text`, `completed_by uuid`, `template_item_id uuid`.
2. Reusable templates are two new tenant tables:
   `bms.work_order_checklist_templates (organization_id, name, domain NULL →
   asset_domains, active)` and `bms.work_order_checklist_template_items
   (template_id, title, mandatory, sort_order)`. A template is per
   organization and optionally per asset domain — not per asset and not on
   the asset template (ADR 0015).
3. Create copies the chosen template's items into `work_order_tasks` — a
   **frozen snapshot**; editing a template never changes an open ticket.
   `bms.maintenance_task_templates` gains a nullable
   `checklist_template_id`, so converting a due schedule brings its checklist.
   Items can also be added to one ticket by hand.
4. A ticket cannot move to `resolved` while a mandatory item is `pending`.
5. No photos, signatures or measured values on an item — that is `E3.2`.

### 5. Root cause *(Q9)*

1. Columns on `bms.work_orders`: `root_cause text`, `corrective_action text`,
   `preventive_action text`, and `cause_code varchar(64)` → a new global
   vocabulary `bms.work_order_cause_codes (code PK, label, sort_order,
   active)` in the ADR 0031 / 0034 shape (data, not an enum; retire with
   `active = false`).
2. Moving to `resolved` requires `rootCause`, `correctiveAction` and
   `causeCode` when the ticket has an `alarm_id`; they are optional on a
   planned-maintenance ticket.
3. They are editable while `resolved` and frozen at `closed`.

### 6. Closure approval *(Q1, Q10, Q11)*

1. No new status. `resolved` **means** "done, waiting for approval";
   `closed` means "approved".
2. `POST /work-orders/:id/close` becomes the **approval**. It needs a new
   third write class, `approval` (`OperationsWriteClass` in
   `apps/api/src/auth/operations-write.ts`): the four admin roles ✅,
   `operator` ❌, `viewer` ❌. The existing scope check still applies. It
   stamps `approved_by` and `approved_at`.
3. **Four eyes:** the approver must not be the user who resolved the ticket
   (new column `resolved_by`). Refused with 409.
4. New `POST /work-orders/:id/reject` (`approval` class, reason required)
   sends a `resolved` ticket back to `in_progress`.
5. `PATCH /:id/status` no longer accepts `closed` — the body schema drops it,
   which is what the copilot's model body already does (ADR 0106 decision 2).
   Kanban drag to *Done* already refuses.
6. Approval applies to **every** work order.
7. Existing `closed` rows stay closed with `approved_by NULL` (read as
   "closed before approval existed"). Existing `resolved` rows wait for
   approval.

### 7. Timeline and audit *(Q12)*

1. New tenant table `bms.work_order_events (id, organization_id,
   work_order_id, event_type, actor_id, from_status, to_status, detail jsonb,
   created_at)`. `event_type` is a closed `CHECK` vocabulary: `created`,
   `assigned`, `status_changed`, `task_updated`, `root_cause_set`,
   `resolved`, `approved`, `rejected`, `sla_changed`.
2. It is **append-only by privilege**: the migration revokes `UPDATE` and
   `DELETE` from `bms_tenant` and `bms_fleet`. It is not hash-chained —
   tamper evidence stays with `F4.15`.
3. Every work-order write inserts its event **in the same transaction** as
   the change and still writes its `bms.audit_log` row (AGENTS.md §9.8).
   The audit payload gains `reference`, `fromStatus` and `toStatus`. The
   events table is the product history any reader of the ticket may see;
   `audit_log` stays the compliance record with its own gate.
4. `detail` never holds free text beyond the reason the user typed, and never
   an `oidcSubject` — the reader sees the actor's display name (the ADR 0046
   Amendment 2 rule).

### 8. Lifecycle stepper *(Q12)*

Five steps, as the reference draws them, derived from the events:
**Alarm Triggered** (the alarm's `created_at`; for a ticket with no alarm the
step reads *Raised manually* or *Scheduled maintenance*) → **Work Order
Created** → **Assigned** → **In Progress** → **Completed**. Step 5 is reached
at `closed`; while the ticket is `resolved` it reads *Awaiting approval*.
The stepper lives in a new work-order detail drawer on `/work-orders`,
together with the checklist, the root-cause form, the SLA chip and the
timeline. There is no `ESKOM_SMOC.html` screen for it (AGENTS.md §5); the
SOW reference layout is the visual source.

### 9. Schema, roles and row security

Four forward-only, idempotent migrations — the next free numbers at build
time (`0140` onward today), one per PR:

| Migration | Tables |
| --- | --- |
| A — references and SLA | `work_orders` + `seq`, `reference`, `sla_minutes`, `sla_due_at`; `asset_domains` + `work_order_prefix`; new `work_order_counters`, `work_order_sla_policies`; backfill |
| B — events | new `work_order_events` |
| C — checklists | new `work_order_checklist_templates`, `work_order_checklist_template_items`; `work_order_tasks` + five columns; `maintenance_task_templates` + `checklist_template_id` |
| D — root cause and approval | new `work_order_cause_codes` (+ seed); `work_orders` + `root_cause`, `corrective_action`, `preventive_action`, `cause_code`, `resolved_by`, `approved_by`, `approved_at` |

- Every new tenant table (`work_order_counters`, `work_order_sla_policies`,
  `work_order_events`, both checklist tables) is created inside `SET ROLE
  bms_owner … RESET ROLE`, so migration `0041`'s default privileges grant
  `bms_tenant` and `bms_fleet`; each gets `ENABLE` + `FORCE ROW LEVEL
  SECURITY` and a `tenant_isolation` policy with `USING` and `WITH CHECK`
  that checks its own `organization_id` **and** its org-bearing parent
  (`EXISTS`, the `0050` / `0082` / `0123` shape).
- `work_order_events`: `REVOKE UPDATE, DELETE` from `bms_tenant`, `bms_fleet`.
- `work_order_cause_codes` is a global catalog with no row security:
  `REVOKE INSERT, UPDATE, DELETE` from `bms_tenant` (the `0090` shape).
- `bms_auth` and `bms_rollup` get nothing. No hypertable, no Timescale
  change.
- Each migration ends with a `DO $$` block asserting its own effect (RLS
  forced, policy present, privileges as stated).

### 10. API and contracts (ADR 0030)

All bodies `.strict()` in `packages/shared/src/contracts/operations-writes.ts`;
responses in `contracts/operations.ts`; the OpenAPI registry and the
strict-body ledger gain each one.

| Route | Class (ADR 0017) | Change |
| --- | --- | --- |
| `GET /work-orders` | read | item gains `reference`, `slaMinutes`, `slaDueAt`, `slaState`, `checklistDone`, `checklistTotal`, `causeCode`, `approvedAt` |
| `GET /work-orders/:id` | read | **new** — the item plus `tasks`, `events`, root-cause fields, alarm summary |
| `GET /work-orders/cause-codes` | read | **new** |
| `POST /work-orders` | operational | body gains `slaMinutes?`, `checklistTemplateId?` |
| `PATCH /work-orders/:id/status` | operational | body loses `closed`; gains `rootCause?`, `correctiveAction?`, `preventiveAction?`, `causeCode?`; `resolved` enforces decisions 4.4 and 5.2 (409) |
| `PUT /work-orders/:id/root-cause` | operational | **new** — while `resolved` or earlier |
| `POST /work-orders/:id/tasks` · `PATCH /work-orders/:id/tasks/:taskId` | operational | **new** |
| `POST /work-orders/:id/close` | **approval** | now the approval; four-eyes check |
| `POST /work-orders/:id/reject` | **approval** | **new** |
| `PATCH /work-orders/reorder` | operational | unchanged |
| `GET` · `PUT /admin/work-order-sla-policies` | configuration + `canManageOrganization` | **new** |
| `GET` · `POST` · `PATCH /admin/work-order-checklist-templates` | configuration + `canManageOrganization` | **new** |
| `PATCH /maintenance/schedules/:id` | configuration | body gains `checklistTemplateId?` |

Copilot (ADR 0099 / 0106): `workOrder.setStatus` and `workOrder.close` keep
their ids and routes; the close card's wording becomes *approve and close*.
The new routes go on the catalog's named exclusion list in this row.

## Dependencies

None. No new npm package in any app.

## Not in this record

Mobile execution and photo evidence (`E3.2`); a CMMS/EAM connector (`E3.3`);
copying alarm enrichment into the ticket (`E3.4`); SLA breach notification,
escalation, pause, or business-hours calendars; response-time SLA; parts,
labour, cost; audit hash-chaining (`F4.15`); degradation and RUL (`E1.5`);
operator use of the copilot; any device command.

## Consequences

- **An operator can no longer close a work order.** That is the point of
  closure approval, and it is a behaviour change for every current user of
  the *Done* column. A site with one administrator who also does the work
  cannot approve their own ticket — a global `admin` must (Q11).
- `PATCH /:id/status` dropping `closed` is a breaking contract change. The
  web close wizard and the copilot already use the close route.
- ADR 0017's matrix gains a class; AGENTS.md §4.7 and §3 owe a
  `chore(agents):` catch-up after the build (§10.1), and `docs/roadmap.md`
  owes a row.
- Two histories exist for one ticket (`work_order_events`, `audit_log`).
  They are written in one transaction so they cannot disagree on what
  happened, only on who may read it.
- `work_order_tasks` stops being dead seed data.
- `E3.2` gets a per-item checklist row to hang evidence on; `E3.3` gets a
  stable human reference to exchange; `E1.5` gets coded causes and
  resolution times to learn from.

## Verification owed

Per PR, in the plan. In summary: each migration applied twice on a seeded
database and its `DO` block green; RLS integration suites prove a second
organization reads and writes none of the new rows under the tenant pool; the
role matrix spec proves `operator` is refused `close` and `reject` and still
allowed `status`; four-eyes refused with 409; a mandatory item blocks
`resolved`; the counter gives no duplicate reference under concurrent creates;
contract round-trip specs for every new schema; one live create → assign →
start → resolve → approve run against the Docker stack, asserted by exact
string in the browser.

## Gate questions

| # | Question | Options | Recommended | Ruled |
| --- | --- | --- | --- | --- |
| Q1 | Is work-order closure approval inside current scope, given AGENTS.md §6 names "approval workflows" under device commanding and identity governance? | (a) in scope, no §6 item moves · (b) needs a §10 promotion first | (a) | |
| Q2 | One record for all seven items, and does `E3.1` absorb `E3.4`? | (a) one ADR, six PRs, `E3.4` stays separate · (b) absorb `E3.4` · (c) split SLA/stepper into a second row | (a) | |
| Q3 | How does a work order get a prefixed id without breaking existing ids? | (a) keep the uuid; add a frozen `reference` from a per-organization counter + domain prefix · (b) per-domain counters · (c) compute the label on read, store nothing | (a) | |
| Q4 | Where does `STP` / `ETP` come from, since they are not asset domains? | (a) domain only in release 1 — an STP asset reads `WATER-…` · (b) a prefix override on the asset template · (c) add `stp` / `etp` domains | (a) | |
| Q5 | SLA source and units | (a) minutes, from a per-organization per-priority policy, snapshotted on the ticket, with a per-ticket override · (b) typed per ticket only · (c) from the alarm rule or severity | (a) | |
| Q6 | Default SLA when an organization has set none | critical 30 min · high 1h · medium 4h · low 24h — or the owner's numbers | as listed | |
| Q7 | What the SLA clock measures | (a) creation → resolved, wall time, no pause, state computed on read, no alerts · (b) also a response SLA (creation → assigned) · (c) add breach notifications now | (a) | |
| Q8 | Checklist templates: per what? | (a) per organization, optional asset domain, copied onto the ticket; schedules may name one · (b) per ticket only, no templates · (c) on the asset template (ADR 0015) | (a) | |
| Q9 | Root-cause shape and when it is required | (a) three text fields + a coded cause; required to resolve an alarm-linked ticket · (b) text only · (c) required on every ticket | (a) | |
| Q10 | Who may approve closure, and for which tickets? | (a) the four admin roles within their scope, every ticket, new `approval` write class · (b) `organization_admin` and `admin` only · (c) only high / critical tickets need approval · (d) a per-organization switch | (a) | |
| Q11 | May the person who resolved a ticket approve it? | (a) no — strict four eyes, 409 · (b) yes for admins, recorded as self-approved | (a) | |
| Q12 | Audit shape and stepper | (a) new append-only `work_order_events` table feeds a five-step stepper (step 5 at `closed`, *Awaiting approval* while `resolved`); `audit_log` still written · (b) richer `audit_log` payload only, add `assigned_at` / `started_at` columns for the stepper · (c) six steps with a separate *Approved* | (a) | |

Who may edit SLA policies and checklist templates (`admin` and
`organization_admin`, through `canManageOrganization`) is a drafter call the
plan may refine; say so if it should be wider.
