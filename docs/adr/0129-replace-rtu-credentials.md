# ADR 0129 — Replace an RTU's stored credentials, in the draft and once committed (`F4.333`)

## Status

**Proposed — 2026-11-12.** Drafted by an agent for backlog row `F4.333` (P1),
raised by the owner on 2026-11-07. Nothing is built. The owner holds the
AGENTS.md §10 gate: the questions under *Open questions* need a ruling, and the
plan [`docs/plans/f4.333-credential-replace.md`](../plans/f4.333-credential-replace.md)
needs an explicit "yes", before any build. Lines marked *(recommended)* depend
on a question; lines marked *(drafter)* are drafter calls the plan may refine.

**Why a new ADR and not an amendment.** Part (1) — the draft — needs no new
rule: the endpoint of [ADR 0022](./0022-onboarding-credential-capture.md)
decision 1 already overwrites. Part (2) is a **new credential write path on a
committed RTU**, plus a change to what the ingest reload detects. That touches
three records at once (ADR 0012, ADR 0022, ADR 0115), so one new record that
amends each in a single line reads better than three amendments that each tell
a third of the story. *Recommended: a new ADR (this one).* The alternative — an
amendment to ADR 0012 — is Q1.

Amends:
- [ADR 0012](./0012-encrypted-rtu-credentials.md) decision 1 and its
  *Consequences*: `rtu_connection_configs.credentials_*` gains a second writer
  after commit (decision 2 below). Decisions 2–4 of ADR 0012 do not change: the
  API **encrypts** on this path and never decrypts.
- [ADR 0022](./0022-onboarding-credential-capture.md) decision 1: the endpoint
  stays "the only way credentials enter onboarding"; it is now also the way
  they are **replaced** in a draft (decision 1 below).
- [ADR 0115](./0115-organization-ingest-switch.md) decision 6 (R5) and the
  `reconcile.ts` header: a credential change on a running endpoint is detected
  at the reload and no longer needs a restart (decision 4 below).

Keeps unchanged: [ADR 0093](./0093-onboarding-protocol-catalog-and-shared-config-schemas.md)
(the freeze of host, port, TLS, protocol and code once credentials are set);
[ADR 0114](./0114-plain-mqtt-for-allowlisted-brokers.md) (plain MQTT only for
allowlisted hosts); [ADR 0062](./0062-credential-key-rotation-and-unconfigured-key-visibility.md) (the key
window). Adds no dependency and no migration. Promotes nothing out of
AGENTS.md §6.

## Context

**Why now.** The BCPL MQTT password was exposed in a chat on 2026-11-07
(ADR 0114 *Consequences* already says it "must be rotated"). The platform has
no way to enter the new one. BCPL LALMATI onboarding waits on this row.

**What the code does today** (`main` at `4d02c59`):

1. **One credential write exists**: `POST /api/v1/admin/onboarding/sessions/:id/credentials`
   (`apps/api/src/admin/onboarding/onboarding.controller.ts:209`,
   `onboarding.service.ts:277`). It encrypts through `mergeDraft` →
   `CredentialCryptoService.encrypt` → `attachEncryptedCredentials`
   (`onboarding-redaction.ts:494`), which **already replaces** the blob stored
   under the RTU's code. So the API can overwrite a draft credential today.
2. **The draft drawer hides it.** Once `credentialsSet` is true the drawer
   shows only a "Set" pill and no button
   (`apps/web/src/components/onboarding/draft-drawer.tsx:190`). The only way
   to enter a new password is to remove the RTU and add it again.
3. **A committed RTU has no credential write at all.** `/admin/rtus` has
   create, update, payload-format, deactivate and reactivate routes
   (`apps/api/src/admin/rtus/rtus.controller.ts`); none touches
   `credentials_ciphertext`, `credentials_iv` or `key_version`. Key rotation
   (`apps/api/src/security/credential-rotation.service.ts`, ADR 0062)
   re-encrypts the same plaintext; it cannot change it.
4. **Ingest does not notice a credential change.** The reload runs every
   `INGEST_RELOAD_MS` (default 60 s, `apps/ingest/src/host/config.ts:152`).
   `diffEndpoints` replaces an endpoint only when its device set or its
   `decoderFingerprint` moves; anything else is a `swap-index`, so the old
   connection keeps its old password. The file says so:
   *"A connection-config or credential change on a running endpoint whose device
   set is unchanged is a `swap-index`, so it still needs a restart (plan R5)"*
   (`apps/ingest/src/host/reconcile.ts:24-27`).
