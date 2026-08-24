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
| Public site URL | `https://bms.demosites.co.in` |
| Public web URL | `https://bms.demosites.co.in` |
| Internal web container | `http://localhost:5173` |
| Internal API container | `http://localhost:4000` |
| Internal Keycloak container | `http://localhost:8080` |
| Public API URL | `https://bms.demosites.co.in` if the reverse proxy routes `/api` and `/socket.io` to the API |
| Public WebSocket URL | `wss://bms.demosites.co.in` if the reverse proxy routes `/socket.io` to the API |
| Public Keycloak URL | `https://bms.demosites.co.in` if the reverse proxy routes `/realms`, `/resources`, and Keycloak auth paths to Keycloak |
| OIDC issuer | `https://bms.demosites.co.in/realms/bms` |
| Redirect URL | `https://bms.demosites.co.in/auth/callback` |
| Post-logout redirect URL | `https://bms.demosites.co.in/login` |

If DNS is not ready, use the IP version temporarily:

```text
http://20.244.16.33:5173
http://20.244.16.33:4000
http://20.244.16.33:8080
```

Important rule: use one browser-facing origin consistently. The current
demo site is deployed at:

```text
https://bms.demosites.co.in
```

For that HTTPS URL, the web build args, API `OIDC_ISSUER`, Keycloak
redirect URIs, Keycloak web origins, and Keycloak post-logout redirect
must all use `https://bms.demosites.co.in` unless the deployment is still
intentionally using explicit public ports.

The committed `docker-compose.yml` still exposes the containers on local
host ports (`5173`, `4000`, `8080`) and does not include the TLS reverse
proxy itself. The HTTPS certificate and routing must therefore be supplied
by the VM/IIS/nginx/Caddy/Azure Application Gateway layer in front of the
containers, or by a separate reverse-proxy compose service added later.

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

The current compose file publishes these host ports:

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

For the deployed public URL `https://bms.demosites.co.in`, public users
should normally need only:

| Port | Purpose |
|------|---------|
| `443` | HTTPS public entry point |
| `80` | Optional HTTP-to-HTTPS redirect / certificate challenge |

Keep `5173`, `4000`, and `8080` restricted to the VM or private admin
network when a reverse proxy is handling public HTTPS. Open those ports
publicly only for temporary direct-port troubleshooting.

### 2.1 Windows Firewall

Open PowerShell as Administrator and run:

```powershell
New-NetFirewallRule -DisplayName "BMS HTTPS 443" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
New-NetFirewallRule -DisplayName "BMS HTTP 80" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "BMS Web 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
New-NetFirewallRule -DisplayName "BMS API 4000" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow
New-NetFirewallRule -DisplayName "BMS Keycloak 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

If HTTPS reverse proxy is already working, prefer to remove or restrict
the public rules for `5173`, `4000`, and `8080`. Do not open `5432` or
`6379` to the internet.

### 2.2 Azure NSG Rules

If the VM is in Azure, Windows Firewall is not enough. Also open inbound
rules in the VM Network Security Group:

| Priority | Source | Destination port | Protocol | Action | Name |
|----------|--------|------------------|----------|--------|------|
| 1000 | Internet | `443` | TCP | Allow | `Allow-BMS-HTTPS-443` |
| 1010 | Internet | `80` | TCP | Allow | `Allow-BMS-HTTP-80` |
| 1100 | Your admin IP only | `5173` | TCP | Allow | `Allow-BMS-Web-5173-Admin` |
| 1110 | Your admin IP only | `4000` | TCP | Allow | `Allow-BMS-API-4000-Admin` |
| 1120 | Your admin IP only | `8080` | TCP | Allow | `Allow-BMS-Keycloak-8080-Admin` |

For a safer pilot, expose only `443` to users and set the direct container
ports (`5173`, `4000`, `8080`) to your office/public admin IP range.

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

For the current demo deployment, choose the HTTPS DNS URL:

```text
https://bms.demosites.co.in
```

Use the IP/direct-port URL only if DNS or the HTTPS reverse proxy does not
work yet:

```text
http://20.244.16.33:5173
```

Do not mix them during login testing. Keycloak tokens contain an issuer
URL. If the API expects the DNS issuer but the browser logs in through the
IP issuer, API calls will fail with `401`.

---

## 6. Update `docker-compose.yml`

The committed compose file defaults to `localhost`. That works only when
the browser runs on the same machine. For the current public deployment,
use the HTTPS browser-facing DNS name if the reverse proxy routes API,
Socket.IO, and Keycloak traffic from the same host.

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

After for the current HTTPS deployment:

```yaml
OIDC_ISSUER: https://bms.demosites.co.in/realms/bms
```

Keep `OIDC_JWKS_URI` unchanged:

```yaml
OIDC_JWKS_URI: http://keycloak:8080/realms/bms/protocol/openid-connect/certs
```

Why: `OIDC_ISSUER` must match what the browser receives in the token. If
operators log in through `https://bms.demosites.co.in`, the token issuer
must be `https://bms.demosites.co.in/realms/bms`. `OIDC_JWKS_URI` is
container-to-container and should keep using the Docker service name
`keycloak`.

