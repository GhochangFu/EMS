# ADR 0130 — A persistent alarm bar on every page, with a popup and a tone (`F4.357`)

## Status

**Accepted — 2026-11-12** (owner, in chat: "Accept ADR 0130"; proposed the
same day). Drafted by an agent for backlog row `F4.357` from a design
conversation with the owner on 2026-11-12. The owner ruled each behaviour in
chat, one question at a time; those rulings are marked
*(owner, 2026-11-12)* below. Lines marked *(recommended)* were the agent's
calls; the owner accepted the ADR with them as written, so **every
*(recommended)* line is now a ruling**. The step-3 plan comes next, and the
build waits for the owner's "yes" to it.
The owner's mockup choice was layout **B, the bottom alarm bar**, over a right
side dock and a floating button.

**Amendment 1 — accepted 2026-11-13** (owner, in chat, choosing "Show both
numbers" after asking whether Acknowledge all lowers the bar's counts).
Amends decision 2; see *Amendment 1* at the end.

Clarifies [ADR 0118](./0118-selectable-design-systems.md) decision 7 (no
animation on an alarm state) for one uniform blink (decision 7 here), and
answers decision 6's "the alarm bell appears in every shell" (decision 12).
Builds on [ADR 0032](./0032-alarm-severity-vocabulary.md) (the severity
vocabulary and its ranks), [ADR 0057](./0057-alarm-lifecycle-auto-clear-and-escalation.md)
(the lifecycle), [ADR 0043](./0043-multi-tenant-architecture.md) (scope) and
[ADR 0098](./0098-location-tree-of-any-depth.md) (the location tree). Adds
**no** dependency, **no** migration and **no** new location type.

## Context

The owner's concern, in their words: "if any critical alarm comes, the user
needs to scroll down and go to the alarm page or view the alarms. On some of
the pages, the alarm section … is not visible at first to the operator." An
operator on a dashboard has no sign that a critical alarm started.

Read from `main` at `5ba7c156`:

- **No global alarm indicator exists.** Every authenticated page wraps itself
  in `AppShell` (`apps/web/src/layouts/app-shell.tsx`), which renders
  `SidebarShell` or `RailShell` (ADR 0118). Neither has a bell, a count, a
  banner, a toast or a ticker. ADR 0118 decision 6 says the alarm bell appears
  in every shell; it was never built. `F3.29` (bell with a live count) is ⬜.
- **The alarms rail is on two pages only:** the control room organization page
  (`pages/control-room/organization-page.tsx`) and the SMOC overview tab. A
  configurable dashboard shows the `active_alarms_rail` widget only if its
  layout includes it. Every other page shows a count or nothing.
- **Live events exist.** `apps/api/src/alarms/alarms.gateway.ts`, namespace
  `/ws/alarms`, emits one event `alarm` with `{type, alarm}` and `type` in
  `created | acknowledged | cleared` (`alarmSocketEventSchema`,
  `packages/shared/src/contracts/operations.ts`). Each socket gets only the
  alarms its user can read (`alarmVisibleInMemory`, `alarm-scope.ts`). There are
  no rooms.
- **The web app opens one socket per caller** (`hooks/use-alarms-socket.ts`
  through `lib/live-socket.ts`): the Alarm Centre, the alarms rail, the site
  widgets, the asset role summary and the map each open their own.
- **The list item carries no organization or location id** — only `siteName`
  and `assetLocationName` (`alarmListItemSchema`). The list and summary queries
  filter by `assetIds` and `organizationId` only
  (`apps/api/src/alarms/alarm-list.schema.ts`), not by location.
- **No toast, sound or browser notification exists** in `apps/web`.
- **The Copilot button** is `fixed bottom-10 right-6 z-50`
  (`components/copilot/copilot-dock.tsx`), where a bottom bar would sit.
- **The control room wall** (`components/control-room/wall-frame.tsx`) renders
  without `AppShell`.

## Decision

### The bar

1. **One alarm bar, fixed to the bottom edge of the window, on every
   authenticated page** *(owner, 2026-11-12: layout B)*. `AppShell` mounts it,
   so both shells and every design system get it. It does not scroll with the
   page; the page body gets bottom padding equal to the bar's height, so the
   last widget is never covered. Pages without a session (login, the auth
   callback) have no bar.
2. **The bar shows**, left to right: one count per severity in the page scope
   (active, uncleared alarms), the newest unacknowledged alarm of the highest
   rank with its location and time, an **Acknowledge** button for that alarm, a
   **mute** button, and **All alarms**, which opens the scoped list upward over
   the page. With no active alarm the bar shows a neutral "No active alarms".
3. **The bar cannot be hidden** *(recommended)*. Only the list above it closes.
4. **A click on an alarm row** in the list or the popup opens the existing
   `AlarmDetailsPanel`; the operator stays on the page *(recommended)*.

### Scope — what the bar counts

5. **The bar follows the page** *(owner, 2026-11-12)*:
   - `/control-room/org/:organizationId` — the alarms of that organization;
   - `/control-room/site/:locationId/*` — the alarms of that location **and
     every location under it** in the ADR 0098 tree;
   - `/control-room` — the **Estate** level, shown on screen as
     "Control Room · Estate": every organization in the user's scope, so
     every alarm the user can read;
   - every other page, `/` included — every alarm the user can read.

   The server's read scope (ADR 0043) always applies on top: the bar never
   shows an alarm the user cannot read. The three control room levels are the
   owner's "Estate → organization → location" *(owner, 2026-11-12: a user with
   several organizations sees the Estate page first)*. **Estate is the existing
   control room page, not a new location type** *(owner, 2026-11-12: "Do not
   require the Estate thing")*; a parent location is already a location page.

### The popup

6. **A new alarm whose severity rank is at or above `warning` opens the popup;
   a lower rank (`info`) goes into the list only** *(owner, 2026-11-12)*. The
   threshold is by **rank**, not by name, because the severity vocabulary is
   open (ADR 0032): rank ≥ 20 pops up, rank ≥ 30 is "critical" for decisions 7
   and 8 *(recommended)*.
7. **One popup, never several** *(owner, 2026-11-12)*. It lists every new
   popup-rank alarm in scope that the operator has not yet seen: critical first,
   then warning, newest first in each group. An alarm that arrives while the
   popup is open joins the list. The popup sits fixed above the bar, at the
   bottom centre, at whatever scroll position the page has. More than 50 rows
   show the first 50 and "and N more", linked to the Alarm Centre
   *(recommended)*.
8. **The popup closes two ways** *(owner, 2026-11-12)*:
   - **Acknowledge** on a row, or **Acknowledge all**, asks for one reason and
     calls the existing `POST /api/v1/alarms/:id/ack` once per alarm with that
     reason *(recommended: no bulk endpoint)*; a row whose call fails stays in
     the list with its error;
   - **Close** hides the popup; the alarms stay unacknowledged in the bar.

   A user without the `operational` write class (the `viewer` role) sees
   **Close** only. "Seen" is per browser tab and is not stored on the server
   *(recommended)*.

### Blink — clarifies ADR 0118 decision 7

9. **The critical count on the bar and the popup's header blink while an
   unacknowledged critical alarm is unseen** *(owner, 2026-11-12: "accept the
   blink rule")*. The blink stops once the operator has seen the alarm (the
   popup was closed) or acknowledged it. Warning alarms get a solid colour, no
   blink. The blink is part of the alarm bar, **identical in every design
   system**, so ADR 0118 decision 7 — no design system *adds* a glow, blur or
   animation to an alarm state — still holds: no design system may change,
   remove or add to this blink. The blink is a 1 Hz opacity step, under the
   WCAG 2.3.1 limit of three flashes a second; under
   `prefers-reduced-motion: reduce` it becomes a static double outline
   *(recommended)*. Alarm colours stay the fixed ADR 0110 roles.

### Tone

10. **A new critical alarm plays a tone; warning and info alarms do not**
    *(owner, 2026-11-12)*. The tone repeats **every 30 seconds** while one or
    more critical alarms in scope stay unacknowledged and unmuted
    *(owner, 2026-11-12: "repeat until acknowledged or muted … does not repeat
    too often"; 30 s recommended)*. More critical alarms in the same 30 seconds
    do not add tones. **Close** does not stop the tone. The tone is generated
    with the Web Audio API — no audio file, no dependency *(recommended)*.
11. **Mute silences the alarms that exist now, never the next one**
    *(owner, 2026-11-12)*. A critical alarm raised after the mute plays the
    tone again. The mute lives in the browser tab only. When the browser
    blocks audio (no click on the page yet — a wall nobody touches), the bar
    shows "Sound blocked — click to enable" instead of failing silently.

### Wall, bell and the shared connection

12. **The control room wall shows the same bar, popup and tone**
    *(owner, 2026-11-12)*. `WallFrame` mounts the bar with the scope of the
    location it shows. The bar is the "alarm bell in every shell" of ADR 0118
    decision 6 and delivers the alarm-count part of `F3.29`; `F3.29` keeps its
    site selector and role subtitle *(recommended)*.
13. **One shared alarm connection for the bar** *(recommended)*. The bar opens
    one `/ws/alarms` socket per tab, held by a store at the app root, instead
    of a socket per component. Moving the existing callers (decision list in
    *Context*) onto it is allowed in this row but not required.
14. **The Copilot button moves up** by the bar's height, so the bar never
    covers it *(recommended)*.

### API and contract

15. **`locationId` joins the list and summary queries** of
    `GET /api/v1/alarms` and `GET /api/v1/alarms/summary`: the alarms of that
    location and its descendants, inside the caller's read scope. A rule alarm
    belongs to its asset's location, an `rtu_comms` alarm to
    `bms.rtus.location_id`, and an `ingest_host` alarm to no location — it has
    an organization (the gateway already reads it), so it shows on its
    organization's page and on the all-scope pages, never on a site page
    *(recommended)*.
16. **The server decides scope; the browser never filters events by scope**
    *(recommended)*. The bar's store holds the scoped active list
    (`state=active` plus the page's `organizationId` or `locationId`, ≤ 50
    rows) and the scoped summary. Every socket event, and every socket
    reconnect, refetches both (debounced to 1 s). An alarm id in the new list
    and not in the previous one is "new". So descendant locations need no
    client lookup, and a missed event during a disconnect is caught by the
    reconnect refetch.
17. **`severityRank` joins `alarmListItemSchema`** (the `bms.alarm_severities`
    rank, additive, ADR 0030), so decisions 6, 9 and 10 read the rank from the
    row, not from a name *(recommended)*. A device alarm's location label comes
    from its RTU's location, not from the null `assetLocationName`.
18. **Rows leave the popup and the bar** when another operator acknowledges
    them or the alarm clears (the refetch drops them). The reason for
    Acknowledge follows `alarmAckBodySchema`: 3 to 2,000 characters.
    Acknowledge all reports "N of M acknowledged" and keeps the failed rows.
19. **The bar's height is one CSS variable, `--alarm-bar-h`**, read by the page
    padding, by the Copilot button's offset (decision 14) and by any page that
    sizes to the viewport *(recommended)*.
20. **On the wall, the scope comes from the wall's route**: the location of the
    site wall. Every other route not named in decision 5 takes the all-scope
    rule.
21. **A login or a reload treats every existing unacknowledged alarm of
    popup rank as unseen** *(owner, 2026-11-12: "Popup + tone")*. The popup
    opens with them, and the tone plays for the critical ones until they are
    acknowledged or muted. A reload never hides a critical alarm. Moving
    between pages inside the app does **not** re-open the popup for alarms the
    tab has already seen: "seen" and "muted" live in the root store, per tab
    *(recommended)*.

## Non-goals

- No new location type, level or hierarchy; Estate is the existing
  `/control-room` page (decision 5).
- No shelving (ADR 0057 leaves it open).
- No browser `Notification` API, OS notification, SMS or push (`F3.9`).
- No server-side mute or per-user sound setting.
- No change to alarm rules, severities, the lifecycle or acknowledgement.
- No app-wide site selector (`F3.29` keeps it).

## Dependencies

None. The Web Audio API and CSS animation are browser built-ins.

## Consequences

- An operator on any page, the wall included, sees and hears a new critical
  alarm without scrolling or navigating.
- `AppShell` and `WallFrame` gain a fixed bottom element; every page loses the
  bar's height of vertical space. Pages that size to `100vh` must use the
  space above the bar.
- The alarm contract (`severityRank`) and the two queries (`locationId`) gain
  fields; old clients ignore them.
- Each socket event costs one scoped list read and one summary read per open
  tab, debounced to 1 s.
- One more socket per tab until the existing callers move to the shared one.
- A tab that stays open for a full shift keeps "seen" and "muted" state only
  in memory; a reload re-opens the popup for unacknowledged alarms
  (decision 21). That is deliberate: a reload must not hide a critical alarm.
  On a fleet with many old unacknowledged critical alarms (16 on the demo on
  2026-11-12), the first login shows a long popup and the tone until the
  operator acknowledges or mutes.
- Follow-ups: the AGENTS.md catch-up for this ADR (a `chore(agents):` PR), and
  `F3.29` narrowed to the selector and the subtitle.

## Open questions

None. The four the draft flagged were accepted as recommended on
2026-11-12: decision 6 (rank 20 pops up, 30 blinks and sounds), decision 10
(the 30-second repeat), decision 12 (the bar is ADR 0118 decision 6's bell)
and decision 15 (an `rtu_comms` alarm belongs to its RTU's location; an
`ingest_host` alarm to its organization only).

## Amendment 1 — the bar shows active and unacknowledged counts (2026-11-13)

**Status: Accepted — 2026-11-13** (owner, in chat: "Show both numbers").

**Context.** After the AWS check of `F4.357`, the owner asked whether
**Acknowledge all** lowers the bar's counts. It does not: decision 2 counts
active (uncleared) alarms, and acknowledgement never closes an alarm
(ADR 0057). An operator who has acknowledged everything still sees, for
example, "Critical 20", with no sign that nothing waits for them. The summary
already carries a per-severity `unacknowledged` count (`F4.357` plan Q1, PR 1).

**Decision.** Decision 2's "one count per severity" becomes **two numbers per
severity**: the active count, as before, then the unacknowledged count, shown
as `Critical 20 · 0 unacked`. The pill's accessible name reads
"Critical: 20 active, 0 unacknowledged". Both numbers come from the same scoped
summary read (decision 16), so they agree with each other and with the page
scope. Acknowledging lowers only the second number; clearing lowers both. The
blink (decision 9) and the colours (ADR 0110) do not change.

**Not changed.** What the popup, the tone and the "and N more" line count; the
API and the contract (no new field); "No active alarms" still means a zero
active total.
