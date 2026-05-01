# Windows VM Docker Deployment Guide

This guide explains how to deploy the current BMS stack on a Windows VM
using Docker Desktop and Docker Compose. It is written for a beginner who
has the VM login, a public IP or DNS name, and permission to open firewall
ports.

The current Docker path runs these services in containers:

- Web UI: React app served by nginx, exposed on host port `5173`
- API: NestJS HTTP + Socket.IO, exposed on host port `4000`
- Keycloak: OIDC login, exposed on host port `8080`
- Database: TimescaleDB/Postgres, used by containers
- Redis: Socket.IO fan-out, used by containers
- Migrate: one-shot migration and seed job
- Simulator: optional live telemetry generator
- Observability: optional Prometheus, Grafana, Loki, Promtail

You do not need to install Node, pnpm, Postgres, TimescaleDB, Redis, or
Keycloak directly on the Windows host for this deployment.

---

## 0. Example Used In This Manual

Use your real host name if you have one. For the current demo information:

| Item | Example value |
|------|---------------|
| DNS name | `bms.demosites.co.in` |
| Public IP | `20.244.16.33` |
| Web URL | `http://bms.demosites.co.in:5173` |
| API URL | `http://bms.demosites.co.in:4000` |
| WebSocket URL | `ws://bms.demosites.co.in:4000` |
| Keycloak URL | `http://bms.demosites.co.in:8080` |
| OIDC issuer | `http://bms.demosites.co.in:8080/realms/bms` |
| Redirect URL | `http://bms.demosites.co.in:5173/auth/callback` |

If DNS is not ready, use the IP version temporarily:

```text
http://20.244.16.33:5173
http://20.244.16.33:4000
http://20.244.16.33:8080
```

Important rule: use one browser-facing origin consistently. If operators
open `http://bms.demosites.co.in:5173`, then compose build args, API
`OIDC_ISSUER`, and Keycloak redirect settings must also use
`bms.demosites.co.in`.

This manual uses HTTP with explicit ports because the current compose file
does not include a reverse proxy or TLS certificate. For a public pilot,
HTTPS should be added later with nginx, Caddy, IIS reverse proxy, or Azure
Application Gateway.

---

## 1. VM And Network Checklist

Before touching Docker, confirm these items.

1. You can log in to the Windows VM as an administrator or a user allowed
   to install software.
2. The VM has internet access.
3. The DNS record exists:

   ```text
   bms.demosites.co.in -> 20.244.16.33
   ```

4. If this is an Azure VM, the public IP `20.244.16.33` should be assigned
   to the VM or to the public load-balancing resource in front of it.
5. The VM size should have at least:
   - 2 vCPUs
   - 8 GB RAM recommended
   - 40 GB free disk recommended
6. You know whether this is only a lab/demo or a wider pilot. For a wider
   pilot, rotate all default passwords before exposing it to users.

---

## 2. Open Required Network Ports

The current compose file publishes these ports:

| Port | Purpose | Public access needed? |
|------|---------|-----------------------|
| `5173` | Web UI | Yes |
| `4000` | API and WebSocket | Yes |
| `8080` | Keycloak login | Yes |
| `5432` | Postgres | No public access |
| `6379` | Redis | No public access |
| `9101` | Simulator metrics | Optional/internal only |
| `3000` | Grafana | Optional/admin only |
| `9090` | Prometheus | Optional/admin only |
| `3100` | Loki | Optional/admin only |

### 2.1 Windows Firewall

Open PowerShell as Administrator and run:

```powershell
New-NetFirewallRule -DisplayName "BMS Web 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
New-NetFirewallRule -DisplayName "BMS API 4000" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow
New-NetFirewallRule -DisplayName "BMS Keycloak 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

Do not open `5432` or `6379` to the internet.

### 2.2 Azure NSG Rules

If the VM is in Azure, Windows Firewall is not enough. Also open inbound
rules in the VM Network Security Group:

| Priority | Source | Destination port | Protocol | Action | Name |
|----------|--------|------------------|----------|--------|------|
| 1000 | Your IP or Internet | `5173` | TCP | Allow | `Allow-BMS-Web-5173` |
| 1010 | Your IP or Internet | `4000` | TCP | Allow | `Allow-BMS-API-4000` |
| 1020 | Your IP or Internet | `8080` | TCP | Allow | `Allow-BMS-Keycloak-8080` |

For a safer pilot, set Source to your office/public IP range instead of
`Internet`.

---

## 3. Install Required Windows Software

### 3.1 Install Docker Desktop

1. Download Docker Desktop:
   [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)
2. Install it with the WSL 2 backend enabled.
3. Restart Windows if Docker asks.
4. Start Docker Desktop.
5. Confirm Docker is using Linux containers. In the Docker tray menu, if
   you see "Switch to Windows containers", you are already on Linux
   containers.

### 3.2 Allocate Docker Resources

Open Docker Desktop:

1. Go to Settings.
2. Go to Resources.
3. Set at least:
   - CPUs: `2`
   - Memory: `6 GB` minimum, `8 GB` recommended
4. Apply and restart Docker if prompted.

### 3.3 Install Git For Windows

Install Git:

[Git for Windows](https://git-scm.com/download/win)

This guide uses Git commands. If you do not install Git, you can copy a
ZIP of the repository to the VM, but Git is simpler for updates.

---

## 4. Get The Source Code

Open PowerShell as a normal user.

Create a simple working folder outside OneDrive:

```powershell
mkdir C:\dev
cd C:\dev
```

Clone the repository:

```powershell
git clone https://github.com/GhochangFu/BMS.git bms
cd bms
```

Confirm you are in the folder that contains `docker-compose.yml`:

```powershell
dir docker-compose.yml
```

If that command cannot find the file, you are in the wrong folder.

---

## 5. Choose Your Public URL

For this example, choose the DNS URL:

```text
http://bms.demosites.co.in:5173
```

Use the IP URL only if DNS does not work yet:

```text
http://20.244.16.33:5173
```

Do not mix them during login testing. Keycloak tokens contain an issuer
URL. If the API expects the DNS issuer but the browser logs in through the
IP issuer, API calls will fail with `401`.

---

## 6. Update `docker-compose.yml`

The committed compose file defaults to `localhost`. That works only when
the browser runs on the same machine. For remote users, change it to the
public DNS name.

Open `docker-compose.yml` in Notepad, VS Code, or another editor:

```powershell
notepad docker-compose.yml
```

### 6.1 API OIDC Issuer

Find the `api` service and change `OIDC_ISSUER`.

Before:

```yaml
OIDC_ISSUER: http://localhost:8080/realms/bms
```

After:

```yaml
OIDC_ISSUER: http://bms.demosites.co.in:8080/realms/bms
```

Keep `OIDC_JWKS_URI` unchanged:

```yaml
OIDC_JWKS_URI: http://keycloak:8080/realms/bms/protocol/openid-connect/certs
```

Why: `OIDC_ISSUER` must match what the browser receives in the token.
`OIDC_JWKS_URI` is container-to-container and should keep using the
Docker service name `keycloak`.

### 6.2 Web Build Arguments

Find the `web` service and update the `build.args`.

Use DNS:

```yaml
args:
  VITE_API_URL: http://bms.demosites.co.in:4000
  VITE_WS_URL: ws://bms.demosites.co.in:4000
  VITE_AUTH_MODE: oidc
  VITE_OIDC_ISSUER: http://bms.demosites.co.in:8080/realms/bms
  VITE_OIDC_CLIENT_ID: bms-web
  VITE_OIDC_REDIRECT_URI: http://bms.demosites.co.in:5173/auth/callback
```

If DNS is not ready, use IP:

```yaml
args:
  VITE_API_URL: http://20.244.16.33:4000
  VITE_WS_URL: ws://20.244.16.33:4000
  VITE_AUTH_MODE: oidc
  VITE_OIDC_ISSUER: http://20.244.16.33:8080/realms/bms
  VITE_OIDC_CLIENT_ID: bms-web
  VITE_OIDC_REDIRECT_URI: http://20.244.16.33:5173/auth/callback
