# Local Development Setup

Single-developer setup for the completed prototype and Phase 1 Sprint C.
Target environment:

- **Host:** Windows 11
- **Dev shell:** WSL2 + Ubuntu 22.04 LTS
- **Editor:** Cursor (Windows) connected to WSL via the Remote-WSL extension
- **Runtime:** Node 20 LTS, pnpm 9
- **Database:** Postgres 16 + TimescaleDB 2.x, installed natively in WSL
  for the lightest local loop, or via Docker Compose for Phase 1.
- **Identity:** Keycloak is used by the compose/pilot path in Sprint C.
  Native WSL may still use local auth while Sprint C is in progress.

If you are setting up a brand-new laptop, follow the sections in order.
Each section is idempotent — re-running the steps is safe.

---

## 1. Enable WSL2 and install Ubuntu

Open **PowerShell as Administrator** on Windows and run:

```powershell
wsl --install -d Ubuntu-22.04
wsl --set-default-version 2
```

After reboot, launch **Ubuntu 22.04** from the Start menu and create
your Linux user when prompted.

Verify:

```powershell
wsl -l -v
# NAME            STATE           VERSION
# Ubuntu-22.04    Running         2
```

---

## 2. Update Ubuntu and install build essentials

Inside the **Ubuntu** terminal:

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install build-essential curl git ca-certificates gnupg lsb-release
```

---

## 3. Install Node 20 via fnm

We use [fnm](https://github.com/Schniz/fnm) so we can switch Node
versions later without sudo.

```bash
sudo apt update && sudo apt install -y unzip
curl -fsSL https://fnm.vercel.app/install | bash
exec $SHELL -l
fnm install 20
fnm default 20
node --version   # v20.x.x
```

Add this to `~/.bashrc` (already done by the installer, verify):

```bash
eval "$(fnm env --use-on-cd)"
```

---

## 4. Install pnpm 9

```bash
corepack enable
corepack prepare pnpm@9 --activate
pnpm --version   # 9.x.x
```

---

## 5. Install Postgres 16

Use the official PGDG apt repository so we can pin to 16:

```bash
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc

echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
| sudo tee /etc/apt/sources.list.d/pgdg.list

sudo apt update
sudo apt -y install postgresql-16 postgresql-client-16
```

Start the cluster (WSL doesn't run systemd by default for Postgres):

```bash
sudo pg_ctlcluster 16 main start
sudo pg_lsclusters   # should show 16 main online
```

Optional but recommended — auto-start on shell login. Add to `~/.bashrc`:

```bash
sudo pg_ctlcluster 16 main start >/dev/null 2>&1 || true
```

---

## 6. Install TimescaleDB 2.x

```bash
sudo apt -y install gnupg postgresql-common apt-transport-https lsb-release wget

echo "deb https://packagecloud.io/timescale/timescaledb/ubuntu/ $(lsb_release -cs) main" \
| sudo tee /etc/apt/sources.list.d/timescaledb.list

wget --quiet -O - https://packagecloud.io/timescale/timescaledb/gpgkey \
| gpg --dearmor | sudo tee /etc/apt/trusted.gpg.d/timescaledb.gpg >/dev/null

sudo apt update
sudo apt -y install timescaledb-2-postgresql-16
```

Tune Postgres for Timescale (auto-edits `postgresql.conf`):

```bash
sudo timescaledb-tune --quiet --yes
sudo pg_ctlcluster 16 main restart
```

---

## 7. Create the BMS database and the bootstrap user

`bms_app` needs `SUPERUSER`, not just ownership — but **since ADR 0045 it is a
*provisioning* identity, not the identity the stack runs as.** It exists to do
the three things nothing else can: `CREATE EXTENSION timescaledb`,
`CREATE ROLE`, and `ALTER ROLE … BYPASSRLS` (Postgres lets a role grant
`BYPASSRLS` only when it holds the attribute itself; `CREATEROLE` alone is not
enough). Docker's official Postgres image makes its `POSTGRES_USER` a superuser
for the same reason; this matches that here.

The five roles the stack actually uses — `bms_owner`, `bms_tenant`,
`bms_fleet`, `bms_auth` and `bms_rollup` — are **not** created here. Step 10's
`pnpm --filter @bms/db roles` creates all five, because their passwords come
from the environment and a migration file is committed while a password is not.

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE bms_app WITH LOGIN SUPERUSER PASSWORD 'bms_app_dev';
CREATE DATABASE bms OWNER bms_app;
\c bms
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE SCHEMA IF NOT EXISTS bms       AUTHORIZATION bms_app;
CREATE SCHEMA IF NOT EXISTS telemetry AUTHORIZATION bms_app;
SQL
```