### 6.2 Web Build Arguments

Find the `web` service and update the `build.args`.

Use the current HTTPS deployment values:

```yaml
args:
  VITE_API_URL: https://bms.demosites.co.in
  VITE_WS_URL: wss://bms.demosites.co.in
  VITE_AUTH_MODE: oidc
  VITE_OIDC_ISSUER: https://bms.demosites.co.in/realms/bms
  VITE_OIDC_CLIENT_ID: bms-web
  VITE_OIDC_REDIRECT_URI: https://bms.demosites.co.in/auth/callback
```

If DNS or HTTPS reverse proxy is not ready, use the direct public ports
temporarily:

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

### 6.3 Simulator Scope

The compose file has been updated so the simulator writes fewer telemetry
rows for the current demo:

```yaml
SIM_RATE_HZ: 0.2
SIM_ASSET_COUNT: all
SIM_SITE_NAMES: RSMOC Western Cape,CSMOC Gauteng,RSMOC KwaZulu-Natal
```

Keep these values on the server unless you intentionally want the simulator
to cover more locations again. `SIM_SITE_NAMES` must match seeded
`site_name` values exactly. Assets marked with `meta.telemetryEnabled=false`
remain inventory-only and do not emit simulator telemetry.

### 6.4 Optional But Recommended: Change Default Passwords

For a lab you can keep defaults temporarily. For anything public, change
these before first boot:

- `POSTGRES_PASSWORD` (the `bms_app` owner role)
- `BMS_AUTH_PASSWORD`, `BMS_TENANT_PASSWORD`, `BMS_FLEET_PASSWORD` (the three
  non-owner roles the API itself connects as, ADR 0043 — set by
  `pnpm --filter @bms/db roles`, which the `migrate` service already runs
  after `db:migrate`/`db:seed`)
- all `DATABASE_URL`/`DATABASE_URL_AUTH`/`DATABASE_URL_TENANT`/
  `DATABASE_URL_FLEET` values that include one of the four passwords above
- `JWT_SECRET`
- `KEYCLOAK_ADMIN_PASSWORD`
- Grafana admin password if using observability

Reference: [`env-inventory.md`](./env-inventory.md).

Beginner warning: if you change a database password in one place but not
the matching `DATABASE_URL`/`DATABASE_URL_AUTH`/`DATABASE_URL_TENANT`/
`DATABASE_URL_FLEET` value, the API and migration containers will fail to
connect. Changing `BMS_AUTH_PASSWORD`/`BMS_TENANT_PASSWORD`/
`BMS_FLEET_PASSWORD` alone does nothing on an already-provisioned volume —
`pnpm --filter @bms/db roles` must be re-run for the new value to take
effect (see `docs/security/encryption-at-rest.md` §4.3).

