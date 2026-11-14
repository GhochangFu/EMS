# ADR 0131 — Maintenance windows: suppress alarms for a set time (`F4.359`)

## Status

**Accepted — 2026-11-13** (owner, in chat: "Accepted"; proposed the same
day). Drafted by an agent for backlog row `F4.359` from a design conversation
with the owner on 2026-11-13. The owner ruled six behaviours in chat, one
question at a time; those rulings are marked *(owner, 2026-11-13)* below.
Lines marked *(recommended)* were the agent's calls; the owner accepted the
ADR with them as written, so **every *(recommended)* line is now a ruling**.
The step-3 plan comes next, and the build waits for the owner's "yes" to it.

Answers the "shelve action" that [ADR 0057](./0057-alarm-lifecycle-auto-clear-and-escalation.md)
left open (*Consequences*), in the form of a scheduled window rather than a
per-alarm shelve. Builds on ADR 0057 (the lifecycle: an alarm is active while
`cleared_at IS NULL`), [ADR 0130](./0130-persistent-alarm-bar.md) and its
Amendment 1 (the alarm bar, its two counts per severity, its popup and its
tone), [ADR 0043](./0043-multi-tenant-architecture.md)
(tenant scope and RLS), [ADR 0098](./0098-location-tree-of-any-depth.md) (the
location tree) and [ADR 0127](./0127-device-health.md) decision 12 (device alarms: `source`
`rtu_comms` and `ingest_host`). Adds **one migration** and **no** dependency.

## Context

Sites run planned maintenance: a chiller is serviced, a panel is isolated, a
cold room is defrosted. During that work the readings go out of range and the
devices often go offline, so the alarm engine raises alarms that everyone
expects. Since ADR 0130 every one of them opens a popup, blinks and sounds on
every page. Operators learn to ignore the bar, and a real alarm on another
asset is missed.

Today the only tool is `PATCH /api/v1/rules/:id/enabled`, one rule at a time,
by hand. It has three faults:

- nothing turns the rule back on, so a forgotten rule stays off for good;
- an asset has many rules, and device alarms (`rtu_comms`) have no rule at
  all, so they cannot be switched off;
- a disabled rule records nothing, so the history has a gap exactly where the
  maintenance was.

The owner asked for a way to stop the alarms of selected assets for a set
period, with automatic return at the end (2026-11-13).

## Decision

### The window

1. **A maintenance window** is a record with an organization, a reason
   (required, free text), a start time, an end time, its targets (decision 4),
   the user who created it, and an optional link to a work order or a
   maintenance schedule *(recommended)*. The start can be now or in the future.
2. **Length.** At creation, `ends_at − starts_at` is at most **7 days**. An
   admin can **extend** an active window; each extension sets a new end at most
   7 days after the moment of the extension *(recommended)*. An admin can
   **end early** an active window and **cancel** a future one. Each action is
   in the audit log.
3. **No repeating windows** in this ADR *(recommended)*. Each window has one
   start and one end.

### Scope — what a window covers

4. **A window targets any mix of** *(owner, 2026-11-13)*:
   - **assets** — every alarm of the asset;
   - **locations** — every asset at that location **and every location under
     it** in the ADR 0098 tree, and every RTU at those locations;
   - **single rules** — only the alarms of that rule (for example, only the
     high-temperature rule of a chiller).

   A target must be inside the creator's read scope (ADR 0043) and inside the
   window's organization.
5. **Device alarms** *(owner, 2026-11-13: offline and no-data alarms are
   suppressed too)*:
   - a **`rule` alarm** (including a no-data or stale rule) is covered when
     its asset or its rule is a target, or its asset is under a target
     location;
   - an **`rtu_comms` alarm** is covered when its RTU's location
     (`bms.rtus.location_id`, the same rule as ADR 0130 decision 15) is under
     a target location, or when **every** asset bound to that RTU is a target
     *(recommended: an RTU that also feeds an asset outside the window keeps
     its alarm)*;
   - an **`ingest_host` alarm is never covered** *(recommended)*. It belongs to
     the organization, not to a site (ADR 0130 decision 15), and it reports a
     platform fault, not a site condition.