`AUTHORIZATION bms_app` above is correct and deliberate: it bootstraps a
database that has no other roles yet. Migration `0041` transfers both schemas —
and every table, view and sequence in them — to `bms_owner`, which is **not** a
superuser; `0042` then moves the four continuous aggregates on to `bms_rollup`. That transfer is the whole point of
ADR 0045: `FORCE ROW LEVEL SECURITY` binds a table's owner and does **not**
bind a superuser, so leaving `bms_app` as the owner makes every tenant policy
in the repo a no-op, silently.

Verify Timescale is loaded:

```bash
psql -U bms_app -h localhost -d bms -c "\dx"
# should list timescaledb
```

If `psql` prompts for a password, use `bms_app_dev`. To skip the
prompt, add to `~/.pgpass` (chmod 600):

```
localhost:5432:bms:bms_app:bms_app_dev
```

---

## 8. Clone the repo (inside WSL, not /mnt/c)

Filesystem performance on `/mnt/c` is poor. Clone into the Linux
filesystem:

```bash
mkdir -p ~/projects && cd ~/projects
git clone <your-git-url> bms
cd bms
```

> If you are bootstrapping the repo for the first time, just `mkdir bms && cd bms`
> and let Sprint 1 generate the scaffolding.

---

## 9. Environment variables

Create `apps/api/.env` (do not commit):

```env
# The owner connection. `db:seed`, `apps/sim` and `apps/ingest` read this —
# the API never does. **It must name `bms_owner`, not `bms_app`** (ADR 0045):
# `bms_owner` is the non-superuser schema owner that FORCE ROW LEVEL SECURITY
# binds. Pointing it back at bms_app silently restores a superuser here, and a
# superuser bypasses every tenant policy regardless of FORCE.
DATABASE_URL=postgres://bms_owner:bms_owner_dev@localhost:5432/bms

# The provisioning superuser (ADR 0045 decision 3). Read by `db:roles`,
# `db:migrate` and `db:seed`, and outside those only by the integration-test
# gate, which never ships — never by the running API. `db:roles` needs it for
# CREATE ROLE and ALTER ROLE ... BYPASSRLS; `db:migrate` needs it because a
# fresh database replays migration 0039, whose line 33 requires SUPERUSER;
# `db:seed` needs it since E7.1b for the three identity functions only,
# because bms.users has FORCE ROW LEVEL SECURITY and every seeded login is
# org-less. Leave this unset and db:seed derives bms_app:bms_app_dev from
# DATABASE_URL, which fails with 42501 if that password is not yours.
DATABASE_URL_SUPERUSER=postgres://bms_app:bms_app_dev@localhost:5432/bms

# ADR 0043 decision 8. The API always connects as one of these three
# non-owner roles, never as an owner — an owner sees rows the tenant policies
# would filter, so there is deliberately no fallback to DATABASE_URL if one is
# missing.
DATABASE_URL_AUTH=postgres://bms_auth:bms_auth_dev@localhost:5432/bms
DATABASE_URL_TENANT=postgres://bms_tenant:bms_tenant_dev@localhost:5432/bms
DATABASE_URL_FLEET=postgres://bms_fleet:bms_fleet_dev@localhost:5432/bms

# Read only by `pnpm db:roles` (step 10; alias of `pnpm --filter @bms/db
# roles`), which creates these roles and sets
# LOGIN + a password on each. No password is committed anywhere, so nothing
# can connect as any of them until this has run once against this database.
# `bms_rollup` is deliberately absent and needs no entry: it owns the four
# continuous aggregates, is reached by SET ROLE rather than connected to, and
# holds LOGIN with **no password** so that only TimescaleDB's background
# workers can use it.
BMS_OWNER_PASSWORD=bms_owner_dev
BMS_AUTH_PASSWORD=bms_auth_dev
BMS_TENANT_PASSWORD=bms_tenant_dev
BMS_FLEET_PASSWORD=bms_fleet_dev

