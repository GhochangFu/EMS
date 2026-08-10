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

**Fixed** by bounding the capture to `(\S{1,256})` and by slicing to `MAX_SCAN`
*again after* NFKC. The trim is now named `VALUE_TRIM` and carries a comment
saying it is quadratic and safe only because the capture is bounded, so the two
cannot drift apart. Independently re-measured by the fourth review: worst case
**3.22 ms** per 8,000-character turn across ~4,000 fuzzed and ~120 structured
adversarial inputs, against 3,083 ms before.

**The fix has a cost, and this paragraph first said it did not.** "No real
secret is 256 non-space characters long" was written here and is beside the
point — the bound is on what the *capture* consumes, not on the secret. Two
shapes the `(\S+)` version caught are now missed:

- **≥256 non-space non-word characters of prefix padding** — `password:` + 256
  `!` + `hunter2`. The capture takes only the padding, `VALUE_TRIM` empties it,
  the loop `continue`s, and `matchAll` resumes past the secret with no term in
  front of it. At 200 characters it still fires, so this is a bound, not a hole.
- **NFKC-expanding padding** — ~1,400 `㌖` ahead of the credential pushes it past
  the second slice. This one defeats **all three** shapes (term, URI and
  bearer), which matters because `INVISIBLE` and `HOMOGLYPHS` exist in this file
  for exactly that threat model.

Both are asserted in the spec, alongside the just-under-the-limit cases that
still fire. The trade is still right — the alternative is 3,083 ms per
request — but it is a trade, and Amendment 3 originally implied it was free.

**Scope, corrected twice.** The quadratic itself is not a read-path amplifier:
any input expensive enough to trigger it strips to a value that is neither in
`NON_VALUES` nor a bare term, so `looksLikeCredential` returns `true`, the turn
is refused before any write, and `scrubMessages` never re-pays it. The fourth
review tried to falsify that and could not. It was one stall per authenticated
request, repeatable, behind `assertOnboardingAccess` — a tenant admin could
stall the API for every other tenant.

But Amendment 3's flat claim that the read-path amplifier "does **not** exist
here" was **too broad, and is withdrawn**. That argument covers `TERM_PATTERN`
only. `URI_USERINFO` and `HTTP_AUTH` run *before* the term loop and are paid
whatever the verdict, so a turn that returns `false` at ~2.95 ms is accepted,
stored, and re-walked by `scrubMessages` on every read — measured 322 ms at 100
stored turns, 6.85 s at 2,000, and there is **no message-count cap** on a
session. Two things are true together: the mechanism is real, and it is ~50×
below the 15.7 s Amendment 2 described at the same 100-turn yardstick, and it is
**unchanged by this commit** (2.95 ms new vs 3.03 ms old). Residual, not
introduced — but the paragraph asserted a property the code does not have, which
is the failure this ADR exists to stop repeating. The transcript cap is not
taken here; it is added to the open list below.

**The test that was supposed to catch this measured nothing.** The assertion
used `"a".repeat(200000)`: a uniform run of word characters never enters the
trim's backtracking path, so it ran in 0 ms and passed throughout. It has been
replaced with the two inputs above.

**And the replacement was half-wrong too.** Amendment 3 first asserted them
under **100 ms** and claimed "both exceeded that on the old code". The fourth
review measured the old ASCII case at **78–133 ms over 12 trials** — so that
assertion missed the defect in **5 of 12 runs**, and would miss it more often on
faster CI hardware. Only the NFKC half discriminated. The threshold is now
**20 ms** (≥4× margin against the worst old-code figure, ≥50× against the
current 0.0–0.4 ms) on `performance.now()`, since `Date.now()` has 1–16 ms
granularity on Windows and is the wrong clock at this scale. A cost assertion
that does not exercise the defect is worse than none — stated in this amendment,
and then half-reproduced by it.