---

## 7. Update Keycloak Redirect And Logout URLs

The committed realm keeps localhost for native/local testing. For the
public HTTPS deployment it must also allow the deployed domain:

```json
"redirectUris": [
  "http://localhost:5173/auth/callback",
  "http://localhost:5173/login"
],
"webOrigins": [
  "http://localhost:5173"
],
"attributes": {
  "post.logout.redirect.uris": "http://localhost:5173/login"
}
```

Edit:

```powershell
notepad infra\keycloak\bms-realm.json
```

Under the `bms-web` client, update these arrays and attributes.

Recommended for the current HTTPS deployment:

```json
"redirectUris": [
  "http://localhost:5173/auth/callback",
  "http://localhost:5173/login",
  "https://bms.demosites.co.in/auth/callback",
  "https://bms.demosites.co.in/login"
],
"webOrigins": [
  "http://localhost:5173",
  "https://bms.demosites.co.in"
],
"attributes": {
  "post.logout.redirect.uris": "http://localhost:5173/login##https://bms.demosites.co.in/login",
  "pkce.code.challenge.method": "S256"
}
```

If you are still testing direct public ports instead of HTTPS, use the
direct-port values temporarily:

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

The realm now also includes scoped demo users and roles used by the
Location and Access work:

| Role | Username | Password |
|------|----------|----------|
| Global admin | `admin@bms.local` | `admin123` |
| Western Cape location admin | `wc-admin@bms.local` | `admin123` |
| Western Cape HVAC asset-group admin | `wc-hvac-admin@bms.local` | `admin123` |
| Operator | `operator@bms.local` | `operator123` |
| Viewer | `viewer@bms.local` | `viewer123` |

Important: Keycloak imports this realm only when creating a fresh realm.
If the server already has a running Keycloak realm, editing
`infra/keycloak/bms-realm.json` and pulling Git may not update the live
client automatically. In that case, update the `bms-web` client in the
Keycloak Admin Console or recreate the Keycloak container/realm only when
you are comfortable losing Keycloak-local state.

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

Go to the deployed HTTPS site:

```text
https://bms.demosites.co.in
```

Or if DNS/HTTPS is not working and you are testing direct ports:

```text
http://20.244.16.33:5173
```

Expected login flow:

1. The web app opens.
2. It redirects to Keycloak through the public HTTPS domain.
3. Sign in with one seeded demo user:

   | Role | Username | Password |
   |------|----------|----------|
   | Admin | `admin@bms.local` | `admin123` |
   | Western Cape location admin | `wc-admin@bms.local` | `admin123` |
   | Western Cape HVAC asset-group admin | `wc-hvac-admin@bms.local` | `admin123` |
   | Operator | `operator@bms.local` | `operator123` |
   | Viewer | `viewer@bms.local` | `viewer123` |

4. Keycloak redirects back to:

   ```text
   https://bms.demosites.co.in/auth/callback
   ```

5. The app opens the dashboard.

For a real pilot, change or remove these demo passwords.

---

## 10. Smoke Test Pages

After login, check these pages:

1. Dashboard: `https://bms.demosites.co.in/`
2. Alarm Centre: `https://bms.demosites.co.in/alarms`
3. Sites Map: `https://bms.demosites.co.in/map`
4. Electrical SLD: `https://bms.demosites.co.in/sld`
5. CRAC: `https://bms.demosites.co.in/crac`
6. Energy: `https://bms.demosites.co.in/energy`
7. Work Orders: `https://bms.demosites.co.in/work-orders`
8. Schedule Centre: `https://bms.demosites.co.in/maintenance-schedules`
9. Rule Engine: `https://bms.demosites.co.in/rules`
10. Reports: `https://bms.demosites.co.in/reports`
11. Control Room Dashboard: `https://bms.demosites.co.in/cr-overview`

Also test API health:

```text
https://bms.demosites.co.in/health
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

### After Git Push From This Machine: Update The Server Step By Step

Use this section after changes are committed and pushed from the development
machine, and you need to update the Windows VM that serves
`https://bms.demosites.co.in`.

1. Log in to the Windows VM.
2. Open PowerShell in the repo folder:

   ```powershell
   cd C:\dev\bms
   ```

3. Confirm the current branch and local changes:

   ```powershell
   git status
   git branch --show-current
   ```

   If `git status` shows local edits on the server, do not overwrite them
   blindly. Save them or decide whether they are server-only overrides.

4. Pull the latest pushed code:

   ```powershell
   git fetch origin
   git pull
   ```

5. Re-check the production URL parameters before rebuilding:

   ```powershell
   Select-String -Path docker-compose.yml -Pattern "OIDC_ISSUER|VITE_API_URL|VITE_WS_URL|VITE_OIDC_ISSUER|VITE_OIDC_REDIRECT_URI|SIM_RATE_HZ|SIM_SITE_NAMES"
   Select-String -Path infra\keycloak\bms-realm.json -Pattern "bms.demosites.co.in|post.logout.redirect.uris|location_admin|asset_group_admin"
   ```

6. Ensure the server build uses the HTTPS public values:

   ```yaml
   OIDC_ISSUER: https://bms.demosites.co.in/realms/bms
   VITE_API_URL: https://bms.demosites.co.in
   VITE_WS_URL: wss://bms.demosites.co.in
   VITE_OIDC_ISSUER: https://bms.demosites.co.in/realms/bms
   VITE_OIDC_REDIRECT_URI: https://bms.demosites.co.in/auth/callback
   ```

   The committed compose file may still be localhost-friendly. For the VM,
   keep these production values either in the server's edited
   `docker-compose.yml` or in a server-only `docker-compose.override.yml`.
   Do not mix `http://localhost`, direct public ports, and HTTPS in the
   same OIDC flow.

   Example server-only override:

   ```yaml
   services:
     api:
       environment:
         OIDC_ISSUER: https://bms.demosites.co.in/realms/bms
     web:
       build:
         args:
           VITE_API_URL: https://bms.demosites.co.in
           VITE_WS_URL: wss://bms.demosites.co.in
           VITE_AUTH_MODE: oidc
           VITE_OIDC_ISSUER: https://bms.demosites.co.in/realms/bms
           VITE_OIDC_CLIENT_ID: bms-web
           VITE_OIDC_REDIRECT_URI: https://bms.demosites.co.in/auth/callback
   ```

7. Rebuild and restart the application stack:

   ```powershell
   docker compose --profile pilot up -d --build
   ```

8. Check migration/seed, API, web, Keycloak, and simulator logs:

   ```powershell
   docker compose ps
   docker compose logs --tail=120 migrate
   docker compose logs --tail=120 api
   docker compose logs --tail=80 web
   docker compose logs --tail=120 keycloak
   docker compose logs --tail=80 sim
   ```

9. If the web image was rebuilt but other images did not need changes, you
   can restart only web on later URL-only changes:

   ```powershell
   docker compose build web --no-cache
   docker compose --profile pilot up -d --no-deps web
   ```

10. If Keycloak already had an existing `bms` realm, verify the live
    `bms-web` client in the Keycloak Admin Console. Confirm:

    ```text
    Valid redirect URIs include https://bms.demosites.co.in/auth/callback
    Valid redirect URIs include https://bms.demosites.co.in/login
    Web origins include https://bms.demosites.co.in
    Post logout redirect URIs include https://bms.demosites.co.in/login
    Realm roles include location_admin and asset_group_admin
    Users include wc-admin@bms.local and wc-hvac-admin@bms.local
    ```

11. Smoke-test from a browser outside the VM:

    ```text
    https://bms.demosites.co.in
    https://bms.demosites.co.in/health
    ```

12. Log in with:

    ```text
    admin@bms.local / admin123
    wc-admin@bms.local / admin123
    wc-hvac-admin@bms.local / admin123
    ```

    Check that global admin sees all completed modules, Western Cape
    location admin sees scoped data, and Western Cape HVAC admin sees only
    HVAC-relevant Control Room actions active.

