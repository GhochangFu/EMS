# Windows VM pilot deployment (Docker Desktop)

This guide deploys the BMS **Phase 1** stack on a **Windows Server or Windows 11 VM** using **Docker Desktop** and **Linux containers**. The database, Redis, Keycloak, API, and web UI run **inside Docker**. You do **not** need to install Postgres, TimescaleDB, or Node on the host for this path.

**Before you start:** Decide the **browser-facing base URL** users will type. Examples:

- `http://20.244.16.33` (public IP, HTTP — pilot only)
- `https://bms.example.com` (HTTPS + DNS — preferred for anything beyond a lab)

The stock `docker-compose.yml` assumes **`localhost`**. For remote users you must align **compose env/build args**, **Keycloak client URLs**, and **firewall rules** with that base URL.

Replace `PUBLIC_HOST` below with your choice (e.g. `20.244.16.33` or `bms.example.com`). Replace `PUBLIC_SCHEME` with `http` or `https`. Ports stay **5173** (web), **4000** (API), **8080** (Keycloak) unless you put a reverse proxy in front.

---

## 1. VM prerequisites

### 1.1 Install Docker Desktop

1. Download and install [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/).
2. During setup, enable the **WSL 2 backend** when prompted (Docker uses this to run Linux containers; you are **not** required to install Postgres in WSL).
3. Confirm **Linux containers** mode (default): Docker menu should **not** say “Switch to Linux containers” if you are already on Linux containers.

### 1.2 Allocate resources

Open **Docker Desktop → Settings → Resources**:

- Assign enough **RAM** for Postgres + Keycloak + API + Web (roughly **4 GiB minimum**; **6–8 GiB** is safer with simulator and observability).
- Assign at least **2 CPUs** if the VM allows.

### 1.3 File sharing

**Docker Desktop → Settings → General / Resources → File sharing:** ensure the drive where you will clone the repo (e.g. `C:`) is allowed.

### 1.4 Install Git (optional but typical)

