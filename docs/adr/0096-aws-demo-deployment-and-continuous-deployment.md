# ADR 0096 — The AWS demo deployment and its continuous deployment

## Status

Accepted — 2026-10-07 (PR #767, merged `eb93f90a`). Amended the same day
by *Amendment 1* (the ingest host). The owner asked, in chat on 2026-10-07, for this
repository to be deployed to the AWS host behind `bms.demosites.co.in` and for
a CI/CD pipeline that deploys it automatically from then on. Four questions
were put to the owner the same day, each with options and a recommendation;
each ruling is recorded under *Gate questions*. The merge of the PR that
carries this record is the owner's acceptance of its text.

Promotes nothing out of `AGENTS.md` §6. It adds no application dependency, no
schema change and no new app: only deployment files (`deploy/aws/`), two
GitHub workflows and a runbook. It changes no application code.

## Context

**The host is shared.** `3.108.117.92` (Elastic IP, `ap-south-1`) is an arm64
(Graviton) Ubuntu 26.04 instance with 2 vCPU and 7.6 GiB of memory. On
2026-10-07 it ran about 18 containers for other client applications, with
2.4 GiB available and no swap. Caddy owns ports 80 and 443 for every site on
the host and imports one file per site from `/etc/caddy/sites/`. Docker's data
root and the 100 GB data disk are under `/var/www`.

**The DNS already pointed at it**, and a site file
`/etc/caddy/sites/bms.demosites.co.in.caddy` already sent the domain to
`127.0.0.1:5175`, where nothing listened.

**The repository is public.** Anything committed — and any workflow that
reacts to `pull_request` — is visible to and triggerable by anyone.

**The root `docker-compose.yml` is a development stack.** It builds from
source, publishes every service port (Postgres, Redis, MinIO, Keycloak on
`0.0.0.0:8080`, which this host already uses), and carries development
secrets (`JWT_SECRET: change-me-in-compose`, `KEYCLOAK_ADMIN_PASSWORD: admin`,
`*_dev` database passwords). The Keycloak realm import seeds every demo login
with `admin123`.

## Decision

1. **Nothing is built on the host.** The deploy workflow builds three
   `linux/arm64` images on a GitHub-hosted arm64 runner — `ems-api` (also run
   as `worker`, `migrate` and `keycloak-provision`), `ems-web`, `ems-sim` —
   and pushes them to GHCR, tagged with the full commit SHA. The host only
   pulls. A `pnpm install` and a Vite build on the host would compete for the
   memory the other applications use.

2. **A standalone compose file, `deploy/aws/docker-compose.yml`.** Not an
   override of the root file: an override cannot remove a published port
   without `!reset` on every service, and it would inherit the `build:`
   sections. It publishes exactly one port, `127.0.0.1:5175` (the `web`
   container). Every secret is `${VAR:?}` from `/var/www/bms/.env`, which
   `deploy/aws/setup-server.sh` generates once on the host and which never
   enters the repository.

3. **One browser-facing origin.** The `web` container's nginx
   (`deploy/aws/nginx.conf`, mounted over `apps/web/nginx.conf`) serves the
   SPA and routes `/api/`, `/socket.io/` and `/health` to `api`, and
   `/realms/` and `/resources/` to `keycloak`. `/admin` is **not** routed to
   Keycloak — the SPA owns `/admin/*`, and the API reaches the Keycloak admin
   API inside the network. `/metrics` is not routed. Caddy terminates TLS and
   forwards everything to `127.0.0.1:5175`; its `request_body` limit is
   10 MB (telemetry imports are 5 MB). The `VITE_*` build arguments of
   `ems-web` are the HTTPS origin; the API's `OIDC_ISSUER` is the public issuer
   string and its `OIDC_JWKS_URI` stays inside the network.

4. **Memory is bounded.** Every service has a `mem_limit` (Postgres 1 GiB,
   Keycloak 768 MiB with a 512 MiB heap, `api` 768 MiB, `worker` 512 MiB, and
   less for the rest), and the host has a 4 GiB swapfile at
   `/var/www/swapfile` with `vm.swappiness=10`.

5. **The deploy key can do one thing.** GitHub holds the private half of a
   key for a dedicated user, `bmsdeploy`, never the host's administrator key.
   Its `authorized_keys` line is `command="/usr/local/sbin/bms-ctl-ssh",restrict`,
   and one sudoers rule lets it run `/usr/local/sbin/bms-ctl` and nothing
   else. `bms-ctl` validates every argument (`deploy <40-hex SHA>`,
   `rollback`, `sim start|stop|status`, `status`, `logs <service>`).

6. **Only `main` is deployed.** `bms-ctl deploy` refuses a SHA that is not an
   ancestor of `origin/main`. The compose file is read from the checked-out
   commit, and a compose file is root on the host, so a commit that only
   exists on a fork or a branch must never be checked out. The override,
   `BMS_ALLOW_UNMERGED=1`, is an environment variable, which `sudo` resets —
   it is reachable by an administrator only.

7. **`bms-ctl` lives outside the checkout.** It is installed to
   `/usr/local/sbin` by `setup-server.sh`, so a merged commit cannot change
   what root runs on the next deploy. An edit to `deploy/aws/bms-ctl.sh`
   reaches the host only when an administrator re-runs `setup-server.sh`.

8. **The registry token is short-lived.** The deploy job sends its own
   `GITHUB_TOKEN` (`packages: read`) over SSH stdin; `bms-ctl` logs in with a
   throw-away Docker client config and deletes it after the pull. If the GHCR
   packages are public, no token is needed and none is kept either way.

9. **Rollback is one command.** The host keeps the images of the current and
   the previous SHA; `bms-ctl rollback` re-deploys the previous one without a
   pull. "Run workflow" with an older `main` SHA does the same through the
   pipeline.

## Gate questions

| # | Question | Ruling (owner, 2026-10-07) |
|---|----------|----------------------------|
| G1 | The host has 2.4 GiB free and no swap. | Add a 4 GB swapfile and per-container memory limits. |
| G2 | Login mode and data on a public URL. | Keycloak (OIDC) with the seeded demo data, every default secret replaced, **plus the simulator, which the owner can start and stop at will** (`bms-ctl sim`, and the "AWS demo simulator" workflow — "AWS demo services" since Amendment 1). |
| G3 | Which SSH key GitHub holds. | A new deploy-only key for a restricted `bmsdeploy` user; `EuphoriaKey.pem` never leaves the owner's PC. |
| G4 | When the pipeline deploys. | Every push to `main`, after `CI` passes on it; also by hand ("Run workflow"). |

## Consequences

- **A green `CI` on `main` now changes a public site.** The deploy follows
  the existing `CI` workflow through `workflow_run`, so `CI` stays the gate;
  nothing new runs on `pull_request`.
- **Every deploy re-runs `roles`, `migrate` and `seed`**, exactly as the root
  compose file does. The seed is the same seed; a seed change reaches the
  public demo on the next deploy.
- **The demo realm is imported once.** Keycloak reads
  `runtime/keycloak-import/bms-realm.json` only when the `bms` realm does not
  exist, so a later edit to `infra/keycloak/bms-realm.json` does not reach the
  host until the `keycloak-data` volume is recreated.
- **Keycloak runs `start-dev`**, as in the root compose file: its store is
  the H2 database on the `keycloak-data` volume. That is a demo posture, not a
  production one.
- **No observability.** The profile is not deployed. (`ingest` was not
  deployed either; *Amendment 1* adds it.)
- **Actions minutes.** The build runs on every green `main` push, docs-only
  ones included; the GitHub Actions cache keeps an unchanged image to a cache
  hit.

## Files

- `deploy/aws/docker-compose.yml`, `deploy/aws/nginx.conf`
- `deploy/aws/bms-ctl.sh`, `deploy/aws/bms-ctl-ssh.sh`,
  `deploy/aws/setup-server.sh`, `deploy/aws/known_hosts`
- `.github/workflows/deploy-aws.yml`, `.github/workflows/aws-simulator.yml`
  (renamed `aws-services.yml` by Amendment 1)
- `docs/runbooks/aws-demo-deployment.md`

## Amendment 1 — the ingest host, on the live PHE broker (2026-10-07)

**Ruling (owner, 2026-10-07, in chat).** After the first deploy the owner asked
for `ingest` on the demo host too, "managed from the actions tab like the sim".
One question was put first, because the demo database seeds the five PHE pilot
MQTT RTUs (`Airsprint-1051/Data/...`, organization `PHEWB`) and holds no
`rtu_connection_configs` row, so every RTU falls back to `MQTT_HOST`:

| # | Question | Ruling |
|---|----------|--------|
| G5 | Which broker `ingest` on the demo host uses. | **The live PHE pilot broker**, `phe.thinkiot.co.in:8883`, with the pilot's MQTT login. |

This is the `AGENTS.md` §6 step "running the host against a production
deployment", and G5 is the owner's named instruction for it on this host. It
does not generalise to any other host or broker.

**Decisions.**

1. **A fourth image, `ems-ingest`** (`apps/ingest/Dockerfile`, `linux/arm64`),
   built by the same matrix and tagged with the same SHA.
2. **`ingest` is an optional service, like `sim`.** It is the compose profile
   `ingest`, off until `bms-ctl ingest start`; `bms-ctl` records the choice in
   `state/ingest-enabled` and keeps it across deploys. `bms-ctl sim` and
   `bms-ctl ingest` share one implementation.
3. **One workflow for both**, "AWS demo services" (`aws-services.yml`, renamed
   from `aws-simulator.yml`): service `sim` or `ingest`, action
   `start`, `stop` or `status`.
4. **The broker login lives in `/var/www/bms/.env`** (`MQTT_USERNAME`,
   `MQTT_PASSWORD`), like every other secret. The compose file reads them as
   optional, so a missing one cannot stop the rest of the stack, and
   `bms-ctl ingest start` refuses to start while either is empty.
5. **The network split of ADR 0016 Amendment 8, Decision 2 is kept.**
   `ingest` joins only the `ingest` network, which it shares with `postgres`;
   its unauthenticated health endpoint is not reachable from `web` or `api`.
6. **A second subscriber, not a replacement.** The pilot's own ingest host
   keeps running. The MQTT adapter passes no client id, so mqtt.js generates
   a random one per connection and the two hosts never take each other's
   session. Both write to their own database.

**Consequences.**

- Real PHE telemetry appears on the public demo URL, behind the Keycloak
  login, for every user whose scope includes `PHEWB`.
- `ingest` uses 256 MiB at most (`mem_limit`).
- An edit to `bms-ctl.sh` reaches the host only through `setup-server.sh`
  (decision 7 above); this amendment needs that re-run once after it merges.
