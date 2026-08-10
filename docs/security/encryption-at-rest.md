# Encryption at Rest

> **Backlog:** E8.1 (Track F, P1). **Related:** E8.2 automated backup &
> recovery · F3.3 object storage · ADR 0012 encrypted RTU credentials.
> **Audience:** whoever deploys and operates a TRINETRA instance.
> **Last verified against `main`:** 2026-08-04.

## 0. Read this first

Most of "encryption at rest" is **not** something this repository can
implement. Application code can encrypt individual columns; it cannot encrypt
the disk its database sits on. Postgres 16 community and the
`timescale/timescaledb:2.29.1-pg16` image we run have **no transparent data
encryption (TDE)** — that is an EDB/Cybertec/cloud-vendor feature, not an
upstream one.

So this document splits into two halves, and both matter:

- **§2 — what the application encrypts.** Real, in code, testable today. It is
  a narrow surface: connection credentials only.
- **§4 — what the deployer must configure.** Everything else. If §4 is not
  done, the database, the telemetry history, and every backup are sitting in
  plaintext on disk, no matter what §2 says.

**Do not read §2 as "the platform encrypts data at rest."** It does not. It
encrypts two credential fields. The rest is §4's job.

---

## 1. Summary table

| Data | At-rest state today | Mechanism |
|------|--------------------|-----------|
| RTU connection credentials (`bms.rtu_connection_configs`) | **Encrypted** | AES-256-GCM, application layer (ADR 0012) |
| Pending credentials in onboarding drafts (`bms.onboarding_sessions.draft._secrets`) | **Encrypted** | AES-256-GCM, same key |
| Local login passwords (`bms.users.password_hash`) | **Hashed, not encrypted** | bcrypt (cost 10) — one-way, see §2.3 |
| Onboarding chat transcript (`bms.onboarding_sessions.messages`) | **Plaintext** — see §5.1 | none |
| Telemetry (`telemetry.point_values`) | **Plaintext** | none |
| All master data, work orders, alarms, rules, audit log | **Plaintext** | none |
| Postgres data volume (`bms_bms-postgres-data`) | **Plaintext unless the host encrypts it** | deployer, §4.1 |
| Prometheus / Loki / Grafana volumes | **Plaintext unless the host encrypts it** | deployer, §4.1 |
| Keycloak realm + users | **Not persisted at all** (dev `start-dev`, embedded H2) — §5.3 | n/a |
| Backups | **No backup mechanism exists** — §6 | n/a (E8.2) |
| Object storage / uploaded files | **No object storage exists** — §7 | n/a (F3.3) |

---

## 2. What the application encrypts

### 2.1 RTU connection credentials — ADR 0012

Per-RTU protocol secrets (MQTT username/password, and later per-adapter certs
and keys) are encrypted before they reach the database.

- **Algorithm:** AES-256-GCM. 12-byte random IV per record; the 16-byte GCM
  authentication tag is appended to the ciphertext.
- **Key:** `CREDENTIAL_ENCRYPTION_KEY`, a base64 string that **must decode to
  exactly 32 bytes**. The service refuses to start an encrypt/decrypt operation
  otherwise — it never silently falls back to plaintext.
- **Storage:** `bms.rtu_connection_configs.credentials_ciphertext` /
  `.credentials_iv` (`bytea`), plus a `key_version` column.
- **Implementation:** `apps/api/src/security/credential-crypto.service.ts`.
- **Read path:** decryption happens in exactly one place — the ingest runtime
  (`apps/ingest/src/rtu-config.js`). There are **zero** `.decrypt(` call sites
  in `apps/api/src`; onboarding commit moves ciphertext and IV across tables
  without decrypting them.
