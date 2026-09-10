# ADR 0062 — Credential encryption key rotation, and an unconfigured key that says so

## Status

Accepted

## Context

ADR 0012 closed with a consequence rather than a decision: *"Key rotation
requires `key_version` support in a future sprint."* This is that sprint —
`E8.4`, Wave 0, P1.

Four things are true of the code today, each measured on 2026-09-10 rather than
assumed.

**1. There is no rotation path, and the version is pinned or absent everywhere.**
`CredentialCryptoService` declares `private readonly keyVersion = 1`
(`credential-crypto.service.ts:17`) and stamps it on every payload.
`decrypt(ciphertext, iv)` accepts no version at all, so a stored `key_version`
could never be acted on even if it varied. The RTU write site discards the
payload's version and writes a literal — `keyVersion: 1` at
`onboarding-commit.service.ts:346`. A compromised key cannot be retired without
re-entering every credential by hand.

**2. Rotation covers two encrypted surfaces, not one.** The `E8.4` backlog row
names RTU credentials only. `NotificationChannelsService` encrypts webhook HMAC
secrets through the same service and stores the same pinned version —
`this.crypto.encrypt(...)` at `channels.service.ts:845`, `secretKeyVersion:
payload.keyVersion` at `:849`, and `this.crypto.decrypt(row.secretCiphertext,
row.secretIv)` at `:914`. AGENTS.md's Secrets row already records that
`secret_ciphertext`/`secret_iv`/`secret_key_version` plus
`CredentialCryptoService` "is what a future per-org relay password would use".
A rotation covering one table would leave the other unrotatable and silently
stale.

**3. The version is missing from two carriers, not merely pinned.** Counted from
source, because the row named one site and the source has eight:

| Site | What it is | Carries a version |
| --- | --- | --- |
| `credential-crypto.service.ts:17,60` | the pin; `decrypt` takes no version | no |
| `channels.service.ts:849` | channel secret write | yes — `payload.keyVersion` |
| `channels.service.ts:914` | channel secret read | no |
| `onboarding-commit.service.ts:346` | RTU credential write | literal `1` |
| `onboarding-redaction.ts:327,364` | the draft `_secrets` blob, `{ c, iv }` | **no** |
| `rtu-config.js:5-30` | **a second, independent AES-GCM implementation** | no |
| `bindings.ts:176,186` | `CredentialDecryptor`, `MqttConnectionResolver` | no |
| `bindings.ts:119-130` | the binding-plan SQL | selects no `key_version` |

Two of these matter more than the pin itself. **The ingest does not call
`CredentialCryptoService`** — `rtu-config.js` carries its own `createDecipheriv`,
its own `CREDENTIAL_ENCRYPTION_KEY` read and its own `TAG_LENGTH`, so a two-key
window written once in `apps/api` would leave the ingest unable to read anything
the rotation produced. And **the onboarding draft stores ciphertext with no
version**: `attachEncryptedCredentials` writes `{ c, iv }` and
`readEncryptedCredentials` returns `{ ciphertext, iv }`, so a draft encrypted
before a rotation and committed after it would be stored under a label that does
not describe its ciphertext.

**4. An unset key fails closed on storage but open on authentication.** Three
sites, two of them opposite:

- `onboarding.service.ts:159` **fails closed** — 503, with a comment that names
  `E8.4` as the false-success it refuses to become. This is correct and stays.
- `onboarding-chat.service.ts:757-759` **fails open** — with no key it skips
  encryption entirely and sets `credentialsSet: true` anyway, so the draft
  reports a stored credential that does not exist.
- `rtu-config.js:48-75` **fails open and mislabels** — with a config row present
  but no key (or no ciphertext), `resolveMqttConnection` returns the global
  `MQTT_USERNAME`/`MQTT_PASSWORD` and reports `source: "db"`.

ADR 0041 decision 5 already forward-references this record — readiness reports
"the same *visible-when-absent* treatment `E8.4` specifies for an unconfigured
`CREDENTIAL_ENCRYPTION_KEY`". That reference has been dangling. This ADR is what
it points at.

**Both credential tables are empty.** Re-measured 2026-09-10 as `bms_app`
(`rolsuper = t`, so this is not the count-as-`bms_owner` trap):
`bms.rtu_connection_configs` **0 rows**, `bms.notification_channels` **0 rows**,
against **56 rows** in `bms.rtus`. Rotation therefore has nothing to re-encrypt
today. That is the argument for building it now: the mechanism is written and
gated while a mistake costs nothing, instead of first being needed on the day a
key is known to be compromised.

## Decision

1. **Two keys, one current.** `CREDENTIAL_ENCRYPTION_KEY` remains the key that
   *encrypts*. `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` (optional, 32-byte base64)
   is accepted for *decryption only*. `CREDENTIAL_ENCRYPTION_KEY_VERSION`
   (integer, default `1`) names the version the current key writes; the previous
   key is that version minus one. No JSON key map — a secret-bearing env var
   that has to be parsed is harder to review than two named ones.