JWT_SECRET=change-me-in-prototype
JWT_TTL=8h
AUTH_MODE=local
PORT=4000
LOG_LEVEL=info
# Optional — indicative Energy Centre cost (ZAR/kWh); default 2.15 in code
# ENERGY_TARIFF_ZAR_PER_KWH=2.15
```

Create `apps/web/.env` (do not commit):

```env
VITE_API_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:4000
VITE_AUTH_MODE=local
```

Create `apps/sim/.env` (do not commit):

```env
DATABASE_URL=postgres://bms_owner:bms_owner_dev@localhost:5432/bms
SIM_RATE_HZ=1
# Use `all` to cover every seeded asset, or a number to cap rows ordered by asset code.
SIM_ASSET_COUNT=all
SIM_METRICS_PORT=9101
```

`.env.example` files (committed) ship sanitised copies.

---

## 10. Install and run

```bash
pnpm install

pnpm --filter @bms/db roles     # ADR 0045: create the five roles, set BYPASSRLS, set passwords
pnpm db:migrate                 # Drizzle migrations + Timescale hypertable creation
pnpm db:seed                    # demo users, assets, locations, scopes, alarms, map markers

# Three terminals (or use a tmux/zellij split)
pnpm --filter api dev    # NestJS on :4000
pnpm --filter web dev    # Vite on :5173
pnpm --filter sim start  # telemetry simulator
```

`pnpm install` also runs `pnpm hooks:install`, which points git at the
committed `.githooks/` directory. See §10a below — if you skip `pnpm install`
and run the services some other way, the commit-time rule checks are not
installed.

**`pnpm --filter @bms/db roles` runs *first*, before `db:migrate`.** It ran
last under ADR 0043, when it only set passwords on roles migration `0039` had
already created. Since ADR 0045 it creates every role the stack needs and sets
`BYPASSRLS`, so the migrations that grant privileges to those roles cannot run
until it has. It connects as `DATABASE_URL_SUPERUSER`, it is idempotent, and
re-running it only resets the passwords from `apps/api/.env`.

The roles it creates, and what each is for:

- **`bms_owner`** — owns both schemas and every table, view and sequence in
  them (not the continuous aggregates; see `bms_rollup` below), and is **not** a
  superuser. `FORCE ROW LEVEL SECURITY` binds a table's owner, so this is the
  role that makes ADR 0043's policies mean anything. `DATABASE_URL` names it,
  and `db:seed`, `apps/sim` and `apps/ingest` connect as it. Because the tenant
  policies bind it, `db:seed` sets `app.current_organization` per organization
  and cannot write across both in one statement.
- **`bms_tenant`**, **`bms_fleet`**, **`bms_auth`** — ADR 0043's row-level
  security split, and the only roles the API connects as. `bms_tenant` sees
  rows in the caller's own organization; `bms_fleet` bypasses row-level
  security for reads that already carry their own scope filter (global-admin
  and multi-organization views); `bms_auth` reads the small, unscoped set of
  tables login and permission checks need before an organization is known.
- **`bms_rollup`** — owns the four continuous aggregates and nothing else,
  because `refresh_continuous_aggregate` requires *ownership* and no `GRANT`
  substitutes for it. It gets `LOGIN` with no password (Timescale background
  workers connect as the job owner) and is granted to the three roles that must
  refresh, `WITH INHERIT FALSE, SET TRUE` — so those rights exist only inside
  an explicit `SET ROLE`, never ambiently.

`bms_app` keeps `SUPERUSER` but is now provisioning-only. It is reached through
`DATABASE_URL_SUPERUSER` by three commands — `db:roles`, `db:migrate` and,
since `E7.1b`, `db:seed` — and by nothing else, never by the API, where a
superuser connection would bypass every tenant policy regardless of `FORCE`.

`db:seed` uses it for the three identity functions only (`ensureAdminUser`,
`seedScopedDemoUsers`, `seedPheOrganizationAdmin`); the tenant-scoped bulk
still runs as the `FORCE`-bound `bms_owner`, so ADR 0045's boundary is
unweakened for every table a tenant owns. Migration `0047` gives `bms.users`
`FORCE ROW LEVEL SECURITY` with a strict `USING`, and every seeded login is
org-less, so `bms_owner` can neither see nor insert one — see
`resolveSeedSuperuserUrl` in `packages/db/src/seed-tenant.ts` for the full
argument. When `DATABASE_URL_SUPERUSER` is unset, that function derives
`bms_app:bms_app_dev` from `DATABASE_URL`; a `bms_app` with a different
password must therefore set the variable, or the seed fails with `42501` on
`bms.users`.

A managed Postgres deployment (not this local setup) cannot run `db:roles` as
written: `CREATE ROLE` needs `CREATEROLE` and `ALTER ROLE ... BYPASSRLS` needs
`SUPERUSER`, and offerings like RDS/Aurora and Cloud SQL grant neither
`BYPASSRLS` nor real superuser to any customer-facing role, DBA-owned or not —
this is not merely gated behind asking a DBA, it is unrunnable there without
first dropping the `BYPASSRLS` line and relying on `FORCE ROW LEVEL SECURITY`
plus ordinary grants instead. ADR 0045 improves the odds without solving it:
the superuser surface is now two commands rather than the whole stack, and
`bms_owner` itself needs no special attribute. But migration `0039` still
replays on a fresh database and still contains the superuser-only line, so a
managed target needs a squashed baseline as well. Nothing in this repo targets
a managed Postgres provider today, so this is a note for future operational
planning, not a solved path.

**Upgrading an existing native install** (already ran an older version of §7
before these roles existed): `bms_app` was created plain `LOGIN`, not
`SUPERUSER`, and `db:roles` will fail on `CREATE ROLE`/`ALTER ROLE ...
BYPASSRLS` until you run, as the `postgres` superuser:

```bash
sudo -u postgres psql -c "ALTER ROLE bms_app SUPERUSER;"
```

Compose and CI are unaffected — the official Postgres/TimescaleDB image
already makes its `POSTGRES_USER` a superuser.

Open `http://localhost:5173` in your Windows browser. Seeded local users:
`admin@bms.local`, `wc-admin@bms.local`, and `wc-hvac-admin@bms.local`
all use password `admin123`. With **api**, **web**, and
**sim** running, the Executive Summary shows live KPI tiles (total kW,
sites online, open alarms, estimated PUE), an area trend of total kW,
and a **Live / Stale** ribbon (stale after ~10 s without telemetry). Stop
the simulator to confirm stale state.