- **Client exposure — read this before concluding secrets are contained.** The
  REST API never *decrypts* a stored secret, but that is not the same as never
  returning one. `redactDraftForClient` deletes the `_secrets` blob and coerces
  the `credentialsSet` boolean — it **masks nothing**, and unlike
  `redactDraftForLlm` it does not run `scrubSecrets`
  (`apps/api/src/admin/onboarding/onboarding-redaction.ts:19`). More
  importantly, `GET /admin/onboarding/sessions/:id` returns `messages`
  **verbatim** (`onboarding.service.ts:339`), and the wizard actively asks the
  admin to paste credentials into that transcript. So a credential typed into
  onboarding chat **is** served back in cleartext to any holder of a valid JWT
  — the controller carries `@UseGuards(JwtAuthGuard)` and no role or org check
  (`onboarding.controller.ts:33`). See §5.1.

Generate a key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 2.2 Onboarding draft secrets

While an onboarding session is still a draft, credentials the admin has
supplied are held under `onboarding_sessions.draft._secrets` as
`{ c: <base64 ciphertext>, iv: <base64 iv> }` using the same key and algorithm.
On commit they move to `rtu_connection_configs`.

**The `_secrets` blob** — and only that blob — is stripped from client and LLM
payloads. The raw chat turn is not. `handleOpenAiTurn` scrubs the *draft* it
puts in the system prompt but forwards the user's message unmodified as
`{ role: "user", content: message }` (`onboarding-chat.service.ts:209`) — the
very string the wizard just asked to contain a password. That is an open gap
against ADR 0011 decision 4 ("Strip credentials from LLM context"). It is
dormant in the compose stack, where `OPENAI_API_KEY` is never passed to the
`api` service so `handleOpenAiTurn` is unreachable, and live in native dev and
any deployment that sets the key. **See §5.1 — the draft is encrypted, the chat
log is not.**

### 2.3 Passwords are hashed, not encrypted

`bms.users.password_hash` holds a bcrypt hash (cost 10). This is a **different
security property** and does not make the row "encrypted at rest": hashing is
one-way and exists so a stolen database does not yield usable passwords. It
provides no confidentiality for any other column, and it is not reversible by
design. Do not count this row as encryption coverage.

Local password login applies only in `AUTH_MODE=local`. Compose deployments use
Keycloak/OIDC.

---

## 3. Key management — where `CREDENTIAL_ENCRYPTION_KEY` lives

**This is the part that most often invalidates everything else.** If the
encryption key is stored on the same encrypted volume as the ciphertext it
protects, volume encryption buys you nothing against the threat it is meant to
stop: anyone who can read the volume can read both.

Requirements:

| Rule | Why |
|------|-----|
| Inject the key as an environment variable from a secret store (Docker/Kubernetes secret, cloud KMS/Secrets Manager, HashiCorp Vault) | Keeps the key off the data volume and out of the image |
| **Never** commit it — the repo's `.env` and `apps/*/.env` are gitignored, and `.env.example` must keep an empty placeholder | A committed key is a permanent leak; volume encryption cannot undo it |
| **Never** bake it into an image layer | Image layers are copied to every registry and node. Guarded by `.dockerignore` + `tests/repo-invariants.test.ts` — see §8 |
| Never log it | AGENTS.md §9.6 |
| Use a distinct key per environment | Prevents a pilot leak from decrypting production data |

**Compose wiring — development only.** Both the API (which encrypts) and the
ingest worker (which decrypts) need the key. `docker-compose.yml` interpolates
it from the gitignored compose `.env`:

```yaml
CREDENTIAL_ENCRYPTION_KEY: ${CREDENTIAL_ENCRYPTION_KEY:-}
```

**Do not copy this to a pilot or production host.** It reads the key from a
plaintext file sitting beside `docker-compose.yml` on the same disk as the
Postgres volume — which is neither a secret store nor off-volume, and is the
exact anti-pattern this section opens by warning about. It is acceptable on a
developer machine and nowhere else. For the pilot VM, mount it instead:

```yaml
secrets:
  credential_encryption_key:
    file: /run/secrets/credential_encryption_key   # outside the project tree
services:
  api:
    secrets: [credential_encryption_key]
```

...or inject from the platform secret store (ECS/K8s secret, KMS, Vault). The
§9 checklist line "that key comes from a secret store, not from the data
volume" is checking for *this*, not for the snippet above.