2. **One key resolver, in `packages/shared`.** The env parse and the
   version-to-key mapping live in `packages/shared/src/credential-keys.ts`,
   published as a new `./credential-keys` subpath alongside `./ingest` and
   `./contracts`, and both `CredentialCryptoService` and
   `apps/ingest/src/rtu-config.js` use it. A runtime import from
   `@bms/shared` already works in the ingest — `supervisor.ts` imports
   `backoffDelayMs` and `DEFAULT_BACKOFF` as values, not types.
   The ingest's duplicate AES-GCM implementation is the reason: two copies of a
   *pin* drift harmlessly, two copies of a *rotation window* disagree about
   which key reads which row. This follows `F4.34`, which moved the ADR 0016 §5
   backoff table into `packages/shared/src/ingest.ts` the moment it gained a
   second consumer, for the same stated reason. The cipher call itself may stay
   duplicated; the key selection may not.

3. **The version is configuration, never a literal, and it travels with the
   ciphertext.** `EncryptedPayload.keyVersion` is read from the resolver, and
   every carrier records it:
   - `onboarding-commit.service.ts:346` writes `enc.keyVersion` in place of the
     literal. When `enc` is `null` — the branch that stores no ciphertext — the
     `NOT NULL` column gets the **current** version. It labels nothing, and a
     credential-less row must not claim to hold a version no key can read.
   - The draft blob gains a version: `attachEncryptedCredentials` writes
     `{ c, iv, v }` and `readEncryptedCredentials` returns it. A blob written
     before this change has no `v` and is read as version `1`, which is what
     every existing blob in fact is.
   - The binding-plan SQL at `bindings.ts:119-130` selects `c.key_version`, and
     `MqttConnectionResolver`'s row type and `CredentialDecryptor` widen to
     carry it.

4. **`decrypt` takes the stored version and selects a key by it.** The signature
   becomes `decrypt(ciphertext, iv, keyVersion)` in the API and
   `decryptCredentials(ciphertext, iv, keyVersion)` in the ingest. The current
   version uses the current key; the current version minus one uses the previous
   key; any other value throws a named error saying which version was stored and
   which are loaded. Guessing by trying both keys is refused: an AES-GCM tag
   check would make the guess *work*, and a rotation that silently accepts an
   unknown version can never report that it has finished.

5. **A previous key at version 0 fails closed at startup, in both
   applications.** `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` set while
   `CREDENTIAL_ENCRYPTION_KEY_VERSION` is `1` makes the previous key version
   `0`, and no row can hold version 0 — `rtu_connection_configs.key_version` is
   `not null default 1` and has only ever been `1`. A key that can decrypt
   nothing is dead configuration, and the most likely cause is a rotation whose
   version bump was forgotten. The API and the ingest both refuse to boot on
   it, and on a previous key that is not 32 bytes. A configuration error that
   waits for the first decrypt surfaces in production, at a broker connection,
   on one RTU.

6. **One re-encryption command, both tables, selected on ciphertext.**
   `pnpm --filter api rotate-credentials` opens a standalone Nest context and
   walks `bms.rtu_connection_configs where credentials_ciphertext is not null`
   and `bms.notification_channels where secret_ciphertext is not null`. It
   selects on the ciphertext, **not** on the version: `key_version` is `NOT
   NULL`, so a row that stores no credentials still reads `1` and a
   version-driven walk would hand `null` to `decrypt`. Each selected row is
   decrypted at its stored version and re-encrypted at the current one. It
   connects as **`bms_fleet`** (`BYPASSRLS`): rotation is a fleet-wide operation
   and an RLS-scoped connection would silently skip every other organization's
   rows and still report success. It is idempotent — a row already at the
   current version is skipped — and it reports counts per table, so "rotation
   finished" is a number, not an absence of errors.

7. **No schema change.** `bms.rtu_connection_configs.key_version` already exists
   (`integer not null default 1`) and `bms.notification_channels.secret_key_version`
   already exists (`integer`, nullable — a channel with no secret writes `null`
   at `channels.service.ts:843`, which stays). This ADR adds no migration.

8. **An unconfigured key never reports a stored credential.**
   `onboarding-chat.service.ts:757-759` stops setting `credentialsSet: true`
   when the key is absent. The credential is dropped, as it already is, and the
   draft says so rather than the opposite. This is the visible-when-absent
   treatment ADR 0041 decision 5 refers to: discoverable from the UI without
   reading a log file.

9. **The ingest reports which credential it will actually use.**
   `resolveMqttConnection` gains `credentialSource: "db" | "env"`, set to `"db"`
   only when credentials were decrypted from the row. `source` is **narrowed and
   documented**, not reinterpreted: today it reports `"db"` whenever a config row
   existed, even though `host` and `port` fall back to `globalHost`/`globalPort`
   inside that same branch (`rtu-config.js:69-70`), so the field currently names
   the row's existence and nothing else. It keeps that meaning and its docblock
   now says so. The host logs a warning when a config row exists and
   `credentialSource` is `"env"` — that is the fail-open case, and it is named
   rather than disguised.