### Suppression

6. **A new alarm during a window is raised as suppressed** *(owner,
   2026-11-13)*. The engine writes the alarm row as usual, with
   `suppressed_at` and `suppressed_by_window_id` set. The lifecycle (raise,
   clear, the dedupe indexes) does not change. A suppressed alarm:
   - does **not** count in the alarm bar's severity pills, and does **not**
     open the popup, blink or sound (ADR 0130 decisions 2, 6–11);
   - sends **no notification** and starts **no escalation** (ADR 0057
     decisions 6 and 7);
   - **stays** in the alarm history, the alarm list (with a "Suppressed" badge
     and a `state=suppressed` filter) and the reports.
7. **An alarm already active when a window starts is suppressed too**
   *(owner, 2026-11-13)*. It stays active; its `suppressed_at` is set. Its tone
   stops and it leaves the bar.
8. **At the end of a window** (the end time, an early end or a cancel), every
   alarm the window suppressed and that is **still active** loses
   `suppressed_at` and becomes a normal alarm *(owner, 2026-11-13: "if the
   condition is still true at the end, it comes back as a normal alarm")*. The
   bar treats it as new: it opens the popup and, if critical, blinks and
   sounds. Its notification is sent then, and the escalation clock starts from
   that moment *(recommended)*. An alarm that cleared during the window stays
   cleared and sends nothing.
9. **Overlapping windows.** An alarm stays suppressed while **any** active
   window covers it; it returns only when the last one ends *(recommended)*.
   `suppressed_by_window_id` names the first window that suppressed it.
10. **Timing.** The engine reads the active windows with the enabled rules
    (the same cache, `CACHE_TTL_MS` 60 s today). A create, extend, end or
    cancel invalidates that cache, so the engine sees the change on its next
    evaluation; without that, a window would start or end up to 60 s late. The
    lifecycle sweep applies decisions 7 and 8; a window takes effect within one
    sweep interval of its stated time *(recommended)*. The raise path decides
    suppression **before** it notifies or dispatches anything, so no
    notification leaks between the raise and the stamp; the plan tests that
    gap.
11. **Acknowledgement** of a suppressed alarm is permitted and changes
    nothing else *(recommended)*.
12. **Telemetry is not affected.** Readings are still ingested, stored and
    calculated during a window. Only alarms are suppressed.

### Who

13. **Organization and site admins** in the window's scope create, extend, end
    early and cancel windows *(owner, 2026-11-13)*. The check is the one the
    rule toggle uses today (`assertOperationsWriteRole(user,
    "configuration")` plus the read scope); the plan confirms that it refuses
    an operator. Every user who can read a target can see its windows.

### Display

14. **A "Maintenance" badge** on the asset page, on the asset's dashboard tiles
    and on each suppressed alarm row, while a window covers the asset
    *(owner, 2026-11-13)*.
15. **A "Maintenance N" pill in the alarm bar**, beside the severity pills,
    while at least one active window touches the page scope (ADR 0130
    decision 5). N is the count of active suppressed alarms in that scope; a
    click opens the list of active windows *(owner, 2026-11-13)*. The pill does
    not blink and plays no tone.
16. **An admin page "Maintenance windows"** lists active, future and past
    windows, and holds the create form (reason, start, end, targets, optional
    link) and the extend, end-early and cancel actions *(recommended)*.

### Schema, API and contract

17. **Migration** (one, forward-only):
    - `bms.maintenance_windows` — `id`, `organization_id`, `reason`,
      `starts_at`, `ends_at`, `ended_at` (early end or cancel), `ended_by`,
      `work_order_id` (nullable), `maintenance_schedule_id` (nullable),
      `created_by`, `created_at`, `updated_at`; CHECK `ends_at > starts_at`;
    - `bms.maintenance_window_targets` — `window_id`, `organization_id`, and
      exactly one of `asset_id`, `location_id`, `rule_id` (a CHECK); composite
      foreign keys keep each target in the window's organization;
    - `bms.alarms` gains `suppressed_at` and `suppressed_by_window_id`, both
      nullable;
    - both new tables get `tenant_isolation` and `FORCE ROW LEVEL SECURITY`
      (ADR 0043).
18. **Routes** under `/api/v1/maintenance-windows`: list (filters `state` =
    active | future | past, `assetId`, `locationId`), create, extend, end,
    cancel. Zod contracts in `packages/shared/src/contracts` (ADR 0030).
19. **Alarm contract.** `alarmListItemSchema` gains `suppressed` (boolean) and
    `maintenanceWindowId` (nullable). The schema is also the socket payload,
    so every consumer (bar, popup, list, wall, the `useAlarmsSocket` callers)
    is updated with it. `alarmListQuerySchema`'s `state` enum
    (`all | active | unacknowledged`) gains `suppressed`; the default list
    keeps suppressed alarms, badged. In `/alarms/summary` **both** per-severity
    numbers, active and `unacknowledged` (ADR 0130 Amendment 1), **exclude**
    suppressed alarms, and the summary gains one `suppressed` count. The raise,
    clear and acknowledge events carry `suppressed`; the bar ignores a
    suppressed alarm and treats the end of suppression (decision 8) as a new
    one.

## Non-goals

- No repeating or calendar windows (decision 3).
- No per-alarm shelve from the alarm row.
- No suppression of `ingest_host` alarms (decision 5).
- No change to telemetry, calculations, KPIs or health scores (decision 12).
- No change to the rule `enabled` switch; it stays for permanent changes.
- No automatic window from a work order or a maintenance schedule; the link is
  for reference only.

## Dependencies

None.

## Consequences

- Planned work stops flooding the bar, the popup and the tone, and the
  history still shows what happened during the work.
- Nothing has to be remembered at the end: alarms return by themselves, and a
  condition that is still bad is announced at once.
- The alarm engine, the lifecycle sweep, the notification dispatch and the
  ADR 0130 bar each gain a "suppressed" check. Each one that misses it either
  leaks an alarm during maintenance or hides one after it, so the plan tests
  each path.
- A long window can hide a real fault on the targeted assets; the 7-day limit,
  the required reason, the badge and the bar pill keep it visible.
- One migration: the `migration-reviewer` and the `security-reviewer` (RLS,
  scope) review the build.
- Follow-ups: the AGENTS.md catch-up for this ADR (a `chore(agents):` PR).

## Open questions

None for the owner's six rulings (decisions 4, 6, 7, 8's return, 13, 14
and 15). Every other decision is the agent's: 1–3, 5's `rtu_comms` and
`ingest_host` lines, 8's notification at the end, 9–12, 13's exact role
check (the plan confirms it), and 16–19. They stand unless the owner changes
them at acceptance. The owner accepted them as written (2026-11-13).