Install [Git for Windows](https://git-scm.com/download/win) so you can clone the repository. Alternatives: copy a ZIP of the repo to the VM.

---

## 2. Get the application source

In **PowerShell** (run as your normal user):

```powershell
cd C:\dev
git clone <YOUR_REPOSITORY_URL> bms
cd bms
```

Use a path **without** synced folders like OneDrive if you hit slow builds or file-watch issues.

---

## 3. Point the stack at your public URL

The following must all describe **the same** origin that the **browser** uses (scheme + host + port).

### 3.1 Edit `docker-compose.yml`

**API service** — set the issuer to the browser-reachable Keycloak URL:

| Variable      | Example when using IP and default ports |
|---------------|-----------------------------------------|
| `OIDC_ISSUER` | `http://PUBLIC_HOST:8080/realms/bms`    |

Leave **`OIDC_JWKS_URI`** as `http://keycloak:8080/realms/bms/protocol/openid-connect/certs` (container-to-container).

**`web` service `build.args`** — bake client-side URLs (rebuilt on every `docker compose build web`):

| Build arg                 | Example |
|---------------------------|---------|
| `VITE_API_URL`            | `http://PUBLIC_HOST:4000` |
| `VITE_WS_URL`             | `ws://PUBLIC_HOST:4000` (use `wss://` if you terminate TLS in front of the API) |
| `VITE_OIDC_ISSUER`       | `http://PUBLIC_HOST:8080/realms/bms` |
| `VITE_OIDC_CLIENT_ID`    | `bms-web` (unchanged unless you changed the realm) |
| `VITE_OIDC_REDIRECT_URI` | `http://PUBLIC_HOST:5173/auth/callback` |

If you use **HTTPS** on a single hostname, all of these must use `https://` / `wss://` and the **same host** you configured in Keycloak.

### 3.2 Edit Keycloak client redirect URLs

Open **`infra/keycloak/bms-realm.json`**. Under the `bms-web` client, extend **`redirectUris`** and **`webOrigins`** so they include your pilot URL (you may keep `localhost` entries for testing only from the VM itself):

```json
"redirectUris": [
  "http://localhost:5173/auth/callback",
  "http://PUBLIC_HOST:5173/auth/callback"
],
"webOrigins": [
  "http://localhost:5173",
  "http://PUBLIC_HOST:5173"
]
```

**Important:** Keycloak imports this realm when the container starts with **`--import-realm`**. If you already ran Keycloak once, it may **not** overwrite an existing realm. For a clean import:

1. Stop the stack: `docker compose --profile core down`
2. Remove the Keycloak volume if your setup persists realm data (only if you accept losing that volume’s data), **or**
3. Use Keycloak **Admin Console** (`http://PUBLIC_HOST:8080`) → **Clients → bms-web** → add the same redirect URIs and web origins manually.

### 3.3 Change default secrets for anything beyond a lab

Before a wider pilot, change at least:

- Postgres `POSTGRES_PASSWORD` in `docker-compose.yml` and matching `DATABASE_URL` / app env vars
- `JWT_SECRET` (used for local-auth paths)
- Keycloak `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`
- Grafana defaults if you use the observability profile

Reference: [`docs/env-inventory.md`](./env-inventory.md).

---

## 4. Windows Firewall (inbound)

Allow inbound TCP on the ports you publish (default compose):

| Port  | Service   |
|-------|-----------|
| 5173  | Web UI    |
| 4000  | API + WS  |
| 8080  | Keycloak  |

**PowerShell (Administrator)** example (adjust profile names if needed):

```powershell
New-NetFirewallRule -DisplayName "BMS Web 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
New-NetFirewallRule -DisplayName "BMS API 4000" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow
New-NetFirewallRule -DisplayName "BMS Keycloak 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
```

Do **not** expose **5432** or **6379** to the public internet unless you have a strong reason; bind them to a private network only or remove port mappings for a public-facing VM.

If the VM runs in **Azure** (or similar), add matching **NSG inbound rules** for the same ports.

---

## 5. Start the stack

From the repo root (folder containing `docker-compose.yml`):

### 5.1 Core app (recommended first boot)

```powershell
docker compose --profile core up --build
```

This starts **Postgres (TimescaleDB)**, **Redis**, **Keycloak**, **migrate** (seed), **API**, and **Web**.

Wait until migrations finish and containers stay healthy. First boot can take several minutes while images build.

### 5.2 Optional: telemetry simulator

In a **second** PowerShell window, from the same directory:

```powershell
docker compose --profile sim up --build sim
```

Or use the **`pilot`** profile to start a demo-shaped set (see [`README.md`](../README.md)).

### 5.3 Optional: observability (Prometheus, Grafana, Loki, Promtail)

```powershell
docker compose --profile core --profile sim --profile observability up --build
```

**Docker Desktop note:** **Promtail** mounts the Docker socket for log discovery. Behavior can differ from Linux hosts. If Promtail fails to start, you can still use **Prometheus + Grafana + Loki** and troubleshoot Promtail later, or rely on [`docs/observability-runbook.md`](./observability-runbook.md) for health checks.

---

## 6. Smoke test

### 6.1 On the VM

- Web: `http://localhost:5173`
- API health: `http://localhost:4000/health`

### 6.2 From another machine

- Web: `http://PUBLIC_HOST:5173`
- Sign in via Keycloak (seeded pilot user in the realm export: e.g. `admin@bms.local` / `admin123` — **change in real pilots**)

If login redirects to **`localhost`**, you missed a URL in **compose** or **Keycloak**. If the API returns **401**, compare **`iss`** in the token with **`OIDC_ISSUER`** on the API.

---

## 7. Day‑two commands

**Stop** (keeps volumes):

```powershell
docker compose --profile core down
```

**Reset application database only** (destructive — deletes Postgres volume; name may differ):

```powershell
docker compose --profile core down
docker volume rm bms_bms-postgres-data
```

See [`README.md`](../README.md) for the exact volume name pattern used by your compose project.

**Rebuild web after changing Vite build args:**

```powershell
docker compose build web --no-cache
docker compose --profile core up -d
```

---

## 8. HTTPS (recommended for non‑lab)

For a hostname and TLS:

1. Put **nginx**, **Caddy**, or IIS + reverse proxy in front.
2. Terminate TLS there and proxy to **web :5173**, **API :4000**, **Keycloak :8080** (or consolidate paths on one hostname if you configure Keycloak for a reverse proxy).
3. Update **all** `VITE_*`, **`OIDC_ISSUER`**, and Keycloak **redirect / web origins** to **`https://`** URLs.
4. Tighten Keycloak hostname settings for production (the committed compose uses dev-oriented flags).

---

## 9. Quick checklist

- [ ] Docker Desktop running, Linux containers, enough CPU/RAM
- [ ] Repo cloned on a file-shared drive
- [ ] `OIDC_ISSUER` and all `VITE_*` build args use the **browser** URL
- [ ] Keycloak **`bms-web`** client allows redirect and web origin for `http(s)://HOST:5173`
- [ ] Windows Firewall (and cloud NSG) allow 5173, 4000, 8080
- [ ] Default passwords rotated for real pilots
- [ ] Database and Redis ports **not** exposed unnecessarily to the internet

For native developer setup on WSL (Node + local Postgres), continue to use [`local-setup.md`](./local-setup.md); that path is **not** required for this Docker-only VM deployment.
