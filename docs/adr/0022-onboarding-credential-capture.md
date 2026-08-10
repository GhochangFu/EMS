# ADR 0022 — Onboarding credential capture off the chat transcript (`E8.3`)

## Status

**Accepted (2026-08-09).** Backlog item `E8.3` (Wave 0, P1). Drafted and
accepted the same day by the repo owner at the AGENTS.md §10 gate, decision 5
included — `messages` is purged, session rows are kept.

Takes `0022`; `0020` stays reserved for the E8.1 encryption-at-rest retro.
`E5.1`'s ADR moves to `0023` — as `docs/e5.1-client-questions.md` already warns,
that number is the next free one at time of writing, not a booking.

## Context

`E8.3` was raised by the E8.1 security review. **Its backlog row overstates one
vector and mis-locates the defect**, so this ADR restates what is actually true
against `main` as of 2026-08-09. The row says the session read is *"behind
`JwtAuthGuard` with no role/org check, so any authenticated user can read
another admin's pasted password."* That is false: `loadSession` calls
`requireMasterDataUser` **and** `canManageOrganization`.

What is true:

1. **The wizard asks for credentials in chat, by design.** The rule-based turn
   replies *"MQTT RTU added. Share username and password, or say **skip
   credentials** for now."* and `extractCredentials(message)` parses them out of
   the free-text turn (`onboarding-chat.service.ts`). The transcript is then
   stored verbatim in `onboarding_sessions.messages`.

2. **`messages` bypasses the redaction `draft` gets.** `mapSession` applies
   `redactDraftForClient(row.draft)` and returns `messages` **raw**. The
   redaction machinery exists and was deliberately pointed at the draft; the
   transcript was never routed through it.

3. **The gates are inconsistent.** ~~`createSession`, `chat` and `commit`
   require role ∈ {`admin`, `organization_admin`}~~ — **that was wrong, and the
   2026-08-10 security review caught it.** `createSession` and `commit` do;
   **`chat` does not**, nor do `patchDraft`, `uploadExcel` or `validate` — all
   four use `loadSession`, which proves org scope only. `getSession` was the
   same. So a `location_admin` could read *and* drive a session, and
   `uploadExcel` writes credentials parsed from the workbook, meaning that role
   could write credentials by upload while being refused by decision 1's
   endpoint. See Amendment 1.

4. **The raw turn goes to OpenAI.** `handleOpenAiTurn` sends
   `{ role: "user", content: message }` unredacted, while applying
   `redactDraftForLlm` to the draft context in the *same request*. The system
   prompt asks the model not to echo secrets, but the secret has already left.
   This is an open gap against **ADR 0011 decision 4**.

**Why the existing redactor cannot fix this.** `scrubSecrets` is a **key-name
denylist** (`password`, `username`, `apiKey`, `clientCert`, `clientKey`,
`community`, `authKey`, `privKey`). It matches object *keys*. A chat turn is
free text — *"the password is hunter2"* has no key to match. Widening the
denylist does nothing. A redactor that appears to cover this and does not is
worse than none, because it converts a known gap into an assumed-safe one.

## Decision

1. **Credentials leave the chat transcript entirely.** A dedicated endpoint
   captures them:

   `POST /api/v1/admin/onboarding/sessions/:id/credentials`
   with `{ rtuIndex: number, credentials: Record<string, string> }`.

   It encrypts through the existing `CredentialCryptoService` /
   `attachEncryptedCredentials` path (ADR 0012) and sets `credentialsSet: true`.
   **The plaintext is never written to `messages`, never returned, and never
   sent to OpenAI.** Same role gate as the other mutating onboarding routes:
   `admin` or `organization_admin`, plus `canManageOrganization`.

2. **`extractCredentials` stops parsing credentials out of chat.** It is
   repurposed as a **detector**: when a turn looks like it carries a secret, the
   turn is **rejected** — not stored, not forwarded to the LLM — and the
   assistant replies telling the user to use the credentials field. Detection is
   allowed to be imprecise **in the refusing direction only**; a false positive
   costs a retyped message, a false negative is the bug this ADR exists to
   close. The wizard's prompt text changes accordingly: it must stop asking
   users to paste secrets into chat.

3. **The read gate matches the write gate.** `getSession` requires `admin` or
   `organization_admin`, not merely `canManageOrganization`. A read that exposes
   what only two roles can create should not be available to a third.

4. **`messages` is redacted on the way out regardless.** Defence in depth: even
   with decisions 1–3, `mapSession` routes `messages` through a scrub before
   returning them. Decision 2 is what keeps secrets out; this is what limits the
   blast radius if it ever fails.

