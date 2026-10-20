# ADR 0099 — A site-wide copilot for administrators (`F3.85`–`F3.87`)

## Status

**Accepted — 2026-10-10** (owner, with all ten drafter choices below
confirmed as written, after reviewing seven UX mockup screens of the flows in
decisions 1–6 and 10–11). Source: owner rulings 2026-10-10, twenty questions
put one at a time. Rulings 1–16 shaped the first draft. A security review and
an `AGENTS.md` compliance review of that draft found four conflicts with
earlier rulings or accepted records; rulings 17–20 settled them. Every ruling
is tabled below with whether it followed the recommendation. Where a decision
needs a detail the rulings do not give, the detail is listed under *Drafter
choices (not asked)* for the owner to confirm at acceptance. Drafted before
any implementation code. Code citations are to `main` at `1f9b8760`.

**Promotes out of `AGENTS.md` §6** the item *"General site-wide AI Copilot /
chatbot"* and relaxes rule 15, **for the four administrator roles only**.
Operators and viewers stay without a copilot. The `AGENTS.md` and
`docs/roadmap.md` edits land in a separate `chore(agents):` PR after this
record is accepted (§9.10, §10); every location is listed under *Promotion
bookkeeping*.

Creates rows `F3.85` (release 1), `F3.86` (release 2) and `F3.87` (release 3)
in Track E.

**Amended 2026-10-10 — Amendment 1** (owner-approved; the `F3.85` plan-gate
rulings Q2, Q3 and Q8): the usage counters, the day boundary, and the reading
of "access only narrows". Where Amendment 1 conflicts with the text above, it
wins.

**Amended 2026-10-13 — Amendment 2** (owner-approved; the `F4.255` plan
gate): a draft onboarding session can be resumed from the dock, and one
untouched for 30 days is erased by the purge tick. Where Amendment 2
conflicts with decisions 7 and 8 above, it wins. A note of
2026-10-14 (owner) adds the draft list's home-organization default.

**Amended 2026-10-15 — Amendment 3** (owner-approved 2026-10-15, with its
four drafter choices; owner rulings Q1–Q8 of the same day): release 3
(`F3.87`) — the mimic catalog entries, drawing a layout by conversation, and
building a mimic from an attached image or PDF. Where Amendment 3 conflicts
with the decisions above or with Amendments 1 and 2, it wins.

**Amendment 4 — Proposed — owner ruled 2026-10-20/21; the merge approves the
text** (`F4.245`): `fill_step` names the record it fills and the server
checks it against the wizards open on the user's screen. Where Amendment 4
conflicts with decision 6 or with Amendments 1–3, it wins; decision 10 stands.

