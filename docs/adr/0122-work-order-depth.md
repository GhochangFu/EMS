# ADR 0122 — Work-order depth: SLA, checklists, root cause, closure approval, timeline, references (`E3.1`)

## Status

**Accepted — 2026-11-10** (owner, in chat: "accept the ADR and yes to the
plan"; proposed the same day). Drafted by the agent for backlog rows `E3.1`
and `E3.4` (`docs/BACKLOG.md` §2 Track M). The owner ruled Q1–Q12 and the
plan's P1–P12 and R1–R5 in chat on 2026-11-10, one at a time (see
*Rulings*); *Decision* below is written to those rulings. The plan
(`docs/plans/e3.1-work-order-depth.md`) was approved in the same message.
Lines marked *(drafter)* are drafter calls the plan may refine.

Builds on ADR 0006 (work-order foundation). This record
**stands as the amendment** to **ADR 0017** (a third write class) and
**ADR 0106** (what the copilot's `workOrder.close` means) — ruling P11; each
of those records gets a one-line pointer here and no separate amendment text.

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

## Decision

### 1. Scope *(Q1, Q2)*

One record for all seven items, built as seven small PRs (ruling R1). **`E3.4` (alarm
enrichment → work order) is folded into this record** (ruling Q2) as a
**frozen snapshot** (ruling Q2b) — decision 5a. Its backlog row closes with
`E3.1`.

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
4. The domain prefix is a new nullable column
   `bms.asset_domains.work_order_prefix varchar(8)`, seeded `ELEC`, `HVAC`,
   `IT`, `ENV`, `WATER`, `MECH`, `UPS`, `FAC`. A global `admin` edits it
   through a new route and screen (ruling P8).
5. **An asset template may override it** (ruling Q4): a new nullable column
   `bms.asset_templates.work_order_prefix varchar(8)`, edited where the
   template is authored (ADR 0015 / 0038 gates unchanged). This is how an STP
   or ETP template gives `STP-…` or `ETP-…` without a new domain. Order at
   create: the asset's template prefix, else its domain's prefix, else `GEN`.
   Both columns take `^[A-Z0-9]{2,8}$` *(drafter)*. A template's prefix is
   set on a **draft** only — a published version stays immutable (ruling
   R2). The demo seed sets `STP` and `ETP` on its two demo templates; the
   stock catalog is left alone (ruling R3). The copilot does not set it
   (ruling R5).
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
   carry an explicit `slaMinutes` that wins — **from the four admin roles
   only** (owner ruling, 2026-11-11). An `operator` who sends `slaMinutes` is
   refused (403); an operator's ticket always takes the policy or the default.
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
4. The seed is nine codes (ruling P5): `equipment_failure`, `wear_and_tear`,
   `power_quality`, `sensor_fault`, `configuration_error`, `operator_error`,
   `external_event`, `no_fault_found`, `other`.

### 5a. Alarm enrichment snapshot — `E3.4` *(Q2, Q2b)*

1. Four nullable columns on `bms.work_orders`: `alarm_root_cause text`,
   `alarm_corrective_actions text`, `alarm_skill_code varchar(64)` →
   `bms.alarm_skills`, `alarm_etr_at timestamptz`.
2. When a ticket is created with an `alarm_id` and that alarm has a
   `bms.alarm_enrichments` row, the create transaction copies the four
   values. **They are never updated afterwards** — a later edit of the
   alarm's enrichment does not reach the ticket, and no route writes them.
3. They are shown read-only in the detail drawer as *From the alarm*, apart
   from the technician's own findings (decision 5). They do not satisfy the
   resolve gate of decision 5.2.
4. A ticket created before this lands, or from an alarm with no enrichment,
   has all four `NULL`. No backfill.

### 6. Closure approval *(Q1, Q10, Q11)*

1. `resolved` **means** "done, waiting for approval"; `closed` means
   "approved". One new status, `cancelled`, comes from ruling P2 (item 8).
2. `POST /work-orders/:id/close` becomes the **approval**. It needs a new
   third write class, `approval` (`OperationsWriteClass` in
   `apps/api/src/auth/operations-write.ts`): the four admin roles ✅,
   `operator` ❌, `viewer` ❌. The existing scope check still applies. It
   stamps `approved_by` and `approved_at`.
3. **Self-approval is allowed and recorded** (ruling Q11). `resolved_by` is
   stamped at resolve; when the approver is the same user, the `approved`
   event and the audit row carry `selfApproved: true` and the drawer says
   *Self-approved*. Only the `approval` class can do it, so an `operator`
   still never closes their own work.
4. New `POST /work-orders/:id/reject` (`approval` class, reason required)
   sends a `resolved` ticket back to `in_progress`.
5. `PATCH /:id/status` no longer accepts `closed` — the body schema drops it,
   which is what the copilot's model body already does (ADR 0106 decision 2).
   `close` approves **only a `resolved` ticket**, 409 otherwise (ruling P2).
   The operational class may move a `resolved` ticket back to `in_progress`
   through the status route, which clears the resolve stamps (ruling P3).
   `PATCH /reorder` refuses a move into `resolved` with 400, as it already
   refuses *Done* (ruling P1) — resolve always goes through its form.
6. Approval applies to **every** work order.
7. Existing `closed` rows stay closed with `approved_by NULL` (read as
   "closed before approval existed"). Existing `resolved` rows wait for
   approval.
8. **Cancel** (ruling P2). A sixth status `cancelled`, terminal like
   `closed`. New `POST /work-orders/:id/cancel` — `approval` class, reason
   required — from `open`, `assigned`, `in_progress` or `resolved`. It stamps
   `cancelled_by` and `cancelled_at` and skips the checklist and root-cause
   gates. A cancelled ticket cannot be reopened, reads SLA state `none`, and
   is not a Kanban column: the board hides it behind a *Cancelled* filter
   *(drafter)*. The four admin roles may cancel; an `operator` may not
   *(drafter — stated to the owner on 2026-11-10, no objection recorded)*.
   Neither status route nor reorder accepts `cancelled`.

### 7. Timeline and audit *(Q12)*

1. New tenant table `bms.work_order_events (id, organization_id,
   work_order_id, event_type, actor_id, actor_name, from_status, to_status,
   detail jsonb, created_at)`. `event_type` is a closed `CHECK` vocabulary:
   `created`, `assigned`, `status_changed`, `task_updated`, `root_cause_set`,
   `resolved`, `approved`, `rejected`, `cancelled`, `sla_changed`.
2. It is **append-only by privilege**: the migration revokes `UPDATE` and
   `DELETE` from `bms_tenant` and `bms_fleet`. It is not hash-chained —
   tamper evidence stays with `F4.15`.
3. Every work-order write inserts its event **in the same transaction** as
   the change and still writes its `bms.audit_log` row (AGENTS.md §9.8).
   The audit payload gains `reference`, `fromStatus` and `toStatus`. The
   events table is the product history any reader of the ticket may see;
   `audit_log` stays the compliance record with its own gate.
4. **The actor's display name is saved on the event** (ruling P7):
   `actor_name varchar(255)`, written at insert and never changed, so a
   tenant reader sees the real name of a global admin and a later rename does
   not rewrite history. It is a display name only — never an email or an
   `oidcSubject` (the ADR 0046 Amendment 2 rule). `detail` holds no free text
   beyond the reason the user typed.
5. No events are invented for tickets older than this table (ruling P10).

### 8. Lifecycle stepper *(Q12)*

Five steps, as the reference draws them, derived from the events:
**Alarm Triggered** (the alarm's `created_at`; for a ticket with no alarm the
step reads *Raised manually* or *Scheduled maintenance*) → **Work Order
Created** → **Assigned** → **In Progress** → **Completed**. Step 5 is reached
at `closed`; while the ticket is `resolved` it reads *Awaiting approval*.
A cancelled ticket stops at the step it had reached and reads *Cancelled*.
A ticket older than the events table lights its steps from its status and
shows a time only where one is known (ruling P10).
The stepper lives in a new work-order detail drawer on `/work-orders`,
together with the checklist, the root-cause form, the SLA chip and the
timeline. There is no `ESKOM_SMOC.html` screen for it (AGENTS.md §5); the
SOW reference layout is the visual source.

### 9. Schema, roles and row security

Four forward-only, idempotent migrations — the next free numbers at build
time (`0140` onward today), one per PR:

| Migration | Tables |
| --- | --- |
| A — references and SLA | `work_orders` + `seq`, `reference`, `sla_minutes`, `sla_due_at`; `asset_domains` + `work_order_prefix`; `asset_templates` + `work_order_prefix`; new `work_order_counters`, `work_order_sla_policies`; backfill |
| B — events | new `work_order_events` |
| C — checklists | new `work_order_checklist_templates`, `work_order_checklist_template_items`; `work_order_tasks` + five columns and its policy re-created; `maintenance_task_templates` + `checklist_template_id` |
| D — root cause, snapshot, approval, cancel | new `work_order_cause_codes` (+ nine-code seed); `work_orders` + `root_cause`, `corrective_action`, `preventive_action`, `cause_code`, `alarm_root_cause`, `alarm_corrective_actions`, `alarm_skill_code`, `alarm_etr_at`, `resolved_by`, `approved_by`, `approved_at`, `cancelled_by`, `cancelled_at`; a `CHECK` on `status` naming the six values |

- Every new tenant table (`work_order_counters`, `work_order_sla_policies`,
  `work_order_events`, both checklist tables) is created inside `SET ROLE
  bms_owner … RESET ROLE`, so migration `0041`'s default privileges grant
  `bms_tenant` and `bms_fleet`; each gets `ENABLE` + `FORCE ROW LEVEL
  SECURITY` and a `tenant_isolation` policy with `USING` and `WITH CHECK`
  that checks its own `organization_id` **and** its org-bearing parent
  (`EXISTS`, the `0050` / `0082` / `0123` shape).
- `work_order_events`: `REVOKE UPDATE, DELETE` from `bms_tenant`, `bms_fleet`.
- `work_order_tasks` gets its first tenant-pool writer, and its `0047`
  policy checks only its own column. Migration C re-creates it with the
  parent `EXISTS` on `work_orders` (ruling P9).
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
| `GET /work-orders/:id` | read | **new** — the item plus `tasks`, `events`, root-cause fields, the alarm snapshot (5a), alarm summary |
| `GET /work-orders/cause-codes` | read | **new** |
| `GET /work-orders/checklist-templates?assetId=` | read | **new** — active templates that fit the asset, so an operator's create form can pick one (ruling P6) |
| `POST /work-orders` | operational | body gains `slaMinutes?`, `checklistTemplateId?` |
| `PATCH /work-orders/:id/status` | operational | body loses `closed`; gains `rootCause?`, `correctiveAction?`, `preventiveAction?`, `causeCode?`; `resolved` enforces decisions 4.4 and 5.2 (409) |
| `PUT /work-orders/:id/root-cause` | operational | **new** — while `resolved` or earlier |
| `POST /work-orders/:id/tasks` · `PATCH /work-orders/:id/tasks/:taskId` | operational | **new** |
| `POST /work-orders/:id/close` | **approval** | now the approval; only from `resolved`; records self-approval |
| `POST /work-orders/:id/reject` | **approval** | **new** |
| `POST /work-orders/:id/cancel` | **approval** | **new** — reason required |
| `PATCH /work-orders/reorder` | operational | refuses a move into `resolved` (400) |
| `GET` · `PATCH /admin/vocabularies/asset-domains/:code` | global `admin` | **new** — `workOrderPrefix` only (rulings P8, R4) |
| asset-template authoring routes | unchanged gates | body gains `workOrderPrefix?` |
| `GET` · `PUT /admin/work-order-sla-policies` | configuration + `isOrganizationLevelAdmin` | **new** |
| `GET` · `POST` · `PATCH /admin/work-order-checklist-templates` | configuration + `isOrganizationLevelAdmin` | **new** |
| `PATCH /maintenance/schedules/:id` | configuration | body gains `checklistTemplateId?` |

Copilot (ADR 0099 / 0106): `workOrder.setStatus` and `workOrder.close` keep
their ids and routes; the close card's wording becomes *approve and close*.
The new routes go on the catalog's named exclusion list in this row, and the
new body fields (`slaMinutes`, `checklistTemplateId`, the four root-cause
fields) are `clientOnly`, so the copilot never sends them (ruling P4). Its
resolve of an alarm ticket with no saved root cause is therefore refused, and
the user completes it on the page.

`workOrderStatusSchema` gains `cancelled`.

## Dependencies

None. No new npm package in any app.

## Not in this record

Mobile execution and photo evidence (`E3.2`); a CMMS/EAM connector (`E3.3`);
a live view of the alarm's current enrichment beside the snapshot; SLA breach notification,
escalation, pause, or business-hours calendars; response-time SLA; parts,
labour, cost; audit hash-chaining (`F4.15`); degradation and RUL (`E1.5`);
operator use of the copilot; any device command.

## Consequences

- **An operator can no longer close a work order.** That is the point of
  closure approval, and it is a behaviour change for every current user of
  the *Done* column. An administrator who also does the work may approve
  their own ticket; the record says so (Q11). That is a weaker control than
  four eyes, chosen so a one-admin site is not stuck.
- `cancelled` is a sixth status value. Every reader of
  `workOrderStatusSchema` (board, filters, KPIs, copilot text) must handle it.
- `E3.4` closes with this row. The ticket carries the alarm's enrichment as
  it stood at creation; it can go stale, by design.
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
role matrix spec proves `operator` is refused `close`, `reject` and `cancel`
and still allowed `status`; a self-approval is recorded as one; `close` on a
ticket that is not `resolved` is 409; a cancelled ticket cannot be reopened;
the alarm snapshot is copied at create and does not move when the enrichment
is edited; a template prefix wins over the domain prefix; a mandatory item
blocks `resolved`; the counter gives no duplicate reference under concurrent creates;
contract round-trip specs for every new schema; one live create → assign →
start → resolve → approve run against the Docker stack, asserted by exact
string in the browser.

## Gate questions

| # | Question | Options | Recommended | Ruled |
| --- | --- | --- | --- | --- |
| Q1 | Is work-order closure approval inside current scope, given AGENTS.md §6 names "approval workflows" under device commanding and identity governance? | (a) in scope, no §6 item moves · (b) needs a §10 promotion first | (a) | as recommended |
| Q2 | One record for all seven items, and does `E3.1` absorb `E3.4`? | (a) one ADR, six PRs, `E3.4` stays separate · (b) absorb `E3.4` · (c) split SLA/stepper into a second row | (a) | **(b) absorb `E3.4`** — as a frozen snapshot (Q2b) |
| Q3 | How does a work order get a prefixed id without breaking existing ids? | (a) keep the uuid; add a frozen `reference` from a per-organization counter + domain prefix · (b) per-domain counters · (c) compute the label on read, store nothing | (a) | as recommended |
| Q4 | Where does `STP` / `ETP` come from, since they are not asset domains? | (a) domain only in release 1 — an STP asset reads `WATER-…` · (b) a prefix override on the asset template · (c) add `stp` / `etp` domains | (a) | **(b) prefix override on the asset template** |
| Q5 | SLA source and units | (a) minutes, from a per-organization per-priority policy, snapshotted on the ticket, with a per-ticket override · (b) typed per ticket only · (c) from the alarm rule or severity | (a) | as recommended |
| Q6 | Default SLA when an organization has set none | critical 30 min · high 1h · medium 4h · low 24h — or the owner's numbers | as listed | as recommended |
| Q7 | What the SLA clock measures | (a) creation → resolved, wall time, no pause, state computed on read, no alerts · (b) also a response SLA (creation → assigned) · (c) add breach notifications now | (a) | as recommended |
| Q8 | Checklist templates: per what? | (a) per organization, optional asset domain, copied onto the ticket; schedules may name one · (b) per ticket only, no templates · (c) on the asset template (ADR 0015) | (a) | as recommended |
| Q9 | Root-cause shape and when it is required | (a) three text fields + a coded cause; required to resolve an alarm-linked ticket · (b) text only · (c) required on every ticket | (a) | as recommended |
| Q10 | Who may approve closure, and for which tickets? | (a) the four admin roles within their scope, every ticket, new `approval` write class · (b) `organization_admin` and `admin` only · (c) only high / critical tickets need approval · (d) a per-organization switch | (a) | as recommended |
| Q11 | May the person who resolved a ticket approve it? | (a) no — strict four eyes, 409 · (b) yes for admins, recorded as self-approved | (a) | **(b) yes for admins, recorded** |
| Q12 | Audit shape and stepper | (a) new append-only `work_order_events` table feeds a five-step stepper (step 5 at `closed`, *Awaiting approval* while `resolved`); `audit_log` still written · (b) richer `audit_log` payload only, add `assigned_at` / `started_at` columns for the stepper · (c) six steps with a separate *Approved* | (a) | as recommended |

Who may edit SLA policies and checklist templates (`admin` and
`organization_admin`) is a drafter call the plan may refine; say so if it
should be wider.

**As built, 2026-11-10 (PR 1).** The check is `isOrganizationLevelAdmin`, not
`canManageOrganization` as first drafted. `canManageOrganization` also answers
yes for a `location_admin` in any organization where they hold one node, which
is wider than the two roles named above. The route table in decision 10 says
so now, and the checklist-template routes of PR 3 take the same check.

## Rulings (owner, in chat, 2026-11-10)

The twelve gate questions are ruled in the table above. The plan raised
twelve more; the owner ruled them the same day:

| # | Question | Ruled |
| --- | --- | --- |
| Q2b | How the alarm's enrichment reaches the ticket | **frozen snapshot at creation** |
| P1 | A Kanban drag into `resolved` | refused (400) |
| P2 | `close` from any status, and a cancel path | **close only from `resolved`; add a cancel path** (`cancelled` status, approver, reason) |
| P3 | An operator moving a `resolved` ticket back to work | allowed |
| P4 | The copilot filling the new fields | no — `clientOnly` |
| P5 | Cause-code seed | the nine listed in decision 5.4 |
| P6 | A template list an operator may read | yes |
| P7 | Timeline actor name | **saved on the event** |
| P8 | Editing domain prefixes | **an admin route and screen** |
| P9 | Tighten the `work_order_tasks` policy | yes |
| P10 | Stepper for older tickets | steps from status, no event backfill |
| P11 | The ADR 0017 and ADR 0106 amendments | ADR 0122 stands as both |
| P12 | Merge rule for the six build PRs | **green CI + clean branch + required reviews, for all six** |

| R1 | Seven build PRs, not six (approval and cancel reviewed apart from root cause) | yes |
| R2 | Template prefix editable on a published version | no — draft only |
| R3 | Who seeds `STP` / `ETP` | the demo seed only |
| R4 | Path of the domain-prefix route | `/admin/vocabularies/asset-domains/:code` |
| R5 | The copilot setting a template's prefix | no — `clientOnly` |

Bold marks a ruling that differs from the drafter's recommendation. R1–R5
were raised by the plan after the first rulings.

Two more, ruled by the owner in chat on 2026-11-11, during the build:

| # | Question | Ruled |
| --- | --- | --- |
| S1 | SLA override: who may send `slaMinutes` on `POST /work-orders` | **admins only** — owner, 2026-11-11, reverses the as-built behaviour of PR 1 (which let any `operational` caller, an `operator` included, send it). Built in PR 3. |
| S2 | Who may edit SLA policies | stays as built: the global `admin` and the organization's `organization_admin` only (`isOrganizationLevelAdmin`) — owner, 2026-11-11 |

**As built, 2026-11-11 (PR 3, migration `0145`).** Six things the plan did not
spell out, each small:

- *Composite foreign keys.* `work_order_tasks` (to its work order and to its
  template item), the template items and
  `maintenance_task_templates.checklist_template_id` each carry a composite
  `(organization_id, …)` foreign key to their parent, as `0144` did for events.
  A policy does not bind `bms_fleet`; the key does. The task's template-item
  key is `ON DELETE SET NULL (template_item_id)`, which needs Postgres 15 or
  later (compose and CI run 16).
- *A ticket's checklist holds at most 100 items* (409 on the next), the same
  bound as a template's list.
- *A template's name is unique in its organization*, case-insensitively (409 on
  a duplicate), so a picker never shows two templates a person cannot tell
  apart.
