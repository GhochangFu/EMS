# Local Development Setup

Single-developer setup for the prototype phase. Target environment:

- **Host:** Windows 11
- **Dev shell:** WSL2 + Ubuntu 22.04 LTS
- **Editor:** Cursor (Windows) connected to WSL via the Remote-WSL extension
- **Runtime:** Node 20 LTS, pnpm 9
- **Database:** Postgres 16 + TimescaleDB 2.x, installed natively in WSL
- **No Docker, no Keycloak, no broker** in the prototype phase — see
`AGENTS.md` §6.

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

## 7. Create the BMS database and user

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE bms_app WITH LOGIN PASSWORD 'bms_app_dev';
CREATE DATABASE bms OWNER bms_app;
\c bms
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE SCHEMA IF NOT EXISTS bms       AUTHORIZATION bms_app;
CREATE SCHEMA IF NOT EXISTS telemetry AUTHORIZATION bms_app;
SQL
```

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
DATABASE_URL=postgres://bms_app:bms_app_dev@localhost:5432/bms
JWT_SECRET=change-me-in-prototype
JWT_TTL=8h
PORT=4000
LOG_LEVEL=info
```

Create `apps/web/.env` (do not commit):

```env
VITE_API_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:4000
```

Create `apps/sim/.env` (do not commit):

```env
DATABASE_URL=postgres://bms_app:bms_app_dev@localhost:5432/bms
SIM_RATE_HZ=1
SIM_ASSET_COUNT=6
```

`.env.example` files (committed) ship sanitised copies.

---

## 10. Install and run

```bash
pnpm install

pnpm db:migrate    # Drizzle migrations + Timescale hypertable creation
pnpm db:seed       # admin user, sample assets, baseline alarms

# Three terminals (or use a tmux/zellij split)
pnpm --filter api dev    # NestJS on :4000
pnpm --filter web dev    # Vite on :5173
pnpm --filter sim start  # telemetry simulator
```

Open `http://localhost:5173` in your Windows browser. Login as
`admin@bms.local` / `admin123` (seeded). The Executive Dashboard
should tick once the simulator is running.

---

## 11. Cursor IDE on WSL

1. Install Cursor on Windows.
2. Install the **Remote - WSL** extension.
3. From Ubuntu: `cd ~/projects/bms && cursor .`
4. Cursor opens the workspace inside WSL — file ops, terminals, and
  git all run Linux-side.

> **Do not** open the project from `\\wsl$\...` in Windows-mode Cursor.
> Performance and file watchers will suffer.

---

## 12. Common issues


| Symptom                                          | Fix                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pg_ctlcluster: Error: Could not bind to socket` | Another Postgres is running on `:5432`. `sudo lsof -i :5432` to find it; either kill it or change `port` in `/etc/postgresql/16/main/postgresql.conf`. |
| `extension "timescaledb" is not available`       | Re-run `sudo timescaledb-tune --quiet --yes` then restart Postgres. Confirm `shared_preload_libraries` includes `timescaledb` in `postgresql.conf`.    |
| `pnpm: command not found` after reopening shell  | `corepack enable` again; ensure `~/.local/bin` and fnm paths are in `$PATH`.                                                                           |
| File watch limit errors from Vite                | `echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p`.                                                            |
| Slow `pnpm install`                              | Make sure the repo is under `~/projects`, **not** `/mnt/c/...`.                                                                                        |
| Cursor terminal opens PowerShell instead of bash | Open the workspace via "Connect to WSL" — bottom-left status bar should read "WSL: Ubuntu-22.04".                                                      |


---

## 13. What is intentionally not installed

To keep the prototype lean and laptop-friendly:

- No Docker / Docker Desktop
- No Keycloak
- No EMQX / Mosquitto
- No Redis
- No Prometheus / Grafana / Loki
- No MinIO

These arrive in **Phase 1** of `docs/roadmap.md` (Pilot-ready
hardening) and onwards. Until then, do not install or wire them up,
even "just to try" — they are blocked by `AGENTS.md` §9 rule 7 and
require a Promotion PR to enter the codebase.