5. **Existing transcripts are purged by migration** — `onboarding_sessions.messages`
   is set to `'[]'::jsonb` for **every** existing row. Forward-only, no attempt
   to selectively detect which rows carry a secret: the detection that cannot be
   trusted going forward (decision 2) cannot be trusted retroactively either.

   **The session rows themselves are NOT deleted.** "Purge the existing rows"
   was the instruction; this ADR reads it as purging the credential-bearing
   *content*, because `bms.audit_log` carries `master.onboarding.commit` rows
   whose `entity_id` is the session id. Deleting sessions would orphan audit
   entries that `F4.14`'s read API now surfaces — destroying audit history to
   fix a credential leak is a bad trade. **If the intent was to delete the rows
   outright, this decision needs changing before the migration is written.**

6. **No key rotation here.** Credentials already encrypted stay as they are;
   rotation and the unconfigured-key visibility gap are `E8.4`, deliberately
   untouched.

## Amendment 1 (2026-08-10) — the security review's findings

Four confirmed defects, all fixed before merge. Recorded here rather than
silently patched, because three of them are places where the *first* pass of
this ADR was wrong rather than merely incomplete.

**H1 — the detector missed the shapes that matter most.** `looksLikeCredential`
was a keyword list, and the review demonstrated bypasses by execution, not
argument: `mqtt://pheadmin:hunter2@phe.thinkiot.co.in:8883` — a paste of the
wizard's *own default broker host* — plus `pw:`, `creds:`, `login:`,
`passphrase:`, `Authorization: Basic …`, zero-width characters inside the
keyword, and Cyrillic homoglyphs. Fixed with URI-userinfo and HTTP-auth *shape*
checks that need no keyword, NFKC normalisation, zero-width stripping and a
homoglyph fold, plus the missing terms. **And decision 4 was not defence in
depth at all**: `scrubMessages` called the same predicate, so its miss set was
identical by construction. It is still the same predicate — now a much stronger
one — and that limitation is stated rather than implied.

**H2 — the wizard still told users to paste credentials into chat.** The Excel
follow-up ended *"or paste credentials in chat"* and printed a copy-paste
template containing `username:`/`password:` lines. Only the RTU prompt was fixed
in the first pass. Worse, the template would now be *refused* by decision 2, so
a user following the instruction hit a wall. Both are gone. Separately, the
**assistant** turn was never inspected — on the OpenAI path it is model output,
so a model echoing back a secret was stored unchecked. It is now scrubbed (not
refused: the turn is ours, so there is nobody to ask to retype it).

**M1 — the role gate moved to the wrong place.** Decision 3 raised `getSession`
only, leaving `chat`, `patchDraft`, `uploadExcel` and `validate` on the weaker
check — inverting this ADR's own principle by making the writes weaker than the
read. The check now lives in `loadSession`, so every caller inherits it.

**M2 — model output was trusted where client input was not.**
`parsed.draftPatch` was cast from the model's JSON and merged with a spread that
preserves unknown keys, so a `_secrets` key could overwrite the encrypted
credential store and `rtus[].config.password` could land as plaintext. It is now
`onboardingDraftSchema.safeParse`d, the same contract `patchDraft` already
applied to clients. And `redactDraftForClient` now scrubs `rtus[].config` —
previously the client response was *less* redacted than the LLM context.

**Still open, deliberately:** `pino` logs the `authorization` header on every
request (repo-wide, pre-existing, §9.6 — its own ticket), and `uploadExcel`
remains the last caller that can reach `mergeDraft`'s unencrypted
`credentialsSet: true` branch when the key is unset (`E8.4`).

## Amendment 2 (2026-08-10) — the detector is narrowed, and Amendment 1 is corrected

A second review, of Amendment 1's own fixes, found they introduced worse defects
than they closed. Recorded in full because two were mine and one is an
overclaim in this document.

**A denial of service was introduced.** The URI shape regex added by Amendment 1
used an unbounded `[a-z0-9+.-]*` and was quadratic: **74 ms per chat turn** at
`chatBodySchema`'s own 8,000-character maximum, and **~15.7 s of blocked event
loop per session read** for a 100-turn transcript, because `scrubMessages` walks
every stored message on every `mapSession`. Node is single-threaded, so that was
an API-wide outage, not an onboarding one. ~~Fixed by bounding every quantifier,
adding a literal `://` pre-filter, and capping the scanned length at 8,000
characters inside the detector rather than trusting the request schema.~~
**Those two struck claims are false — see Amendment 3.** The `://` pre-filter is
real and effective; the quantifier bound and the scan cap were not delivered,
and the shipped code was 52× slower than the defect this paragraph describes.

