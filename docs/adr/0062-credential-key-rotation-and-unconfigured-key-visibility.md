# ADR 0062 — Credential encryption key rotation, and an unconfigured key that says so

## Status

Accepted

## Context

ADR 0012 closed with a consequence rather than a decision: *"Key rotation
requires `key_version` support in a future sprint."* This is that sprint —
`E8.4`, Wave 0, P1.

Three things are true of the code today, each measured on 2026-09-10 rather
than assumed.

**1. There is no rotation path, and the version is pinned in three places.**
`CredentialCryptoService` declares `private readonly keyVersion = 1`
(`credential-crypto.service.ts:17`) and stamps it on every payload. Worse,
`decrypt(ciphertext, iv)` accepts no version at all, so a stored
`key_version` could never be acted on even if it varied. And the RTU write site
discards the payload's version and writes a literal — `keyVersion: 1` at
`onboarding-commit.service.ts:346` — so after any bump, RTU rows would
mislabel their own ciphertext. A compromised key cannot be retired without
re-entering every credential by hand.

**2. Rotation covers two encrypted surfaces, not one.** The `E8.4` backlog row
names RTU credentials only. `NotificationChannelsService` encrypts webhook HMAC
secrets through the same service and stores the same pinned version —
`this.crypto.encrypt(...)` at `channels.service.ts:845`, `secretKeyVersion:
payload.keyVersion` at `:849`, and `this.crypto.decrypt(row.secretCiphertext,
row.secretIv)` at `:914`. AGENTS.md's Secrets row already records that
`secret_ciphertext`/`secret_iv`/`secret_key_version` plus
`CredentialCryptoService` "is what a future per-org relay password would use".
A rotation that covered one table would leave the other unrotatable and silently
stale.

**3. An unset key fails closed on storage but open on authentication.** Two
sites, with opposite behaviour:

- `onboarding.service.ts:159` **fails closed** — 503, with a comment that names
  `E8.4` as the false-success it refuses to become. This is correct and stays.
- `onboarding-chat.service.ts:757-759` **fails open** — with no key it skips
  encryption entirely and sets `credentialsSet: true` anyway, so the draft
  reports a stored credential that does not exist.
- `rtu-config.js:48-75` **fails open and mislabels** — with a config row present
  but no key (or no ciphertext), `resolveMqttConnection` returns the global
  `MQTT_USERNAME`/`MQTT_PASSWORD` and reports `source: "db"`. The label is a
  false statement about which credential the broker will see.

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

2. **The version is configuration, never a literal.** `CredentialCryptoService`
   reads the current version from the environment and stamps it on
   `EncryptedPayload.keyVersion`. Every write site stores **the payload's**
   version. `onboarding-commit.service.ts:346`'s literal `keyVersion: 1` becomes
   `keyVersion: enc.keyVersion`, so the stored version cannot drift from the key
   that produced the ciphertext.

3. **`decrypt` takes the stored version and selects a key by it.** The signature
   becomes `decrypt(ciphertext, iv, keyVersion)`. The current version uses the
   current key; the current version minus one uses the previous key; any other
   value throws a named error that says which version was stored and which are
   loaded. Guessing by trying both keys is refused: an AES-GCM tag check would
   make the guess *work*, and a rotation that silently accepts an unknown
   version can never report that it has finished.

4. **A misconfigured pair fails closed at startup, not at first use.** If
   `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` is set while
   `CREDENTIAL_ENCRYPTION_KEY_VERSION` is `1`, the two keys claim the same
   version and the application refuses to boot. The same refusal covers a
   previous key that is not 32 bytes. A configuration error that surfaces on the
   first decrypt surfaces in production, at a broker connection, on one RTU.

