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
the `(alarm, channel, raise key)` triples whose insert threw and stops
re-offering them. The reasoning, the cap and the eviction rule are in ADR 0057
Amendment 5 §2; what belongs here is the shape and the two constraints it was
built under.

**`rowLost`, and deliberately not `written`.** The three exits above write no
row **by design**, and a caller that read those as lost rows would stop
re-offering a ceiling-refused raise — undoing `F3.48` on the raise path, which
is the exception this very amendment adds. `rowLost` is true in exactly one
case: an insert was attempted and it threw. The exits that conserve a key
report `false`, because nothing was lost there.

**The bound is in process, not in the ledger, and that is forced.** A bound
that survived a restart would have to be a row, and a row is exactly what could
not be written. A restart clears it and the retry resumes as if the losses had
not happened — the treatment `PROCESS_STARTED_AT` already gives the
unconfigured watermark.

**Two placements this review also settled.** `MAX_EVENT_ATTEMPTS` and
`offeredAgainWithoutAsking` moved out of `notifications.service.ts` into
`notifications/dispatch-policy.ts`, with `DispatchOutcome`: the file stood at
958 of AGENTS.md §4.5's 1000-line cap and what moved is the part that needs
nothing from the class. There is deliberately **no re-export** — two import
paths for one constant is the drift shape this repository keeps finding. And
`dispatchToChannel`'s exits gained a `channelId` on every result, because
`dispatchToChannels` drops channels from another organization (M2) and the
results are therefore not index-aligned with the list a caller passed.
