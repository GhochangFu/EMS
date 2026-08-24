import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "./access-control.service";
import {
  assertAssetGroupScope,
  assertAssetManagementFollowsLocation,
  assertDbRoleBeatsJwtClaim,
  assertFixturesPresent,
  assertGlobalAdminScope,
  assertLocationManagementIsFlat,
  assertLocationScope,
  assertOrganizationScope,
  assertUngrantedRolesFailClosed,
  assertUnprovisionedTokenBehaviour,
} from "./access-control.integration.spec";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../testing/integration-db-gate";

/**
 * `F4.10` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle, because a connection and
 * a skip decision cannot live in a portable assertion bundle.
 *
 * **Skip only when nobody claimed a database; otherwise fail loudly.** A suite
 * that silently skips when the database is unreachable reports green and proves
 * nothing — the same species of defect as an unjournaled migration or an
 * unwrapped spec, and the reason `F4.10` exists at all. So there are exactly
 * two states:
 *
 * - `DATABASE_URL` unset — skip on a developer machine, **throw under `CI`**.
 *   CI runs `db:migrate` → `db:seed` → `test:coverage` against a live
 *   `timescale/timescaledb:latest-pg16` service, so an absent URL there is a
 *   broken pipeline, never an acceptable state.
 * - `DATABASE_URL` set — connecting is now a claim that a database exists.
 *   A failed connection fails the suite everywhere, CI or not. Never skipped.
 *
 * The gate is synchronous on purpose: `apps/api` compiles as CommonJS, where a
 * top-level `await` is a compile error that only `pnpm typecheck:tests` catches,
 * since `nest build` excludes test files from the API build. So the connection
 * itself moved into `beforeAll`, where a throw fails every test rather than
 * skipping them.
 *
 * Run it locally against your own stack (docker-compose.override.yml may remap
 * the port; 5432 is the committed default):
 *
 *   DATABASE_URL=postgres://bms_app:bms_app_dev@localhost:5432/bms pnpm test
 *
 * `AccessControlService` is constructed with `new`, not through a Nest testing
 * module — its dependencies are three drizzle handles (`F4.16` / ADR 0043:
 * auth, tenant, fleet). That keeps `F4.10` free of a new devDependency, which
 * would otherwise trip AGENTS.md §9.4 and need its own ADR before a single test
 * could run.
 *
 * All three arguments below are the **same** owner-backed connection. This
 * suite proves query correctness (which rows a role's grants produce), not row
 * level security itself — the owner bypasses RLS regardless of which of the
 * three pools a query nominally runs through, so passing one real connection
 * three times exercises the exact same SQL this suite always ran. The RLS
 * enforcement claim — that a real `bms_tenant`/`bms_auth` connection with no
 * privileged grant actually gets refused or scoped — is proved separately in
 * `access-control-rls.integration.test.ts`, which is the one that needs three
 * distinct roles.
 */

const connectionString = requireIntegrationDb({
  item: "F4.10",
  label: "access-control integration tests",
  because:
    "a green run here would assert that scope isolation holds while nothing checked it. Fix " +
    "the pipeline, do not relax this guard.",
});

describe.skipIf(!connectionString)("F4.10 — access control against a real database", () => {
  let pool: pg.Pool | undefined;
  let svc: AccessControlService;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F4.10");
    pool = created;
    const db = createDb(created);
    svc = new AccessControlService(db, db, db);
  });

  afterAll(async () => {
    await pool?.end();
  });

  // Ordered deliberately: every containment assertion that follows is vacuous
  // on an unseeded schema, so this runs first and fails with instructions.
  it("has the seeded fixtures every other assertion depends on", async () => {
    await assertFixturesPresent(pool as pg.Pool);
  });

  describe("scopeFromSource — one test per query branch", () => {
    it("global: sees every active location and asset, including gateway-less ones", async () => {
      await assertGlobalAdminScope(svc, pool as pg.Pool);
    });

    it("organization: sees its own org and leaks nothing from another", async () => {
      await assertOrganizationScope(svc, pool as pg.Pool);
    });

    it("location: sees exactly its grants, and canReadAsset agrees with the list", async () => {
      await assertLocationScope(svc, pool as pg.Pool);
    });

    it("asset_group: strictly narrower than the group's own location", async () => {
      await assertAssetGroupScope(svc, pool as pg.Pool);
    });
  });

  it("resolves the role from the database, never from the JWT claim (ADR 0017)", async () => {
    await assertDbRoleBeatsJwtClaim(svc);
  });

  it("refuses an unprovisioned admin claim, leaves other roles' fallback alone (ADR 0044)", async () => {
    await assertUnprovisionedTokenBehaviour(svc);
  });

  it("walks all four sources and fails closed for an ungranted operator/viewer", async () => {
    await assertUngrantedRolesFailClosed(svc);
  });

  it("keeps location management flat — the companion depth ADR's tripwire", async () => {
    await assertLocationManagementIsFlat(svc, pool as pg.Pool);
  });

  it("resolves asset management through location_id (ADR 0018)", async () => {
    await assertAssetManagementFollowsLocation(svc, pool as pg.Pool);
  });
});
