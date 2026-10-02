# Runbook — Keycloak for user administration (F3.78 / ADR 0089)

How to make a host's Keycloak realm `bms` ready for the users API, rotate the
secret it uses, and repair a login that cannot link. Read with
[ADR 0089](../adr/0089-user-access-and-asset-group-administration.md)
decisions 4–6.

The users API writes to Keycloak as the confidential client
**`bms-api-admin`**, through its service account. That account holds
`realm-management` `manage-users` and `view-users`, which can set **any** realm
user's password — the `admin`'s included. **Its secret is equivalent to global
admin.** It is never committed, never logged, never returned, and never reused
across hosts.

## 1. Provisioning

`infra/keycloak/bms-realm.json` declares the client (with **no** secret),
brute-force detection, and a user profile in which only an admin can edit an
email. `--import-realm` reads that file **only when realm `bms` does not exist
yet**, so a realm imported before F3.78, or built by hand, never sees it. The
one-shot provisioning step closes that gap on every host, new or existing:

| It sets | Why |
|---|---|
| `passwordPolicy` = `length(12) and notUsername and notEmail` | Decision 6. Not in the realm file: the demo users' realm-file passwords are shorter, and the import must not depend on whether Keycloak 24 checks the policy on that path. |
| Brute-force detection (10 failures, 60 s steps, 15 min cap) and `editUsernameAllowed: false` | Decision 6; the same values as the realm file. |
| The `bms-api-admin` client, created or updated | Confidential, service accounts only, every browser flow off. |
| The client secret, from `KEYCLOAK_ADMIN_CLIENT_SECRET` | Decision 5. An empty value is refused before any request. |
| The service account's `realm-management` roles: exactly `manage-users`, `view-users` | Any other `realm-management` role is removed. |
| The user profile: `email` editable by `admin` only | Decision 4. The step reads the live profile and changes only that one key. |

It then prints every realm user that is **unverified and unlinked** (§3) and
exits **2** if there is one, **1** on any failure, **0** otherwise. It prints
steps, HTTP statuses, Keycloak ids and — in the report only — emails; never a
request or response body, the secret or the master password.

### 1.1 Compose hosts

1. Generate the secret and put it in the host's gitignored root `.env`:

   ```bash
   echo "KEYCLOAK_ADMIN_CLIENT_SECRET=$(openssl rand -base64 32)" >> .env
   ```

2. Bring the stack up. The `keycloak-provision` service (profiles `core`,
   `identity`, `pilot`, `phe`, `realtime-smoke`) runs after `keycloak` starts
   and `migrate` completes, retries for up to 120 s while Keycloak boots, and
   exits.

   ```bash
   docker compose --profile core up -d
   docker compose --profile core logs keycloak-provision
   docker compose --profile core ps -a keycloak-provision   # Exited (0)
   ```

3. Recreate `api` (and `api-replica` where it runs) so it reads the secret:
   `docker compose --profile core up -d api`.

To re-run the step alone: `docker compose --profile core run --rm --no-deps keycloak-provision`
(`--no-deps`: without it Compose re-runs `migrate`, which re-seeds).

The job logs into realm `master` as the `keycloak` service's
`KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`. A host that changed that password
must change it on `keycloak-provision` too.

### 1.2 From source

`pnpm --filter api build`, then, with the five variables below and
`DATABASE_URL_AUTH` set:

```bash
KEYCLOAK_ADMIN_URL=http://keycloak:8080 KEYCLOAK_ADMIN_REALM=bms \
KEYCLOAK_ADMIN_CLIENT_ID=bms-api-admin KEYCLOAK_ADMIN_CLIENT_SECRET=... \
KEYCLOAK_ADMIN=admin KEYCLOAK_ADMIN_PASSWORD=admin \
pnpm --filter api keycloak:provision
```

`KEYCLOAK_ADMIN_URL` follows decision 5's rule, as the API does: `https://`,
or exactly `http://keycloak:8080`. See §5.

## 2. Rotating the secret

1. Generate a new value and replace `KEYCLOAK_ADMIN_CLIENT_SECRET` in `.env`.
2. Re-run the step (§1.1, last command). It sets the new value on the client.
   From this moment the old value is dead, and an API still holding it gets
   `unauthorized_client` from Keycloak on every user write; reads keep working.
3. Recreate `api` and `api-replica` at once: `docker compose --profile core up -d api`.

Rotate on any suspicion of exposure, and when anyone who held `.env` leaves.
A rotation does not end any user's session — to cut off a user, deactivate
them in the screen.

## 3. An unverified, unlinked user

A Keycloak login becomes a `bms.users` row on its first sign-in: the API sets
the row's `oidc_subject` to the token's `sub`, matching `lower(email)`, **only
if the token's email is verified** (decision 4). Users created through the
users screen are created verified. A user created by hand in the Keycloak
console, on a hand-built realm, may not be — and then cannot ever link. An
unlinked `admin` is refused outright (ADR 0044).

The step lists such users by email. For each one, **first confirm the person
owns the mailbox** by a channel outside Keycloak. Then either:

- in the Keycloak admin console (realm `bms` → Users → the user), turn
  **Email verified** on and let the user sign in — the API links on that
  sign-in; or
- link the row by hand as the database superuser, with the user's Keycloak id
  (Users → the user → ID):

  ```sql
  -- as the superuser (DATABASE_URL_SUPERUSER, `bms_app` in compose)
  BEGIN;
  UPDATE bms.users
     SET oidc_subject = '<keycloak user id>'
   WHERE lower(email) = lower('<email>')
     AND oidc_subject IS NULL;
  -- must report UPDATE 1; anything else: ROLLBACK
  COMMIT;
  ```

Re-run the step; it exits 0 when the list is empty.

## 4. Re-linking a row

A set `oidc_subject` is fixed: a trigger refuses to change it unless the
current role is a superuser (decision 4, migration `0098`). Re-link only when
the Keycloak account behind a row was deleted and re-created for the **same
person** — never to hand a row to someone else (create a new user instead).

```sql
-- as the superuser
BEGIN;
SELECT id, email, oidc_subject FROM bms.users WHERE lower(email) = lower('<email>');
UPDATE bms.users
   SET oidc_subject = '<new keycloak user id>'
 WHERE id = '<row id from the SELECT>'
   AND oidc_subject = '<old subject from the SELECT>';
-- must report UPDATE 1; anything else: ROLLBACK
COMMIT;
```

Record the change (who, when, old and new subject) in the host's change log;
this path writes no `audit_log` row.

## 5. The from-source developer path

Decision 5 accepts `http://` only for the Compose service name
`http://keycloak:8080` (owner ruling Q-B), because the secret must never cross
a network in the clear. An API run from source on the host therefore cannot
use `http://localhost:8080`. Two ways:

- **A hosts entry.** Map `keycloak` to the loopback address — `127.0.0.1 keycloak`
  in `/etc/hosts` (Linux, macOS, WSL) or
  `C:\Windows\System32\drivers\etc\hosts` (Windows, as Administrator) — and set
  `KEYCLOAK_ADMIN_URL=http://keycloak:8080`. Compose publishes Keycloak on
  `8080`. CI does exactly this.
- **The API in Compose.** Run `api` from the stack instead
  (`docker compose --profile core up -d --build api`).

Without either, a from-source API runs with user administration not
configured: one warning names `KEYCLOAK_ADMIN_URL`, the user write routes
answer 503, and everything else works.