**The detector deleted its own remediation guidance.** With the separator
optional, `looksLikeCredential` matched the product's own copy — *"Add its
credentials with the **Credentials** field"* — and `docs/env-inventory.md`
records that compose never sets `OPENAI_API_KEY`, so the rule-based path is the
default *and* the pilot path. Every MQTT RTU addition therefore replaced the one
message telling users where the Credentials field is with `[REDACTED]`. The
marker even matched itself.

**So decision 2 is narrowed, not grown.** A separator (`:`, `=`, or `is`) is now
**mandatory** for every term. That single rule removes the collateral damage,
most of the ReDoS surface and the false positives on ordinary English
("Community Hall", "the token bus is down").

**The trade is explicit.** These are now **documented misses**, asserted as tests
so they cannot be mistaken for coverage: a bare value (`hunter2`), a keyword
with no separator (`api key abc123`), userinfo with no scheme
(`pheadmin:hunter2@host`), and `MQTT_PASSWORD=x` where a leading underscore
defeats the word boundary. *(This enumeration is itself incomplete — Amendment 3
widens it.)* **This is acceptable only because decision 1
exists** — the detector is a nudge; the control is that credentials have a
typed home and the wizard no longer asks for them in chat. Three review rounds
each found this predicate simultaneously too narrow and too broad, which is the
evidence that it should not be the control.

**Amendment 1 overclaimed, and those lines are wrong.** It said the URI shape
and the client/LLM redaction inversion were closed. Neither fully was: the
scheme-less form was missed, the invisible/homoglyph fold was partial, and
`meta` (`z.record(z.unknown())`, like `config`) is **still unscrubbed on the
client path**, so the inversion persists. Corrected here rather than left as
provenance, because this ADR's own §Context says a redactor that appears to
cover something and does not is worse than none.

**Still open after this amendment**, all from the second review and none fixed
here: `meta` unscrubbed for clients (M2); `scrubSecrets` matching keys
case-sensitively and exactly, so `Password`/`pwd`/`api_key` survive (M3);
`onboardingDraftSchema.safeParse(...).data ?? {}` discarding an entire partial
patch, leaving the OpenAI path writing nothing while reporting success (M1);
and `_secrets` keyed by array index while `mergeDraft` replaces `rtus` wholesale,
which `POST :id/credentials` makes newly load-bearing (M4). Each needs its own
decision.

## Amendment 3 (2026-08-10) — Amendment 2 did not fix the ReDoS, and said it did

A third review, of Amendment 2, found that the denial of service was **moved,
not removed**, and that the amendment's claim to have fixed it was false. This is
the third consecutive round in which a fix to this predicate introduced or
preserved a defect while the document asserted otherwise. That pattern is now
the most important fact in this ADR, and it is why decision 1 — not this
detector — is the control.

**The quadratic moved from the URI regex to the value trim.**
`[^\w/.@-]+$` backtracks over an entire run of non-word characters at every
start index, so it is O(n²) in the length of the value handed to it. Two
unbounded quantifiers fed it:

1. `TERM_PATTERN` captured `(\S+)`, so a single value could span the whole scan.
2. `normalise` applied `.slice(0, MAX_SCAN)` **before** `.normalize("NFKC")`, and
   NFKC expands. `U+3316` (㌖) becomes six characters with no whitespace, so a
   **7,912-character input — inside `chatBodySchema`'s own 8,000 cap** — was
   normalised to 47,412 characters and the cap bounded nothing.

Measured against the shipped module, per request:

| input (all ≤ 8,000 chars) | Amendment 2 | Amendment 3 |
| --- | --- | --- |
| `password: a` + `!`×7900 + `a` | 110 ms | 0 ms |
| `password: a` + `㌖`×7900 + `a` | 3,083 ms | 0 ms |

Amendment 2 called the 74 ms it replaced "an API-wide outage". The code it
shipped was **110 ms on plain ASCII and 3,083 ms on one repeated character** —
a 52× regression on the exact metric it claimed to have fixed.

**Fixed** by bounding the capture to `(\S{1,256})` — no real secret is 256
non-space characters long — and by slicing to `MAX_SCAN` *again after* NFKC. The
trim is now named `VALUE_TRIM` and carries a comment saying it is quadratic and
safe only because the capture is bounded, so the two cannot drift apart.

**Scope correction, so this is not overstated.** The ~15.7 s-per-read
amplification Amendment 2 cites does **not** exist here. Any input expensive
enough to trigger the quadratic strips to a value that is neither in
`NON_VALUES` nor a bare term, so `looksLikeCredential` returns `true`, the turn
is refused before any write, and `scrubMessages` never re-pays the cost. This
was one stall per authenticated request, repeatable, behind
`assertOnboardingAccess` — a tenant admin could stall the API for every other
tenant. Blocking, but not a read-path amplifier.