| # | Question | Options put | Ruled | Decision |
| --- | --- | --- | --- | --- |
| 1 | Copilot or narrow assistant | narrow admin assistant; general copilot; no change | **general copilot** (owner's own choice) | 1 |
| 2 | Scope of release 1 | admin + read-only Q&A; + operator writes; admin only; everything | **admin writes + read-only Q&A and navigation, for `admin`, `organization_admin`, `location_admin`, `asset_group_admin` only**, covering dashboards, templates, KPIs, mimics and every other admin object (owner's wording, close to the recommendation) | 1 |
| 3 | Confirm model | one change set; every change; deletes only | **every single change** (not the recommendation) | 4 |
| 4 | Wizard and copilot | stepper + panel; chat only; keep forms | **stepper + panel** (recommended) | 6 |
| 5 | Delete | deactivate only; delete and deactivate; neither | **deactivate yes, hard delete no** (recommended; see 19) | 3 |
| 6 | Users and grants | yes inside own limits; read only; global admin only | **yes, inside own limits** (recommended; see 17, 20) | 3 |
| 7 | Onboarding agent | copilot skill; separate; merge later | **copilot skill** (recommended) | 7 |
| 8 | Onboarding Confirm | draft free + one commit Confirm; tick each; write each | **draft free, one commit Confirm** (recommended) | 7 |
| 9 | History | per user 30 days; session only; forever | **per user, 30 days** (recommended) | 8 |
| 10 | Keys | org rule / platform for global; platform for all; org always | **org rule for scoped admins, platform for the global admin** (recommended; see 12) | 10 |
| 11 | What "one change" is | one API write; one object; one task | **one API write = one Confirm** (recommended) | 4 |
| 12 | Global admin inside an organization | that org's rule; platform always; refuse | **that organization's rule** (recommended) | 10 |
| 13 | Out-of-scope items for release 1 | usage limits; streaming; platform setting UI; live model lists | **usage limits only** (recommended) | 11 |
| 14 | Approach | real REST call on Confirm; in-process catalog; drafts everywhere | **A, real REST call on Confirm** (recommended) | 4 |
| 15 | Availability | org + role + user exceptions; org + role; org + user | **org switch, role switches, named-user exceptions; new organizations off** (recommended) | 5 |
| 16 | First release area | dashboards/templates/KPIs; master data; mimics | **dashboards, templates, KPIs first; master data, then mimics** (recommended) | 12 |
| 17 | A copilot-created user's first password | typed on the Confirm card; Users page only; invite email | **typed on the Confirm card, never seen by the model** (recommended) | 3 |
| 18 | KPI content and calc DSL from the copilot | validated and confirmed; copilot suggests, admin types; defer | **yes, parsed by the DSL parser and shown in full** (recommended) | 3 |
| 19 | Grant and membership removal (DELETE routes) | access removals only; no DELETE; all DELETEs | **only grant revoke and group-member removal** (recommended) | 3 |
| 20 | Limits on access changes | never global admin + user must ask; user must ask; as ruled | **never grant global `admin`; only when the admin's own message asked** (recommended) | 3, 9 |

## Context

**What exists.** The onboarding agent (ADR 0011, ADR 0090–0095) is a
tool-calling loop over one onboarding draft, on three providers, with
per-organization keys in `bms.organization_llm_settings` (ADR 0090
Amendment 1), checkpoints and step undo (ADR 0094), a guided mode with no LLM
(ADR 0090 Amendment 2) and a credential refusal (ADR 0022). It runs only inside
`/admin/onboarding`, only for `admin` and `organization_admin`
(`onboarding.service.ts:703`). Its commit is bound to the draft the admin saw:
`commitProposed(jwt, sessionId, expectedDraftHash)`
(`onboarding-commit.service.ts:154`). `AGENTS.md` rule 15 and §6 keep a general
copilot out.

**What the owner asks.** One copilot for the administrators across the site:
it answers questions about live data, opens pages, and does admin writes on the
admin's instruction; every admin add/edit form becomes a step-by-step wizard
with the copilot beside it.

**What decides the design.**

- The write checks are in the controllers, not the services:
  `dashboard-builder.controller.ts` runs
  `accessControl.assertOperationsWriteRole(user, "configuration")` and
  `parse(createDashboardBodySchema, body)` before `dashboards.create(...)`. A
  copilot that called services in-process would skip them.
- A dashboard saves all its widgets in one call
  (`PUT /api/v1/dashboards/:id/widgets`), so "one change" is the API write.
- Many write body schemas live in `apps/api`, not `packages/shared`:
  `createDashboardBodySchema` and `putDashboardWidgetsBodySchema`
  (`apps/api/src/dashboard-builder/dashboards.schema.ts:171,970`), the
  dashboard-template bodies (`dashboard-templates.schema.ts:155,196`), the
  asset-template bodies (`asset-templates.schema.ts:365,389`).
- `POST /api/v1/admin/users` requires a `temporaryPassword`
  (`packages/shared/src/contracts/users.ts:55`); ADR 0089 Q3 chose a typed
  temporary password over an email link, and no email path exists.
- The global admin's reads run as `bms_fleet`, which has `BYPASSRLS`
  (`packages/db/drizzle/0039_tenant_roles_and_grants.sql:33`); a fleet-wide read
  has no organization filter (`apps/api/src/database/tenant-read-scope.ts:40`).

## Decision

### 1. Scope: administrators, admin writes, read-only Q&A

The copilot is offered to `admin`, `organization_admin`, `location_admin` and
`asset_group_admin` (`packages/shared/src/contracts/auth.ts`), and only to a
user with a provisioned `bms.users` row whose **database** role is one of the
four. The JWT role alone never qualifies (`resolveDbUser` falls back to the
token for an unprovisioned non-admin, `access-control.service.ts:903`). It
can:

- answer questions about data the user can read (alarms, readings, KPIs,
  health, assets, locations, dashboards) — read only;
- name and open the page that shows something;
- propose any write in the action catalog (decision 3), within the user's own
  scope.

It cannot: acknowledge, clear or edit alarms or work orders; send a device
command; hard-delete (except decision 3's two removals); take a credential;
grant the global `admin` role; change any copilot availability, usage limit or
AI key setting.

### 2. One action catalog drives the copilot and the wizards

**Before the catalog:** every body schema a release-1 entry uses moves from
`apps/api` to `packages/shared/src/contracts/` (ADR 0030), and the controllers
import it from there. `F4.150` (split `contracts/admin.ts`) lands first. The
catalog lives in `packages/shared/src/copilot/`, so the API and the web read
the same entries.

| Field | Meaning |
| --- | --- |
| `id` | stable name, e.g. `dashboard.create`, `dashboardTemplate.publish` |
| `method`, `path` | the existing REST route, e.g. `POST /api/v1/dashboards`, `POST /api/v1/admin/dashboard-templates/:id/publish` |
| `body` | the **existing** Zod body contract the controller parses — imported, never copied |
| `clientOnly` | body fields the browser adds at Confirm and the model never sees (decision 3) |
| `risk` | `create` · `edit` · `deactivate` · `access` |
| `summary` | renders the Confirm card text from the body **and the resolved path**, naming each target by name and code, not only by id |
| `steps` | field groups for the wizard (decision 6) |

The propose tools and the wizards are generated from the catalog. A coverage
spec fails when an in-release admin write route has neither an entry nor a
place on the **exclusion list**, when an entry's `body` is not the schema its
controller parses, or when an entry is a `DELETE` other than decision 3's two.

**Exclusion list** (never in the catalog): the AI key routes
(`/api/v1/admin/organizations/:orgId/ai-assistant`, which carry `apiKey`); the
copilot availability and usage routes; `POST /api/v1/admin/users/:id/temporary-password`;
every hard `DELETE` not named in decision 3.

### 3. What the catalog may hold

- Create, edit, publish, archive, instantiate, apply and deactivate routes.
- **No hard delete** (ruling 5), with two exceptions (ruling 19), each with its
  own red Confirm: revoking a grant
  (`DELETE /api/v1/admin/users/:id/grants/:kind/:grantId`) and removing an
  asset-group member. The other `DELETE` routes stay manual: dashboards,
  dashboard templates, asset templates, calc parameters, calc-point overrides
  and the AI key.
- **KPIs and calc formulas** (ruling 18; amends ADR 0091 for the copilot): the
  copilot may propose a template's KPI content and calc DSL formulas. The
  server runs the existing DSL parser on every formula before the card shows,
  and the card shows each formula in full. The onboarding skill keeps ADR
  0091's rule.
- **Users and grants** (rulings 6, 17, 20), release 2, `risk: "access"`:
  - ADR 0089's checks decide what an admin may grant.
  - `temporaryPassword` is a `clientOnly` field: the Confirm card shows a
    password box; the browser adds the value to the real call. It never reaches
    the model, `fill_step`, the pending-change row or the history, and the body
    hash is taken without it.
  - Promotion to the global `admin` role is outside the copilot; the Users page
    keeps it.
  - An access change is proposed only when the admin's **own message** in that
    turn asked for one; never in an automatic follow-up turn (decision 4.7) and
    never from a turn whose request came from a tool result.
- **Onboarding's commit** (release 2) as one entry (decision 7).

### 4. Propose, then Confirm: the model never writes

1. The model calls a propose tool with a body.
2. The server parses the body with the entry's Zod schema (and, for a formula,
   the DSL parser). A failure goes back to the model as the tool result.
3. On success the server stores a row in `bms.copilot_pending_changes` (user,
   conversation, catalog id, method, resolved path, body without `clientOnly`
   fields, SHA-256 of the canonical body, summary, `status = 'pending'`,
   expiry) and the reply carries a Confirm card.
4. The card shows a readable diff and names each target. Deactivate and
   removal cards are red; access cards are marked "access change".
5. **Confirm**: the browser sends the real REST call with the user's own token
   and the header `X-Copilot-Change: <id>`. A **global interceptor** handles
   the header (a request without it passes untouched, so no catalog route can
   miss the check):
   - It re-checks the caller first: a provisioned row, one of the four roles in
     the database, copilot availability now (decision 5). A demoted or switched
     off admin cannot use a change proposed earlier.
   - It **claims the change atomically before the controller runs**:
     `UPDATE bms.copilot_pending_changes SET status = 'applying' WHERE id = $1
     AND user_id = $2 AND status = 'pending' AND expires_at > now()
     RETURNING method, path, body_hash`. No row → 409 (used, expired or
     another user's change; the response does not say which). Two fast clicks
     therefore apply once: **the change id is the idempotency key**.
   - It checks that the request's **method, resolved path and canonical body
     hash** (without `clientOnly` fields) all equal the claimed row; a mismatch
     sets the row back to `pending` and refuses with 409.
   - The controller then runs unchanged — every role check, Zod parse, RLS
     policy and audit write. The interceptor puts `{ via: "copilot", changeId }`
     in a request-scoped context (`AsyncLocalStorage`), and **every writer of
     `bms.audit_log`** adds it to the row's `payload`: `master-data-audit.service.ts`,
     and the direct writers the plan enumerates by the insert call (today
     including `asset-templates.service.ts` and `calc-write.service.ts`).
   - On the way out it records, **server side**, the HTTP status and, for a
     2xx, the created or updated resource id, and sets the row to `applied` or
     `failed`. A sweeper sets a row stuck in `applying` for more than five
     minutes to `failed`. The browser never reports the result.
6. **Reject** marks the row `rejected` and tells the model.
7. **One API write = one Confirm** (rulings 3, 11). A task that needs several
   writes gets one card per write, in order. When a change reaches `applied` or
   `failed`, the **API process that recorded it** starts the next model turn
   with the outcome (status and resource id) as the tool result. That turn
   re-runs every turn check (decision 4.5's caller check, decision 10's key
   resolution, decision 11's limit) and counts as one turn; it runs under the
   same per-turn caps as a user turn (ADR 0090 decision 3), and it **cannot
   propose an access change** (ruling 20). A later write is never proposed
   before the earlier one is applied.
8. A 4xx or 5xx from the real call is shown on the card and returned to the
   model. Only confirmed writes are applied.
9. **Stale diff (accepted residual):** the card shows the state at proposal
   time. A `PUT` that replaces a list can overwrite a concurrent edit made
   after the card was shown; no `If-Match` exists today. The card says when it
   was proposed, and the 15-minute expiry bounds the window.

The header binds the audit mark and the idempotency to what the admin saw. A
user can send any body by hand without it, as today; the copilot adds no power
the user's token does not already have.

### 5. Availability: organization switch, role switches, named exceptions

- `bms.copilot_org_settings (organization_id PK, enabled bool, …)` — written by
  the global admin only. A new organization starts **off** (ruling 15).
- `bms.copilot_role_settings (organization_id, role, enabled)` for
  `location_admin` and `asset_group_admin` (a `CHECK` on the role) — written by
  the organization admin and the global admin.
- `bms.copilot_user_overrides (organization_id, user_id, allow bool)` — named
  exceptions, same writers. An override is evaluated against the user's
  **current** database role and home organization: it never reaches an
  `operator`, a `viewer`, a user since demoted, or a user of another
  organization.
- The organization admin has the copilot whenever the organization switch is
  on. The global admin has it for cross-organization work, and inside one
  organization only when that organization's switch is on (drafter choice 7).
- Access only narrows down the chain.
- Screens: a switch per organization on the global admin's Organizations page;
  a *Copilot access* section on the organization's AI settings page.
- Every copilot route and the interceptor check availability on the server;
  hiding the dock is not the protection.

### 6. The wizard shell

Every admin add/edit form becomes a stepper built from the entry's `steps`
(Basics → … → Review). A copilot panel sits beside it. The model can call
`fill_step`, which returns field values for the current step (never a
`clientOnly` field) and writes nothing; the fields fill on screen and the admin
checks them before Next. The Review step is the Confirm card of decision 4 —
one wizard submission is one write. With no key, or the copilot off for the
user, the wizard works alone.

### 7. Onboarding becomes a copilot skill

The onboarding loop, tools, draft, checkpoints (ADR 0094) and guided mode move
under the copilot as one skill ("onboard a site"). The skill keeps its role
gate: `admin` and `organization_admin` only. Draft edits write nothing and need
no Confirm; undo stays. The commit is one catalog entry with one Confirm and
stays one transaction (ruling 8). **The commit entry carries the draft hash**
the card was built from and goes through `commitProposed`
(`onboarding-commit.service.ts:154`), so a draft changed after the card was
shown is refused (ADR 0090 decision 5 and its note are kept). The Confirm
button replaces the typed "confirm commit" phrase. `/admin/onboarding` retires
only after the skill passes the existing onboarding suites unchanged in
behaviour.

### 8. History: per user, 30 days

- `bms.copilot_conversations`, `bms.copilot_messages`,
  `bms.copilot_pending_changes` and `bms.copilot_usage`, keyed by the
  **database** user id.
- **Per-user RLS that does not depend on the organization**: the API sets a new
  `app.current_user` setting (amends ADR 0043 decision 10), and each policy
  requires `user_id = current_setting('app.current_user')::uuid`; with the
  setting unset the policy matches nothing.
- **`bms_fleet` gets no grant on these tables**: the migration revokes what
  migration `0041`'s default privileges grant it (ADR 0090's correction of
  2026-10-03 records that they reach `bms_fleet` with `arwd`), because its
  `BYPASSRLS` would defeat the policy. This departs from the `0094` pattern on
  purpose. The global admin's copilot reads and
  writes them through `bms_tenant` with `app.current_user` set, like every
  other user.
- A worker job erases conversations whose last turn is older than 30 days, with
  their messages and their unapplied pending changes (drafter choice 8). The
  audit log keeps every applied change.
- Who can still read the rows: the database superuser only. (`bms_owner` is
  bound by FORCE RLS.)

### 9. Security rules

- The model has no write path (decision 4).
- **Read tools run with the user's own read scope** — the same
  `readableAssetIds` and `resolveTenantReadScope` the user's pages use. For the
  global admin that scope is fleet-wide, so decision 10 narrows it further.
- **Read tools return only `packages/shared` contract DTOs**, never raw rows
  (raw rows hold RTU ciphertext, `key_last4` and `oidc_subject`). History and
  tool results pass `scrubMessages`.
- Tenant free text (asset names, location names, alarm text) reaches the model
  as data only; the system prompt says so. The per-write Confirm enforced on
  the server, cards that name their targets, and ruling 20's limits on access
  changes are the defence against prompt injection.
- The ADR 0022 credential refusal runs on every turn; the secret scrub runs on
  every reply; no prompt or reply text is logged (§9.6).

### 10. Which key a turn uses, and which data it may send

- A scoped admin: its organization's rule, exactly as ADR 0090 Amendment 1
  (own row → own key, or guided mode when the row has no key; no row →
  platform key).
- The global admin inside one organization: **that organization's rule**
  (ruling 12). "Inside one organization" is decided **on the server** from the
  conversation's bound organization, never from a page context the client
  sends.
- **A turn binds one key scope.** Its read tools return data only from
  organizations that resolve to that same key and whose copilot switch is on.
  A cross-organization turn by the global admin on the platform key therefore
  reads only organizations with no AI row of their own and the switch on; an
  organization with its own key, or in guided mode, is excluded and never sent
  (ADR 0090 Amendment 1's "an organization row never uses the platform key").
  The same rule binds a scoped admin who holds grants in several
  organizations.
- No key resolved: the panel says the assistant is not configured; wizards and
  read pages work.

### 11. Usage limits

`bms.copilot_usage (user_id, organization_id, day, turns)`. A turn — including
an automatic follow-up turn — over the user's or the organization's daily
limit is refused before any model call, with a message naming the reset time.
The limits are configuration (drafter choice 2). Streaming replies, a platform
AI settings screen and live model lists stay out of scope.

### 12. Releases

| Row | Release | Holds |
| --- | --- | --- |
| `F3.85` | 1 | `F4.150` first; the body schemas moved to `packages/shared`; a shared `llm/` core moved out of onboarding; the copilot module, dock, availability, usage limits, history, read-only Q&A; catalog entries and wizards for **dashboards, dashboard templates and KPIs** |
| `F3.86` | 2 | master data: locations, RTUs, assets, asset groups, point keys, asset points, users and grants; the onboarding skill (decision 7) |
| `F3.87` | 3 | plant and network mimics and symbol libraries — drawing by conversation gets its own amendment of this record before build |

Release 1's KPI entries are the KPI writes that exist today: the KPI tier of an
asset template's draft content (`PATCH /api/v1/admin/asset-templates/:id`, then
`POST /api/v1/admin/asset-templates/:id/publish`), the calc-point override
(`PUT /api/v1/admin/assets/:assetId/calc-points/:pointKey`), and calc
parameters (`POST /api/v1/admin/calc-parameters`,
`PATCH /api/v1/admin/calc-parameters/:id`). The plan confirms each route before
it adds an entry.

Network mimics beyond the `lv_single_line` preset do not exist yet (`F3.80`);
the copilot gains them through the catalog when that row ships.

## Not in this ADR

- Operator and viewer use of the copilot; operator writes; device commands.
- Hard deletes other than decision 3's two removals.
- Granting the global `admin` role.
- Streaming replies, a platform AI settings screen, live model lists.
- An invite email for new users (ADR 0089 Q3 stands).
- `If-Match` / optimistic concurrency on list `PUT`s (decision 4.9).
- Mimic drawing by conversation (release 3 needs its own amendment).

## Amends and relates to

- **ADR 0011** decision 6 ("general site copilot … remains deferred") — the
  copilot is promoted for administrators.
- **ADR 0090** — its status line ("promotes nothing out of §6") and decision 2
  (the loop runs inside onboarding's `/chat`) give way to decision 7; decision
  3's caps apply to every copilot turn, including automatic ones; decision 5's
  draft-hash commit is kept (decision 7); Amendment 1's key rule is kept for
  scoped admins and extended for the global admin (decision 10); the
  *Deferred* item "per-organization cost limits" is answered in part by
  decision 11.
- **ADR 0091** — its deferral of chat authoring of template KPIs and its "the
  model never writes calc DSL" no longer bind the copilot (ruling 18); they
  still bind the onboarding skill.
- **ADR 0094** — checkpoints and step undo are reused unchanged inside the
  onboarding skill.
- **ADR 0089** — grant rules apply unchanged; the typed temporary password of
  Q3 is kept and typed on the Confirm card (ruling 17).
- **ADR 0043** decision 10 — a second session setting, `app.current_user`,
  beside `app.current_organization`, for the copilot tables only.
- **ADR 0022** — the credential refusal applies to every copilot turn.
- **ADR 0030** — the moved body schemas become shared contracts.

## Promotion bookkeeping (for the `chore(agents):` PR)

- `AGENTS.md` rule 15 (line 1293) and the §6 copilot item (line 3724), with its
  "per-organization cost limits" sub-item (line 3731).
- The status-line mentions at `AGENTS.md` lines 1157 and 1234, and the §6 prose
  at line 3781.
- `docs/roadmap.md` lines 5061 and 5121 ("AI Copilot … deferred").

## Drafter choices (not asked)

1. A pending change expires **15 minutes** after it is proposed.
2. Default usage limits: **150 turns per user per day** and **1,500 turns per
   organization per day**, set by `COPILOT_USER_DAILY_TURNS` and
   `COPILOT_ORG_DAILY_TURNS`; a cross-organization turn counts against the user
   limit only.
3. **The dock follows the mockup:** a floating copilot button with a slide-out
   panel, as `ESKOM_SMOC.html` draws it (`#aiFab`, `toggleAI()`, lines
   325–332). The stepper has no mockup; it uses the existing admin page frame
   and the §5 tokens.
4. The `via` audit mark goes in `bms.audit_log.payload` (no new column), through
   the request context of decision 4.5.
5. The canonical body hash is SHA-256 over the JSON with sorted keys.
6. Rows `F3.85`–`F3.87` sit in Track E; `F3.85` is P1, `F3.86` P1, `F3.87` P2.
7. **The global admin inside an organization whose switch is off** gets no
   copilot there; ruling 12 makes the organization's rule bind the global
   admin.
8. The 30-day erase deletes conversations, messages and **unapplied** pending
   changes. Applied and failed change rows are kept (without conversation
   text) because `bms.audit_log` names them by change id; there is no foreign
   key from the audit row.
9. **Accepted residual risk:** read-only answers carry no Confirm, so tenant
   free text can still steer what an answer *says* (not what it writes). The
   answer cites the record it read, so an admin can open it and check.
10. `F4.21`'s idempotency keys do not block release 1 because of the atomic
    claim in decision 4; when `F4.21` lands, the change id is passed as its key.

## Dependencies

None. The providers already use `openai` and `@anthropic-ai/sdk`
(`apps/api/package.json`). No new npm package.

## Consequences

- One write path for people and for the copilot: every guard keeps its single
  home in the controller, at the cost of one Confirm per API write.
- Release 1 moves several body schemas from `apps/api` to `packages/shared`
  before any copilot code.
- Every admin form is rebuilt as a stepper over three releases; the coverage
  spec keeps an unconverted write route visible.
- A copilot conversation sends tenant data to an LLM provider for every
  organization that enables it; an organization keeps control through its
  switch, its key and guided mode, and decision 10 keeps a turn from mixing
  organizations with different key rules.
- The copilot can add and remove grants, but cannot grant the global `admin`
  role.
- `F4.17` (rate limits) and `F4.21` (error envelope, idempotency keys) gain
  weight; neither blocks release 1 (drafter choice 10).
- `F4.7` (Playwright E2E) should land before release 2, when the master-data
  forms change.

## Verification owed

- Unit: catalog coverage (exclusion list; no `DELETE` except the two removals;
  every entry's body is its controller's schema; no `clientOnly` field reaches
  a tool schema); availability rules, including overrides against the current
  role; usage limiter; key-scope binding.
- Loop: fake-provider specs, as onboarding has today, including an injected
  instruction in an asset name that asks for an access change (refused).
- Integration: the `X-Copilot-Change` interceptor (another user's, expired or
  used change 409; changed body, path or method 409; two concurrent Confirms
  apply once; demoted or switched-off user refused; the resource id recorded
  server side); per-user RLS on every copilot table, **including the global
  admin's path, with `bms_fleet` refused**; a cross-organization turn that
  excludes an organization with its own key; the onboarding commit refused
  after a draft change.
- Mutation runs on every guard.
- Live stack: the dock shows only for enabled administrator roles; a confirmed
  dashboard create and widget save write audit rows whose payload names the
  copilot change; a rejected card writes nothing; an operator sees no dock and
  gets 403 from every copilot route.

## Amendment 1 — usage counters, the day boundary, and Q2 (owner, 2026-10-10)

The `F3.85` step-3 plan (`docs/plans/f3.85-admin-copilot-release-1.md`, §0)
found that decision 11's one usage table cannot work under decision 8's
per-user policy, and asked the owner three questions this record left open.
The owner ruled each one at the plan gate on 2026-10-10 (Q8 against the
plan's recommendation) and approved this amendment the same day. Each item names the decision or choice whose text it changes.

- **A1 — Decision 11 and decision 8: two counter tables (Q3).** Decision 11's
  `bms.copilot_usage (user_id, organization_id, day, turns)` is replaced by:
  - `bms.copilot_usage (user_id, day, turns)`, primary key `(user_id, day)`,
    under decision 8's per-user policy (`user_id =
    current_setting('app.current_user')::uuid`), FORCE row-level security,
    and **no grant to `bms_fleet`** (decision 8's revoke applies);
  - `bms.copilot_org_usage (organization_id, day, turns)`, primary key
    `(organization_id, day)`, under the strict `tenant_isolation` policy
    (`USING` and `WITH CHECK` on `app.current_organization`), FORCE, and
    **no grant to `bms_fleet`** either. It holds a count and no conversation
    text.

  Why two tables: decision 8 requires every copilot policy to bind
  `user_id`, so one table keyed by user cannot add up an organization's
  turns; and a key of `(user_id, organization_id, day)` gave the global admin
  150 turns **per organization**. With `(user_id, day)` the user limit
  (drafter choice 2: 150) is per user per day across all organizations.

  A turn increments both counters **in one transaction** that sets
  `app.current_user` and `app.current_organization`; a turn over either limit
  is refused before any model call and the transaction rolls back, so a
  refused turn counts nowhere. A cross-organization turn (no bound
  organization) increments the user counter only, as drafter choice 2 says.
  The 30-day erase (decision 8, drafter choice 8) also removes counter rows
  older than 30 days. Decision 8's table list gains `bms.copilot_org_usage`.

- **A2 — Decision 11: the day boundary is the organization's timezone (Q8,
  against the plan's recommendation of UTC; follow-up ruling: a new column).**
  - `bms.organizations` gains `timezone varchar(64) NOT NULL DEFAULT 'UTC'`,
    an IANA zone name. The API validates it on write against the runtime's
    IANA list, as the location timezone is validated since `E4.1b` (ADR 0070
    decision 6); the organization DTO and the organization form gain the
    field, written by whoever writes organizations today. The seed sets the
    demo organization's zone; every other organization keeps `'UTC'` until an
    administrator sets it.
  - The organization counter's `day` is the calendar date in **that
    organization's** zone. The user counter's `day` is the date in the zone of
    the **user's home organization**; the global admin, who has no home
    organization, counts in UTC.
  - The refusal names the reset time as an instant; the browser shows it in
    the user's locale.
  - This is a schema change to `bms.organizations` (AGENTS.md §10); it ships
    in the usage-limits build PR (`F3.85` plan PR 6), not before.

- **A3 — Decision 5: what "Access only narrows down the chain" means (Q2).**
  The organization switch always wins: when it is off (or absent), no role
  switch and no exception can give anyone the copilot in that organization.
  Below it, a role switch with no row is **on**, and a named-user exception
  works **in both directions** — `allow = true` re-enables one user whose role
  switch is off, `allow = false` denies one user whose role switch is on. An
  exception still reaches only a user whose current database role is
  `organization_admin`, `location_admin` or `asset_group_admin` and whose
  home organization is the exception's (decision 5's own rule), and an
  `organization_admin` is narrowed by a deny only. Built in `F3.85` PR 3
  (#804).

## Erratum (2026-10-12, with the `F3.85` closure)

Two references in the text above were wrong when written; the decisions do
not change.

- **Decision 1** cites `access-control.service.ts:903` for `resolveDbUser`.
  The method is at `:885` (it was there when the ADR was accepted).
- **Decision 4.5** names `asset-templates.service.ts` and
  `calc-write.service.ts` as direct writers of `bms.audit_log`. Neither is:
  `asset-templates.service.ts` writes through `MasterDataAuditService`, and
  `calc-write.service.ts` writes no audit row (ADR 0037 decision 10 — the
  calc engine has no user to attribute). The `via` mark therefore reaches
  every audited copilot write through `master-data-audit.service.ts` and the
  writers `tests/f3.85-audit-via-mark` enumerates by the insert call (it
  added `control-room/site-layout.service.ts` in PR 8).

Release 1 closed 2026-10-12 (`F3.85`): the per-PR record is in
`docs/plans/f3.85-admin-copilot-release-1.md` §10.5, §11.1a, §11.2a, §11.2b,
§11.3a and §11.3b.

## Erratum (2026-10-13, after the `F3.86` closure)

One path string in the text above was wrong when written; the decisions do
not change.

- **Context** ("It runs only inside `/admin/onboarding`") and **decision 7**
  ("`/admin/onboarding` retires") name the onboarding page by a path it never
  had. The page's route was `/admin/organizations/:orgId/onboarding`
  (`apps/web/src/app.tsx`, opened by "Onboard with AI" on the organizations
  list); its API routes are under `/api/v1/admin/onboarding/sessions`. `F3.86`
  PR 7 (#831) retired that page route and `POST …/sessions/:id/chat`; the
  other session routes stay, because the skill uses them.

Release 2 closed 2026-10-13 (`F3.86`, #822–#831, closure #832; the commit
route requires the draft hash since #833): the per-PR record is in
`docs/plans/f3.86-admin-copilot-release-2.md` §4.9, §5.4, §5.6, §6.7, §7.3,
§8.4 and §9.1.

## Amendment 2 — resuming an onboarding draft, and its 30-day erase (owner, 2026-10-13)

`F3.86` PR 7 retired the onboarding page and left decision 7 with no way back
into a draft: `DELETE …/skills/onboarding` unbinds the session and leaves it a
`draft` row (`copilot-skill.service.ts:84-89`), a reload or an organization
pick drops the conversation that bound it, the decision 8 purge deletes that
conversation after 30 days, and a start that loses its bind race leaves the
loser's session behind. Such a draft can hold encrypted RTU credentials
(`_secrets`, ADR 0022 decision 2) with no end date, and no ADR gave
`bms.onboarding_sessions` a lifetime. The `F4.255` plan asked the owner, who
ruled on 2026-10-13 (the plan's §0) and approved this amendment the same day.
Each item names the decision or choice whose text it changes.

- **A1 — Decision 7: a draft can be resumed; a resume is a skill start.**
  The dock, while the conversation runs no skill, lists the organization's
  open drafts (its location's name, the phase, the last update, who started
  it) from a new organization-scoped list route, `GET
  /api/v1/admin/onboarding/sessions?organizationId=…`, whose contract lives in
  `packages/shared/src/contracts/onboarding.ts` (ADR 0030). The list's access
  is `loadSession`'s own (`assertOnboardingAccess`: `admin`, or an
  `organization_admin` who may manage the organization), applied to the
  organization the caller names, so a scoped administrator naming another
  organization is refused 403 as `createSession` refuses it; the by-id reads
  keep `F4.256`'s uniform 404. `POST …/skills/onboarding` takes an optional
  `sessionId`: with it, the route binds that draft instead of creating one,
  after the same checks as a start — the conversation is the caller's and
  bound to the body's organization, the organization's copilot switch is on
  (ruling Q4), no skill is bound yet, and the session is readable by the
  caller, in that organization, and still a draft. The daily limit applies to
  its turns as to any skill turn. A resume first unbinds the caller's **own**
  other conversations from that session (the per-user policy of decision 8
  shows no one else's), and binds no unique index: two administrators may
  open one draft, and the `FOR UPDATE` re-checks of ADR 0094 decision 6 and
  the hash-bound commit decide who writes. End onboarding keeps the draft.
  `createSession` writes `created_by` from this row on; earlier rows keep
  `NULL` and are listed as started by an unknown user.

- **A2 — Decision 8 and drafter choice 8: the 30-day erase reaches
  `bms.onboarding_sessions`.** The same `copilot-purge` tick, per organization
  inside `withTenant` as `bms_tenant` under the table's `tenant_isolation`
  policy, deletes every session whose `status` is `draft` and whose
  `updated_at` is older than 30 days. The delete removes the draft's
  encrypted RTU `_secrets` and its checkpoints with the row; a conversation
  bound to it becomes a plain conversation (`0107`: `ON DELETE SET NULL`),
  and its open `onboarding.commit` card is rejected on the conversation's
  next read, as a card with no draft skill behind it already is. Committed
  sessions are never erased by this tick: `result` is the commit's record.
  No audit row is written — an uncommitted draft wrote no master data, as a
  purged conversation wrote none. Decision 8's table list gains
  `bms.onboarding_sessions (status = 'draft')`.

- **A3 — Drafter choice: the lost bind race leaves an empty draft, not a
  refusal with a side effect to undo.** `CopilotSkillService.start` creates
  the session before the bind; when two starts race, the loser's session is an
  empty draft (phase `location`, no content, no secrets). It is listed by A1 —
  started by the caller, a moment ago — so the caller can resume or ignore it,
  and A2 erases it with every other untouched draft. Deleting it at once would
  add a delete path to the skill seam for a case the dock already prevents
  (the button is disabled while a start is pending).

- **Amends and relates to.** ADR 0022 (the credential ciphertext now has a
  lifetime: 30 days without a write, or the commit); ADR 0094 (checkpoints go
  with the row); ADR 0030 (the list DTO is a shared contract); this record's
  decision 7 (resume) and decision 8 (the table list).

## Amendment 2, A1 note — the draft list's home-organization default (owner, 2026-10-14)

A1 names the list route as `GET /api/v1/admin/onboarding/sessions?organizationId=…`,
applied to "the organization the caller names". `F4.255` PR 3 (#842,
`300578c9`) made `organizationId` optional. The owner kept it on 2026-10-14.

- **With no `organizationId`**, an `organization_admin` gets the drafts of its
  **home** organization (`recalledIdentity(jwt).organizationId`). A new copilot
  conversation binds to that organization, so the dock's list and its resume
  always name the same organization. The role gate and `canManageOrganization`
  run first, as for a named organization. A caller with no home organization
  gets 400.
- **A global administrator must name an organization.** With none, it gets 400.
- **An empty or non-uuid value** is still 400. A named organization keeps A1's
  403 (out of scope) and 404 (unknown, global administrator).

The reason: the dock first took a scoped administrator's organization from the
organizations list. That list holds the user's direct organization grants, not
the home organization, so a resume could list one organization's drafts and
bind in another, and answer 400 for the mismatch.

## Amendment 3 — release 3: mimics by conversation and from an image (owner, 2026-10-15)

Decision 12 gave release 3 (`F3.87`) the plant and network mimics and the
symbol libraries, and said that drawing a layout by conversation needs its own
amendment of this record before build; *Not in this ADR* kept it out. On
2026-10-14 the owner added new scope: an administrator may attach an image of
a plant and ask the copilot to build the mimic from it. `F3.80` (ADR 0101)
closed on 2026-10-15 (#860–#864), so the layout seam is final: a write node
carries `fanOut`, `isSource` and `isSwitching`; `PUT` replaces the whole
layout and needs `version`; node keys stay stable; units bind by `roleCode`
(ADR 0081, ADR 0088); ADR 0101 decision 17 moves the layout write schemas to
`packages/shared` in this row. The owner ruled eight questions one at a time
on 2026-10-15. Code citations are to `main` at `71b20634`.

| # | Question | Options put | Ruled | Item |
| --- | --- | --- | --- | --- |
| Q1 | Which mimic writes enter the catalog | JSON writes, no upload; layouts only; all, with the SVG upload | **all, with the SVG upload** (not the recommendation) | A1 |
| Q2 | How a layout is proposed | a card with a drawn preview; open the editor prefilled; both | **a card with a drawn preview** (recommended) | A2 |
| Q3 | Where an attached image lives | not stored; object storage with a 30-day erase; `bytea` with a 30-day erase | **not stored** (recommended) | A4 |
| Q4 | Attachment limits | PNG/JPEG/WebP, 5 MB, one per turn; add PDF, 10 MB, three per turn; 10 MB, one per turn | **PNG/JPEG/WebP and PDF, 10 MB each, three per turn** (not the recommendation) | A4 |
| Q5 | Which model reads the file | the turn's own key and model; a separate vision model setting; rasterize PDFs on the server | **the turn's own key and model** (recommended) | A5 |
| Q5a | Q4's "first page only" with no PDF library | the whole PDF under the 10 MB cap; single-page PDFs only; no PDF | **the whole PDF, the 10 MB cap only** (recommended) | A4 |
| Q6 | How a copilot symbol upload works | the admin attaches the file; also let the model draw an SVG; the model draws only | **the admin attaches the file, and the model may also draw an SVG** (not the recommendation) | A3 |
| Q7 | Binding the units of a layout built from an image | draw, then offer binding cards; draw only; build the whole plant | **draw, then offer binding cards** (recommended) | A6 |
| Q8 | The risk of an unscrubbed file sent to the provider | a per-organization switch, default off; on wherever the copilot is on; global admin only | **a per-organization switch, default off** (recommended) | A7 |

Each item names the decision whose text it changes.

- **A1 — Decision 2 and decision 3: the release-3 catalog entries (Q1).**
  - **Before the entries** (ADR 0101 decision 17; decision 2's rule): the
    body schemas these entries use move from `apps/api` to
    `packages/shared/src/contracts/`, and the controllers import them from
    there — `createMimicLayoutBodySchema` and `putMimicLayoutBodySchema`
    (`apps/api/src/mimic-layouts/mimic-layouts.schema.ts:227,237`); the
    symbol-library bodies `createMimicOrgSymbolLibraryBodySchema`,
    `updateMimicOrgSymbolLibraryBodySchema`, `putMimicLibrarySettingBodySchema`,
    `updateMimicOrgSymbolBodySchema`, `mimicSymbolUploadFieldsSchema` and
    `mimicSymbolFilenameSchema` (`mimic-symbol-libraries.schema.ts`); and
    `createAssetRoleBodySchema` (`admin/vocabularies/asset-roles.schema.ts:42`).
  - **Entries** (the plan confirms each route before it adds the entry):
    `mimicLayout.create` (`POST /api/v1/mimic-layouts`), `mimicLayout.replace`
    (`PUT /api/v1/mimic-layouts/:id`), `mimicLibrary.setting`
    (`PUT /api/v1/mimic-symbol-libraries/settings/:libraryCode`),
    `mimicLibrary.create` (`POST /api/v1/mimic-symbol-libraries`),
    `mimicLibrary.update` (`PATCH /api/v1/mimic-symbol-libraries/:id`),
    `mimicSymbol.upload` (`POST /api/v1/mimic-symbol-libraries/:id/symbols`,
    multipart — A3), `mimicSymbol.update`
    (`PATCH /api/v1/mimic-symbol-libraries/:id/symbols/:symbolId`) and
    `assetRole.create` (`POST /api/v1/admin/vocabularies/asset-roles`, the
    global `admin` only by its own check — A6).
  - **Exclusion list** gains `DELETE /api/v1/mimic-layouts/:id` (no hard
    delete, ruling 5) and `PATCH /api/v1/admin/vocabularies/asset-roles/:code`
    (a vocabulary edit or retire stays on its page).
  - The coverage spec (`tests/f3.85-catalog-coverage.test.ts`) gains the three
    controllers, so every write route on them is an entry or excluded.
  - **Who sees the tools.** The layout and library routes write for `admin` and
    `organization_admin` only (`mimic-layouts.service.ts:71`, ADR 0081
    decision 3; `mimic-symbol-libraries.service.ts:53`, ADR 0086). Their
    propose tools are offered only to those two roles; `location_admin` and
    `asset_group_admin` keep read-only answers about mimics. The controller
    still decides on Confirm.

- **A2 — Decision 4: a layout is proposed as one whole body on one card with a
  drawn preview (Q2).** One layout save is one API write, so one Confirm
  (rulings 3, 11).
  - The model calls the `mimicLayout.create` or `mimicLayout.replace` propose
    tool with the whole body. The server parses it with the shared schema
    (the caps of ADR 0101 decision 2: 120 nodes, 160 pipes, fan-out 16) and
    runs the service's own read-only checks before the card shows — the
    libraries a unit's symbol uses are live for the organization
    (`assertLibrariesLive`, `mimic-layouts.service.ts:168`). A failure goes
    back to the model as the tool result.
  - The card **draws the proposed layout** with the web's mimic renderer from
    the body alone, with no live state. For a replace it lists the units and
    pipes added, changed and removed by node key against the version the card
    was built from, and it shows ADR 0101 decision 14's editor warnings (no
    source; a switching unit with no role; a switching unit no source reaches).
    The warnings do not block Confirm, as they do not block a save in the
    editor.
  - A replace carries `version`; a layout changed after the card was built is
    refused 409 by the service, shown on the card and returned to the model
    (decision 4.8). This narrows decision 4.9's stale-diff residual for
    layouts.
  - The model may write a new layout from a conversation, from an attached
    image or PDF (A4), or as an edit of an existing layout it read.

- **A3 — Decision 2 and decision 4: a copilot symbol upload (Q1, Q6).**
  `mimicSymbol.upload` is the catalog's first multipart entry. The SVG comes
  from either source:
  - **An attached `.svg`** (up to `MAX_MIMIC_SYMBOL_SVG_BYTES`, 64 KB). The
    model never sees its markup: it receives the filename, the size and the
    result of the existing parser (`svg-symbol-parser.ts`), and proposes the
    `name`, `label` and `group`.
  - **An SVG the model writes** for a unit that no live library holds. It goes
    through the same parser and the same 64 KB cap.

  The server runs the parser at propose time; a refusal goes back to the model.
  The pending-change row stores the SVG text (64 KB at most), and the hashed
  canonical body is `{ name, label, group, filename, fileSha256 }`. The card
  draws the symbol from that text as an image (an `<img>` from a blob URL, so
  no script in the file runs) beside its fields. On Confirm the browser sends
  the real multipart call built from the stored text, with
  `X-Copilot-Change`; the interceptor hashes the uploaded file's bytes and
  refuses 409 when `fileSha256` or a field differs (decision 4.5). The
  controller's own checks run unchanged.

  **An attached `.svg` is the one stored exception to A4.** Its text lives only
  in the pending-change row, which expires after 15 minutes (drafter choice 1)
  and is erased with the conversation (decision 8). It is an attachment for
  A4's three-per-message limit and needs A7's switch. An SVG the model writes
  needs neither.

- **A4 — Decision 8 and decision 9: attachments on a copilot turn (Q3, Q4,
  Q5a).**
  - An administrator may attach **up to three files per message**: PNG, JPEG,
    WebP or PDF, **10 MB each**, checked by magic bytes as asset images are.
    A PDF goes whole; the 10 MB cap bounds it. An `.svg` is accepted only as a
    symbol to upload (A3), never as an image to read.
  - The turn route takes the files as multipart, with the limits written
    inline in the interceptor's options (`tests/f4.102-file-interceptor-limits.test.ts`).
  - **Nothing is stored.** The API holds the bytes in memory for that turn's
    model calls only and drops them when the turn ends. The message row keeps
    a placeholder (filename, type, size, SHA-256), never the bytes. The system
    prompt tells the model to write its reading of the drawing (units, pipes,
    labels, roles it can see) as text in its reply; that text is the history
    later turns use. An automatic follow-up turn (decision 4.7) never has the
    file. No new table, no object storage, and the 30-day erase of decision 8
    has nothing new to erase.
  - Attachments are taken on a plain copilot conversation only. A turn with a
    skill bound (the onboarding skill, decision 7) refuses them with 400.

- **A5 — Decision 10: the file goes to the turn's own key and model (Q5).**
  The key and model come from decision 10's resolution, unchanged. The LLM
  port (`apps/api/src/llm/llm-port.ts`, text-only `content` today) gains
  content parts, and each provider sends the file in its native form: image
  parts, and a PDF as a document or file part. No new npm package and no new
  model setting. When the provider or model refuses the file, the panel says
  that this model cannot read the file and the turn counts as a turn that
  reached the model. In guided mode, or with no key resolved, the attach
  button is absent and the route refuses attachments with 400.

- **A6 — Decision 4.7: binding after a layout is drawn (Q7).** When a layout
  change reaches `applied`, the follow-up turn offers the binding writes that
  already exist in the catalog, one card each, in order:
  `assetGroup.member.add` and `assetGroup.member.setRole` (`F3.86`), and, for
  the global `admin` only, `assetRole.create` for a role code the vocabulary
  lacks (scoped administrators choose among the existing roles, ADR 0101
  decision 7's eight included). A unit the model cannot match to an asset
  stays unbound; the editor warning lists it. The copilot never creates
  assets or points from an image in this release (`F3.86`'s entries stay
  available when the administrator asks for them in words).

- **A7 — Decision 5 and decision 9: a switch for attachments, default off
  (Q8).**
  - `bms.copilot_org_settings` gains `attachments_enabled boolean NOT NULL
    DEFAULT false`; existing and new organizations start off. It counts only
    when the organization's copilot switch is on. Unlike `enabled`, which
    stays global-admin only, this column is written by the global admin
    (Organizations page) **and** by the organization admin (the *Copilot
    access* section) — this amends decision 5's "written by the global admin
    only" **for this column alone**. The organization admin's write never
    creates a row or changes `enabled`: with no row the copilot is off
    (ruling 15) and the write is refused. Schema change: one migration, frozen
    ones untouched.
  - The turn route checks the switch on the server for every attachment; a
    hidden button is not the protection.
  - The attach button says that the file goes to the organization's AI
    provider as it is, unscrubbed.
  - **Accepted residual risk:** the secret scrub and the ADR 0022 credential
    refusal read text, so a secret printed in an image reaches the provider.
    The scrub still runs on every reply.
  - **Prompt injection by file:** text inside a file is data, as tenant free
    text is (decision 9). A turn with an attachment **cannot propose an access
    change** (ruling 20 treats the file like a tool result), and every write
    still needs its Confirm.

- **A8 — Decision 12: the release-3 row.** `F3.87` holds A1–A7. Decision 12's
  "drawing by conversation gets its own amendment" is met by this amendment,
  and *Not in this ADR*'s "Mimic drawing by conversation" item is withdrawn.
  Decision 12's `F3.87` table row and its closing paragraph on `F3.80` are
  read with this amendment.
  The step-3 plan may shape the PRs; the drafter's suggested order is: the
  schema move and the mimic read tools; the layout entries and the preview
  card; the library, symbol-upload and role entries; the attachments (the
  port, the migration, the turn route).

**Drafter choices (not asked; confirmed by the owner with this amendment,
2026-10-15).**

1. New read tools: `list_mimic_layouts`, `get_mimic_layout` and
   `list_mimic_symbols` (the live libraries' symbol keys, labels and groups,
   never the SVG bodies), through the user's read scope (decision 9).
2. A turn with attachments counts as **one turn** against the daily limits
   (decision 11, Amendment 1).
3. The placeholder in the message row keeps the file's SHA-256 so the audit of
   a conversation can name which file a layout came from; the bytes are gone.
4. A layout built from an image is a draft proposal like any other: no
   accuracy claim is made, and the card says the layout was read from a file.

**Still out.** Storing attachments; attachments for operators and viewers;
attachments in the onboarding skill; reading a DWG or other CAD file; creating
assets and points from an image without the administrator's words; live state
in the card's preview; the layout `DELETE` and the role-vocabulary edit by the
copilot; a separate vision model setting.

**Amends and relates to.** ADR 0101 decision 17 (the schema move, done here);
ADR 0081 and ADR 0088 (binding by role, kept); ADR 0086 (library and upload
rules, kept, the upload reached through the catalog); ADR 0022 (the credential
refusal reads text — A7's residual); ADR 0090 decision 3 (caps apply to every
attachment turn) and Amendment 1 (the key rule, kept); ADR 0030 (the moved
schemas become shared contracts).

**Promotion bookkeeping (after approval).** Nothing new leaves `AGENTS.md`
§6 — the copilot is already promoted for administrators. Owed: the `F3.87`
row in `docs/BACKLOG.md` (it still says the amendment is needed), and a
`chore(agents):` sweep in its own PR (§9.10) for the `AGENTS.md` text that
states ADR 0099's scope (the status-line paragraph and the §6 copilot item),
which must name attachments and A7's residual.

**Dependencies.** None. The providers' existing SDKs (`openai`,
`@anthropic-ai/sdk`) carry image and PDF parts; no new npm package.

**Verification owed (in addition to the record's list).**

- Unit: the coverage spec with the three new controllers (the layout `DELETE`
  and the role `PATCH` excluded); the multipart entry's hash over the fields
  and `fileSha256`; the attachment limits (type by magic bytes, 10 MB, three
  per message, `.svg` only for A3); the mimic propose tools offered only to
  `admin` and `organization_admin`.
- Loop: fake-provider specs for a layout proposed from an attachment; an
  instruction written in an image that asks for an access change (refused); a
  follow-up turn with no file.
- Integration: the interceptor refuses a symbol upload whose bytes differ from
  the proposal; a stale layout `version` gives 409 on the card; the
  attachments switch is enforced on the server (off → 400 or 403 by the plan,
  on → the turn runs); no image or PDF bytes reach any table.
- Mutation runs on every new guard.
- Live stack: a layout drawn from a photo of the ESKOM `ND-` demo network is
  proposed, previewed, confirmed and audited with the copilot change id.

## Amendment 4 — `fill_step` names its record (owner, 2026-10-20/21)

**Status: Proposed — owner ruled 2026-10-20/21; the merge approves the text.**

Decision 6 says the model "can call `fill_step`, which returns field values
for the current step". On `main` before `F4.245` the fill named a catalog
entry only, so the browser handed it to any open wizard of that entry: a
conversation about dashboard A filled dashboard B's open edit form
(`docs/BACKLOG.md` F4.245). The owner ruled on 2026-10-20 that the browser
sends the open wizard with each turn, and on 2026-10-21, after the plan's
adversarial critique (its C1 and C3), replaced "the server stamps the
wizard's parameters on the fill" with the rulings below. Code citations are to
`main` at `1b38ca60`.

| # | Question | Ruled | Item |
| --- | --- | --- | --- |
| 1 | How the open wizard reaches the server | the turn body names every open wizard: its catalog id and all its path parameters | B1 |
| 2 | Who names the record a fill is for | **the model names it; the server checks it** (replaces "the server stamps it") | B2, B3 |
| 3 | A fill in the turn that opens the page | allowed through the `open_page` target the server resolved; the fill waits for that wizard only | B4 |
| 4 | A field the page fixes (critique C2) | never set by a fill | B5 |

- **B1 — The turn body names the open wizards (ruling 1).** `POST
  /copilot/conversations/:id/turns` carries `wizards: [{ catalogId, params }]`
  (strict, at most 8, required; `[]` when none is open). `params` holds
  **every** path parameter of the entry's route (`{}` for a create). A
  multipart turn sends it as a JSON string; a value that is not JSON is a 400.
  The API checks each wizard against its catalog entry: the entry exists, the
  parameter names are exactly the entry's, and each value parses with the
  entry's own `params` schema; a mismatch is a 400. The dock names one record
  once; a duplicate a client still sends does not fail the turn, and only a
  fill for that record is refused as ambiguous.
- **B2 — The server resolves the records inside the conversation's scope and
  tells the model (ruling 2).** Each open wizard's record is read through the
  propose target resolver with the turn's allowed organizations and the
  conversation's bound organization — the check `propose` makes (decision 10).
  A record outside that scope, or one the caller may not manage, is not named
  to the model and cannot be filled. A create, and an entry named by codes
  whose organization the page fixes (a stock import, a library setting), has no
  row to read and is open with no name; a server-proposed entry (the onboarding
  wizards) is never open. The model reads the open records in one system line
  per turn — at most 8 entries, each name cut to 80 characters, scrubbed and
  quoted as data; no line when none is open — because it must know the record
  before it chooses a tool: a tool description is static per registry, and a
  tool result comes too late. A record's organization becomes the turn's
  provenance, as a tool read's does.
- **B3 — `fill_step` names its record (ruling 2).** The tool's arguments gain
  `params`. The server refuses the fill unless `{ catalogId, params }` equals
  one open, in-scope wizard's, with a sentence that tells the model to propose
  a card instead. A conversation about A with B's wizard open is refused. The
  fill the browser receives carries `{ catalogId, params, stepId, values }`,
  and the browser applies it only to the wizard whose catalog id and filled
  path (its key) are the fill's.
- **B4 — `open_page` and `fill_step` in one turn (ruling 3).** A fill with no
  matching open wizard is accepted only when the same turn called `open_page`
  for a page that mounts that entry's wizard and the parameters equal the
  record the server resolved for that page (the dashboard edit page's slug is
  read in the allowed organizations). The `open_page` result names those
  records. In the browser the fill waits for that wizard's key only; it is
  dropped when the user is on another page, or when a wizard of that key
  unregisters. A fill no open wizard matches and no page waits for is dropped
  at once.
- **B5 — A page-fixed field is never filled (critique C2).** A body field the
  page fixes — an asset page's `assetId` for a point mapping, the
  organization of a library setting, a library create or a stock import — is
  never set by a fill: the page sends its own value, so a filled one would make
  the Review card differ from the request, or move the record.

**The wizard context is never an authorization input.** It chooses which open
form a fill may land in and nothing else. Decision 10's rule — the key and the
organization are decided on the server, never from a page context the client
sends — stands: the propose tools, the Confirm interceptor and the routes
authorize exactly as before, and a fill still writes nothing (decision 6).

**Not in this amendment.** Read tools for the records that have none (users,
grants, RTUs, asset groups and members, calculation parameters); If-Match on
Confirm (`F4.247`); any catalog change.

**Verification owed.** Unit and loop: the shared contract, the open-wizard
check, the record resolution in and out of scope, the fill refusals
(another record, no wizard, two copies), `open_page` then `fill_step` in one
turn, the browser store's keyed hand-off and its drops, and the page-fixed
fields — each with a named mutation. Integration: the dashboard slug lookup
under the tenant policy. Live stack: a fill for another record than the open
one is refused, and a fill for the open one lands.