- *A close that skips `resolved` is gated like a resolve.* Until PR 5 limits
  `close` to a resolved ticket, a ticket can be closed straight from a live
  status; that path now also answers 409 while a mandatory item is pending, so
  it cannot step around decision 4.4.
- *A retired template is skipped at convert, not refused.* A schedule names its
  checklist template once; if that template is later retired or re-scoped, the
  converted work order is created with no checklist. Create from the form
  refuses an unusable template (400).
- *A checklist write on a `resolved` or `closed` ticket answers 409.* Move the
  ticket back to work to change its checklist.

`checklistDone` counts the items that are no longer `pending` (`done` or
`not_applicable`). No read returns a schedule's `checklistTemplateId` yet, and
no screen sets it; the schedule item contract was left alone in PR 3.

**As built, 2026-11-11 (PR 4, migration `0148`).** Migration D landed whole, as
plan D15 says: the approval and cancel columns and the `cancelled` value of the
status `CHECK` have no writer until PR 5. Six things the plan did not spell out:

- *The Root cause "step" is a section of the Status step.* The four findings
  fields are `clientOnly` on `workOrder.setStatus` (ruling P4), and a
  `clientOnly` field may not sit in a catalog step, which is where the shared
  wizard takes its steps from. So the status wizard shows a **Root cause**
  section when `resolved` is chosen, and its values ride the same `PATCH`.