**Failing closed on storage — but silently, and it fails *open* on
authentication.** An empty value means *not configured*, and no plaintext is
ever written. That much is intentional and verified. The rest of the behaviour
is not obvious and matters more:

1. The credential is discarded, yet the draft is still marked
   `credentialsSet: true` (`onboarding-chat.service.ts:509-511`), so the admin
   UI reports credentials as set for that RTU.
2. Commit writes `credentials_ciphertext: null` / `credentials_iv: null`
   (`onboarding-commit.service.ts:166-176`).
3. Ingest then falls through to the **global** `MQTT_USERNAME` /
   `MQTT_PASSWORD` (`apps/ingest/src/rtu-config.js:51-52`) and still reports
   `source: "db"`.

Net effect if a pilot is deployed without the key: nothing fails, nothing logs,
every onboarded RTU quietly authenticates with one shared broker account, and
per-RTU credential revocation silently does nothing. **Set the key before
onboarding any RTU.** Surfacing the unconfigured state is tracked as `E8.4`.

**Key rotation is not implemented.** The `key_version` column exists and
`CredentialCryptoService` hard-codes version `1`; there is no re-encryption
path. ADR 0012 records this as deferred; it is tracked as **`E8.4`** — a
rotation procedure has to be written before a compromised key can be retired
without manually re-entering every RTU credential. Treat this as an open risk,
not a solved problem.

---

## 4. What the deployer MUST configure — code cannot do this

### 4.1 Encrypt the volume the database sits on

The compose stack stores Postgres data in a **plain named Docker volume**,
`bms_bms-postgres-data`. Docker does not encrypt volumes. Find where it
actually lives:

```bash
docker volume inspect bms_bms-postgres-data --format '{{.Mountpoint}}'
```

Then encrypt the underlying storage using **one** of:

| Platform | Mechanism | Notes |
|----------|-----------|-------|
| Linux host / on-prem VM | **LUKS / dm-crypt** on the filesystem backing `/var/lib/docker` | Must be set up **before** the volume holds data; enabling it later does not retroactively encrypt existing blocks |
| Windows VM + Docker Desktop (see `windows-vm-docker-deploy.md`) | **BitLocker** on the drive holding the Docker Desktop WSL2 data VHDX | Enable BitLocker on the whole volume, and confirm the VHDX location — Docker Desktop stores it under the user's local app data by default |
| AWS | **EBS encryption** (KMS CMK) on the instance volume, or **RDS storage encryption** if Postgres is managed | RDS encryption can only be set at creation; migrating an unencrypted instance requires a snapshot-restore |
| Azure | **Azure Disk Encryption** / SSE with CMK, or **Flexible Server** encryption | |
| GCP | **CMEK** on the persistent disk or Cloud SQL instance | |
| Kubernetes (F4.27) | Encrypted StorageClass + `EncryptionConfiguration` for etcd Secrets | Encrypting the PV is not enough if Secrets sit unencrypted in etcd |

**Ordering matters.** Full-disk encryption applies to blocks written *after*
it is enabled. Provision encrypted storage first, then create the volume and
initialise the database. Retrofitting an existing instance means: back up,
provision encrypted storage, restore, then securely destroy the old media.

### 4.2 Encrypt the other data volumes too

`bms-prometheus-data`, `bms-loki-data` and `bms-grafana-data` are also plain
volumes. **Loki holds application logs**, which carry operational detail and
user identifiers even though the codebase forbids logging secrets
(AGENTS.md §9.6). Same host-level treatment as §4.1 — they are usually on the
same filesystem, in which case §4.1 covers them, but verify rather than assume.

### 4.3 Change every default credential

The committed compose defaults are **development values, published in the
README**, and must not survive into a pilot or production deployment:

| Setting | Committed default | Action |
|---------|-------------------|--------|
| `POSTGRES_PASSWORD` | `bms_app_dev` | Change — see the caveat below |
| `JWT_SECRET` | `change-me-in-compose` | Change (or run OIDC-only) |
| `KEYCLOAK_ADMIN_PASSWORD` | `admin` | Change |
| Grafana admin | `admin` / `admin` | Change |
| Seeded demo users | `admin123` | Remove or disable outside demos |