Use the sidebar **Alarms** link for the Alarm Centre: thresholded
telemetry creates rows within seconds; the table updates over
`/ws/alarms` without refresh. Acknowledgements require a reason and are
written to `bms.audit_log`.

Open **Map** (`/map`) for Eskom, SMOC, RSMOC, and CSMOC markers on a dark
basemap. Markers reflect open alarms and telemetry freshness for
operational locations;
stopping the simulator should move those sites toward offline or
degraded within the refetch window.

**Electrical SLD** (`/sld`): single-line diagram with live kW, flow animation, and breaker-based fault colouring; click equipment for a read-only detail drawer.

**CRAC schematic** (`/crac`): four precision cooling units with live air/CHW/fan telemetry and animated loop (stop sim to see stale/offline).

---

## 10a. The git pre-commit hook

`pnpm install` runs `pnpm hooks:install`, which is one line:

```bash
git config core.hooksPath .githooks
```

`core.hooksPath` is per-clone configuration and cannot be committed, which is
why an install step exists at all. It lives in the shared `.git/config`, so one
install also covers every linked worktree. It is a no-op outside a git checkout
— a Docker build context has no `.git`, and the install must not fail there.

**What it checks, on every commit.** Four AGENTS.md rules, over the *staged*
tree:

| Check | Blocks when |
|---|---|
| committed migration edit | a `packages/db/drizzle/*.sql` already in `HEAD` is modified, renamed or deleted |
| dependency ADR gate (§9.4) | a dependency specifier is added and **no** `docs/adr/*.md` is staged in the same commit |
| drizzle journal | a staged `.sql` has no journal entry, a journal entry has no `.sql`, or `when` does not strictly increase |
| style hygiene (§4.1/§4.5) | an **added** line of a staged `.ts`/`.tsx` carries `console.log`, an `any` type or an emoji — or the file crosses the 1000-line cap |

