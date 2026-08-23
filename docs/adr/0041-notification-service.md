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