> **Postgres password caveat — read before changing it.** Postgres applies
> `POSTGRES_PASSWORD` **only during first-time `initdb`**. Setting it against a
> volume that already contains a database has no effect on the stored role
> password, and the stack then fails authentication in a way that looks like an
> application bug. On an existing volume, change it with
> `ALTER ROLE bms_app WITH PASSWORD '…'` **and** update every `DATABASE_URL` in
> the same change. This is why `docker-compose.yml` still hard-codes the dev
> default rather than parameterising it — a silent, confusing break was judged
> worse than an obvious dev-only constant.

### 4.4 Protect connections in transit

Not at-rest, but it is the other half of any real assessment and it is
currently unset:

- `DATABASE_URL` uses plain `postgres://` with no `sslmode`. On a single host
  the traffic never leaves the Docker bridge network; **the moment Postgres is
  on another host, add `?sslmode=verify-full`** and give the server a
  certificate. Do not use `sslmode=require` alone — it encrypts without
  authenticating the server.
- MQTT ingest already uses TLS on port 8883 (ADR 0007), and verifies the
  broker certificate by default. `MQTT_TLS_REJECT_UNAUTHORIZED=false` disables
  that verification — it is a local-debugging escape hatch and **must stay
  unset in any real deployment**.
- Keycloak runs with `KC_HTTP_ENABLED=true` for local development. Put it
  behind TLS termination for any non-local deployment.

---

## 5. Known gaps in what the application stores

### 5.1 Onboarding chat transcripts are stored in plaintext

**This is a real exposure, verified in code, and it is not covered by ADR
0012's encryption.**

`bms.onboarding_sessions.messages` stores the **raw, verbatim** chat turn for
both user and assistant (`onboarding.service.ts` → `chatService.createMessage`,
which applies no redaction). The wizard explicitly invites credentials into the
chat — it prompts *"Share username and password"* and *"paste credentials in
chat"*.

Consequence: an administrator who types an MQTT password into the wizard has
that password persisted **in the clear** in a JSONB column, even though the
same credential is correctly encrypted in `draft._secrets` and in
`rtu_connection_configs`.

**At-rest storage is only the first of three vectors.** The same unredacted
transcript also travels:

1. **Back out through the API.** `GET /admin/onboarding/sessions/:id` returns
   `messages` verbatim (`onboarding.service.ts:339`). The controller carries
   `@UseGuards(JwtAuthGuard)` and no role or organization check
   (`onboarding.controller.ts:33`), so **any authenticated user** can read a
   password another admin pasted into a wizard session. Encrypting the column
   at rest would not close this.
2. **Out to OpenAI.** `handleOpenAiTurn` redacts the draft but forwards the raw
   user turn as `{ role: "user", content: message }`
   (`onboarding-chat.service.ts:209`) — a third-party egress of the credential,
   and an open gap against ADR 0011 decision 4. Dormant under compose
   (`OPENAI_API_KEY` is not passed to the `api` service); live in native dev
   and anywhere the key is set.
3. **Back in via the model's own reply.** The system prompt instructs the model
   *"Never include password or secret values in assistantMessage"*
   (`onboarding-chat.service.ts:201`), but nothing enforces it —
   `finalizeTurn` applies no sanitisation before the assistant message is
   persisted. A model that echoes the password writes it to the transcript a
   second time.

Mitigations available to an operator **today**:

- Prefer the Excel upload path for credentials over pasting them into chat.
- Treat `onboarding_sessions` as a secret-bearing table: restrict access, and
  purge committed sessions' `messages` on a schedule.
- Rotate any credential that has been pasted into a wizard chat.

The durable fix — redacting secret-shaped content from the persisted
transcript, scoping the session read endpoint, and scrubbing the user turn
before it reaches the LLM — is application-code work tracked as **`E8.3`**.
Note that all three vectors must be closed together: redacting only the stored
column still leaks through vector 2, and scoping only the endpoint still leaks
through vector 1's stored copy on any future read path.

### 5.2 The audit log is unencrypted and unconstrained

