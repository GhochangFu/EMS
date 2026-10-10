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