5. **One endpoint serves many RTUs.** Ingest groups RTUs by
   `(protocol, endpointKey)`, and an MQTT `endpointKey` is `host:port` (or
   `mqtt://host:port` for plain, `apps/ingest/src/adapters/mqtt.ts:460`). The
   endpoint uses the **first non-empty credential** among its RTUs
   (`apps/ingest/src/host/bindings.ts:879-885`); a second RTU with the same key
   names but a different password is **not** detected. So if 21 BCPL meters
   each hold a copy of the old password, replacing it on one RTU may change
   nothing at the broker. The endpoint key has no organization in it, so two
   organizations on one broker share one connection (a known gap owned by
   `F1.7`, ADR 0016 *Consequences*).
6. **Edge-served RTUs** (ADR 0123) never get a cloud credential: the edge reads
   its broker credentials from its own `EDGE_CONFIG_FILE`
   (`apps/ingest/src/host/edge-plan.ts`), and the cloud never decrypts a blob
   for them (`bindings.ts:585-592`).
7. **Who can write a committed RTU today.** `update` and `setPayloadFormat`
   gate on `canManageLocation`, which admits `admin`, `organization_admin` for
   its organizations, and `location_admin` for its subtree
   (`apps/api/src/auth/access-control.service.ts:238`). The onboarding
   credential write is narrower: `admin` or `organization_admin` only
   (ADR 0022 decision 1 and Amendment 1).

## Decision

1. **Draft: "Replace credentials" beside the "Set" pill.** When
   `credentialsSet` is true the drawer shows the "Set" pill **and** a
   "Replace" button. It opens the same credential form, posts to the same
   `POST sessions/:id/credentials`, and replaces the blob for that RTU's code.
   The form starts empty and says "The stored credential is never shown.
   Saving replaces it." No API change: the endpoint already overwrites
   (Context 1). The plan adds a test that proves it does, so a later change
   cannot quietly turn the write into "set once". The copy of ADR 0117
   decision 7 (`SameCredentialsCopy`) does not change.
   - *(recommended, Q5)* The draft write gains an audit entry,
     `master.onboarding.credentials.set`, payload
     `{ sessionId, rtuCode, replaced: boolean, keyVersion }` — never a value,
     never a key name beyond the code. Today it writes none (ADR 0022
     Amendment 4, *Observation*).

2. **Committed RTU: a new write-only route.**
   `PUT /api/v1/admin/rtus/:id/credentials`, body
   `replaceRtuCredentialsBodySchema` in `@bms/shared` (ADR 0030).
   - **MQTT only** *(recommended, Q2)*. The body is
     `{ username: string, password: string }`, `.strict()`, each 1 to
     `MAX_RTU_CREDENTIAL_CHARS` (4,096) characters, and refused when either
     holds a control character (the existing `MQTT_CREDENTIAL_CONTROL_CHARS`
     rule, so the two writes give one answer). A non-MQTT row is a 400.
   - **A full replacement, never a merge.** Both fields are required. A
     "password only" change would mean decrypting the old blob in the API to
     keep the username, which ADR 0012 decision 4 forbids. The user types both.
   - **Encrypted under the current key version.** `CredentialCryptoService.encrypt`
     always writes `currentVersion`; the route stores `ciphertext`, `iv` and
     `key_version` together in one `UPDATE`. No key loaded → 503 with the same
     fail-closed sentence as `setCredentials`; nothing is written.
   - **Nothing else changes.** `config` (host, port, `tls`, topic, payload
     format) is not in the body and not in the `UPDATE`. The ADR 0093/0114
     freeze is untouched, so this route can never point a credential at a new
     host.
   - **Never echoed.** The response is the `AdminRtuDto`. It gains one field,
     `credentialsSet: boolean | null` *(drafter)* — `null` with no connection
     row, else whether a blob is stored — so the page can show "Set" / "Not
     set". No value, no key name, no ciphertext, no key version reaches a
     client.
   - **Refusals, in this order** *(drafter)*: 404 RTU not found; 403 role or
     scope (decision 3); 404 no connection row; 400 not MQTT; 409 edge-served
     RTU (decision 5); 503 no key; 400 body (Zod). All fixed text, no host,
     no value (§9.6).
   - **Audited without values** (AGENTS.md §9.6, §9.8). One row per RTU
     written, action `master.rtu.credentials.replace`, through
     `MasterDataAuditService` inside the same tenant transaction, payload
     `{ hadCredential: boolean, fromKeyVersion: number | null, toKeyVersion: number }`.
     No row when the `UPDATE` hits nothing (the security-review L2 rule of
     `setPayloadFormat`). The request body is never passed to the audit
     writer, so ADR 0021 decision 6's standing check passes by construction.
   - **Not through the copilot.** The route goes on the copilot catalog's
     `EXCLUDED_ROUTES` with the reason "a credential is entered on a form,
     never through chat (ADR 0022)".
   - **Siblings on the same broker** *(recommended, Q3)*. The body may carry
     `alsoApplyTo: string[]` (RTU ids, at most 100 *(drafter)*). Each must be
     an active MQTT RTU of the **same organization**, on the **same broker**
     (equal `host`, `port` and `tls`, the `sameBroker` rule of
     `apps/api/src/admin/onboarding/onboarding-mqtt-broker.ts`), not edge-served, and pass decision 3's
     gate. One bad id refuses the whole request; nothing is written. All rows
     get the **same** fresh blob in one transaction, one audit row each. The
     page pre-ticks every sibling it finds. Reason: Context 5 — with a copy of
     the old password on 20 siblings, a single-RTU replace may not reach the
     broker at all.