`bms.audit_log.payload` stores whole request bodies for admin CRUD. Audited
today: no admin route that carries credentials writes them there — RTU CRUD
(`apps/api/src/admin/rtus/rtus.service.ts`) does not handle credentials at all,
and the onboarding-commit audit payload contains only created ids. But nothing
*enforces* that, so any future route that accepts a secret in its body would
leak it into the audit log by default. Anyone adding such a route must redact
before auditing.

### 5.3 The committed Keycloak realm is demo-only

`infra/keycloak/bms-realm.json` contains demo users with the **published**
password `admin123` and one public OIDC client (no client secret) — audited,
and there is **no confidential-client secret in git**. But the realm export
must not be imported into a production instance as-is: it seeds known
credentials. Note also that compose runs Keycloak with `start-dev` and an
embedded H2 database and **no data volume**, so realm state is not persisted
between container recreations at all. A real deployment needs Keycloak on a
proper database — which then falls under §4.1 like any other datastore.

---

## 6. Backups — none exist yet (E8.2)

**There is no backup mechanism in this repository.** No `pg_dump` scripts, no
scheduled dump service in any compose profile, no snapshot tooling, no restore
procedure. Verified across `docker-compose.yml`, `docs/` and the whole tree.
`docs/windows-vm-docker-deploy.md` covers stopping the stack without deleting
the volume, which is data *retention*, not a backup.

Automated backup and tested restores are **E8.2**, and this document
deliberately stays out of that lane. When E8.2 lands it **must** satisfy:

1. **Backup artefacts are encrypted before they leave the host.** A `pg_dump`
   written to a plain file is a full plaintext copy of the database, and it
   usually ends up somewhere with weaker access control than the database.
   Encrypt with age/GPG or an object-store SSE-KMS bucket.
2. **The backup encryption key is stored separately from the backups**, and is
   *not* `CREDENTIAL_ENCRYPTION_KEY` — different lifetime, different blast
   radius.
3. **A backup remains restorable after `CREDENTIAL_ENCRYPTION_KEY` rotates.**
   Dumps contain AES-GCM ciphertext in `rtu_connection_configs`; restoring an
   old dump under a new key yields undecryptable credentials. Retain key
   versions for at least the backup retention window — this is precisely why
   the unimplemented `key_version` rotation path (§3) matters.
4. **Restores are exercised, not assumed.** An untested backup is not a backup.
5. **Backup transport is encrypted** and off-host storage is access-controlled.

## 7. Object storage — does not exist yet (F3.3)

There is no MinIO or S3 integration, and no `asset_images` table. Introducing
one is **F3.3**, and per AGENTS.md §6 + §9.4 it needs its own dependency ADR
before any code lands. It is deliberately not added here.

When it lands it **must** satisfy:

1. **Server-side encryption enabled by default on every bucket** — SSE-S3 at
   minimum, SSE-KMS where a CMK is available; MinIO KES for self-hosted.
2. **TLS for all client traffic**; no plaintext `http://` endpoints.
3. **Buckets private by default**, no public-read, no anonymous listing.
4. **Object-store credentials injected from the secret store**, never committed
   and never baked into an image (§3).
5. **Uploaded files inherit the volume requirement in §4.1** when MinIO is
   self-hosted — MinIO's own disks need host-level encryption exactly like
   Postgres does.

---

## 8. Secrets must not enter image layers

Docker matches `.dockerignore` patterns against the context-relative path, and
`*` does not cross `/`. A bare `.env` pattern therefore excludes **only** the
root file.

This repository previously shipped exactly that gap: `.dockerignore` excluded
the root `.env` but **not** `apps/api/.env` — the file `README.md` instructs
every developer to create. Because `apps/api/Dockerfile` runs
`COPY apps/api apps/api`, any local build baked its values into a permanent
image layer, where deleting the file later does not remove them.