```

These values are baked into the web image during build. If you change
them later, rebuild the web image.

### 6.3 Optional But Recommended: Change Default Passwords

For a lab you can keep defaults temporarily. For anything public, change
these before first boot:

- `POSTGRES_PASSWORD`
- all `DATABASE_URL` values that include the Postgres password
- `JWT_SECRET`
- `KEYCLOAK_ADMIN_PASSWORD`
- Grafana admin password if using observability

Reference: [`env-inventory.md`](./env-inventory.md).

Beginner warning: if you change the database password in one place but
not the matching `DATABASE_URL` values, the API and migration containers
will fail to connect.

---

## 7. Update Keycloak Redirect URLs

The realm file currently allows only localhost:

```json
"redirectUris": [
  "http://localhost:5173/auth/callback"
],
"webOrigins": [
  "http://localhost:5173"
]
```

Edit:

```powershell
notepad infra\keycloak\bms-realm.json
```

Under the `bms-web` client, update these arrays.

Recommended for the DNS example:

```json
"redirectUris": [
  "http://localhost:5173/auth/callback",
  "http://bms.demosites.co.in:5173/auth/callback",
  "http://20.244.16.33:5173/auth/callback"
],
"webOrigins": [
  "http://localhost:5173",
  "http://bms.demosites.co.in:5173",
  "http://20.244.16.33:5173"
]
```

You may keep the IP entries during setup. Once DNS is stable and users
only use the DNS name, prefer the DNS URL as the standard.

Important: Keycloak imports this realm at container startup. Because the
current compose file does not mount a persistent Keycloak data volume,
recreating the Keycloak container imports the edited file again. If you
later add a Keycloak volume, existing realms may need to be changed from
the Keycloak Admin Console instead.

---

## 8. Start The Stack

From `C:\dev\bms`, run:

```powershell
docker compose --profile pilot up --build
```

The `pilot` profile starts:

- Postgres/TimescaleDB
- Redis
- Keycloak
- migration and seed job
- API
- Web
- simulator

First build can take several minutes because Docker downloads base images
and installs pnpm dependencies inside images.

Keep this PowerShell window open for the first run so you can see logs.

### 8.1 What Good Startup Looks Like

Look for these signs:

- `postgres` becomes healthy
- `migrate` runs `pnpm db:migrate && pnpm db:seed` and exits successfully
- `api` starts on port `4000`
- `web` starts nginx
- `sim` starts generating telemetry for all assets
- Keycloak starts on port `8080`

If `migrate` fails, the API usually will not start correctly because it
depends on migration completion.

---

## 9. First Login Test

Open a browser on your laptop, not only inside the VM.

Go to:

```text
http://bms.demosites.co.in:5173
```

Or if DNS is not working:

```text
http://20.244.16.33:5173
```

Expected login flow:

1. The web app opens.
2. It redirects to Keycloak on port `8080`.
3. Sign in with one seeded demo user:

   | Role | Username | Password |
   |------|----------|----------|
   | Admin | `admin@bms.local` | `admin123` |
   | Operator | `operator@bms.local` | `operator123` |
   | Viewer | `viewer@bms.local` | `viewer123` |

4. Keycloak redirects back to:

   ```text
   http://bms.demosites.co.in:5173/auth/callback
   ```

5. The app opens the dashboard.

For a real pilot, change or remove these demo passwords.

---

## 10. Smoke Test Pages

After login, check these pages:

1. Dashboard: `http://bms.demosites.co.in:5173/`
2. Alarm Centre: `http://bms.demosites.co.in:5173/alarms`
3. Sites Map: `http://bms.demosites.co.in:5173/map`
4. Electrical SLD: `http://bms.demosites.co.in:5173/sld`
5. CRAC: `http://bms.demosites.co.in:5173/crac`
6. Energy: `http://bms.demosites.co.in:5173/energy`
7. Work Orders: `http://bms.demosites.co.in:5173/work-orders`
8. Schedule Centre: `http://bms.demosites.co.in:5173/maintenance-schedules`
9. Rule Engine: `http://bms.demosites.co.in:5173/rules`
10. Reports: `http://bms.demosites.co.in:5173/reports`
11. Control Room Dashboard: `http://bms.demosites.co.in:5173/cr-overview`

Also test API health:

```text
http://bms.demosites.co.in:4000/health
```

If the simulator is running, dashboard values and Control Room values
should update from seeded simulated assets.

---

## 11. Run In The Background

After the first successful foreground run, stop it with `Ctrl+C`.

Start it in detached mode:

```powershell
docker compose --profile pilot up -d --build
```

Check status:

```powershell
docker compose ps
```

View logs:

```powershell
docker compose logs -f api
docker compose logs -f web
docker compose logs -f keycloak
docker compose logs -f sim
```

---

## 12. Stop, Restart, And Update

### Stop Without Deleting Data

```powershell
docker compose --profile pilot down
```

This keeps Docker volumes, including the database.

### Start Again

```powershell
docker compose --profile pilot up -d
```

### Pull Latest Code And Rebuild

```powershell
cd C:\dev\bms
git pull
docker compose --profile pilot up -d --build
```

### Rebuild Only Web After URL Changes

Use this if you changed `VITE_*` build args:

```powershell
docker compose build web --no-cache
docker compose --profile pilot up -d web
```

---

## 13. Reset A Broken Local Pilot

Use this only when you are okay losing the local compose database.

Stop the stack:

```powershell
docker compose --profile pilot down
```

List volumes:

```powershell
docker volume ls
```

Remove the BMS Postgres volume:

```powershell
docker volume rm bms_bms-postgres-data
```

Start again:

```powershell
docker compose --profile pilot up --build
```

The migration/seed job will rebuild the database.

---

## 14. Optional Observability

For local diagnostics, start observability:

```powershell
docker compose --profile pilot --profile observability up -d --build
```

Open:

| Tool | URL | Default login |
|------|-----|---------------|
| Grafana | `http://bms.demosites.co.in:3000` | `admin` / `admin` |
| Prometheus | `http://bms.demosites.co.in:9090` | none |
| Loki | `http://bms.demosites.co.in:3100` | none |

For a public VM, do not expose these broadly. Restrict by source IP in
Azure NSG and Windows Firewall.

Promtail mounts the Docker socket. On Docker Desktop for Windows this can
behave differently than Linux. If Promtail fails, the main BMS app can
still run; troubleshoot observability separately.

---

## 15. HTTPS And Port 80/443

The current compose deployment exposes:

```text
http://bms.demosites.co.in:5173
```

If you want users to open:

```text
https://bms.demosites.co.in
```

you need a reverse proxy and TLS certificate. Common choices:

- Caddy
- nginx
- IIS reverse proxy
- Azure Application Gateway

The reverse proxy should route:

| Public path or host | Internal target |
|---------------------|-----------------|
| Web | `http://localhost:5173` |
| API/WebSocket | `http://localhost:4000` |
| Keycloak | `http://localhost:8080` |

After adding HTTPS, update all of these to `https://` or `wss://`:

- `VITE_API_URL`
- `VITE_WS_URL`
- `VITE_OIDC_ISSUER`
- `VITE_OIDC_REDIRECT_URI`
- API `OIDC_ISSUER`
- Keycloak `redirectUris`
- Keycloak `webOrigins`

Do not mix HTTP and HTTPS in OIDC settings.

---

## 16. Common Problems And Fixes

### Browser redirects to localhost

Cause: one or more URLs still use `localhost`.

Check:

- `docker-compose.yml` web build args
- `docker-compose.yml` API `OIDC_ISSUER`
- `infra/keycloak/bms-realm.json` redirect URIs and web origins

Then rebuild:

```powershell
docker compose build web --no-cache
docker compose --profile pilot up -d --build
```

### Login works but API returns 401

Cause: the token issuer does not match API `OIDC_ISSUER`.

Fix: make these identical:

```text
VITE_OIDC_ISSUER
api.environment.OIDC_ISSUER
Keycloak browser URL used during login
```

For DNS example:

```text
http://bms.demosites.co.in:8080/realms/bms
```

### Web loads but data does not update

Check API and simulator:

```powershell
docker compose ps
docker compose logs -f api
docker compose logs -f sim
```

Confirm browser can reach:

```text
http://bms.demosites.co.in:4000/health
```

### Port does not open from outside

Check all three layers:

1. The container is running: `docker compose ps`
2. Windows Firewall allows the port
3. Azure NSG allows the port

### Web URL values changed but app still calls old host

The web app is a static Vite build. Rebuild web:

```powershell
docker compose build web --no-cache
docker compose --profile pilot up -d web
```

### Docker build is very slow

Use a non-OneDrive folder such as:

```text
C:\dev\bms
```

Increase Docker Desktop memory to 8 GB if possible.

---

## 17. Final Beginner Checklist

- [ ] Docker Desktop installed and running
- [ ] Docker Desktop is using Linux containers
- [ ] Repo cloned to `C:\dev\bms`
- [ ] DNS `bms.demosites.co.in` points to `20.244.16.33`
- [ ] Windows Firewall allows `5173`, `4000`, and `8080`
- [ ] Azure NSG allows `5173`, `4000`, and `8080` if this is an Azure VM
- [ ] `docker-compose.yml` API `OIDC_ISSUER` uses the public DNS URL
- [ ] `docker-compose.yml` web `VITE_*` args use the public DNS URL
- [ ] Keycloak realm allows the public redirect URI and web origin
- [ ] `docker compose --profile pilot up --build` completes
- [ ] Browser opens `http://bms.demosites.co.in:5173`
- [ ] Login succeeds with a seeded user
- [ ] Dashboard and Control Room values update while the simulator runs
- [ ] Default demo passwords are changed before wider pilot use
- [ ] Postgres `5432` and Redis `6379` are not exposed publicly

For native WSL development, use [`local-setup.md`](./local-setup.md).
This guide is only for the Docker-only Windows VM deployment path.