## Build notes (2026-11-13, `F4.359`)

Built in seven PRs (plan `docs/plans/f4.359-maintenance-windows.md` §11 has
the record): #1300 migration `0152`, #1301 the routes, #1302 the contract and
the reads, #1303 the raise path and the sweep, #1304 the badge and the bar
pill, #1305 the Copilot entries (ADR 0099 Amendment 19), #1306 the admin page
and the asset badges.

- **The plan's rulings Q1–Q7** (owner, 2026-11-13) refine this ADR's
  mechanism without changing its promises: the raise path decides
  suppression inside the raise transaction, not through a rule-engine cache
  (decision 10's two promises kept: no 60 s lag, decided before any
  notification); `state=active` keeps suppressed alarms and
  `state=unacknowledged` excludes them; the notification ledger decides what
  is owed at the return; `asset_group_admin` passes the route's role check.
- **A third alarm column**, `unsuppressed_at` (Q2): the moment an alarm
  returns. The escalation clock counts from it, and the alarm list item
  carries it as `unsuppressedAt`, so the bar treats a returned alarm as new
  (its "seen" key is `id@unsuppressedAt`).
- **A fourth socket event**, `{ type: "suppression", alarm }`, for a stamp or
  a lift by the lifecycle sweep.
- **Location targets** (decision 4, "inside the creator's read scope"): only a
  caller whose location- or organization-sourced grant holds the node may name
  it, so the whole subtree is readable. An asset-group admin names member
  assets and their rules only. A location target also reaches an inactive
  leaf subtree under the granted node (accepted).