**What was at risk is worse than `JWT_SECRET` alone.**
`docs/onboarding-manual-ui-tests.md:3` instructs developers to put
`OPENAI_API_KEY` **and `CREDENTIAL_ENCRYPTION_KEY`** in that same
`apps/api/.env`, alongside `DATABASE_URL`. A pre-fix image could therefore
carry the AES key into every registry and node that holds the ciphertext it
protects — violating §3's "**never** bake it into an image layer" and
invalidating §2 entirely for anyone who did.

Behaviour demonstrated with a throwaway build listing the context. **The
`before` case was reproduced with a synthetic `apps/api/.env` — no such file
exists in this checkout** (verified: `apps/api`, `apps/web`, `apps/ingest`,
`apps/sim` each contain only `.env.example`), so no image built from this
repository leaked anything:

```
before:  /ctx/apps/api/.env          <-- would carry developer secrets
         /ctx/apps/api/.env.example
after:   /ctx/apps/api/.env.example  <-- placeholders only
```

`.dockerignore` now carries the depth-recursive `**/.env` and `**/.env.*`
patterns, with `!**/.env.example` re-includes after them.
`tests/repo-invariants.test.ts` asserts those patterns are present and
correctly ordered, so CI fails if they are ever dropped.

The exclusion does not change what gets built, and this follows from the build
definitions rather than from a one-off observation: `apps/web/Dockerfile:6-17`
declares every `VITE_*` variable the SPA reads as an `ARG` and exports it to
`ENV` before `vite build`, compose passes them as build args
(`docker-compose.yml:121-127`), and Vite's `loadEnv` gives real environment
variables priority over `.env` file values. `apps/api/Dockerfile` reads its
configuration at runtime. So excluding `apps/*/.env` cannot alter either
emitted artefact.

**If you ever created an `apps/*/.env` and built an image before this fix,
treat every value in it as exposed** — `JWT_SECRET`, `DATABASE_URL`,
`OPENAI_API_KEY` and `CREDENTIAL_ENCRYPTION_KEY`. Rotate them and delete the
affected local images. If `CREDENTIAL_ENCRYPTION_KEY` was among them, rotating
it is not enough on its own: there is no re-encryption path (§3), so **every
stored RTU credential must be re-entered by hand.**

This does not apply to a clean checkout of this repository, which has never
contained an `apps/*/.env`.

---

## 9. Deployer checklist

Before a pilot or production deployment:

- [ ] Storage backing `/var/lib/docker` (or the managed DB) is encrypted — §4.1
- [ ] Encryption was enabled **before** the database was initialised — §4.1
- [ ] Observability volumes are covered too — §4.2
- [ ] `CREDENTIAL_ENCRYPTION_KEY` is set, 32 bytes, unique per environment — §2.1
- [ ] That key comes from a secret store, **not** from the data volume — §3
- [ ] No `.env` is committed; no key is in an image layer — §3, §8
- [ ] Images were rebuilt after the `.dockerignore` fix; pre-fix secrets rotated — §8
- [ ] Every default credential in §4.3 has been changed
- [ ] Seeded demo users removed or disabled outside demos — §4.3
- [ ] Keycloak runs on a real database behind TLS, not `start-dev` — §5.3
- [ ] `sslmode=verify-full` set if Postgres is not on the same host — §4.4
- [ ] Access to `bms.onboarding_sessions` is restricted; any credential pasted
      into a wizard chat has been rotated — §5.1
- [ ] A backup strategy exists (E8.2 is not delivered — §6)

## 10. Scope boundary

Delivered by E8.1: this document, the `.dockerignore` fix and its CI gate, and
the compose key wiring.

**Not** delivered by E8.1, with owners:

| Not covered | Owner |
|-------------|-------|
| Automated encrypted backups and tested restores | **E8.2** |
| Object storage and its bucket encryption | **F3.3** (ADR required) |
| Full-disk / volume / KMS encryption | **The deployer** — §4, not implementable in this repo |
| Row-level security | **F4.16** |
| `CREDENTIAL_ENCRYPTION_KEY` rotation and re-encryption | **unowned** — §3 |
| Onboarding chat transcript redaction | **unowned** — §5.1 |
| mTLS between services | **F4.18** |
| Keycloak MFA | **F4.13** |
