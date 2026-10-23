# ADR 0106 — The copilot proposes alarm and work-order writes (`F4.284`)

## Status

**Proposed — 2026-10-23** (owner, in chat). Six gate questions were put to the
owner one at a time, each with options and a recommendation: four were ruled
as recommended, Q4 otherwise, and Q2 was not reached because Q1 keeps
operators out (see *Gate questions*). A line marked *(Qn)* states that
ruling; *drafter choice* lines were not asked. Drafted before any
implementation code; the merge of the record approves it. Code citations are to
`main` at `5d8249e9`.

This record **reverses part of ADR 0099 decision 1** — *"It cannot: acknowledge,
clear or edit alarms or work orders"* — and decides whether the *Not in this
ADR* item *"Operator and viewer use of the copilot; operator writes"* moves.
It also settles `POST /maintenance/schedules/:id/convert`, which ADR 0099
Amendment 8 excluded for this record to decide.

## Context

ADR 0099 gave the copilot to the four administrator roles for admin writes and
read-only answers. Since `F4.274`–`F4.277` (#930, #931) it reads telemetry,
alarm details and the alarm knowledge base, so it can explain an alarm, but it
cannot act on one: an administrator who reads *"Main breaker reported OPEN —
check the breaker"* must leave the dock to acknowledge the alarm or to raise a
work order.

The routes, as the code enforces them today (research pass of 2026-10-23):

- `POST /api/v1/alarms/:id/ack` — the `operational` write class
  (`apps/api/src/auth/operations-write.ts`), which admits `operator` and the four
  administrator roles; it stops the alarm's escalation
  (`alarm-lifecycle-phases.ts:382`, `:804`) and cannot be undone.
- `PUT /api/v1/alarms/:id/enrichment` — the alarm's notes (cause, impact,
  corrective actions); operational class.
- `POST /api/v1/work-orders`, `PATCH /work-orders/:id/status`, `POST
  /work-orders/:id/close`, `PATCH /work-orders/reorder` — operational class. The
  status route accepts `closed` with no reason (`work-order.schema.ts:30-37`),
  and the service does not check that `assignedTo` belongs to the work order's
  organization (`work-orders.service.ts:296-340`). Reorder writes up to 100 rows
  in one call.
- The six body schemas live in `apps/api` (`ack.schema.ts`,
  `enrichment.schema.ts`, `work-order.schema.ts`), not in `packages/shared`.

Two facts shape the choice of who gets this. Operators have no dock today:
`COPILOT_ROLES`, the access guard, the Confirm interceptor's role re-check
(decision 4.5), the availability chain (decision 5, Amendment 1 A3) and the
web dock gate all name the four administrator roles, and a DB `CHECK` (`0104`)
bounds the switchable roles. And ADR 0017 already lets administrators make
operational writes, so giving these jobs to administrators first reverses only
decision 1's *cannot* list.

## Decision

1. **Administrators first; operators later in their own record.** The four
   copilot roles may propose the writes in decision 2. Operators still get no
   dock; ADR 0099 decision 5 and Amendment 1 A3 stand. Operator use of the
   copilot needs its own ADR once these entries and the operator read scope are
   proven. *(Q1)* That later record also decides the operator turn's key and
   usage limit (ADR 0099 decisions 10 and 11); Q2 was not reached.
2. **The entries — all six routes.** `alarm.acknowledge` (`POST
   /alarms/:id/ack`), `alarm.enrichment.set` (`PUT /alarms/:id/enrichment`),
   `workOrder.create`, `workOrder.setStatus` (`PATCH /work-orders/:id/status`,
   whose model body leaves out `closed`, so a close always goes through the
   close route and carries a reason), `workOrder.close` and
   `workOrder.reorder` (`PATCH /work-orders/reorder`). Clearing an alarm and
   device commands stay out. *(Q4)* Reorder is one API write of up to 100
   rows, so it stays *one API write = one Confirm*; its card lists every work
   order whose position changes, with its old and new position, and the
   resolver refuses a list that names a work order outside the conversation's
   organization or the user's scope (drafter choices).
3. **Own message only, and the reason in the hash.** An acknowledge and a close
   are proposed only in a user turn whose own message asked for them — never in
   an automatic follow-up turn, never from a tool result (ruling 20's rule for
   access changes, extended). The model proposes the reason; the card shows it
   in full and the body hash binds it, so decision 4.5's *what you saw is what
   is written* holds; to change it the user rejects and asks again. The card
   names the alarm text, severity, asset and raised time. *(Q3)*
4. **A fifth risk class, `operational`.** Acknowledge and close get risk
   `operational`: a red card that says *"cannot be undone"*; a migration widens
   `copilot_pending_changes_risk_check`. Create and enrichment keep `create` and
   `edit`. *(Q5)*
5. **Maintenance convert returns.** `POST /maintenance/schedules/:id/convert`
   makes a work order from a schedule; with decision 2 it leaves Amendment 8's
   exclusion list as `maintenanceSchedule.convert` (risk `create`). *(Q6)*
6. **New target kinds** `alarm` (by path id: organization from
   `alarms.organization_id`, the card names the alarm text and asset) and
   `workOrder` (by path id), each mirroring the route's own gate (operational
   class plus read scope), as ADR 0099 Amendment 8 D2 rules. A new ref kind
   `user` resolves `assignedTo`; the copilot refuses an assignee outside the
   work order's organization. The missing server-side check on `assignedTo` is
   raised as its own backlog row, not fixed here (drafter choice).
7. **Common work (drafter choices).** The six body schemas move to
   `packages/shared/src/contracts/` (ADR 0030); the alarm, enrichment and
   work-order write services audit through `MasterDataAuditService` and join
   `CATALOG_WRITERS` in `tests/f3.85-audit-via-mark.test.ts`.

## Not in this record

Operator or viewer use of the copilot, and an operator turn's key and limit
(a later ADR); clearing an alarm; device commands; a server fix of the
`assignedTo` organization check.

## Consequences

- An administrator can act on what the copilot explains in the same dock; each
  write is one Confirm, and the irreversible ones are red and own-message only.
- `copilot_pending_changes_risk_check` gains a fifth value (a forward-only
  migration), and the web card styles key on it.
- Operator use stays a separate, later decision with its own key and limit
  rulings (ADR 0099 decisions 10 and 11).
- The `AGENTS.md` edit (decision 1's *cannot* list and rule 15) lands in a
  separate `chore(agents):` PR after the build (§9.10, §10.1).

## Verification owed

Per entry: the resolver refuses a role and a scope the route refuses; an
acknowledge or close proposed in a follow-up turn, or from alarm text, is
refused; the reason is in the hash (a changed reason at Confirm is 409); the
red `operational` card renders *cannot be undone*; a reorder card lists each
moved work order and its resolver refuses an out-of-scope one; the audit row
carries `via: "copilot"`. Live: one acknowledge and one
work-order create and close against the Docker stack.

## Gate questions

| # | Question | Recommended | Ruled |
| --- | --- | --- | --- |
| Q1 | Who may use these jobs | administrators now; operators in a later ADR | as recommended |
| Q2 | Operator key and usage limits (only if Q1 admits operators) | home organization's rule; a lower per-operator default | not reached (Q1) |
| Q3 | The reason and the own-message rule | model proposes the reason, hash binds it; own message only | as recommended |
| Q4 | Which routes enter the catalog | ack, enrichment, create, status (no `closed`), close; reorder excluded | **all six, reorder included** (the other option) |
| Q5 | The risk class of ack and close | a fifth class `operational`, red | as recommended |
| Q6 | Maintenance convert | returns as `maintenanceSchedule.convert` | as recommended |
