# Runbook — the Ion Exchange demo organization (F3.32 / ADR 0079 Amendment 1)

How to build, on the demo host, the **Ion Exchange demo organization**
(`IONX-DEMO`) that shows the `F3.32` water-train plant mimic on live
simulated data — with no visibility into `ESKOM` or `PHEWB`.

ADR 0079 Open point 2 first ruled that an administrator builds this by hand in
the admin screens. Writing this runbook found that no screen and no API
creates an asset group, a membership, a user or an access grant, so
**Amendment 1** (owner ruling, 2026-09-28) replaced the by-hand steps with a
one-off, idempotent command. It is **not** part of `db:seed`; run it once on
the demo host.

## 0. Before you start

- The database is migrated and seeded (`roles → migrate → seed`). The command
  reads the fleet-wide point-key catalog the seed writes, and the mimic role
  codes `wtp`, `ro`, `stp`, `etp` from migration `0087`.
- **The deployed build must include `F4.169`** (#627, on `main` since 2026-09-28). Before it,
  `verifyHierarchySeed` (`packages/db/src/verify-hierarchy-seed.ts`, Pass 1)
  requires **exactly 2** rows in `bms.organizations`. After this command there
  are 3, so every later `db:seed` — including the compose `migrate` service on
  each `docker compose up` — fails with
  `Hierarchy seed verification failed: - organizations: expected 2, got 3`.
  `F4.169` changes the check to count only the seeded organization codes. Do
  not run the command on a build without it.

## 1. Run the command

Run it in the compose `migrate` service's container. That image carries
`packages/db` and `tsx`, and its environment already sets `DATABASE_URL`
(`bms_owner`) and `DATABASE_URL_SUPERUSER` (`bms_app`) for the in-network
host `postgres`. Rebuild the image first if it predates this command:

```powershell
docker compose build migrate
docker compose run --rm migrate pnpm --filter @bms/db demo:ion-exchange
```

From a host checkout instead, set both variables to the published Postgres
port of your stack (not the in-network `postgres:5432`) and run
`pnpm --filter @bms/db demo:ion-exchange`.

It creates, in `IONX-DEMO` only:

| What | Value |
|------|-------|
| Organization | code `IONX-DEMO`, name "Ion Exchange Demo", currency `INR` |
| Site | "Ion Exchange Demo Plant", slug `ionx-demo-plant`, type `pump_station`, zone `Asia/Kolkata` |
| Simulator RTU | `SIM-RTU-IONX-DEMO-PLANT-WATER` (domain `water`) |
| Water assets | `WTR-WTP-02`, `WTR-RO-02`, `WTR-CT-02`, `WTR-STP-02`, `WTR-ETP-02`, each pinned to this organization's own `DEMO-WATER-<CLASS>` mirror template with its flow points |
| Asset group | `demo-water-plant`, roles WTP `wtp`, RO `ro`, CT `utilities`, STP `stp`, ETP `etp` |
| Dashboard | slug `water-plant-mimic`, scoped to that group, one **Plant mimic** widget `{ "source": "preset", "preset": "water_train" }` |
| Login | `ionx-admin@bms.local`, "Ion Exchange Demo Admin", role `organization_admin`, organization access to `IONX-DEMO` only |

**Why the codes end `-02`.** `bms.assets.code` is unique across the whole
fleet, and the seed already owns `WTR-WTP-01` … `WTR-ETP-01` under `ESKOM`.
The simulator gives flows to any `WTR-<WTP|RO|CT|STP|ETP>-NN` code, in any
organization (`waterClassOf`, `apps/sim/src/index.js`), so `-02` is enough.

The command ends with a read-back of every row above and throws with the
counts if one is missing. A second run writes nothing and prints
`already present — this run changed nothing`. A membership role is written
only while it is empty, so a role an operator changed is never overwritten.

## 2. Add the login to Keycloak (OIDC deployments)

The API maps a token to `bms.users` by email, so the Keycloak user must carry
the same email. `infra/keycloak/bms-realm.json` now holds
`ionx-admin@bms.local` with realm role `organization_admin`.

- Keycloak's `--import-realm` (the compose `keycloak` service) imports the
  file only when the `bms` realm does **not** exist yet. On a host whose realm
  is already imported, add the user by hand in the Keycloak admin console
  (realm `bms` → Users → Add user), with the email above, realm role
  `organization_admin`, and a non-temporary password.
- **Password.** The realm file uses the repository's demo password convention
  (`admin123`, the same as `phe-admin@bms.local`); the command sets the same
  value on the local `bms.users` row. **Change it on any customer-facing
  host** before the demo.

## 3. Restart the simulator

The simulator reads assets **once at start**. It must also select the new
site:

- The compose `sim` service lists `Ion Exchange Demo Plant` in
  `SIM_SITE_NAMES` (`docker-compose.yml`). If a host overrides that list,
  keep the site in it, or the five new assets get no flows.
- Keep `SIM_ASSET_COUNT=all` (the compose default); a smaller count can leave
  the new assets unselected.

```powershell
docker compose up -d sim
```

(`up -d` recreates the container with a changed environment; `restart` does
not re-read it.)

## What the demo must show

Log in as `ionx-admin@bms.local` and open the dashboard `water-plant-mimic`.
The mimic renders 8 nodes in preset order: intake, WTP, RO, softener,
storage, cooling tower, STP, ETP (discharge is a drawn sink label after ETP,
not a ninth node — ADR 0079 owner ruling 1).

- **5 nodes carry a live asset and live values**: WTP, RO, cooling tower,
  STP, ETP — the five `WTR-…-02` assets, updating from the simulator's flows.
- **3 nodes show dimmed "Not assigned"**: intake, softener, storage — no
  membership carries `water_intake`, `softener`, or `water_storage` in this
  demo group, by design (ADR 0079 Consequences, Open point 1).
- The login sees only the Ion Exchange organization — no `ESKOM` or `PHEWB`
  data anywhere in its session.

## Rehearsal

Rehearsed on the local stack (date): ____________________

Rehearsed by: ____________________

Notes / deviations from this runbook: ____________________