Style hygiene reads added lines only. Scanning whole files would make every
pre-existing violation in a legacy module block every commit that touches it,
and a gate everybody bypasses is worse than no gate.

**This is a backstop, not a relocation.** The same four rules are already
enforced by the Claude Code hooks in `.claude/settings.json`, and two of those
are `PreToolUse` *deny* — they stop a bad edit before the file is written, which
is strictly better than catching it at commit time. Those hooks stay. This one
exists because they match `Edit|Write|MultiEdit`, so they see nothing when a
file is written by a `Bash` heredoc, by `sed`, or by an external agent running
in its own process. Every one of those paths still reaches `main` through a
commit.

The two entry points share their predicates (`scripts/checks/`) rather than
each carrying a copy, so a rule cannot be weakened on one path while the other
still passes. `tests/pre-commit-gate.test.ts` drives both.

**The override belongs to the person, not to an agent:**

```bash
git commit --no-verify
```

A check that throws prints a warning and is skipped; the other three still run.
A crash degrades the gate visibly rather than disabling it silently.

---

## 11. Optional Docker Compose path

Phase 1 adds Docker Compose for reproducible development and a single-VM
pilot path. Native WSL remains supported and is still the lightest
option on an 8 GB laptop.

Install Docker Engine or Docker Desktop with WSL integration, then from
the repo root:

```bash
# Core app path: Postgres/TimescaleDB, Redis, Keycloak, migrations/seed, API, and web.
docker compose --profile core up --build

# Optional explicit migration/seed run. Keep `--build`: unlike `up`,
# `docker compose run` reuses the image it finds and never rebuilds it.
docker compose --profile migrate run --build --rm migrate

# Optional live telemetry; this waits for migrations/seed.
docker compose --profile sim up --build sim
docker compose stop sim

# Optional observability stack: Prometheus, Grafana, Loki, and Promtail.
docker compose --profile core --profile sim --profile observability up --build

# Stop Docker services.
docker compose down
```