**The documented-miss enumeration was materially incomplete.** Amendment 2 named
four misses and asserted them as tests "so they cannot be mistaken for
coverage" — the enumeration itself then understated the gap. **Three** causes
(Amendment 3 first said two, and its own asserted example `password - hunter2`
needed the third): only `\s*` may sit between a term and its separator; `\b`
fails after *any* word character rather than only a leading underscore; and the
separator set is `:`/`=`/`is` only, so `-`, `,` and `->` all miss. So the
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

- **No cap on transcript length** — `onboarding.service.ts` appends two messages
  per turn without bound and `mapSession` walks all of them on every read, which
  is what turns the linear `://` scheme scan into 6.85 s at 2,000 stored turns.
  Pre-existing and untouched here; the natural home is a `messages` length cap
  decided alongside M1–M4.

None of these are fixed here. Only the ReDoS, the test, and this document's own
false statements are.

**Corrections made after the fourth review (2026-08-10).** This amendment as
first written contained three wrong claims, corrected above rather than left as
provenance: the 100 ms cost threshold did **not** reliably fail on the old code
(5 of 12 trials passed); the read-path amplifier claim was too broad and is
withdrawn for `URI_USERINFO`/`HTTP_AUTH`; and "no real secret is 256 non-space
characters long" implied the bound was free when it costs two documented
misses. "Every quantifier is bounded" was also still false and is now stated
precisely. The fourth review confirmed the ReDoS fix itself is sound.

**Four rounds, four times a fix to this predicate was defective or overclaimed.**
That is no longer a run of bad luck; it is the evidence for decision 1. Anyone
proposing to grow this detector should read this section first.

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

## Amendment 4 (2026-08-10) — M2 closed, M3 narrowed, M4 partially closed; the control gets its tests

> **Heading corrected by Amendment 5.** This section first read "M2, M3 and M4
> are closed". A fifth review found M4 still delivered one broker's credential
> to another RTU and M3 still leaked every compound key name. The claims below
> are struck where they were wrong rather than rewritten.

The first compliance review of this change found **no blocking issues** — scope
(§6), dependencies (§9.4), the `chore(agents):` isolation (§9.10), §4.1–4.7 and
the repo invariants are all clean. It found something else worth recording: the
**nudge had a 227-line spec and the control had none.** `setCredentials`, its
`.strict()` schema, its role gate and its fail-closed branch shipped untested,
and **neither Amendment 1 security fix had a regression test**, so re-narrowing
the gate to `getSession` or dropping `config` from the client scrub would have
been silent. `onboarding-credentials.{spec,test}.ts` now covers both, plus the
decision-1 guarantee that no plaintext, ciphertext or `_secrets` is ever echoed
back.

**M2, M3 and M4 are fixed.** They were left open across three amendments on the
grounds that each needed its own decision; the decisions are:

- **M4 — `_secrets` is keyed by RTU `code`, never by array position.** The
  positional key was the sharpest item in the open list: `PATCH :id/draft`
  accepts a full `rtus` array and `mergeDraft` replaces it wholesale, so a
  reorder made index `i` decrypt one broker's password into a **different
  broker's** `rtu_connection_configs` row. `mergeDraft` now reconciles the store
  on every merge — orphaned and renamed entries are **dropped**, and a code
  claimed by two RTUs drops rather than guesses ~~— **false as written; true of
  `reconcileSecrets` alone, see Amendment 5**~~. Losing a credential costs a
  retype; misdelivering one does not. `credentialsSet` is derived from the store
  instead of trusted from input, since `draftRtuSchema` lets any caller assert
  it — but only when encryption is configured, so the unconfigured path E8.4
  owns is not silently changed. `POST :id/credentials` refuses an RTU with no
  code rather than falling back to the index.
- **M3 — key matching is normalised.** `SECRET_KEYS.has(key)` was exact and
  case-sensitive, so `Password`, `pwd`, `api_key` and `client_secret` all
  survived. Because `redactDraftForLlm` composes `redactDraftForClient`, this
  was the only filter between `rtus[].config` and the LLM prompt — an **ADR 0011
  decision 4** gap, not the client-response cosmetic this ADR first called it.
