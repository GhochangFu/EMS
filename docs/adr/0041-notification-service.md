# ADR 0041 — Notification service: transports, recipient model, delivery path and webhook egress

## Status

**Accepted** — 2026-08-23, by the repository owner, the same day it was
drafted. Nine decisions as drafted, **all three open questions ruled — two as
recommended, one against**. The one ruled against is the admin UI: it goes
*into* `F3.8` rather than into a later row, which moves the effort estimate
`4–6` → `7–9` (decision 10). `F3.8` is Wave 0 / P0 / ⭐ and its `Depends` cell is `—`, so nothing
blocks the build except this ADR.

## Context

`F3.8` is the notification service. It exists because the rule engine already
records an intent it cannot act on: `ruleActionSchema` is
`{ type: "notify" | "review" | "trace_only" }`, the value is persisted on
`bms.automation_rules.action`, copied by `duplicateRule`, echoed by
`previewRule` — and **read by nothing that sends anything**.
`RulesService.evaluateEnabledRules` branches on `shouldRaise(row, result)`, not
on `row.action`, so a rule marked `notify` and a rule marked `trace_only`
behave identically: both raise an alarm through `AlarmRaiser`, both write a
`bms.rule_executions` trace, and neither tells a human. `F3.7` ("execute rule
actions") is the row that closes that gap and it lists `F3.8` in `Depends`;
`F3.10` (escalation) and `F3.9` (SMS/push) sit behind it too.

Three things about this repository shape the decisions.

**§6 forbids the obvious architecture.** AGENTS.md §6 says *"Redis must not be
used for unrelated caching or job queues until a later promotion"* and lists
*"scheduler/job queues"* among what *"remain[s] out of scope until their
specific sprint is promoted."* `F4.24` (`apps/worker` + BullMQ, Wave 0, P2) is
the row that would promote it, and `F3.11` and `F3.12` already depend on
`F4.24` for exactly that reason. `F3.8` does **not**, and this ADR keeps it
that way rather than quietly acquiring a dependency its backlog row does not
carry.

**There is no mail infrastructure at all.** `docker-compose.yml` runs
`postgres`, `redis`, `keycloak`, `migrate`, `api`, `api-replica`, `web`, `sim`,
`ingest`, `prometheus`, `loki`, `promtail`, `grafana`. No SMTP service, no
`nodemailer` anywhere outside archived planning docs. The owner has stated they
hold no SMTP credentials today, which makes "what happens when no channel is
configured" a first-class decision rather than an edge case.

**The webhook half is an egress surface.** An operator-supplied URL, stored in
the database, POSTed to by the API process, which sits on a Compose network
with `postgres`, `keycloak`, `prometheus` and `grafana` reachable by service
name. That is server-side request forgery unless it is designed out here.

This ADR is **§9.4-gated**: it adds `nodemailer` to `apps/api` and a Mailpit
service to Compose. It is not a §10 promotion — `F3.8` is already Wave-0 scope
and §6 carries no line placing notifications out of scope. It does not amend
ADR 0033; it consumes the `AlarmRaiser` boundary that ADR 0033 established.

## Decision

1. **Notifications are sent inline from the API process. No queue, no worker,
   no Redis.** `NotificationService` is a NestJS provider in
   `apps/api/src/notifications/`. Dispatch is fire-and-forget from the raise
   path: the send promise is not awaited by `evaluateEnabledRules` or by the
   streaming alarm path, its rejection is caught and recorded, and it can never
   fail a rule evaluation or an HTTP response. This is what keeps `F3.8`'s
   `Depends` cell honest at `—`. **When `F4.24` lands, moving dispatch onto
   BullMQ is a follow-up that changes the caller, not the transports** — which
   is the point of decision 2.

2. **One `NotificationTransport` interface, three implementations, chosen by
   configuration.** `send(message: NotificationMessage): Promise<DeliveryResult>`.
   - `LogTransport` — the default when nothing is configured. Writes a
     structured pino line and returns `skipped_unconfigured`.
   - `EmailTransport` — `nodemailer`, SMTP settings from environment.
   - `WebhookTransport` — a `POST` through the global `fetch` already used in
     `jwt-auth.guard.ts`. **No new dependency for the webhook half.**

   Tests assert against a fake transport. **No test ever opens a socket, and no
   real inbox is required to build, review or merge `F3.8`.**

3. **Recipients live in two new tables, not in `automation_rules.action`.**
   Migration `0038_notification_channels.sql` adds:
   - `bms.notification_channels` — `id`, `code` (unique), `name`, `kind`
     (`'email' | 'webhook'`, FK to a `bms.notification_channel_kinds` lookup
     table per the dynamic-vocabulary pattern ADR 0031 Amendment 1 set),
     `config` `jsonb`, `enabled`, `created_at`, `updated_at`.
   - `bms.rule_notifications` — `(rule_id, channel_id)` join, `ON DELETE
     CASCADE` from `bms.automation_rules`.

   `automation_rules.action` keeps its current three-value shape and gains no
   columns. A rule with `action.type = 'notify'` and **no** joined channel is
   valid and sends nothing — that is the state every rule is in the moment this
   migration runs, so any other reading would make the migration a behaviour
   change. Per ADR 0015 this is one additive forward-only migration; no
   backfill, no rewrite of existing rows.

4. **Every attempt writes a `bms.notification_deliveries` row.** `id`,
   `rule_id`, `alarm_id`, `channel_id`, `status`, `attempted_at`, `error` and a
   `dedupe_key`. `status` is one of `sent`, `failed`, `skipped_unconfigured`,
   `skipped_deduped`, `skipped_rate_limited`. A notification that was never
   sent is a fact worth as much as one that was, and without this row "the
   alarm fired but nobody was told" is unanswerable. `GET
   /api/v1/notifications/deliveries` reads it, admin-scoped, with the same
   pagination shape `listExecutions` uses.

5. **An unconfigured channel is a recorded skip, never an exception and never
   silence.** If `SMTP_HOST` is unset, `EmailTransport` is not constructed;
   `LogTransport` stands in and the delivery row reads
   `skipped_unconfigured`. `GET /api/v1/notifications/readiness` reports, per
   kind, whether a transport is configured — the same *visible-when-absent*
   treatment `E8.4` specifies for an unconfigured
   `CREDENTIAL_ENCRYPTION_KEY`. **A rule marked `notify` with no working
   transport must be discoverable from the UI without reading a log file.**

6. **Webhook egress is restricted at the transport, not at input validation.**
   All of the following, in `WebhookTransport`:
   - **`https://` only.** `http://` is accepted only when
     `NOTIFY_WEBHOOK_ALLOW_INSECURE=true`, which is a local-development escape
     hatch and is asserted absent from `docker-compose.yml` by a repo
     invariant.
   - **DNS is resolved and the resolved address is checked before the
     request** — loopback, link-local (169.254/16, fe80::/10), and the RFC 1918
     / RFC 4193 private ranges are refused. Validating the *string* at write
     time is not sufficient: `grafana` resolves to a Compose-internal address
     and DNS can change between write and send.
   - **Redirects are not followed** (`redirect: "manual"`); a 3xx is a
     `failed` delivery. A redirect is the standard way around an allowlist.
   - **A 5-second `AbortSignal.timeout`**, and at most 2 KiB of the response
     body is read for the error field. Nothing from the response is
     interpreted.
   - **The body is signed.** An `X-Trinetra-Signature` header carries an
     HMAC-SHA256 of the raw body under a per-channel secret, so a receiver can
     tell a real alarm from anything that can reach its URL.

7. **Storm control belongs to `F3.8`, and it is two bounds, not one.**
   - **Dedupe:** a delivery fires on the *transition* of an alarm to open, not
     on every evaluation that matches. The signal already exists and was
     verified rather than assumed — `AlarmRaiseResult` is
     `{ raised: boolean; alarmId: string | null }`, and `raised` is `false`
     exactly when `alarms_open_per_rule_uidx` (migration 0032) caught a rule
     already open for that asset. The notifier keys on that flag plus
     `(rule_id, channel_id)`. Re-evaluating 337 enabled rules against an
     unchanged plant sends **zero** messages.
   - **Rate limit:** a per-channel ceiling, default 60 deliveries per hour, over
     the `bms.notification_deliveries` table (no Redis — see decision 1).
     Excess is recorded as `skipped_rate_limited`.

   AGENTS.md §4.6 requires proving both directions, and for this item the
   second direction — *it does not fire when it should not* — is the one that
   costs a client an inbox. It is `F3.8`'s to satisfy, not `F3.10`'s.

8. **Secrets: SMTP from environment, per-channel webhook secrets encrypted at
   rest.** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
   `SMTP_FROM`, `SMTP_SECURE` are read once at module init, in
   `apps/api/src/notifications/notifications.config.ts` — never from a service
   body. The webhook HMAC secret is per-channel operator-supplied data, so it
   goes through `CredentialCryptoService` (ADR 0012) like every other stored
   credential. **No secret, and no recipient address, is ever written to
   `bms.notification_deliveries.error` or to a log line** (§9.6) — and
   redacting the channel `config` blob is **new work this item must build**,
   not a control already in place. That was checked rather than assumed:
   `looksLikeCredential` exists, but every one of its callers is inside
   `apps/api/src/admin/onboarding/`, so it is onboarding-transcript scrubbing
   and not a pino redaction path anything else inherits. The notifications
   module either never logs `config` at all — the preferred shape, since it has
   no reason to — or reuses that predicate explicitly.

9. **Both raise paths dispatch, and dispatch sits in the caller, not inside
   `AlarmRaiser`.** There are two callers of `AlarmRaiser.raise`, and naming
   only one would ship a service that notifies nobody in production while every
   test passes:
   - `RulesService.evaluateEnabledRules` — the on-demand `POST
     /api/v1/rules/evaluate` path. It already holds the full `RuleRow`,
     including `action`, so it needs no new plumbing.
   - `AlarmEngineService` — the streaming path fed by `LISTEN bms_telemetry`,
     which is where **real** plant alarms come from. Its cache row is
     `CachedThresholdRule = AlarmRaiseRule & { assetId, operator,
     thresholdValue }`, and `AlarmRaiseRule` carries `{ id, code, name,
     pointKey, severity, alarmMessage, unit }` — **no `action`**. `F3.7` must
     therefore add `action` to that cached `SELECT`. It is a column added to an
     existing query, not a schema change.

   `AlarmRaiser` itself stays exactly what ADR 0033 made it: the one writer of
   `bms.alarms`. Widening `AlarmRaiseRule` to carry `action` so `raise()` could
   dispatch was considered and rejected — it would make the alarm writer also
   the notifier and give ADR 0033's boundary a second job.

10. **`F3.8` ships the admin UI, and the effort estimate moves `4–6` → `7–9`.**
    *Ruled against the draft's recommendation, deliberately.* The draft offered
    API-only to keep the enabler small and reach `F3.7` sooner; the owner ruled
    that an item closed with its browser layer marked N/A is not closed. Two
    surfaces, both under `apps/web/src/`:
    - a **channels admin screen** — list, create, edit, enable/disable, delete,
      and a "send test" action per channel, which is the cheapest way to make
      decision 6's egress rules visible to whoever configures a webhook;
    - a **deliveries view** reading `GET /api/v1/notifications/deliveries`,
      showing every attempt *including* the skips, because
      `skipped_unconfigured` and `skipped_rate_limited` are the two states an
      operator most needs to see and the two a "sent items" list would hide.

    `GET /api/v1/notifications/readiness` (decision 5) renders as a banner on
    the rules surface, not only inside the notifications screen — a rule marked
    `notify` with no working transport must be visible where rules are edited.
    Per ADR 0030 every response these read is `z.infer`red from a
    `packages/shared/src/contracts/` schema and reaches the client through
    `checkResponse`.

    The consequence is accepted openly: `F3.7` waits longer behind an enabler
    that already carries the SSRF controls and storm control. `F3.8` remains
    ⭐ — built serially and hands-on, never dispatched to a cold subagent.

11. **A rule notifies exactly the channels joined to it. There is no default
    recipient and no role-derived fallback.** *Ruled as recommended.* No
    channel attached means no send, recorded as a delivery row — which is the
    state every existing rule is in the moment migration `0038` runs, so any
    other answer would make that migration a behaviour change rather than an
    additive one. Deriving recipients from `bms.users` by role was considered
    and rejected: the first live alarm would mail the entire user table
    including the seeded demo accounts (`admin@bms.local`,
    `wc-admin@bms.local`, `wc-hvac-admin@bms.local`), and nobody on that list
    chose to be there. It also puts recipient addresses on a code path that has
    never carried them, against §9.6. **Reopening this needs a new ADR, not a
    flag.**

12. **Mailpit joins its own Compose profile, `mail`, not `core`.** *Ruled as
    recommended.* The default stack is unchanged; `docker compose --profile
    mail up -d` starts the catcher when someone wants to watch a message
    arrive, and `docs/local-setup.md` and `README.md` document it beside the
    existing `core` / `sim` / `pilot` / `observability` profiles. **`SMTP_HOST`
    gets no default value in `docker-compose.yml`** — that is the load-bearing
    half of this decision, and a repo invariant asserts it. A default pointing
    at Mailpit would mean a deployment that forgot to configure SMTP delivers
    every alarm into a test catcher, silently, with no error anywhere; an unset
    `SMTP_HOST` produces `skipped_unconfigured` and a readiness banner instead.

## Dependencies

New, and what §9.4 gates:

- **`nodemailer`** (`^6.9`) and **`@types/nodemailer`** — `apps/api`,
  `EmailTransport` only. Reached through one module; no other file imports it.
- **`axllent/mailpit`** — a `docker-compose.yml` service in the **`mail`**
  profile (decision 12), local and pilot only. A test mail catcher with a web
  inbox; it holds no production role and requires no account.

Deliberately **not** added: no HTTP client (global `fetch`), no queue library,
no template engine (the first message bodies are string composition off the
same fields `alarmMessageFieldsFromCondition` already produces).

## Consequences

- `F3.7` becomes buildable: it wires `action.type === 'notify'` to
  `NotificationService.dispatch`, and every hard question — recipients,
  storm control, failure recording — is answered here rather than in that row.
- `F3.9` (SMS/push) is a fourth `NotificationTransport` and needs no schema
  change. `F3.10` (escalation) gets its delivery history for free from
  `bms.notification_deliveries`.
- **Inline dispatch is a deliberate, revisitable compromise.** A slow or
  hanging SMTP server consumes an API request-handler slot for up to the
  transport timeout. The 5-second cap, the fire-and-forget call and the rate
  limit bound the damage; a genuinely high-volume deployment wants `F4.24`, and
  decision 2's interface is what makes that a caller change.
- One additive migration (`0038`) — `migration-reviewer` applies, and per the
  `F3.6` finding the seed must be a no-op-safe insert that survives running
  before `pnpm db:seed`.
- The repository still holds no SMTP credentials. Everything above is
  buildable, testable and reviewable without them; only a production send needs
  them, and that is a deployment step. Decision 12 is what keeps that true
  *safely* — an unset `SMTP_HOST` is a visible skip, not a silent delivery into
  a catcher.
- **`F3.8`'s effort is `7–9`, not `4–6`** (decision 10), and its `docs/BACKLOG.md`
  row is updated to say so. The board's Wave-0 line is unchanged: the item did
  not move wave, it got larger.
- **All four AGENTS.md §4.6 layers are in scope for this item's closure** —
  database (migration `0038` from scratch, then seeded), API (the transports
  against a fake, plus the egress refusals), and **browser** (decision 10's two
  screens, clicked). None may be recorded N/A. That is the direct consequence
  of ruling question 1 against the draft.

## Promotion follow-ups (AGENTS.md §10, owed in a separate `chore(agents):` PR)

- **`AGENTS.md` §6** — no line places notifications out of scope, so nothing
  needs softening there. But the §6 job-queue sentence is now *load-bearing for
  this ADR*: decision 1 cites it. If `F4.24` later promotes queues, that
  sentence and this decision move together.
- **`AGENTS.md` §2 / status line** — a *Notifications* row naming
  `NotificationService` as the single sender, the two new tables, and the
  webhook egress rules.
- **`docs/roadmap.md`** — flip the `F3.8` row when it lands.
- Neither edit belongs in the `F3.8` feature commit (§9.10).

## Amendment 1 — `F3.7` built: both raise paths dispatch, asymmetrically, and the sweep's dispatch is cross-organization (2026-09-06)

**Status: Accepted — 2026-09-06.** Ruled by the repository owner at `F3.7`'s
step-2 and step-5 gates; recorded here in the `chore(agents):` sweep after PR
#331 merged as `11ef0a8`.

Decision 9 said `F3.7` would wire `action.type === 'notify'` to `dispatch` in
both callers. It did — `rules/rule-actions.ts` is the one reader of a rule's
stored `action`, and `RulesService.evaluateEnabledRules` and
`AlarmEngineService` both call its `notifyOnRaise` and nothing else — and the
build and its reviews forced five rulings this ADR had not made:

1. **The two paths are asymmetric.** The on-demand sweep dispatches on every
   *attempted* raise and passes `raised` through, so a repeat sweep against an
   unchanged plant writes one `skipped_deduped` row per joined channel —
   decision 4 as written. The streaming engine dispatches **only when the raise
   opened an alarm**. Decision 4 read literally for the streaming loop means one
   skip row per open alarm per batch: five batches a minute against 118 open
   alarms on the seeded database is 35,400 rows an hour per channel, into a
   table no retention policy touches. A streaming engine re-observing an open
   alarm is not an attempt to tell anyone anything; a human pressing *Evaluate
   now* is, and that human deserves the ledger's answer.
2. **The sweep's dispatch is cross-organization, like the sweep.** ADR 0033
   decision 2 makes the sweep evaluate every tenant's rules on the fleet role,
   and only the returned trace is scoped to the caller. The dispatch follows
   every raise, so a `configuration`-role user of one organization can choose
   the moment another organization's real alarm is notified. Content never
   crosses: the alarm text goes to that organization's own channels, stamped
   with its organization id, and the alarm itself opens whoever pressed the
   button. The owner kept it as built rather than gate the send on the caller's
   scope, because a gated send opens an alarm nobody is told about and, the
   alarm being open, the streaming path never sends for it afterwards. Scoping
   the sweep itself would amend ADR 0033 and is not this ADR's to rule.
3. **`review` is inert.** `ruleActionSchema` still accepts it; `shouldNotify`
   is `type === "notify"` only; the rules card says so on a `review` or
   `trace_only` rule. Its meaning, if it ever has one, is a later decision.
4. **A per-rule save keeps joins the caller cannot see.** Decision 7 lets a
   fleet-global channel (`organization_id IS NULL`) be joined to any rule, and
   `ChannelsService.list` hides it from an org-scoped caller while
   `ruleChannelIds` returns it — so a full-replace `PUT` from the new picker
   silently unjoined it. `setRuleChannels` now preserves joins outside an
   org-scoped caller's manage scope and audits `preservedChannelIds`; a global
   caller keeps the full replace.
5. **The per-rule channel picker is `F3.7`'s**, on decision 10's own
   precedent: an item closed with its browser layer N/A is not closed.

**Left open, filed as `F3.46`:** repeated sweeps grow
`bms.notification_deliveries` with `skipped_deduped` rows that the dedupe
branch writes *before* the hourly ceiling, keyed by a forensic (non-unique)
`dedupe_key`, into a table no retention policy touches.

**Consequences for this ADR's text.** Decision 4 ("a row for every attempt")
now has one reading per path, stated in ruling 1; decision 9's "`F3.7` becomes
buildable" is discharged. Nothing else moves.

## Amendment 2 — `F3.46` built: a refusal is recorded once per key, and `dedupe_key` has its index (2026-09-06)

**Status: Accepted — 2026-09-06.** Ruled by the repository owner at `F3.46`'s
step-2 and step-5 gates on `docs/plans/f3.46-dedupe-skip-growth.md`; recorded
here in the `chore(agents):` sweep after PR #336 merged squashed as `fd6117d`
and PR #339 merged squashed as `64db1db`.

1. **Decision 4 reads differently again, now that the sweep path grows
   without bound.** A refusal still leaves a row — that much of decision 4
   stands — but `NotificationsService.dispatchToChannel` now reads the ledger
   *before* writing one, and writes `skipped_deduped` at most once per
   `(channel_id, organization_id, dedupe_key)` for the life of the ledger: the
   second and every later press of *Evaluate now* against the same unchanged
   alarm answers from the existing row rather than adding another. A failed
   read is not treated as "no prior refusal" — it logs one warning and falls
   back to today's plain write, so a read outage degrades to Amendment 1's
   behavior rather than to silence. The narrow window this leaves under two
   concurrent sweeps racing the same key was named and accepted as the bound
   this amendment buys, not closed by it — a unique constraint would close it
   at the cost of a write-path failure mode this ADR is not ready to take on.
2. **Ruling Q1 gives the sweep's key its content.** `AlarmRaiser` returns no
   alarm id on an already-open conflict, and none either on the E7.1b
   organization-mismatch refusal (ADR 0043 Amendment 5) — both are the same
   shape of "nothing to raise" to the caller. The sweep's refusal key is
   therefore `rule:no-alarm:severity`, and the two refusals share it: a
   suppression is per rule and severity, not per alarm, for as long as the
   ledger keeps the row. The owner accepted this rather than widen the key,
   because the two refusals are indistinguishable to the operator reading the
   deliveries view — both mean "nothing new to tell you about this rule" — and
   a wider key would only restore the growth this amendment exists to bound.
3. **Decision 7's forensic key gets its first reader, and `0038`'s own promise
   is discharged — by migration `0065`, not the plan's `0064`.** `F2.7`'s PR 1
   (#337) landed migrations `0063` and `0064` first, so the index that
   `dedupe_key` was always going to need lands numbered `0065`:
   `notification_deliveries_dedupe_skip_idx ON bms.notification_deliveries
   (channel_id, dedupe_key) WHERE status = 'skipped_deduped'`, partial on the
   skip status so a `sent` or `failed` row never enters it. `organization_id`
   is deliberately outside the index — the rule id inside `dedupe_key` already
   belongs to one organization, so the extra column would only widen the index
   for no selectivity. The migration runs under `SET ROLE bms_owner` /
   `RESET ROLE` per ADR 0045, and the read this amendment adds must stay an
   unnamed statement so a prepared plan never survives across the role switch.
   Ruling Q2 is why this shipped as two pull requests rather than folded into
   one: the index is the discharge of `0038`'s own rule that whoever gives
   `dedupe_key` a reader adds the index with it, recorded in this amendment
   rather than gated on it landing first.
4. **Retention for `bms.notification_deliveries` stays deliberately
   unchosen.** This amendment bounds growth from the dedupe branch only; a
   channel's `sent` and `failed` history still has no retention policy, and
   nothing here rules on adding one.
5. **Left open, filed as `F3.47`:** `POST /api/v1/rules/evaluate` still writes
   one `bms.rule_executions` row per enabled rule per press — 289 on the
   seeded database — with no throttle and no retention policy of its own.
   This amendment bounds the delivery ledger the sweep writes to, not the
   execution trace the sweep itself is; a `configuration`-role user looping
   *Evaluate now* still grows `bms.rule_executions` one sweep at a time.
6. **Forward pointer.** ADR 0057 (`F3.10`, PR 1 merged #338 `452c1f4`) adds
   escalation and cleared event kinds to the same `dedupe_key` shape and a
   wider partial index of its own in migration `0066`; that migration must
   drop or re-key `notification_deliveries_dedupe_skip_idx` rather than leave
   two partial indexes disagreeing about which statuses they cover.
   **Landed 2026-09-07** (PR #341, `f9aa102e`): the two kinds ride decision
   7's key as `:escalation:<n>` and `:cleared`, and `0066` dropped
   `notification_deliveries_dedupe_skip_idx` for
   `notification_deliveries_channel_key_idx (channel_id, dedupe_key) WHERE
   dedupe_key IS NOT NULL`, which serves both `hasRecordedSkip` and the event
   reads (ADR 0057 Amendment 1).

## Amendment 3 — `F3.48`: decision 4 has a third exception, and it is a decision rather than a read (2026-09-08)

**Status: Accepted — 2026-09-08.** Ruled by the repository owner at `F3.48`'s
step-2 gate. This record is a pointer: the reasoning and the rulings live in
**ADR 0057 Amendment 2**, and this amendment exists so that a reader of ADR
0041 alone does not still believe decision 4 holds without exception.

**Decision 4 — "Every attempt writes a `bms.notification_deliveries` row" — no
longer holds on one path.** Since `F3.48`, when decision 5's per-channel hourly
ceiling refuses an **escalation step**, `dispatchToChannel` returns
`skipped_rate_limited` to its caller and writes nothing. The row would spend
the event's dedupe key for the life of the ledger, and the alarm lifecycle
sweep needs that key to survive so a later tick can retry the step once the
ceiling's trailing hour has lifted. Without it, the tail of a first severity
mapping's burst was lost outright — 52 backlogged alarms, measured on the
seeded stack (ADR 0057 ruling Q7).

Two boundaries, both deliberate:

- **The raise path is unchanged** and still records its rate-limited rows. A
  raise key is per transition and the next raise is a new alarm with a new key,
  so decision 4's visibility is served where its growth is bounded.
- **A refused *cleared* message keeps its row** (ADR 0057 ruling Q-A). It is
  dispatched once, from the clear phase, and the sweep never sees that alarm
  again — so there is no retry for the missing row to buy, and dropping it
  would only make the refusal invisible.

This is the third exception to decision 4 on the event path, not the first: ADR
0057's plan D3 and its security review H1 already keep a failed ledger read and
a failed rate-limit read out of the ledger, for the same reason. The `F3.10`
build made those two; `F3.48` makes this one, and it differs from them in being
a decision rather than a failed read.

Decision 5 itself is untouched. The ceiling still refuses the send, still
counts `sent` rows over a trailing hour, and `skipped_rate_limited` rows were
never in that count — so no arithmetic moved and outbound volume stays bounded
exactly as before.

## Amendment 4 — `F3.54`: the three event-path exceptions are all conditional now (2026-09-08)

A correction to Amendment 3 above, which says of plan D3 and security review H1
that they "already keep a failed ledger read and a failed rate-limit read out of
the ledger". That was true when it was written and is not true now.

Under **ADR 0057 Amendment 4** all three exceptions to decision 4 on the event
path narrow to `event.kind === "escalation"`. A refused **cleared** message
keeps its row at every one of them — the hourly ceiling (ruling Q-A, `F3.48`),
the failed ledger read and the failed rate-limit read (`F3.54`) — because a
clear is dispatched once and never re-offered, so a missing row buys no retry
while costing the only evidence the refusal happened.

**The count of exceptions stays three, and decision 4 is better served than
before**, not further eroded: two refusals that were invisible for every event
are now visible for the kind that will never be retried. **The raise path is
untouched** and records as it always has. The reasoning, the accepted costs and
the two exits deliberately left alone are in ADR 0057 Amendment 4; this note
exists only so a reader of ADR 0041 alone is not left with Amendment 3's
sentence.

## Amendment 5 — `F3.51`: decision 4 gains a fourth exception, and it is the first that is not an event (2026-09-09)

A correction to Amendment 4 above, and to `dispatchToChannel`'s own header
comment: "**The raise path is untouched** and records as it always has" was
true for every raise before this row and is now false for one of them. The
reasoning and the four owner rulings this row was built under are in ADR 0057
Amendment 5; this note exists so a reader of ADR 0041 alone is not left with
Amendment 4's sentence.

**The property, not a fourth event kind.** `offeredAgainWithoutAsking`, the
one call the three event-path exits already shared since `F3.54`, gains a
fourth answer that reaches it through a different door. `DispatchInput` gains
an optional `reoffered?: true`, set nowhere but the alarm lifecycle sweep's new
raise-retry phase. The function's first line now reads
`if (input.event === undefined) return input.reoffered === true;` before its
exhaustive `switch` over `event.kind` — so a raise that nobody re-offers still
answers `false` there exactly as before, and the `switch` beneath is untouched,
still exhaustive, still a compile error under `noImplicitReturns` for a third
event kind. `reoffered` never reaches `buildDedupeKey` and never changes
`subjectFor`: it is not an event, and the three exits do not learn a new kind
of dispatch, only a second way to reach the answer they already know how to
give.

**What the fourth exception is.** A raise's own outcome is recorded under the
key `rule:alarm:severity`; nothing before this row ever asked for that key
again; the alarm lifecycle sweep's raise-retry phase now does, every 30 s tick,
for as long as the alarm stays open, unacknowledged, and its rule keeps
notifying. A dispatch carrying `reoffered: true` therefore has exactly the
escalation step's property — the sweep will ask again on its own — and none of
the cleared message's, so it takes the same three no-row exits an escalation
step takes: the failed ledger read (D3), the failed rate-limit read (H1), and
the ceiling's own refusal (`F3.48` ruling Q1). Writing a row at any of those
three would spend one of the raise key's `MAX_EVENT_ATTEMPTS` on a refusal the
very next tick means to revisit, for the same reason `F3.48` gave for the
escalation path: the sweep ticks faster than the ceiling's trailing hour can
clear.

**The original raise's row is untouched, and that sentence now needs to be
read carefully.** The *first* raise — the one a rule evaluation dispatches
with no `reoffered` flag — still records at all three exits exactly as
Amendment 4 describes, because `input.reoffered` is unset there and the
predicate still answers `false`. That row is not incidental; it is the only
evidence the sweep's raise-retry phase has to work from, since the phase reads
the ledger for the alarm's raise key before deciding who is still owed the
message (ADR 0057 Amendment 5). A raise that never wrote a row — a rejected
channel read, or a rejected `record()` insert — is never retried; the
raise-retry phase reads evidence, it does not infer absence.

**Growth accounting.** `MAX_EVENT_ATTEMPTS`'s bound on an event key now covers
the raise key as well, reached through `channelsOwedTheRaise` rather than
through `eventDeliveryBlocked`, but it is the same predicate, so the same
paragraph applies unchanged: this many `failed` rows under a raise key stop the
sweep re-offering it to that channel, a `skipped_rate_limited` row never counts
toward the cap and never blocks, and a `skipped_unconfigured` row blocks only
while it is newer than the unconfigured watermark (`F3.50` ruling Q1) — now
computed by one shared helper, `unconfiguredWatermark`, called from both the
event path and the raise-retry read. The two accountings never mix: the ledger
read that feeds the raise-retry phase filters on the raise's own dedupe key,
and a step's key always carries an `:escalation:<n>` or `:cleared` suffix.

**The accepted cost, stated where ADR 0057 states it in full.** A channel held
permanently over a misconfigured hourly ceiling is now re-offered a raise on
every tick for the life of the alarm — two reads a tick, nothing written,
nothing sent — the same cost Amendment 2 of ADR 0057 already accepted on the
escalation path, reaching the raise path for the first time. `F3.53` owns the
per-tick read cost; `F3.52` owns splitting the hourly budget between the raise
and event paths, and owns the retried message's lack of any age or staleness
marker — deliberate here, since byte-identity with the original raise is what
lets the ledger rows line up, and inherited rather than fixed by this row.

### Amendment 5 §2 — the growth accounting counts rows, and a row that was not written counts for nothing (2026-09-09)

The `F3.51` review's High finding, and it lands on the "Growth accounting"
paragraph above. That paragraph is true of every row the ledger holds and says
nothing about the case where the ledger holds none.

`record()` catches its own INSERT failure, logs an error and returns the
result. **Decision 1 is unchanged and is not what the review objected to**: a
dispatch must not fail its caller, `dispatch()` is fire-and-forget from the
raise path, and a rejection there would surface as an unhandled promise. What
the review objected to is that the failure was invisible to the one caller that
needs it. If writes fail while reads succeed, no row is ever written under the
raise key — so `MAX_EVENT_ATTEMPTS` has nothing to count, `isOverHourlyLimit`
has no `sent` row to count, and the raise-retry phase keeps seeing the same
single original `failed` row and keeps re-offering it, twice a minute, for the
life of the alarm, with no ledger trace of any of it.

`record()` now reports whether the row landed. Every result of `dispatch()` and
`dispatchToChannels()` is a `DispatchOutcome` — the `DeliveryResult` unchanged,
plus `channelId` and `rowLost` — and the sweep keeps an in-process record of
the `(alarm, channel, dedupe key)` triples whose insert threw and stops
re-offering them. The reasoning, the cap and the eviction rule are in ADR 0057
Amendment 5 §2; what belongs here is the shape and the two constraints it was
built under.

**"The one caller that needs it" was two, and this review only wired one.** The
escalation phase re-offers a due step on every tick and discarded
`dispatchToChannels`'s outcomes, so it had the identical unbounded loop. §3
below closes it under the step's own key. The sentence above is left standing
with this correction beside it because the reasoning it gives is unchanged —
only its count of callers was wrong.

**`rowLost`, and deliberately not `written`.** The three exits above write no
row **by design**, and a caller that read those as lost rows would stop
re-offering a ceiling-refused raise — undoing `F3.48` on the raise path, which
is the exception this very amendment adds. `rowLost` is true in exactly one
case: an insert was attempted and it threw. The exits that conserve a key
report `false`, because nothing was lost there.

**The bound is in process, not in the ledger, and that is forced.** A bound
that survived a restart would have to be a row, and a row is exactly what could
not be written — the treatment `PROCESS_STARTED_AT` already gives the
unconfigured watermark.

**What a restart costs is one extra send per remembered pair**, and the first
wording of this paragraph ("the retry resumes as if the losses had not
happened") read as though it cost nothing. It does not: the ledger still holds
the same `failed` row, which still reads as "owed", so the first tick after a
restart offers every remembered pair once more. Once, that is small. Under a
restart LOOP it is unbounded — and a database refusing writes is exactly the
condition in which this API may be crash-looping, so the two arrive together.

**Two placements this review also settled.** `MAX_EVENT_ATTEMPTS` and
`offeredAgainWithoutAsking` moved out of `notifications.service.ts` into
`notifications/dispatch-policy.ts`, with `DispatchOutcome`: the file stood at
958 of AGENTS.md §4.5's 1000-line cap and what moved is the part that needs
nothing from the class. There is deliberately **no re-export** — two import
paths for one constant is the drift shape this repository keeps finding. And
`dispatchToChannel`'s exits gained a `channelId` on every result, because
`dispatchToChannels` drops channels from another organization (M2) and the
results are therefore not index-aligned with the list a caller passed.

### Amendment 5 §3 - the second review: the exception is unchanged, the row that carries it is bounded (2026-09-09)

A second review of the same branch found one CI-breaking error and three
defects. Two of them land on this ADR: the fourth exception to decision 4 is
untouched, but two claims made around it were false.

**1. Both re-offering paths now have the §2 accounting, not one (High).** §2
above wired `rowLost` into the raise-retry phase only, and said "the one caller
that re-offers a dispatch on its own". `runEscalationPhase` is the other, and it
discarded the outcomes it was handed - so with a ledger serving reads and
refusing inserts, `eventDeliveryBlocked` found nothing under the step's key,
never blocked, `isOverHourlyLimit` counted no `sent` rows, and the due step was
re-sent every 30 s for the life of the alarm with no trace of any of it. That is
§2's own argument, unamended, applied to the phase §2 did not reach.

Both phases now go through one helper and one `LostLedgerRows` instance, each
under its **own** dedupe key: the raise key `rule:alarm:severity` for the retry,
`...:escalation:<n>` for a step. The instance is shared and so is its cap, which
is a real coupling - escalation losses can spend the slots the raise path would
have used - and it is recorded here rather than left to be discovered. The keys
are never shared: a lost step row must not silence the raise, nor a lost raise
row a step.

**2. A control character in a delivery error cost a row on demand (Medium).**
`record()` stored the transport's failure text in
`notification_deliveries.error`, which is `text`, and Postgres refuses `0x00` in
a text parameter (measured against the real database: `invalid byte sequence for
encoding "UTF8": 0x00`). `webhook.transport.ts`'s `readBounded` normalises a
response excerpt with `.replace(/\s+/g, " ").trim()`, and neither `\s` nor
`trim()` touches `U+0000` - so any endpoint answering 500 with a NUL in its body
made the insert throw, `record()` report `rowLost`, and the sweep spend one of
its 1000 in-process slots. Past the cap the pair is re-offered every tick for
ever, dispatched sequentially.

Every C0 and C1 control but tab, newline and carriage return is now stripped
**where the error is recorded** - the one place any transport's text reaches the
column, so the rule does not have to be repeated per transport. Two consequences
are stated rather than implied: the stored text and the returned
`DeliveryResult.error` now differ for one delivery, and only the stored one is
sanitised, because only the column can refuse a byte.

**3. Two documentation claims here were wrong, and both are corrected in
place.** The exhaustiveness of `offeredAgainWithoutAsking` was credited to
`noImplicitReturns`, which is set in no tsconfig in this repository; the guard
does hold, as `TS2366` under `strictNullChecks` from `strict: true` in
`tsconfig.base.json`. And `notifications.service.ts` said an ordinary raise
keeps its row "at all three of those exits": it reaches two, because the first
is inside `if (input.event !== undefined)` and an ordinary raise carries no
event.

## Amendment 6 — `F3.52`: the hourly ceiling reserves headroom for the raise path, and a due escalation step can be too late to send (2026-09-09)

**Status: Accepted — 2026-09-09.** Ruled by the repository owner at `F3.52`'s
step-2 gate; six rulings, taken 2026-09-09.

### The premise `F3.52` was filed on is no longer true, and the row is kept anyway

`docs/BACKLOG.md`'s `F3.52` row, written 2026-09-08, says a new critical
alarm's raise that meets a full ceiling is "then lost outright". **It is not,
and has not been since `F3.51` merged as `16dc9e89` the following day.** A
ceiling-refused raise writes `skipped_rate_limited`; in `channelsOwedTheRaise`
that row counts as *evidence* at stage 1 but is *excluded* at stage 2, so the
eligible set is empty, both blocking arms are false, and the channel comes back
owed. The sweep re-offers that raise every 30 s until it lands.

The harm is therefore a **delay**, not a loss — and the owner ruled the fix in
scope regardless (ruling 2), because a critical raise queued behind an
escalation backlog for hours is operationally a loss even though the ledger
will eventually deliver it. The row's severity text is wrong and is corrected
in this row's closure sweep, not here.

**The row's other error, corrected here so it is not repeated:** it says both
fixes are "ADR 0041 decision 5 territory". The per-channel hourly ceiling is
**decision 7**, storm control's second bullet. Decision 5 is the unconfigured
channel's recorded skip.

### 1. Decision 7's ceiling is one query, two counts and two limits (rulings 3, 4 and 8)

`isOverHourlyLimit` counts `sent` rows in the trailing hour and compares that
count to `ratePerHour`. It gains a third argument — **the budget to charge
against, not the kind asking**, and this sentence said "kind" until the build
measured why it cannot: `sendTest` is neither a raise nor an event, so a
parameter called `kind` would make that call site a false claim in code. The
type is `CeilingBudget = "full" | "reserved"`. One query returns **two**
numbers, and each budget reads the pair differently:

- **the raise path keeps the whole ceiling** — refused when `allSent >=
  ratePerHour`;
- **the reserved path — an escalation step, a cleared message or a `sendTest` —
  is refused when `allSent >= ratePerHour` **or** `reservedSent >=
  Math.floor(ratePerHour * EVENT_SHARE)`**, with `EVENT_SHARE` at `0.8`.

At the default 60 an hour, events can never occupy more than 48 of the 60, so
twelve slots stay reachable by a raise alone. Still one round trip and no schema
change: a `FILTER` aggregate beside the existing count.

**This said "one count, two limits" and shipped that way, and it was
backwards** (`F3.52` security review, Medium; owner ruling 8). An unfiltered
count charges a RAISE against the reduced limit too, so forty-eight sent
*raises* refused every step, every cleared message and every test send on that
channel while raises went on to 60. The reserve was taking from the path it was
meant to protect — and a step held that long is exactly the step §2's age
cut-off then abandons, so the two halves of this row compounded into a loss
where there had been a late delivery.

**The invariant that makes the second count correct, and it is not "events":**
*the rows counted against the reserved limit are exactly the rows written by
dispatches that CHARGED the reserved limit.* A `sendTest` charges it (ruling 4)
and therefore must be counted in it, or a burst of tests would fill the full
ceiling and eat the raise headroom without ever tripping the reserved one. A
raise's dedupe key carries no suffix; an escalation key ends `:escalation:<n>`,
a cleared key ends `:cleared`, and a test send writes no key at all.

**`sendTest` meets the reduced event limit** (ruling 4). It is the third caller
of this ceiling and is neither a raise nor an event — an operator pressing *Send
test* on the channels page. A manual test is not an alarm, so it must never
consume headroom held for a critical raise, and the reserve then means exactly
one thing: **only a real raise may reach the last slots.** A refused test
already records `skipped_rate_limited` and already reads as a refusal in the UI;
that is unchanged.

**The accepted consequence at a small ceiling, stated because the owner should
see it at this gate.** `Math.floor(ratePerHour * 0.8)` is `0` at
`ratePerHour = 1`: a channel throttled that hard sends raises only, and no
escalation step or cleared message at all. That is the correct ordering of the
two — a raise is the message an operator cannot do without — but it is a
behaviour change at the extreme.

**This paragraph said "a change no existing test covers". That was false**, and
it is struck rather than softened: `notifications.events.spec.ts` case 7 —
`F3.48` ruling Q1's own gate — builds exactly `NOTIFY_RATE_LIMIT_PER_HOUR: "1"`,
refuses a step at one `sent` row and then asserts the step **sends** once the
count falls to zero. At a reserved limit of zero it refuses at every count, so
the case inverts. The claim it makes — the next tick retries a ceiling-refused
step — is `F3.48`'s and must survive, so the fixture is raised to a rate of five
refusing at four rather than the case being re-pointed at the new behaviour.
The extreme itself is then covered on purpose, by a `hourlyCeiling` case
asserting `0` at a rate of one: it is the only fixture that separates
`Math.floor` from `Math.ceil`.

### 2. Decision 4 gains a sixth status: a due step can be too late to send (rulings 1, 5 and 6)

**Only the escalation path is touched (ruling 1).** The `F3.52` row asks for
"an age cut-off past which a due step is abandoned", while Amendment 5 above
assigns this row "the retried message's lack of any age or staleness marker" on
the **raise-retry** path. Those are different changes on different paths, and
Amendment 5 says in the same sentence that **byte-identity with the original
raise is what lets the ledger rows line up**. An age marker on a retried raise
would break the thing Amendment 5 defends. The raise retry stays byte-identical;
the retried-raise staleness question is re-filed, not carried here.

**A due escalation step more than `STEP_MAX_LATENESS` past due is abandoned**
(ruling 6), where a step's due instant is `raised_at + after_minutes` — the same
arithmetic `dueSteps` already does — and the default is **60 minutes**,
configurable from the environment as `ratePerHour` already is. Sixty matches
`isOverHourlyLimit`'s own trailing hour: a step that could not fit inside one
full ceiling window is over budget, not merely queued.

**The abandonment is recorded as a new `skipped_stale` row** (ruling 5), not as
a log line and not as a reused status. Three consequences follow, and the third
is the one that makes this the honest choice:

1. `packages/shared/src/contracts/notifications.ts` gains the sixth value, and
   **the comment above that enum, which today reads "The database refuses a
   sixth value; this refuses it one layer earlier", is corrected in the same
   edit.** Migration `0068` widens
   `notification_deliveries_status_check` from migration `0038`. The schema
   comment at `packages/db/src/schema/alarms-schema.ts:359-362` restates the list
   and is corrected too.

   **`0068`'s own header says its widening was "MEASURED" against the running
   database, and the first measurement ran on different bytes.** The migration
   review found the applied row hashing `d452088a…` while the committed file
   hashes `b257bb67…` — a DRAFT of `0068` had run, and because drizzle applies a
   file only when the last stamp is *strictly* lower than the journal's, an
   equal stamp meant the committed bytes would never have run on that database
   at all. The DDL was identical, so nothing was wrong in the schema; what was
   wrong is that a green readback proved a file nobody had executed. Repaired by
   hand on the dev database — the stray row re-stamped one millisecond earlier,
   never deleted, since lowering the maximum re-runs everything above it — and
   `pnpm db:migrate` then applied the committed bytes, whose hash is now the
   newest row. `0068` is frozen by the pre-commit hook, so this note is the
   correction rather than an edit to the header.
2. `apps/web/src/lib/notification-channels.ts` holds **three** switches over
   the status — the row label, the tone, and the *Send test* message — so this
   row has an `apps/web` surface and owes a browser layer. A test send carries
   no step and can never be stale, so the third handles the value the way it
   already handles `skipped_deduped` there, marked unreachable.

   **All three carry a `default:` clause, so the compiler flags none of them**,
   and this note said "for exhaustiveness" as though it would. Adding the sixth
   value produces no error anywhere in `apps/web`: the label would render the
   raw string `skipped_stale` and the tone would fall to `"offline"` — grey, the
   way a disabled channel renders, which is precisely the misread
   `deliveryStatusTone`'s own docblock argues against. The `default:` clauses
   stay, because each records a deliberate reason. **The hand-written cases in
   `notification-channels.spec.ts` are the only gate on all three**, and a
   missing case is therefore a silent grey row rather than a red build.

   The same undercount applies to the prose, and **this note got the count
   wrong three times in a row** — one, then three, then thirteen. Measured from
   the branch base, it is **fifteen sites across eight files**:

   | file | sites |
   |---|---|
   | `packages/shared/src/contracts/notifications.ts` | 3 — the opening line, the skips enumeration, the "refuses a sixth value" pointer |
   | `tests/f3.8-notification-schema.integration.test.ts` | 3 — a docblock item and two `it()` names |
   | `apps/web/src/lib/notification-channels.ts` | 2 — `:260`, `:284` |
   | `apps/web/src/lib/notification-channels.test.ts` | 2 — `:92`, `:101` |
   | `apps/web/src/pages/admin/notification-deliveries-page.*` | 2 — the `ALL_FIVE` fixture and the `it()` that renders it |
   | `packages/shared/src/index.ts` | 1 — the docblock on the exported type |
   | `apps/api/src/notifications/notification-transport.ts` | 1 |
   | `packages/db/src/schema/alarms-schema.ts` | 1 |

   **Two of the fifteen were found by no review pass and by neither
   implementer**, and each names a different failure. The barrel docblock at
   `packages/shared/src/index.ts:603` is the sentence a consumer of
   `@bms/shared` reads — missed because nobody looked outside the contract file.
   The `ALL_FIVE` fixture was missed because **the census `git grep` used
   `apps/**/*.ts`, which does not match `.tsx`.** A search that silently
   excludes a file extension reports a clean sweep of the files it happened to
   look at; the glob is as much a claim as the count.

   `ALL_FIVE` is the one that mattered beyond prose: it is the deliveries
   page's only "every status renders" fixture, so a name-only correction would
   have left a test asserting six statuses over five rows.

   **The durable rule, and this row is the third to pay for it** (`F4.102`,
   `F4.105`): count echo sites from the source with a search, never from the
   sites a row or a plan happens to name — and check the search's own glob
   before trusting that it found none.
3. **A non-`failed` row blocks its key through `eventDeliveryBlocked`'s existing
   arm**, so the abandoned step is never re-offered without a line of new retry
   logic. `failed` would have been wrong on behaviour rather than merely on
   naming — the step would have gone on being offered until
   `MAX_EVENT_ATTEMPTS`.

**The blocking must reach the step and nothing else, and that is an assertion,
not an assumption.** A step's key carries an `:escalation:<n>` suffix, so a
`skipped_stale` row blocks that step number for that alarm and channel, for the
life of the ledger. `channelsOwedTheRaise` reads the raise key, which has no
suffix, and excludes only `skipped_rate_limited` and a stale
`skipped_unconfigured` — so a `skipped_stale` row reaching a **raise** key would
block that raise for ever. Ruling 1 keeps the raise path untouched and no such
row should ever exist; the build gates that rather than trusting it.

**Where the exit sits, and what that does *not* buy** (ruling 9). It is the last
pre-check in `dispatchToChannel`: after the ledger read, and **after** the hourly
ceiling. It sat before the ceiling until the security review, and the argument
for moving it was that a step refused by the budget would then never be
abandoned for age it spent waiting. **That argument is false and is recorded
here rather than in a comment, because it was believed for a while.** A
correctness pass traced it: `stepIsTooLate` recomputes each tick from a fixed
`raised_at` and an increasing `now`, so once a step is stale it stays stale — the
moment the ceiling frees, control reaches the exit and the step is abandoned
after all. **The end state is identical either way; the move changes only which
reason an operator reads while the channel is over budget**, and that is the
whole of its justification: `skipped_rate_limited` is true and self-clearing
while it is true, and `skipped_stale` is written at the moment the step could
actually have been sent and was too old. What actually reduces the loss is
ruling 8 in §1 — stopping raises from consuming the event budget in the first
place.

Before the ledger read is wrong for its own unrelated reason: it would write a
row for a step already sent, because the phase re-dispatches every due step
every tick and the ledger read is what makes that idempotent.

### What this does not change

Decision 4's "a row for every attempt" is better served, not eroded: an
abandonment that today would be an unrecorded late send becomes a row an
operator can read. Decision 7's dedupe bullet is untouched. The raise path's
recording is untouched. `MAX_EVENT_ATTEMPTS`, the unconfigured watermark and
the `F3.48` ceiling exception all keep their present meanings.

### A constraint the build must respect, recorded here because it shapes the design

`apps/api/src/notifications/notifications.service.ts` stands at **986 of
AGENTS.md §4.5's 1000-line cap** and is on §2's "extract before adding" list.
Neither change above may be built by adding a public method and its docblock to
that class. The staleness decision is a **pure predicate in a module beside the
service**, on `dispatch-policy.ts`'s and `raise-retry.ts`'s precedent, and the
row is written by the dispatch path that already writes every other refusal —
no second writer beside `record()`.

## Amendment 7 — `F3.53`: the sweep remembers a closed ceiling for the length of one tick, and only ever the closed answer (2026-09-09)

**Status: Accepted — 2026-09-09.** Ruled by the repository owner at `F3.53`'s
step-2 gate; two rulings, taken 2026-09-09 on the measurements in §1 below
rather than on the row's filed text.

### The row was filed on a cost model that has moved three ways, and one of them is a path it never mentions

`docs/BACKLOG.md`'s `F3.53` row was created 2026-09-08 by `F3.48`'s security
review (M2). Every figure in it predates `F3.51` and `F3.52`.

1. **Up, on a path the row does not name.** `F3.51` added
   `runRaiseRetryPhase`, which dispatches per owed channel per active
   unacknowledged alarm on every tick. Amendment 5 above and ADR 0057
   Amendment 5 both assign that cost to `F3.53` by name; the row's own text
   describes only the escalation phase.
2. **Up marginally, and not in the number of queries.** Amendment 6 §1 made the
   read return two counts instead of one. It is still one round trip, one index
   scan and the same buffers.
3. **Down, and unrecorded anywhere until now.** Amendment 6 §2's
   `skipped_stale` row is not excluded by `eventDeliveryBlocked`, so it blocks
   its key on the "not `failed`" arm. An abandoned step stops reaching the
   ceiling at all.

### 1. What was measured, because the ruling rests on it and not on the row

All figures below were taken on the development host against a 2.2 M-row,
718 MB copy of `bms.notification_deliveries`, warm cache, before any code was
written. The plan is an index scan of
`notification_deliveries_channel_time_idx` with `organization_id` and
`status = 'sent'` as residual filters — **identical for both forms**, ten
shared buffer hits each.

| | server-side execution | round trip from the API process |
|---|---|---|
| the `F3.48` form, one count | 0.471 ms | 2.533 ms (p95 5.175) |
| the Amendment 6 form, two counts | 0.622 ms | 2.863 ms (p95 8.926) |

**About 2.2 ms of every read is round trip and driver, not the query.** The
aggregate is not the cost; the round trip is, and Amendment 6 added 0.33 ms to
it. `dispatchToChannels` issues these reads serially, so on the 30 s
sweep-then-sleep tick 52 spinning dispatches — the burst ADR 0057 Amendment 2
ruling Q7 measured — cost **149 ms, 0.5 % of a tick**. The tick stops sleeping
at about **10 500**.

**And exactly one case spins.** Driven over two ticks with the ceiling read
counted: a step that sends, and a step abandoned as `skipped_stale`, each pay
the read once and are blocked by their own row on the next tick. A step
**refused by the ceiling** pays it again on every tick, for ever, because
`F3.48` ruling Q1 deliberately writes no row so that the next tick can ask.
Three channels on one step cost three reads.

**The deployed run, recorded here because nothing else in the repository held
it.** `AGENTS.md` §2 states "126 dispatches a tick issued 3 ceiling reads
instead of 126" and the figure appeared only in a pull-request body until the
post-merge review pointed out that no committed document derived it. The
measurement: an `api` image built `--no-cache` from the `F3.53` branch, run
against an isolated copy of the development database — 42 open `critical`
alarms in one organization, one escalation step at one minute, **three**
channels on that step, and `NOTIFY_RATE_LIMIT_PER_HOUR=1`, which makes the
reserved ceiling `floor(1 × 0.8) = 0` so every step is refused at the ceiling
before any transport. Nine consecutive ticks of the Postgres statement log, at
`log_min_duration_statement = 0` scoped to that database:

```
18:36:16  dispatches=126  ceiling_reads=3
18:36:47  dispatches=126  ceiling_reads=3
18:37:18  dispatches=126  ceiling_reads=3
18:38:51  dispatches=126  ceiling_reads=3
```

42 alarms × 3 channels = 126 dispatches, and **3** ceiling reads — one per
channel, per tick. The dispatch count is the *un-memoised* event-idempotency
read, which is what makes the 3 a reduction rather than an absence of work; the
ledger held 0 rows throughout, because `F3.48` ruling Q1 writes none for a
ceiling refusal. The emitted JavaScript was grepped first: the memo is
constructed in `runLifecycleSweep` and the adapter forwards all three arguments.

That result decides the shape. The row states the two answers are asymmetric —
a cached `false` over-sends permanently, a cached `true` can only postpone —
and worries that the safe half is the less useful one. **The measurement
inverts that: the only case that spins is the case whose answer is `true`, so
the safe half of the fix removes all of the cost and the dangerous half is not
needed at all.**

### 2. Ruling 1 — the memo remembers the closed ceiling only

Within one tick, a channel the ceiling has already refused is not asked again.
Nothing else is remembered: a `false` is never cached, so no send is ever
authorised by memory, and decision 7's ceiling is still read from the ledger
before every dispatch that could be admitted by it.

**The key is `channel · organization · budget`.** The budget belongs in the key
because Amendment 6 §1 gives the two budgets different limits against different
counts: a channel over the reserved limit may still be under the full one, and
a raise must not inherit an event's refusal.

**A cached `true` is safe but it is NOT monotone, and the amendment says so
rather than claiming it is.** `isOverHourlyLimit` recomputes `since` on every
call, so the trailing hour's left edge moves and a channel at its limit can
drop below it part-way through a tick. The memo therefore postpones such a
dispatch to the next tick. Since `F3.48` that dispatch is retried, so the cost
is bounded at **one tick of latency, 30 s** — the same bound Amendment 5 and
ADR 0057 Amendment 2 already accept for a ceiling-refused dispatch.

**One tick, unless the alarm leaves the active-and-unacknowledged set inside
it.** The security review's L2, and this amendment records it rather than
keeping the rounder sentence. `runRaiseRetryPhase` skips an alarm cleared this
tick or carrying an `acknowledged_at` — ADR 0057 Amendment 5 ruling 4, somebody
is already on it — so a postponed RAISE retry has a next tick only while the
alarm stays open and unacknowledged. Acknowledged or cleared inside that 30 s,
the channel is never offered the raise text again, and the cleared message does
not stand in for it: `notifyCleared` writes only to channels already holding a
`sent` row for that alarm.

**That is not a reason to cache less, and the review says so too.** A real
`isOverHourlyLimit` answering `true` at the same instant loses the same offer,
and ruling 4 accepts that knowingly. What the memo adds is one narrow extra way
in — a `sent` row that aged out of the trailing hour part-way through the sweep,
where the ledger would have answered `false`.

**The escalation path has a terminal exit too, and this amendment first said it
did not.** The correctness review's C-1, landing on the paragraph written an
hour earlier to fix the security review's L2 — a correction is a claim too
(AGENTS.md §4.6), and this one was wrong in the same way.

The false sentence was "a due step stays due". It does; it does not stay
**sendable**. `stepIsTooLate` is `dispatchToChannel`'s block 2b, checked AFTER
the ceiling by Amendment 6 §2 ruling 9, so a step the memo postpones never
reaches it on that tick. Where the trailing hour moved inside the phase, and
that step was within one tick of `raised_at + after_minutes +
NOTIFY_STEP_MAX_LATENESS_MINUTES`, the ledger would have sent it now — and the
next tick instead finds the ceiling open, reaches 2b, and abandons the step as
`skipped_stale`. `eventDeliveryBlocked` counts that row as an answer on its
"not `failed`" arm, so the key is blocked for the life of the ledger. On that
path the postponement is not latency; it is the whole step, permanently.

**It stays in scope, and the reason is the measurement.** Two coincidences are
required — the hour moving inside one phase, and the step in its final tick
before a 60-minute cut-off — where the cost being bought is the removal of an
unbounded per-tick term. Amendment 6 §2 already accepts that a step can be
abandoned for age it spent waiting on a ceiling; this narrows the margin by at
most one tick. What is not acceptable is an amendment that says the exposure
does not exist, which is why it is written out here in full rather than
softened.

### 3. Ruling 2 — the window is the tick, created by the sweep, and it reaches exactly one call site

`runLifecycleSweep` creates the memo and it dies with the tick. There is no TTL
and no eviction cap, because it never outlives one sweep — `F3.51` ruling 3
replaced a clock constant with a structural condition and this keeps that
precedent rather than reintroducing one.

`dispatchToChannels` takes it as an **optional** argument, so a caller that
does not pass one reads the ledger exactly as it does today. It has **three**
production callers, one passes the memo and two do not, and each omission is a
decision:

- **`dispatchRememberingLostRows` passes it** — the single call site shared by the raise-retry and escalation phases, which
  is where all of the measured spin is.
- **`notifyCleared` does not.** A cleared
  message is dispatched once, from the clear phase, and `loadActiveAlarms`
  never selects that alarm again. It has no next tick to be postponed to, so
  the aged-out edge in §2 would cost the clear itself — the silent-loss shape
  ADR 0057 Amendment 2 ruling Q-A refused.
- **`dispatch()`, the fire-and-forget raise path, does not**
  (the `dispatch()` tail of `notifications.service.ts`). It runs concurrently
  outside it; it was the row's stated reason for doubting a service-level memo,
  and threading the window from the sweep removes the question rather than
  answering it.

**`sendTest` is not one of them, and this section said it was.** Corrected in
place on Amendment 6 §1's precedent rather than quietly reworded: `sendTest`
calls `isOverHourlyLimit` **directly**, from `NotificationsService.sendTest`, and
never enters `dispatchToChannels` at all, so it cannot see a memo on either
reading and the ruling's behaviour is unchanged. The count of four callers was
wrong, and the correction is recorded because a closure record or a docblock
that copied the sentence would carry the error forward.

**The adapter is the edit that makes any of this reach production, and this
section omitted it.** `AlarmLifecycleDeps.dispatchToChannels` is typed
`NotificationsService["dispatchToChannels"]`, so it widens with the method —
but the adapter that satisfies it, the `dispatchToChannels` arrow in
`alarm-lifecycle.service.ts`'s `deps()`, is written
`(channels, input) => this.notifications.dispatchToChannels(channels, input)`
and **drops a third argument**. Left alone, the memo is created, threaded
through both phases, and never delivered — while every sweep spec stays green,
because they replace `deps.dispatchToChannels` with their own fake. The build
edits that line and gates it against a real database, since no fake-deps test
can reach it.

`DispatchInput` is local to `apps/api` (declared in `notifications.service.ts`), not a
`packages/shared` contract, so nothing here is ADR 0030 contract drift.

### What this does not change

Decision 7's ceiling, its two limits and its two counts are untouched — this
amendment changes only how often the query is issued, never its answer.
Decision 4's row-per-attempt is untouched: the memo writes nothing and reads
nothing. `MAX_EVENT_ATTEMPTS`, `eventDeliveryBlocked`, the unconfigured
watermark, `F3.48`'s ceiling exception and Amendment 6's `skipped_stale` exit
all keep their present meanings, and there is no schema change.

### A constraint the build must respect, recorded here because it shapes the design

`apps/api/src/notifications/notifications.service.ts` stands at **982 of
AGENTS.md §4.5's 1000-line cap** and is still on §2's "extract before adding"
list. The memo's type, its docblock and its behaviour belong in a module beside
the service, on the `dispatch-policy.ts` precedent; the service itself may gain
only the parameter and the consultation. If that does not fit, the build
extracts before it adds, as `F3.52` did twice — it does not spend the last
eighteen lines and call the file legal.

**Measured at the plan, and it does not fit: the parameter and the consultation
alone cost +14, landing the file at 996 of 1000.** The owner ruled the
extraction at the plan gate: `hasRecordedSkip` and `eventDeliveryBlocked` — the
two dedupe-key ledger reads, each `fleetDb`-only and needing nothing from the
class — move to a module beside the service, which the service's own comment at
its `sentChannelIdsForAlarm` docblock already gives as the rule for a read it
kept out. The service lands near
805 before the memo is added.

**The move gate is weaker than `F3.52`'s and the amendment says so rather than
asking for a byte-identity it cannot have.** After `F3.52` nothing is left at
module level in that file; every remaining candidate is a method on
`this.fleetDb`. The achievable claim is *identical apart from indentation, the
signature line, and `this.fleetDb` → `db`*, checked with `diff -w` against the
base commit's bytes — not "byte-identical apart from `export`", which held for
`ledger-text.ts` and `dispatch-shapes.ts` and does not hold here.

## Amendment 8 — `F3.56`: the delivery ledger names the event kind, and it is derived from the key rather than stored (2026-09-10)

**What the row asked.** `NotificationDeliveryDto` carries ten fields and neither
the dedupe key nor the kind, so an operator reading a `failed` row cannot say
whether it was a raise, an escalation step or the cleared message. `F3.54` made
that matter more: a refused clear now writes a `failed` row that reads exactly
like a transport failure the sweep will retry three times, and it will never be
retried at all.

**Owner ruling 1 (2026-09-10): a kind-only enum, derived server-side.**
`notificationDeliveryDtoSchema` gains one flat field, `event`, from a closed set
of five. The raw dedupe key is not exposed and no column is added.

**One correction to the row's own text before anything else.** It says
`rate-limit check failed` "stays ambiguous between a raise and a clear". That
string is written at **two** sites — `notifications.service.ts:458` on the
dispatch path and `:759` in `sendTest` — so it is ambiguous **three** ways, not
two, and the third is the one no event kind would name.

### The two options that were not taken, and why

**The terminal status was already declined** (`F3.54` ruling 3) and this
amendment does not re-open it. One half of that ruling's cost argument has since
expired: `F3.52` shipped exactly "a migration plus a contract change plus every
reader" as `skipped_stale` (migration `0068`), so the cost is now known rather
than feared. The other half stands and is the load-bearing one — a status says
what happened to the attempt, and the kind says what the attempt was *for*.
Those are different questions and one column cannot answer both without the
product of the two sets.

**The raw key was declined on two grounds, both measured.**

*Nobody outside `apps/api` **parses** it.* **The first draft of this sentence
said `git grep -ln "dedupeKey\|dedupe_key"` outside that tree "returns
documentation only … and no source", and that is false** — `F3.56`'s post-merge
review re-ran it and got eight non-documentation files: the column declaration
(`packages/db/src/schema/alarms-schema.ts`), three migrations (`0038`, `0065`,
`0066`), `packages/shared/src/contracts/notifications.ts` (added by `F3.56`
itself), and three `tests/` invariants, two of which read `ledger-reads.ts`'s
source and assert it still filters on the column. The doc half was short too:
seven plans, not five, plus `docs/roadmap.md`, which the sentence did not name.

**The conclusion survives the correction, and that is why it is worth stating
precisely.** Not one of those eight **decomposes** the key — they declare the
column, index it, or assert that a reader filters on it. Exposing the key would
therefore still create the **first** client of a grammar that is already load-bearing for two unrelated
purposes: Amendment 5's byte-identity between a raise and its re-offer, and
`RESERVED_KEY_PATTERN`'s segment-count invariant, which is compiled into SQL. A
browser that parses the key becomes a second reader of an invariant that exists
to make ledger rows line up.

*The two options are not information-neutral.* `NotificationDeliveryDto` carries
no severity today. The raw key carries a rule uuid, an alarm uuid **and** the
severity, and would put all three on the wire past the redaction
`ChannelsService.listDeliveries` performs in SQL rather than in its `.map()`,
precisely so a tenant's row never leaves Postgres carrying detail it should not.
A derived kind adds no identifier at all.

### Where the grammar is parsed

In `apps/api/src/notifications/dedupe-key.ts`, beside `buildDedupeKey`, as a new
exported function. The pairing is the point: a key format whose writer and
reader sit in one file can be gated by a round-trip spec over every
`DispatchEvent` shape, where a format read in a second module is a claim about a
file the reader never opens.

### The parse is total, and the proof is an enumeration of writers

`bms.notification_deliveries` has exactly one production insert —
`NotificationsService.record()` (`notifications.service.ts:813`). It has nine
call sites. **Six** are on the dispatch path and pass `buildDedupeKey(...)`,
which returns `string`; all six carry a `DispatchInput`, whose `ruleId` is
`string` and not nullable. **Three** are in `sendTest` and pass the literal
`null`, with `ruleId: null`. No seed and no migration inserts a row — checked
with `git grep -n "notification_deliveries" -- packages/db`, which matches only
the Drizzle journal, the table declaration and its comments. So for every row
this codebase has ever written:

> `dedupe_key IS NULL` ⟺ `rule_id IS NULL` ⟺ the row is a send test.

**A live count was run and is deliberately not offered as evidence.** The shared
stack's ledger holds zero rows, so
`SELECT count(*) … WHERE dedupe_key IS NULL AND rule_id IS NOT NULL` returning
`0` separates nothing. The claim above rests on the source enumeration, and the
amendment says which of the two it is standing on.

**`no-alarm` in a key does not mean "test", and that is the inversion a later
reader will make.** `F3.46`'s transition refusal writes
`<ruleId>:no-alarm:<severity>` with a null `alarm_id`, and a
`skipped_unconfigured` row can predate any alarm. Both are raises. Only a NULL
key is a test.

### The algorithm, and why it is not a segment count

Given a row's `dedupeKey`, `ruleId` and `alarmId`:

1. `dedupeKey === null` → `test`.
2. `ruleId === null` with a non-null key → `unknown` (a shape no writer above
   produces).
3. Strip the prefix the row itself determines: `${ruleId}:${alarmId ?? "no-alarm"}:`.
   A key that does not start with it → `unknown`.
4. On the remainder — which is the severity plus at most one suffix — match
   `:cleared` at the end → `cleared`; `:escalation:<digits>` at the end →
   `escalation`; otherwise → `raise`.

**Counting colons would be wrong, and so would matching the suffix alone.**
`bms.alarm_severities.code` is `varchar(64)` PRIMARY KEY with **no format
CHECK** — the vocabulary is open by design (migration `0030`, ADR 0032). A
severity code containing a colon defeats a segment count; a severity code
literally named `cleared` defeats a bare `/:cleared$/`, because
`rule:alarm:cleared` is a *raise* of a `cleared`-severity alarm. Stripping the
prefix the row supplies removes both, because the two uuids are known values
rather than parsed ones.

**Two residual limits, named rather than claimed away.**

- A severity code whose own text *ends* in `:cleared` or `:escalation:<digits>`
  is still read as that event. The three seeded codes are `info`, `warning` and
  `critical`; a format CHECK on the code belongs to ADR 0032, not here.
- `buildDedupeKey` clamps at 255 characters and cuts the **tail**, so a key long
  enough to lose its suffix reads as a raise. Two uuids, a 64-character severity
  and the longest suffix reach 152, so this needs a rule id that is not a uuid.

### Why the set has five members

Four name the four things a row can be. **`unknown` is unreachable from the
writers enumerated above** and exists so the function is total without lying: a
row whose key does not start with its own rule and alarm was not written by this
code, and calling it a raise would be a claim about a row nothing here produced.
It is driven **directly through the parse function** by that function's own
spec, so it is a measured case rather than dead prose.

### Three things this amendment does not do

- **Staleness is not in the key and is not derived here.** `F3.52` deliberately
  keeps `stale` out of `buildDedupeKey` so that rows earlier ticks wrote under a
  step's key still match. A stale step is an `escalation` event whose `status`
  is `skipped_stale`, and the DTO already carries the status.
- **A retry carries no mark.** A re-offered raise is byte-identical to its
  original by Amendment 5, dedupe key included, so `event` reads `raise` for
  both. That is open row `F3.57`, not a gap in this one.
- **`error` stays null on `sent` and `skipped_deduped` rows.** `event` narrows
  what a `failed` row was *for*; it does not give a successful row prose it
  never had.

### ADR 0057 decision 9 is unchanged

Decision 9 says the kind "lives in the dedupe key, not in a new column", and
that stays exactly true. `event` is a projection computed in the read query's
`.map()`, never a stored value. Nothing on the write path changes and
`notification_deliveries` keeps its shape — which is also why
`tests/adr-0041-notification-invariants.test.ts` must **not** grow a mirror for
the new enum: it compares `notificationDeliveryStatusSchema` against
`notification_deliveries_status_check`, and the event set has no CHECK to
compare against. One enum is closed by the database; the other is closed by a
function.

### Surfaces

- `packages/shared/src/contracts/notifications.ts` — a new
  `notificationDeliveryEventSchema` beside the status enum, and one **flat**
  field on `notificationDeliveryDtoSchema`. Flat because
  `tests/adr-0030-contract-derivation.test.ts` bounds that schema with
  `[\s\S]*?\n\}\);`, which terminates at the object's own close.
- `apps/api/src/notifications/dedupe-key.ts` — the parse, plus its round-trip
  spec against `buildDedupeKey`.
- `apps/api/src/notifications/channels.service.ts` — the `select` gains
  `dedupeKey`, the `.map()` gains the derived value. The key itself is consumed
  in that `.map()` and never returned.
- `apps/web/src/pages/admin/notification-deliveries-page.tsx` — one column
  between **Status** and **Detail**; its spec's `ALL_SIX` fixture gains the
  field.

No migration, no dependency, no change to any write path.

## Amendment 9 — `F3.57`: a re-offered raise carries the alarm's age, and Amendment 5's "byte-identity" sentence was wider than the mechanism (2026-09-10)

`F3.51`'s raise-retry phase re-offers a still-open alarm's ORIGINAL raise: the
same `DispatchInput`, the same subject, the same dedupe key, the same body.
Amendment 5 above recorded that identity as the mechanism and assigned the
missing age marker to `F3.52`, which inherited it and deliberately did not build
it. `F3.57` is that row, and the first thing it did was measure the constraint
it was filed under.

**The constraint is the KEY, not the message.** Three measurements, and any one
of them settles it:

- `buildDedupeKey` takes `ruleId`, `alarmId`, `severity` and `event`. Its own
  docblock has said since `F3.8` that the key is "the rule and the alarm, not
  the message text" — keying on the text would defeat the dedupe on exactly the
  storm it exists to stop.
- `notification_deliveries` has **no body column and no subject column**
  (migration `0038`, unchanged since). Neither text is stored, so neither can be
  matched.
- `loadRaiseAttempts`'s statement matches on `alarm_id`, `organization_id` and
  `dedupe_key`, and `channelsOwedTheRaise` then groups those rows by channel.
  Nothing on that path reads a message.

So a second body under one key orphans nothing. What a marker must still not do
is reach `buildDedupeKey` — a `:retry` suffix or a new `event` kind would, and
that half of Amendment 5's sentence is exactly right and unchanged.

**The subject is unchanged for a different and much narrower reason than either
Amendment 5 or the first draft of this amendment claimed.** `subjectFor`
composes from `severity`, `ruleCode` and `event`, so it could not reach the key
either. This paragraph first said an identical subject lets a mail client
*thread* the re-offer with the original. **The transport establishes no such
thing** (`F3.57` review): `email.transport.ts` calls `sendMail` with `from`,
`to`, `subject` and `text` and sets no `Message-ID`, `In-Reply-To` or
`References`, so nodemailer mints a fresh id per send and there is no RFC 5322
thread to join. What actually survives is that a subject-GROUPING client —
Gmail's conversation view, Outlook's conversation topic — keeps the two
together. That is a receiving client's heuristic, not a property this code
establishes, and it is worth nothing at all on a `webhook` channel, which is the
other transport. Enough to keep the subject stable; not a mechanism.

**The complaint the row was filed with also needed correcting, in two parts.**

*"A recipient cannot tell a retry from a first attempt"* is **narrow, not
general**. `channelsOwedTheRaise` stage 3 blocks on any eligible row that is not
`failed`, so a channel that ever recorded `sent` is never re-offered: the
recipient of a re-offer did not receive the original. It arises only where a
transport reports failure for a message that was in fact delivered — a webhook
that timed out after the endpoint committed, SMTP that accepted and then failed
locally. Real, and not what this amendment is for.

*"Nothing in the message says how long the alarm has been open"* is the real
defect, and its mechanism is worth stating because it is not obvious. A plainly
failing channel writes three `failed` rows and spends `MAX_EVENT_ATTEMPTS` after
about ninety seconds; there is no age problem there. (`raise-retry.ts` says "the
cap is spent inside a minute" of the same mechanism, and both are right about
different instants: the third row lands at t≈60 s, and the tick that reads three
rows and declines to re-offer is the one at t≈90 s. Named here because the two
figures sit in adjacent files describing one thing.) The long deferral exists
**only** because `skipped_rate_limited` (`F3.48` ruling Q2) and stale
`skipped_unconfigured` (`F3.50` ruling Q1) rows are excluded from `eligible` and
so never count toward the cap. Such a channel stays owed for the life of the
alarm and is delivered the moment the ceiling frees or the credential lands — an
hour later, reading as current. **The two rulings that make a deferred delivery
survivable are the same two that make it arrive stale.**

**`F3.52` ruling 8 narrowed one of those two causes and not the other**, and the
`F3.57` row's own text claimed it narrowed the urgency generally. Ruling 8
stopped an unfiltered count charging a RAISE against the reduced limit, so a
raise is now far less likely to be ceiling-refused at all — which shrinks the
`skipped_rate_limited` path. It does nothing to the `skipped_unconfigured` one:
an SMTP password that is not set is not a budget question, and `F3.50` ruling
Q1's watermark is what holds that channel owed until the credential lands. The
hour-old first delivery therefore remains reachable by the second path after
ruling 8, which is what keeps this row worth building rather than closing.

**One accuracy limit, stated rather than claimed away** (`F3.57` security
review). `bms.alarms.raised_at` defaults to the DATABASE clock, and `now`
reaches the sweep from the API process clock (`alarm-lifecycle.service.ts`,
`now: () => Date.now()`). Skew between the two hosts shifts the printed figure.
The sweep already rests on that same pair far more heavily — `dueSteps` and
`stepIsTooLate` decide *whether* to escalate from it, where this decides only a
number in a message — so the exposure is not new and is strictly smaller than
what already depends on it.

### The shape (owner ruling 1, 2026-09-10)

A body-only age clause, composed in `raiseRetryDispatchInput` where the alarm's
`raisedAt` is in scope:

```text
Feeder overload: kw = 150 (gt 100) — alarm open for 62 min
```

- **The subject and the dedupe key are byte-identical to the original raise's.**
- **No threshold constant.** The first re-offer lands one tick after the raise,
  so `Math.floor` gives 0 and "open for 0 min" would be noise on the common case
  while telling the recipient nothing they do not already assume. The clause
  appears exactly when the age is expressible in whole minutes.
- **The composition mirrors `escalationDispatchInput`'s**, which has rendered
  the same figure since `F3.10`. The re-offered raise was the only **first
  delivery** with no age in it. The first draft of this line said "the only
  lifecycle message", which is false and was caught in review:
  `clearedDispatchInput` composes `Cleared: <message>` and carries no age
  either. It keeps none — a cleared alarm has stopped being a problem, so its
  age is history rather than a call to act.
- **The guard is written `minutes >= 1`, not `minutes < 1`.** The two agree on
  every age this code normally sees, which is exactly why the first draft's
  direction survived a mutation and had to be found by review: `NaN < 1` is
  `false`, so an unparseable `raisedAt` rendered `alarm open for NaN min` to a
  real recipient. Every comparison against NaN is false, so the `>= 1` form
  fails closed — NaN and a negative age both yield the message untouched. A
  negative age is reachable, because `raised_at` is stamped by the DATABASE
  clock and `now` arrives from the API process clock.

`runRaiseRetryPhase` gains a required `now: Date`, which the clear and
escalation phases have both carried since `F3.10`; it is required rather than
defaulted for the reason `F3.52` made `stale` required — a defaulted clock lets
the phase drift out of step with the sweep's own `now` and still compile.

**All three shapes the row offered were declined, and what shipped is a fourth**
(`F3.57` compliance review — the first draft of this paragraph said "two of
three", which misread the row's own first option).

- *A field the transport renders but `buildDedupeKey` and `subjectFor` never
  see*, on `F3.52`'s `stale?: true` precedent — declined because it is more than
  is needed. A new field on `DispatchInput` obliges every transport to learn to
  render it. The age is text, and the body is already text nothing reads.
- *A separate follow-up message* — declined because it needs a new
  `DispatchEvent` kind, so a new key suffix, a new subject form,
  `parseDeliveryEvent`, the `NotificationDeliveryEvent` contract and the web
  Event column, an ADR 0030 contract change; and it would double the messages to
  a recipient who never received the first one.
- *Won't-fix* — live until the measurement above, and it rested on a constraint
  that does not exist.

The fourth meets the first shape's constraint — a text no ledger reader sees —
without the first shape's field. **The shipped surface is strictly smaller than
any of the three**: one composed string, no new field, no new kind, no new
column, no contract.

No migration, no dependency, no contract change, no write-path change, and no
change to what any ledger reader matches on.

### What holds it

`alarm-lifecycle.spec.ts` gains **seven** cases, one `it()` each on `F3.52`'s
precedent. Twelve mutations were run and all twelve reddened. §4.6 asks which
assertion reddens, so all twelve are named rather than summarised — the first
draft of this section named two of ten and left the rest an unnamed aggregate
the next reader could not check.

Short names below are the seven unit cases in `alarm-lifecycle.spec.ts` —
`under`, `exactly-1`, `hour`, `key`, `subject`, `future`, `NaN` — plus
**S** = the sweep case in
`alarm-lifecycle-raise-retry.spec.ts`, **I** = the case in
`alarm-lifecycle-raise-retry.integration.spec.ts`, **R** =
`runAlarmLifecycleTests`, **E** = `notifications.events.spec.ts` E18.

| # | Mutation | Reddens |
|---|---|---|
| M1 | `>= 1` → `> 1` (boundary moves) | `exactly-1`, S, I |
| M2 | `>= 1` → `true` (clause always) | `under`, `future`, `NaN` |
| M3 | `>= 1` → `false` (clause never) | `exactly-1`, `hour`, `key`, S, I, R |
| M4 | `>= 1` → `!== 0` (fails OPEN) | **`future`, `NaN` — and nothing else** |
| M5 | `Math.floor` → `Math.ceil` | `under`, S, I, R |
| M6 | `60_000` → `1_000` | `under`, `exactly-1`, `hour`, S, I, R |
| M7 | age measured backwards | `exactly-1`, `hour`, `key`, `future`, S, I, R |
| M8 | builder reads the wall clock | `under`, `exactly-1`, `hour`, `future`, S, I, R |
| M9 | builder drops the age (row reverted) | `exactly-1`, `hour`, `key`, S, I, R |
| M10 | phase passes `new Date()`, not `input.now` | **S and I** |
| M11 | `subjectFor` prefixes a re-offer | `subject`, I, E |
| M12 | an `event` on the re-offered input | `key`, `subject`, R, S, and three I cases |

**M4 is the one that matters most**, and it exists because the review found a
defect ten mutations could not: it reddens the two new clock cases and nothing
else, which is exactly the claim they own. Its predecessor — the shipped
`minutes < 1` — agreed with `minutes === 0` on every age the suite drove, so the
direction of the guard was never gated at all.

**M10 corrects a false sentence in the first draft of this section**, which said
the wall-clock mutation reddens "only the sweep-level case". It reddens **two**:
the unit sweep case and the integration case. The first mutation batch was run
with no `DATABASE_URL`, so the integration spec was skipped and the word "only"
was measured against a suite that never ran. This table was re-measured with the
database attached, and the integration spec is in the runner for that reason.

**Three mutations exist because three assertions were otherwise unproven.**
Nothing in the first batch could make the subject case, the key case or the
guard's direction fail, so they were passing without having been tested. M11,
M12 and M4 are their gates. The subject and key cases still cannot fail from an
age change — neither `subjectFor` nor `buildDedupeKey` can see `message`, by
type — so they are documented invariants with positive controls, not age gates,
and `alarm-lifecycle.spec.ts` says so where they are defined.

`notifications.events.spec.ts` E18 is unchanged behaviourally and stays green:
the age lives in the builder, and `dispatchToChannels` still passes
`input.message` through untouched. Its comment carried Amendment 5's wider
sentence and now carries this one.

## Amendment 10 — `F3.60`: the sweep's rule-channel read is one statement per 500 rules, and "the rule's channels" keeps one definition (2026-09-10)

**Status: Proposed — 2026-09-10.** Awaiting the repository owner's ruling.

Amendment 9's raise-retry phase read a rule's channels through
`ChannelsService.loadForRule`, one round trip per distinct rule with an
evidence-bearing alarm, serially, every 30 s tick. `F3.59` (ADR 0057 Amendment
9) removed the reads that were *dead*; this row is the *count* of the ones that
remain. They are now `ceil(distinct evidenced rules / RULE_CHANNEL_BATCH_SIZE)`
statements.

### The measurement, with every conditional it carries

Taken on `main` at `13b32232`, read-only, as `bms_fleet` from inside
`bms-api-1` over the docker network, over the 78 distinct rules of the 78 open
unacknowledged alarms this stack held:

| Probe (three runs) | Result |
|---|---|
| round-trip floor — `select 1` × 78, sequential | 83 · 132 · 94 ms |
| sequential `loadForRule` × 78 — the old shape | 135 · 131 · 125 ms |
| one batched statement over the same 78 ids | 3.6 · 2.9 · 2.6 ms |

Four things that measurement does **not** say, each recorded because a row in
this series has been closed on exactly this kind of unconditional sentence:

- **Both timed queries returned zero rows.** The stack held 0
  `notification_channels`, 0 `rule_notifications` and 0
  `notification_deliveries`, so the statement cost is approximately nothing and
  what the probe compares is the round-trip **hop**. That is the stronger claim
  rather than the weaker one: the hop does not shrink on a configured fleet,
  and the statement cost only grows.
- **On that stack the read is not reached at all.** Since `F3.59` the evidence
  guard returns before it, and with no delivery rows no candidate holds
  evidence. The ~130 ms is what a **configured** fleet pays once raises send —
  0.43% of the 30 s tick at 78 rules, linear in distinct evidenced rules, while
  the batched read is constant.
- **`F3.59`'s own figures (183–200 / 2.5–4.1 / 81–90 ms) are not corrected by
  these.** Different day, unknown load, three runs each. Only the ratio is
  stable across the two samples: **~40–50×**.
- **The shared stack moved 15 minutes later**, to 105 channels and 105
  `rule_notifications`, when the concurrent `E8.4` session committed them. These
  figures are timestamped, not current.

### What was decided

1. **The read is a module function in `channel-reads.ts`**, not the
   `ChannelsService.loadForRules` the backlog row sketches.
   `channels.service.ts` stands at 964 of AGENTS.md §4.5's 1000 lines, and a
   batching loop with a failure shape and a docblock in this repository's style
   was estimated at 80–120 lines. **About 150 landed** — `channel-reads.ts` went
   from 44 to 220 — and the estimate is corrected rather than quietly left,
   because the conclusion never depended on it: 964 plus even 37 breaks the cap.
   That is the same reason `channel-reads.ts` itself exists (its
   header records `channels.service.ts` at 986 when `F3.10` wrote it) and the
   reason `raise-attempts.ts` is "a module function, not a service method". The
   sketch is followed in everything but its home.
2. **The contract is `byRule` / `unread` / `reasons`**, mirroring
   `RaiseAttemptsRead` — which Amendment 5's review introduced for the same
   reason: a failing batch must cost only the rows it bound, so one noisy
   tenant's volume cannot disable the phase for the whole fleet. An absent group
   and an unread rule mean opposite things, so the difference is a field rather
   than an inference.
3. **The statement is `loadForRule`'s** — same join, same `enabled = true`
   filter, same ten columns, same `ORDER BY notification_channels.code` — plus
   `rule_notifications.rule_id` so the rows can be grouped, and grouping is by
   insertion so each rule's slice keeps the statement's order. Decision 8's
   decryption stays in `ChannelsService.toChannelRow`, which the sweep's adapter
   applies; `dispatch()` is unchanged and still calls `loadForRule`. Case CI4
   asserts the two lists id-for-id, so "one definition" is measured.
4. **De-duplication runs over the whole id list before the slicing**, which is
   the one place this differs from `raiseAttemptBatches`. A rule id landing in
   two batches would be grouped twice and its channels offered twice — a
   duplicate send, the failure `F3.51` exists to stop. `raiseAttemptBatches`
   never faced it because the phase builds one ref per alarm.
5. **`RULE_CHANNEL_BATCH_SIZE = 500` is its own constant**, not a reuse of
   `RAISE_ATTEMPT_BATCH_SIZE`, which holds the same number by coincidence: that
   one binds roughly two parameters per alarm across three `IN` lists. Here the
   pessimal bind count is `500 + 1` against the extended protocol's 65 535.
6. **`reasonOf` is exported from `raise-attempts.ts` rather than copied**, for
   the reasons and with the limits below — the limits matter, because there are
   **three** functions of that name in this codebase with three different
   bounds, and the security pass caught an earlier draft of this decision
   implying otherwise.

   - `raise-attempts.ts`'s bounds to **200 characters**. `channel-reads.ts` now
     imports that one, so the two module reads that fill `reasons` share a
     single bound and cannot drift apart. That is the whole of what this
     decision changes.
   - `ledger-text.ts`'s bounds a **database column** and is a different number.
     It is untouched.
   - `alarm-lifecycle-phases.ts`'s is **unbounded**, and `F3.60`'s own
     phase-level warn line uses it, as do the five warn lines that were already
     in that file. **That is deliberate and it is not a regression**: bounding
     one of six would make the new line the odd one out, and bounding all six is
     a different row. The cause on that path is a raw driver message reached
     only when the whole read rejects — `loadEnabledChannelsForRules` catches
     per batch and `toChannelRow` never throws — so it carries no SQL text, no
     bind parameters and no ciphertext on `drizzle-orm@0.38.4`. A driver upgrade
     that started wrapping queries would remove that protection, which is the
     reason to record it here rather than to leave it unsaid.

### What gates it

C1–C7 over a fake database, CI1–CI6 against a real one, one `it()` per case in
both. Thirteen mutations were run — not reasoned about — and all thirteen
killed, two of them only after a case was added for them. Four are recorded
rather than claimed:

- **M9** (`RULE_CHANNEL_BATCH_SIZE = 70_000`) reddens **only C6**. C1 is
  expressed in terms of the constant, so it stays invariant. The plan predicted
  C1 would redden too; it does not.
- **M11** (the `ORDER BY` dropped) reddens CI2 **and** CI4, and the honest
  reading is that neither is stronger than the other for this mutant. The
  mutation leaves `ChannelsService.loadForRule`'s own `ORDER BY` in place, so
  CI4's id-for-id comparison diverges on exactly the condition CI2 diverges on —
  heap order differs from code order — and coincides on exactly the condition
  CI2 coincides on. A heap order is unspecified, so **the clause is unheld
  against a heap order that happens to agree**, in both cases. What CI4 holds
  order-independently is the other half: that the join and the `enabled` filter
  are `loadForRule`'s. An earlier draft of this bullet claimed CI4 rescued the
  ordering claim; the compliance pass showed it does not, and the mutation run
  had already printed both case names.
- **M12** (the `WHERE rule_id IN (…)` dropped) **survived the first pass**, and
  the reason is worth keeping: the projection carries `rule_id` and the caller
  groups on it, so removing the filter changes no decision the phase makes — it
  returns every rule's channels on the whole fleet, in every batch, every tick,
  which is the opposite of this row's purpose. Every other case stayed green.
  CI5 was added for it and kills it.
- **M26** (each statement binds the whole de-duplicated list instead of its own
  batch) **survived all eighteen cases**, and the correctness pass found it. The
  unit fake discards the argument it is handed, and every integration fixture
  passed at most three rule ids — one batch, where `batch` already equals the
  whole list, so the mutant was the identity. Above 500 evidenced rules it makes
  each of the N statements return every rule's channels and each group hold N
  copies of every channel; nothing downstream de-duplicates, so a doubled group
  is a doubled offer to the same channel. `loadEnabledChannelsForRules` now
  takes `size` for the sole purpose of letting a case drive two batches against
  a real database. CI6 does, and kills it — measured, printing
  `r1=[c1,c2,c1,c2]`.