The `migrate` service runs `pnpm --filter @bms/db roles` **before** `db:migrate`
and `db:seed` on every invocation — the order ADR 0045 decision 6 requires,
since the migrations grant privileges to roles that command creates. All four
password-holding roles can therefore log in by the time `api` starts — the
fifth, `bms_rollup`, holds `LOGIN` with **no** password on purpose, so only
Timescale's background workers reach it — and no separate step is needed here
(compare step 10's native path, where the same command is manual).
`api` and `api-replica` connect using `DATABASE_URL_AUTH`/`_TENANT`/`_FLEET`
per ADR 0043 decision 8; `sim` and `ingest` use the owner `DATABASE_URL`, which
names `bms_owner`. The `migrate` service is the **only** one carrying
`DATABASE_URL_SUPERUSER`, and `tests/adr-0045-owner-and-superuser-url.test.ts`
fails if a second service acquires it.

Open `http://localhost:5173`. Compose uses Keycloak/OIDC by default:
click **Sign in with Keycloak** and use `admin@bms.local` / `admin123`.
The Keycloak admin console is available at `http://localhost:8080` with
`admin` / `admin`. Compose variables are documented in
[`docs/env-inventory.md`](./env-inventory.md).

For observability, open Grafana at `http://localhost:3000` with
`admin` / `admin`, then open the **BMS Pilot Overview** dashboard.
Prometheus is available at `http://localhost:9090`, Loki at
`http://localhost:3100`, and simulator metrics at
`http://localhost:9101/metrics`.

For a demo-like run with API, web, simulator, and migration/seed ordering:

```bash
docker compose --profile pilot up --build
```

To verify Redis-backed Socket.IO fan-out across two API processes:

```bash
docker compose --profile realtime-smoke up -d --build api api-replica
pnpm --filter web smoke:realtime
```

To watch notification email (`F3.8`, ADR 0041), start the Mailpit catcher in its
own profile:

```bash
docker compose --profile mail up -d
```

Mailpit listens for SMTP on `localhost:1025` and serves the inbox at
`http://localhost:8025`. Point the API at it from **your own** environment —
`SMTP_HOST=localhost`, `SMTP_PORT=1025` — because `docker-compose.yml` sets no
`SMTP_HOST` and a repo invariant (`tests/adr-0041-notification-invariants.test.ts`)
fails the build if one appears there. With no host configured, email channels
record `skipped_unconfigured` deliveries and the rules page shows a readiness
banner; that is the intended behaviour, not a fault.

---

## 12. Cursor IDE on WSL

1. Install Cursor on Windows.
2. Install the **Remote - WSL** extension.
3. From Ubuntu: `cd ~/projects/bms && cursor .`
4. Cursor opens the workspace inside WSL — file ops, terminals, and
  git all run Linux-side.

> **Do not** open the project from `\\wsl$\...` in Windows-mode Cursor.
> Performance and file watchers will suffer.

---

## 13. Common issues


| Symptom                                          | Fix                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pg_ctlcluster: Error: Could not bind to socket` | Another Postgres is running on `:5432`. `sudo lsof -i :5432` to find it; either kill it or change `port` in `/etc/postgresql/16/main/postgresql.conf`. |
| `extension "timescaledb" is not available`       | Re-run `sudo timescaledb-tune --quiet --yes` then restart Postgres. Confirm `shared_preload_libraries` includes `timescaledb` in `postgresql.conf`.    |
| `pnpm: command not found` after reopening shell  | `corepack enable` again; ensure `~/.local/bin` and fnm paths are in `$PATH`.                                                                           |
| File watch limit errors from Vite                | `echo fs.inotify.max_user_watches=524288 \| sudo tee -a /etc/sysctl.conf && sudo sysctl -p`.                                                           |
| Slow `pnpm install`                              | Make sure the repo is under `~/projects`, **not** `/mnt/c/...`.                                                                                        |
| Cursor terminal opens PowerShell instead of bash | Open the workspace via "Connect to WSL" — bottom-left status bar should read "WSL: Ubuntu-22.04".                                                      |
| Compose API starts before seeded data exists     | Run `docker compose --profile migrate run --build --rm migrate` once, then restart the `api`, `web`, and `sim` services.                               |
| Seed fails with `42501` on `bms.users`           | Two unrelated causes. See the note under this table.                                                                                                   |

### Seed fails with `42501` on `bms.users`

The whole error is `new row violates row-level security policy for table
"users"`, raised out of `packages/db/src/demo-users-seed.ts`. Two unrelated
things produce it, and the fixes do not overlap.

**Compose — the `migrate` image is stale.** Unlike `up`, `docker compose run`
reuses whatever image it finds and never rebuilds on its own, so an image built
before your last `git pull` runs old migrations and an old seed against a
current database. If that image predates `E7.1b`, its seed still writes the
identity rows as `bms_owner` and hits the policy. Rebuild it:

```bash
docker compose --profile migrate run --build --rm migrate
```

**Native — the derived superuser credential is wrong.** `db:seed` needs a
superuser for its three identity functions (see step 10). When
`DATABASE_URL_SUPERUSER` is unset, `resolveSeedSuperuserUrl` derives
`bms_app:bms_app_dev` from `DATABASE_URL`; a `bms_app` with any other password
fails with the same `42501`. Set the variable explicitly in `apps/api/.env`,
as step 9 shows.

---

## 14. What is intentionally not installed

To keep Phase 1 lean and laptop-friendly:

- No EMQX / Mosquitto
- No MinIO

Redis, Keycloak, Prometheus, Grafana, Loki, and Promtail are now in scope
for Phase 1 Sprint B-D. The remaining items arrive in later add-on
sprints and phases. Until then, do not install or wire them up, even "just
to try" — they are blocked by `AGENTS.md` §9 rule 7 and require a
Promotion PR to enter the codebase.