- **M2 — `meta` is scrubbed on the client path**, for locations, RTUs and
  assets. `meta` is `z.record(z.unknown())` exactly like `config`, so scrubbing
  only `config` for clients left the client **less** redacted than the model —
  the inversion Amendment 1 claimed to have closed and Amendment 2 correctly
  said persisted.

**Measured, not assumed:** all 7 stored sessions hold **zero** `_secrets` and
zero drafts with RTUs, so no legacy index-keyed data needed migrating and the
new keying could be adopted without a compatibility fallback — a fallback would
have preserved the very defect it was meant to smooth over.

**ADR 0021 decision 6 fires here and passes.** `setCredentialsBodySchema` is a
new secret-bearing request body, which that ADR makes a standing audit-read
obligation. Onboarding's only audit writes are in `onboarding-commit.service.ts`
(`payload: result`, ids only; and `payload: { orgCode, via }`); neither carries a
request body, so there is no audit-read exposure. Recorded so the next reviewer
does not repeat the check.

**Still open, unchanged:** M1 (`safeParse(...).data ?? {}` discarding whole
partial patches — fails closed, on a path compose never enables), the missing
transcript-length cap, and pino's unredacted `authorization` header plus the
discarded `keyVersion`, both of which belong with **E8.4**.

**Observation, not a finding:** `setCredentials` writes no audit row — but
neither do `chat`, `patchDraft` or `uploadExcel`; only `commit` audits. That is
consistent with the module rather than a §9.8 bypass, but it does mean there is
no "who set credentials for which RTU" trail. Worth a decision alongside F4.15.

## Amendment 5 (2026-08-10) — the contested-code rule is enforced where it is needed

A fifth review found Amendment 4's M4 fix incomplete in the now-familiar shape:
**the invariant was enforced at the one place it was tested and at neither of
the two places it was needed.**

**H1 — whitespace-aliased codes delivered one broker's credential to another
RTU.** `rtuCodeAt` keyed on `code.trim()`, so two RTUs whose codes differ only by
trimmable whitespace aliased to a single `_secrets` key. `reconcileSecrets` was
the only caller that checked for a contested code, and `mergeDraft` runs it
**before** `attachEncryptedCredentials`; neither `attachEncryptedCredentials` nor
`readEncryptedCredentials` re-checked, and `onboarding-commit.service.ts` reads
positionally with no merge in between. Reproduced end to end through the real
`mergeDraft` and real AES-256-GCM: commit wrote the *same* ciphertext into both
`rtu_connection_configs` rows, so the ingest runtime offered the real broker
password to a second, attacker-chosen `config.host` — with `credentialsSet`
still `undefined` on that RTU, so the drawer showed no credential while commit
shipped one. E8.4's false-success, inverted into a silent one.