3. **Role rule for decision 2** *(recommended, Q4)*: `admin`, or
   `organization_admin` of the RTU's organization — the same two roles that
   may set a credential at onboarding (ADR 0022 decision 1). Checked as
   `requireMasterDataUser` → role ∈ {`admin`, `organization_admin`} →
   `canManageLocation(rtu.locationId)` → `resolveAgreedOrg` (the `F4.138`
   check). `location_admin` and every other role get 403, even though they
   may edit the RTU's name. A write of a secret must not be weaker than the
   write that first set it (ADR 0022 Amendment 1, M1).

4. **How ingest learns of it: a credential fingerprint at the reload — no
   restart** *(recommended, Q6)*.
   - `EndpointPlan` gains `credentialFingerprint: string`: sha256 over the
     sorted list of `(rtu_id, key_version, base64(credentials_iv))` of every
     RTU in the group. The IV is random per encrypt, so every write — a
     replace, a copy, a key rotation — changes it. It is built from **no
     secret and nothing derived from one**: not the plaintext, not the
     ciphertext. *(drafter)* It is never logged.
   - `diffEndpoints` gains a third test: same device set, same decoder
     fingerprint, different credential fingerprint → `replace` with
     `reason: "credentials-changed"`. The registry stops the old supervisor
     and starts a new one with the newly decrypted credential (the ADR 0115 R5
     mechanism; ordering rule R10 unchanged).
   - One `info` line per replaced endpoint: `endpoint replaced` with
     `reason: credentials-changed` and the endpoint key. No username, no
     password, no fingerprint (§9.6).
   - **Timing.** The broker sees the new password at the next reload: at most
     `INGEST_RELOAD_MS` (60 s by default) after the commit. The endpoint
     reconnects once, so every RTU on that endpoint has a gap of a few seconds.
     A key rotation also changes every IV, so after a rotation each endpoint
     reconnects once — harmless, and it proves the new key decrypts.
   - **No restart is needed.** The `reconcile.ts` header and ADR 0115 R5's
     "needs a restart" line are corrected by this decision.
   - Edge plans keep `credentialFingerprint: ""`, like `decoderFingerprint`.

5. **Edge-served RTUs are refused** *(recommended, Q7)*. If
   `rtus.edge_gateway_id` is set, decision 2 answers 409: "This RTU is served
   by an edge gateway. Its broker credential is in the gateway's config file;
   change it there." Writing a cloud blob that nothing reads would report a
   rotation that did not happen.

6. **Web, `/admin/rtus`.** A "Replace credentials" action on an MQTT RTU row,
   shown only to the roles of decision 3 and hidden on an edge-served row. It
   opens a dialog with two empty fields (`autocomplete="off"`, password field
   masked), the sibling list of decision 2 (pre-ticked), and the line "The
   current credential is never shown. Ingest uses the new one within about a
   minute." On success the dialog clears its fields from state, and the row
   shows a "Credentials set" pill from `credentialsSet`. The values are never
   put in the TanStack Query cache, the URL, or `localStorage`.