5. **One re-encryption command, both tables.** `pnpm --filter api
   rotate-credentials` opens a standalone Nest context and walks
   `bms.rtu_connection_configs` and `bms.notification_channels`, decrypting each
   row at its stored version and re-encrypting at the current one. It connects
   as **`bms_fleet`** (`BYPASSRLS`): rotation is a fleet-wide operation and an
   RLS-scoped connection would silently skip every other organization's rows and
   still report success. It is idempotent — a row already at the current version
   is skipped — and it reports counts per table, so "rotation finished" is a
   number, not an absence of errors.

6. **No schema change.** `bms.rtu_connection_configs.key_version` already exists
   (`integer not null default 1`) and `bms.notification_channels.secret_key_version`
   already exists (`integer`, nullable — a channel with no secret writes `null`
   at `channels.service.ts:843`, which stays). This ADR adds no migration.

7. **An unconfigured key never reports a stored credential.**
   `onboarding-chat.service.ts:757-759` stops setting `credentialsSet: true`
   when the key is absent. The credential is dropped, as it already is, and the
   draft says so rather than the opposite. This is the visible-when-absent
   treatment ADR 0041 decision 5 refers to: discoverable from the UI without
   reading a log file.

8. **The ingest connection reports which credential it will actually use.**
   `resolveMqttConnection` gains `credentialSource: "db" | "env"`, set to `"db"`
   only when credentials were decrypted from the row. The existing `source`
   field keeps its present meaning — where **host and port** came from — because
   that is what it already describes for a row whose credentials were never
   stored. The host logs a warning when a config row exists and
   `credentialSource` is `"env"`: that is the fail-open case, and it is now
   named rather than disguised. `MqttConnectionResolver` in
   `apps/ingest/src/host/bindings.ts` widens to match (ADR 0016 §9 keeps the
   resolver injected, so tests still need no key).

9. **The `MQTT_USERNAME`/`MQTT_PASSWORD` fallback stays.** ADR 0016 §6 commit
   4's fifth action conditioned retiring it on the pilot RTU having an
   `rtu_connection_configs` row, and ADR 0016 Amendment 3 reassigned that action
   to `E8.4`. The table still holds 0 rows, re-measured on 2026-09-10, so the
   condition the ADR itself set is still unmet and the fallback is still the
   pilot's only working credential path. Decision 8 makes the fallback
   **honest**, which is the part that does not depend on data. Retiring it stays
   open under `E8.4` and is blocked on someone entering the PHE broker password
   through the `E8.3` credentials field — not on this decision.

10. **Tests never require a key.** `CREDENTIAL_ENCRYPTION_KEY` appears nowhere
    in `.github/workflows/ci.yml`, which AGENTS.md §4.3 also records. The
    rotation command's unit
    gates generate their own keys in-process and the ingest resolver keeps its
    injected `CredentialDecryptor`, so no gate here depends on deployment
    configuration.

## Dependencies

None. No new npm package; `node:crypto` already carries AES-256-GCM.

## Consequences

- **Rotation is exercised against empty tables.** The command's correctness rests
  on its own gates and on a planted fixture, not on production data. That is
  stated so a later reader does not mistake a green run for a migration that
  happened.
- **A three-key window is not supported.** Rotating twice before the command has
  finished the first pass leaves rows at a version neither key can read, and
  decision 3 makes that a loud error rather than a silent skip. Operationally:
  finish one rotation before starting the next.
- **`decrypt`'s signature changes**, so every caller is touched — two read sites
  today (`channels.service.ts:914` and the ingest path). That is the point: a
  caller that cannot supply a version is a caller that was ignoring one.
- **`E8.4` does not fully close.** Decision 9 leaves the env-fallback retirement
  open, blocked on data. The row stays open with that single item, and the
  backlog row must say which part shipped and which did not.
- ADR 0012's rotation consequence and ADR 0041 decision 5's forward reference
  are both discharged by this record.
- Promotion follow-ups owed in a separate `chore(agents):` PR (AGENTS.md §9.10):
  the Secrets row at AGENTS.md §4 gains the two-key window, the Ingest adapters
  row's `E8.4` reassignment gains decision 8, and `docs/BACKLOG.md` plus
  `docs/roadmap.md` record what shipped.