10. **The `MQTT_USERNAME`/`MQTT_PASSWORD` fallback stays.** ADR 0016 §6 commit
    4's fifth action conditioned retiring it on the pilot RTU having an
    `rtu_connection_configs` row, and ADR 0016 Amendment 3 reassigned that
    action to `E8.4`. The table still holds 0 rows, re-measured on 2026-09-10,
    so the condition the ADR itself set is still unmet and the fallback is still
    the pilot's only working credential path. Decision 9 makes the fallback
    **honest**, which is the part that does not depend on data. Retiring it stays
    open under `E8.4`, blocked on someone entering the PHE broker password
    through the `E8.3` credentials field — not on this decision.

11. **Tests never require a key.** `CREDENTIAL_ENCRYPTION_KEY` appears nowhere
    in `.github/workflows/ci.yml`, which AGENTS.md §4.3 also records. The
    rotation command's gates generate their own keys in-process, and the ingest
    keeps its injected `CredentialDecryptor` (ADR 0016 §9), so no gate here
    depends on deployment configuration.

## Dependencies

None. No new npm package; `node:crypto` already carries AES-256-GCM.
`apps/ingest` already depends on `@bms/shared` (the ADR 0016 §5 backoff table
lives there), so decision 2 adds no dependency edge.

## Consequences

- **Rotation is exercised against empty tables.** The command's correctness rests
  on its own gates and on a planted fixture, not on production data. Stated so a
  later reader does not mistake a green run for a migration that happened.
- **A three-key window is not supported.** Rotating twice before the command has
  finished the first pass leaves rows at a version neither key can read, and
  decision 4 makes that a loud error rather than a silent skip. Operationally:
  finish one rotation before starting the next.
- **`decrypt`'s signature changes in both applications**, so every read site is
  touched — `channels.service.ts:914` in the API and the whole
  `rtu-config.js` → `bindings.ts` chain in the ingest, including the SQL. That
  is the point: a caller that cannot supply a version is a caller that was
  ignoring one.
- **`rtu-config.js` stops being the unmodified pilot-era file** AGENTS.md's
  Ingest adapters row describes. It is not frozen — the freeze was on
  `src/index.js`, which ADR 0016 §6 commit 4 deleted — but the rulebook's
  sentence becomes stale and the promotion sweep must correct it.
- **`E8.4` does not fully close.** Decision 10 leaves the env-fallback
  retirement open, blocked on data. The row stays open with that single item,
  and the backlog row must say which part shipped and which did not.
- ADR 0012's rotation consequence and ADR 0041 decision 5's forward reference
  are both discharged by this record.
- Promotion follow-ups owed in a separate `chore(agents):` PR (AGENTS.md §9.10):
  the Secrets row gains the two-key window, the Ingest adapters row's
  "unmodified `rtu-config.js`" sentence and its `E8.4` reassignment gain
  decision 9, and `docs/BACKLOG.md` plus `docs/roadmap.md` record what shipped.

## Amendment 1 — decision 5 covers two more dead windows (2026-09-10)

The step-3 plan (`docs/plans/e8.4-credential-key-rotation.md`) asked seven
questions at its gate and the owner ruled all seven as recommended the same day.
Five are implementation choices and live in the plan's §12. Two widen **decision
5**, so they are recorded here rather than there — decision 5 as written names
only the *previous* key, and building to the plan without this amendment would
have made the ADR describe less than the code does.

Decision 5's refusal now covers three configurations, not one:

1. A previous key at version 0 — the original decision, unchanged.
2. **A `CREDENTIAL_ENCRYPTION_KEY` that does not decode to 32 bytes.** Today it
   reads as *unconfigured* — `isConfigured()` answers false and the throw waits
   for the first use — so a typo in the key silently becomes "no encryption
   available" and the failure surfaces at a broker connection or a webhook
   secret rather than at boot. That is the same argument decision 5 already
   makes about a dead previous key, applied to the key that matters more. The
   two states are genuinely different and only one of them is configuration:
   **unset stays unconfigured** and every fail-closed path already handles it;
   **malformed refuses the boot.**
3. **`CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` set while `CREDENTIAL_ENCRYPTION_KEY`
   is unset.** The likeliest cause is that the two names were swapped during a
   rotation, and the resulting process is a half-done one — it could decrypt
   what exists and could not encrypt anything new, so the next credential
   written would be dropped by decision 8's honest path while the operator
   believed a rotation was in progress.

Both refusals happen in `resolveCredentialKeys`, so both applications inherit
them from decision 2's single resolver: the API through
`CredentialCryptoService`'s constructor under `NestFactory.create`, and the
ingest through `readHostConfig`. Nothing else in the ADR changes; decisions 1–4
and 6–11 stand as written.