7. **Not in this ADR.** Reading back or partially editing a credential.
   Changing host, port or TLS of a committed RTU. Non-MQTT credentials (no
   adapter uses them yet). Per-RTU credentials on a shared endpoint (`F1.7`).
   Pushing a credential to an edge gateway. A copilot tool. Any change to key
   rotation.

## Open questions (for the owner, in order)

**Q1 — Record.** Where is this decided?
- A. This new ADR 0129, amending ADR 0012, 0022 and 0115 in one line each.
  *(recommended)*
- B. An amendment to ADR 0012 (and a second one to ADR 0115 for the reload).

**Q2 — Protocols.** Which RTUs can have a credential replaced once committed?
- A. MQTT only, with a fixed `{ username, password }` body. *(recommended —
  the only adapter that reads a stored credential today; a strict body is
  easy to validate and review.)*
- B. Any protocol, with a free `Record<string,string>` like the draft write.

**Q3 — Siblings on the same broker.** Context 5: an endpoint uses the first
non-empty credential of its RTUs.
- A. One request may also replace the credential on chosen RTUs of the same
  organization on the same broker (`alsoApplyTo`), pre-ticked on the page.
  *(recommended — rotating BCPL's password is one action, not 21.)*
- B. One RTU per request; the user repeats it for each sibling.
- C. Always every RTU of the organization on that broker, with no choice.

**Q4 — Role rule for a committed RTU.**
- A. `admin`, or `organization_admin` of the RTU's organization.
  *(recommended — same as onboarding's credential write.)*
- B. Global `admin` only.
- C. Anyone who passes `canManageLocation` (adds `location_admin`), like the
  payload-format route.

**Q5 — Audit the draft write too?** Today `POST sessions/:id/credentials`
writes no audit row.
- A. Yes: `master.onboarding.credentials.set` with code, `replaced` and key
  version, never a value. *(recommended — a rotation then leaves a trail
  whether it happens before or after commit.)*
- B. No; audit only the committed-RTU route.

**Q6 — How ingest picks up the new credential.**
- A. A non-secret credential fingerprint (RTU id, key version, IV) at each
  reload; the endpoint reconnects within `INGEST_RELOAD_MS`; no restart.
  *(recommended)*
- B. No ingest change; the runbook says "restart ingest after a replace"
  (`bms-ctl restart ingest` on AWS). Simpler, but every rotation needs an
  operator, and a forgotten restart keeps the leaked password in use.

**Q7 — Edge-served RTUs.**
- A. Refuse with 409 and say where the credential lives. *(recommended)*
- B. Write the cloud blob anyway, with a warning.

**Q8 — Build order.** The draft half (decision 1) needs no API change and
unblocks the LALMATI draft at once.
- A. Ship decision 1 first as its own small PR, then ingest, API and page.
  *(recommended)*
- B. One PR for everything.

## Consequences

- A leaked broker password can be replaced in the product, before or after
  commit, without removing an RTU. With Q6 A, the broker sees the new password
  within about a minute, with no operator step.
- One more place handles plaintext in the API: the request body of decision 2.
  It is encrypted at once and dropped; it reaches no log, response, audit row
  or cache. The security review checks this (plan §6).
- An `organization_admin` can stop ingest for its own RTUs by typing a wrong
  password. Because one endpoint can serve two organizations (Context 5), a
  wrong password on organization A's RTU could also stop organization B's RTUs
  on the same broker if A's RTU supplies the endpoint's credential. This is
  the `F1.7` gap, not new, but this route makes it reachable by one form. The
  audit row names who did it. Fixing it (an organization in the endpoint key)
  is out of scope here and is raised as a follow-up row.
- Each replace makes the endpoint reconnect once: a short gap in readings for
  all RTUs on that broker.
- After a key rotation every endpoint reconnects once at the next reload.
- `AdminRtuDto` gains `credentialsSet`; the copilot catalog gains one excluded
  route.
- A `chore(agents):` sweep is owed for AGENTS.md (the credential paths and
  §9.6), tracked in `docs/BACKLOG.md` §5 after the build (§10.1).

## Dependencies

None. No new package, no migration.