- *A resolved ticket goes back to `in_progress` only on the board too.* A drag
  from Review to Open or Assigned answers 409, as the status route does (ruling
  P3); a drag back to In progress clears the resolve stamps.
- *A close that skips `resolved` owes the root cause too* on a ticket raised
  from an alarm, for the reason given for the checklist in PR 3, until PR 5.
- *A resolved ticket raised from an alarm keeps its three findings.* They stay
  editable (decision 5.3), but `PUT /work-orders/:id/root-cause` answers 409 if
  it would clear one of them while the ticket is `resolved`.
- *The status body sets a finding and never clears one;* the root-cause route
  clears. A ticket keeps a cause code that is retired after it was given; a
  retired code cannot be given to another ticket (400).
- *No typed finding reaches the timeline or the audit log.* The `root_cause_set`
  event carries the coded cause only. The root-cause route's audit row carries
  the coded cause and which texts are filled; the status route's carries the
  coded cause and that the findings changed.
- *A finding is trimmed before it is measured*, so three spaces are not a
  finding (400), and the status route holds the same "a resolved alarm ticket
  keeps its findings" rule as the root-cause route (409) — from the security
  review.
- *The copilot's status and close pre-check follows the route's rule:* a
  resolved ticket moved back to Open or Assigned is refused before the card.

*The migration's number.* It was first pushed as `0146_…`; `F4.17` merged its own
`0146` and `0147` while this PR was in review, so the file was renamed to
`0148_work_order_root_cause_snapshot_approval_cancel.sql` before any shared
database had applied it. The rename is a change to a committed migration, which
the pre-commit guard refuses; the owner authorised that one commit to bypass it.

`GET /work-orders/cause-codes` answers the active codes to every signed-in user.
The detail read also answers `resolvedBy` (a user id). `approvedAt` on the list
item reads null until PR 5.