**The test that was supposed to catch this measured nothing.** The assertion
used `"a".repeat(200000)`: a uniform run of word characters never enters the
trim's backtracking path, so it ran in 0 ms and passed throughout. It has been
replaced with the two inputs above, asserted under 100 ms — both exceeded that
on the old code. A cost assertion that does not exercise the quadratic is worse
than none, for the same reason this ADR gives about redactors.

**The documented-miss enumeration was materially incomplete.** Amendment 2 named
four misses and asserted them as tests "so they cannot be mistaken for
coverage" — the enumeration itself then understated the gap. Two causes, both
wider than stated: only `\s*` may sit between a term and its separator, and `\b`
fails after *any* word character rather than only a leading underscore. So the
missed set includes **every quoted or structured paste** — `{"password":
"hunter2"}`, a `.conf` line, XML, and the wizard's own `**password**:` markdown
convention — and **every camelCase/snake_case config key** (`accessToken:`,
`client_secret=`, `mqtt_password=`), which is precisely the text a user pastes
out of a broker configuration. All are now asserted as tests. The detector was
**not** grown to cover them: doing so is what failed three times.

**Two still-open items are re-ranked, and one was dropped from the list.**

- **M4 (`_secrets` keyed by array index) is the sharpest, not the last.** It is
  credential *misdelivery*, not a redaction miss: `PATCH :id/draft` accepts a
  full `rtus` array and `mergeDraft` replaces it wholesale, while `_secrets` is
  untouched, so deleting or reordering an entry makes
  `readEncryptedCredentials(session.draft, i)` decrypt one RTU's password into
  a **different broker's** `rtu_connection_configs` row.
- **M3 (`scrubSecrets` exact-case key match) is an ADR 0011 decision 4 gap**, not
  only a client-response issue: it is the only filter between `rtus[].config`
  and the LLM prompt, and `Password`/`pwd`/`api_key`/`secret`/`token` all reach
  both. The Excel path is not a vector (`onboarding-excel.service.ts` builds
  `config` from a fixed key set); the inline draft editor and the model's own
  `draftPatch` are.
- **M1 (`safeParse(...).data ?? {}`) ranks below both** — it fails closed, so it
  is a correctness and UX defect on a path compose never enables.
- **pino was dropped from Amendment 2's list and is restored here**:
  `app.module.ts` configures `LoggerModule` with no `redact` and the default
  request serialiser, so the `authorization` header is logged for every request
  including `POST :id/credentials` (§9.6). Request bodies are not logged, so the
  credential payload itself is not. Belongs with E8.4.
- **`keyVersion` is computed and discarded** — `credential-crypto.service.ts`
  returns it; the draft store keeps only `{ c, iv }`, so ADR 0012's rotation
  requirement is unmet for onboarding drafts. Pre-existing, but
  `POST :id/credentials` is a new writer into it. Belongs with E8.4.

None of these are fixed here. Only the ReDoS, the test, and this document's own
false statements are.

## Dependencies

**None.** No new npm package — `CredentialCryptoService` and the Zod/Nest
surfaces all exist.

## Consequences

- **Takes the migration lock.** One migration-bearing job at a time; the drizzle
  journal is a single shared file. Needs `migration-reviewer` before merge.
- **Breaking for the wizard UI.** `apps/web`'s onboarding flow must call the new
  endpoint instead of relying on chat parsing. A UI that still tells users to
  paste credentials into chat re-opens the hole at the presentation layer, so
  the prompt text is part of this change, not follow-up.
- **`messages` becomes lossy for old sessions.** Anyone relying on transcript
  history for pre-migration sessions loses it. That is the point.
- **Detection is now a refusal, not a parse.** Users who paste credentials get
  told to use the field. This is a deliberate UX cost.
- **Not closed by this ADR:** `E8.4` (key rotation, unconfigured-key
  visibility), and the `AccessControlService` JWT-claim fallback recorded
  against `F4.10` — a `location_admin` is excluded by decision 3, but an
  *unprovisioned* principal claiming `organization_admin` still resolves through
  the claim, exactly as ADR 0021 Amendment 1 found for audit read.

## Promotion follow-ups (AGENTS.md §10, owed separately)

- **AGENTS.md** — §2's onboarding row gains the credentials endpoint and the
  "credentials never transit chat" rule; §4.7 gains the tightened `getSession`
  gate; §9.6's secret-handling line should name the chat transcript explicitly.
- **`docs/roadmap.md`** — mirror `E8.3` per §10 step 4.
- **`docs/BACKLOG.md`** — flip `E8.3` after tests pass, and **correct its row**:
  the "any authenticated user" claim is false and should not survive as
  provenance.