### Rebuild Only Web After URL Changes

Use this if you changed `VITE_*` build args:

```powershell
docker compose build web --no-cache
docker compose --profile pilot up -d --no-deps web
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

The current public demo URL is:

```text
https://bms.demosites.co.in
```

The compose file itself still exposes container ports only. HTTPS requires
a reverse proxy and TLS certificate in front of those containers. Common
choices:

- Caddy
- nginx
- IIS reverse proxy
- Azure Application Gateway

The reverse proxy should route at least:

| Public path or host | Internal target |
|---------------------|-----------------|
| `/` and frontend routes | `http://localhost:5173` |
| `/api/*` | `http://localhost:4000/api/*` |
| `/health` | `http://localhost:4000/health` |
| `/metrics` if exposed internally | `http://localhost:4000/metrics` |
| `/socket.io/*` | `http://localhost:4000/socket.io/*` with WebSocket upgrade |
| `/realms/*` | `http://localhost:8080/realms/*` |
| `/resources/*` | `http://localhost:8080/resources/*` |
| other Keycloak auth/admin paths used by login | `http://localhost:8080` |

After HTTPS is active, verify all of these use `https://` or `wss://`
browser-facing values:

- `VITE_API_URL=https://bms.demosites.co.in`
- `VITE_WS_URL=wss://bms.demosites.co.in`
- `VITE_OIDC_ISSUER=https://bms.demosites.co.in/realms/bms`
- `VITE_OIDC_REDIRECT_URI=https://bms.demosites.co.in/auth/callback`
- API `OIDC_ISSUER=https://bms.demosites.co.in/realms/bms`
- Keycloak `redirectUris` include `https://bms.demosites.co.in/auth/callback`
- Keycloak `redirectUris` include `https://bms.demosites.co.in/login`
- Keycloak `webOrigins` include `https://bms.demosites.co.in`
- Keycloak `post.logout.redirect.uris` includes `https://bms.demosites.co.in/login`

Do not mix HTTP and HTTPS in OIDC settings.

---

## 16. Common Problems And Fixes

### Browser redirects to localhost

Cause: one or more URLs still use `localhost`.

Check:

- `docker-compose.yml` web build args
- `docker-compose.yml` API `OIDC_ISSUER`
- `infra/keycloak/bms-realm.json` redirect URIs, web origins, and
  post-logout redirect URIs

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

For the current HTTPS deployment:

```text
https://bms.demosites.co.in/realms/bms
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
https://bms.demosites.co.in/health
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
docker compose --profile pilot up -d --no-deps web
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
- [ ] Windows Firewall allows `443` and, if needed, `80`
- [ ] Azure NSG allows `443` and, if needed, `80` if this is an Azure VM
- [ ] Direct container ports `5173`, `4000`, and `8080` are private or admin-restricted
- [ ] Reverse proxy routes web, API, Socket.IO, and Keycloak paths correctly
- [ ] `docker-compose.yml` API `OIDC_ISSUER` uses `https://bms.demosites.co.in/realms/bms`
- [ ] `docker-compose.yml` web `VITE_*` args use the HTTPS public URL
- [ ] Keycloak realm allows the public redirect URI, login URI, web origin, and post-logout redirect URI
- [ ] Simulator is limited to the selected demo sites with `SIM_RATE_HZ=0.2`
- [ ] `docker compose --profile pilot up --build` completes
- [ ] Browser opens `https://bms.demosites.co.in`
- [ ] Login succeeds with a seeded user
- [ ] Dashboard and Control Room values update while the simulator runs
- [ ] Default demo passwords are changed before wider pilot use
- [ ] Postgres `5432` and Redis `6379` are not exposed publicly

For native WSL development, use [`local-setup.md`](./local-setup.md).
This guide is only for the Docker-only Windows VM deployment path.