- **Decision 14's "dashboard tiles"** are one badge in the header of an
  asset-scoped dashboard (Q7), not one per tile.
- **Decision 6's "Suppressed" badge** reads "Maintenance" (decision 14's word)
  on the alarm rows; the list filter is "Suppressed only".
- **Accepted behaviours recorded at review:** after a lift, a rule channel
  with no ledger row under the raise key is owed the raise for the rest of the
  alarm's life (Q3 as written), so a channel joined later receives it; a
  failing window read in the raise path rolls the raise back (one
  transaction), while the sweep leaves stamps unchanged for that tick;
  `rtu_comms` "every bound asset" counts inactive assets that still carry the
  RTU id; the KPI ribbons, map, mimic colours, site-widget summary and health
  scores still count a suppressed alarm (non-goal); the group-tab status was
  later excluded (owner, 2026-11-14; the `F4.360` defect 7 build notes below).

## Build notes (2026-11-14, `F4.360` defects 3–6)

Four page defects from the owner's AWS check of 2026-11-14.

- **A cancelled window reads "Cancelled".** Only a future window can be
  cancelled, so a cancelled window's `ended_at` is before its `starts_at`;
  the page uses that rule and shows "Cancelled" and "Cancelled by …" in the
  End column, with no end time. A window ended early keeps its end time and
  "Ended by …".
- **The Review steps say local times and names.** `WizardShell` takes
  `review.shown`, a readable heading and value for a body field's row (a time
  in the browser's zone with its offset label, the targets' and links'
  names); the body sent is unchanged. `CatalogSummaryInput` gains an optional
  `timeZone`: the page passes the browser's zone, so its Review sentence says
  "2026-11-13 13:30 (UTC+05:30)"; the server passes none, so a Copilot card
  says "2026-11-13 08:00 (UTC)" (`instantText`; never the raw ISO string). The
  page still calls the entry's own `summary`, so ADR 0099's rule that a
  wizard's Review text is its entry's summary holds.
- **Names for assistive technology.** The Start radios and the target
  checkboxes carry their own `value` (they had the default "on") and a name
  ("Start now", "Asset Pump 1 (P-001)"); each row action names its window
  (`End window "<reason>"`).
- **The End and Cancel Review say the reason** in its own line, or "No
  reason given.". The omission seen on AWS did not reproduce in jsdom (the
  reason was in the summary sentence and the Field table); the line makes it
  explicit.

## Build notes (2026-11-14, `F4.360` defect 7)

- **The group-tab status leaves out a suppressed alarm** *(owner,
  2026-11-14, in chat: "Exclude them")*. The AWS check of 2026-11-14 saw a
  site dashboard tab read "Deep freezers & cold rooms, Critical, 2 alarms"
  while both alarms were suppressed. `tabStatuses` in
  `apps/api/src/dashboard-builder/site-widgets.service.ts` now counts, and
  takes the worst severity from, active alarms with `suppressed_at IS NULL`,
  as the alarm bar does (decision 6). The same `tabs[].status` feeds the tab
  marker, the tab's accessible name, the Module summary card and the
  Critical systems list, so all four follow. The tab's rail still
  lists a suppressed alarm, badged "Maintenance" (decision 6: it stays in
  the lists), so a tab's count can be lower than its rail's rows during a
  window. The other surfaces of the 2026-11-13 accepted-behaviours note (the KPI ribbons, the
  map, the mimic colours, the site-widget severity summary and the health
  scores) are unchanged and remain non-goals.