Three details that make this reachable rather than theoretical: `draftRtuSchema.
code` had no regex and no trim; JS `.trim()` removes NBSP, which renders as an
ordinary space in the preview drawer; and `bms.rtus`' `UNIQUE (location_id,
code)` does **not** catch it, because Postgres `varchar` comparison is not
blank-padded (`'PHE-01' = 'PHE-01 '` is false). A uniqueness check on raw strings
would not have closed this either.

**Fixed at the single point all three callers share:** `rtuCodeAt` now returns
`null` unless **exactly one** RTU claims the trimmed code. That makes the
endpoint answer 400, `attachEncryptedCredentials` throw, and
`readEncryptedCredentials` return `null` at commit — fail-closed everywhere,
rather than correct in the one function with a test. `draftRtuSchema.code` also
gained `.trim()`, so the alias cannot be created through the API at all.

**Why it shipped: the tests asserted the invariant only where it held.** The
contested-code case used *exact* duplicates and called `reconcileSecrets` in
isolation, and the endpoint test stubbed `mergeDraft`, so the `reconcile → attach`
composition — the exact site of the defect — was exercised by neither. The spec
now tests `rtuSecretKey`, `attachEncryptedCredentials` and
`readEncryptedCredentials` directly under contest.

**M3 was narrowed, not closed.** Amendment 4 matched the normalised key
**exactly**, so every compound name still leaked to both the client and the
model: `mqttPassword`, `mqtt_username`, `snmpCommunity`, `authPassword`,
`privPassword`, `keystorePassword`, `caCert`, `caKey`, `sasToken`,
`sharedAccessKey`, `credential`. Matching is now a normalised **substring**
against a fragment list. That is safe here in a way it was not for the chat
detector — this runs over structured key names from a known schema, not free
English — and it was checked against every field of all five draft schemas.
`credentialsSet` contains `credential` and is excluded by name: it is the status
flag the drawer renders, so redacting it would break the UI while protecting
nothing. A bare `key` fragment was **rejected** for the same reason: it would
swallow `pointKey` and `sourceDataKey`, which are core wizard vocabulary. `caKey`
and friends are enumerated instead.

**Corrected, not rewritten:** Amendment 4's heading claimed all three items were
closed, and its M4 paragraph claimed a property the system did not have. Both
are struck above.

**Also fixed:** the `docs/BACKLOG.md` E8.3 row stated coverage thresholds that
the same commit did not set (it named 31.1/26.1/32.0/31.2 while `vitest.config.
ts` set 31.9/26.9/32.9/32.1) — an internal contradiction inside the very item
whose point was that a document asserted a measurement the tree lacked.

**Verified true by the fifth review, recorded so they are not re-checked:** the
zero-`_secrets` count across all 7 sessions; the ADR 0021 decision-6 finding that
onboarding's audit writes carry ids and metadata but never a request body; M2's
closure (all four free-form records in the draft schema are now scrubbed for
clients); that removing the second gate call in `setCredentials` is safe; and
ADR 0012's unique-IV-per-encryption property.

**Bounded, and not claimed otherwise:** keying by `code` binds a credential to a
**name**, not an endpoint. An actor who can patch the draft can change
`config.host` under an unchanged code and redirect the credential at commit.
Index keying had the same property, and M4's fix never claimed to solve it — but
it bounds what "cannot hand this password to a different broker" can mean.
Closing it needs the credential bound to the resolved endpoint, which is its own
decision and belongs with **E8.4**.

**Five rounds.** Every round has found the previous round's fix defective or its
description overclaimed. The pattern has been consistent enough to name: fixes
land at the point that is easiest to test rather than the point that is
load-bearing, and the document then describes the intent rather than the code.

## Promotion follow-ups (AGENTS.md §10, owed separately)

- **AGENTS.md** — the **status line** gains ADR 0022 (its "Merged and in scope"
  list ends at ADR 0021; this list originally omitted the status line entirely);
  §2's onboarding row gains the credentials endpoint and the "credentials never
  transit chat; a credential-bearing turn is refused, not stored" rule; §2's
  **Secrets** row names this endpoint as a writer into the ADR 0012 store;
  **§4.7 gains a fourth gate** — *not* "the tightened `getSession` gate", which
  is how this list first read and is stale: Amendment 1 moved the check into
  `loadSession`, so it covers `getSession`, `chat`, `patchDraft`, `uploadExcel`,
  `validate` **and** `setCredentials`, and it is role (`admin`/
  `organization_admin`) **plus** `canManageOrganization` in one place. Copying
  the old wording would invite someone to re-narrow the gate. §9.6's
  secret-handling line should name the chat transcript explicitly. §3 needs
  nothing — no new folder.
- **`docs/roadmap.md`** — mirror `E8.3` per §10 step 4.
- **`docs/BACKLOG.md`** — flip `E8.3` after tests pass, and **correct its row**:
  the "any authenticated user" claim is false and should not survive as
  provenance.
