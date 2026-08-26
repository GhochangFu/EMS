import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertAuthCanReadPasswordHash,
  assertAuthCanUpdateOnlyLastLogin,
  assertAuthReachesOnlyIdentityTables,
  assertFleetCannotReadPasswordHash,
  assertFleetIsDeniedPasswordHashAtRuntime,
  assertNoRoleCanInsertOrDeleteUsers,
  assertRolesExist,
  assertTenantCannotReadPasswordHash,
  assertTenantIsDeniedPasswordHashAtRuntime,
  assertTenantReachesTelemetry,
} from "./role-grants.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F4.16` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 *
 * The connection is made as the provisioning superuser (`bms_app`, via the
 * gate's `connection: "superuser"` — since ADR 0045 it is no longer the schema
 * owner), rather than as one of the three roles under test. That is deliberate:
 * those roles are `NOLOGIN` until `pnpm db:roles` runs, and the suite must pass
 * on a database that has had `db:migrate` and nothing else. The runtime denials use `SET LOCAL ROLE`, which
 * needs no password and no `LOGIN` attribute.
 *
 * Run it locally against your own stack (docker-compose.override.yml remaps the
 * published port to 5433; 5432 is the committed default):
 *
 *   DATABASE_URL=postgres://bms_owner:bms_owner_dev@localhost:5433/bms pnpm --filter api test role-grants
 */

const connectionString = requireIntegrationDb({
  item: "F4.16",
  label: "role grant-matrix tests",
  because:
    "they are the only check that bms_tenant cannot select password_hash and that " +
    "bms_auth reaches no table beyond the four identity tables. Without them the " +
    "migration's REVOKE can be a no-op and nothing says so.",
  // `E7.1a` / ADR 0045. The runtime denials use `SET LOCAL ROLE`, which requires
  // the superuser attribute or membership in the target role. `bms_owner` — what
  // `DATABASE_URL` names since ADR 0045 — has neither, and giving it membership
  // would let the owner `SET ROLE bms_fleet` and inherit BYPASSRLS, defeating the
  // FORCE this item exists to make binding. So this one suite asks for the
  // provisioning superuser by name.
  connection: "superuser",
});

describe.skipIf(!connectionString)("F4.16 — role grant matrix", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.16");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("creates the three roles, and only bms_fleet bypasses RLS", async () => {
    await assertRolesExist(pool as pg.Pool);
  });

  it("withholds password_hash from bms_tenant", async () => {
    await assertTenantCannotReadPasswordHash(pool as pg.Pool);
  });

  it("withholds password_hash from bms_fleet as well", async () => {
    await assertFleetCannotReadPasswordHash(pool as pg.Pool);
  });

  it("keeps password_hash readable by bms_auth", async () => {
    await assertAuthCanReadPasswordHash(pool as pg.Pool);
  });

  it("lets no pool role insert or delete a bms.users row", async () => {
    await assertNoRoleCanInsertOrDeleteUsers(pool as pg.Pool);
  });

  it("grants bms_auth nothing beyond the four identity tables", async () => {
    await assertAuthReachesOnlyIdentityTables(pool as pg.Pool);
  });

  it("lets bms_auth update only last_login_at on bms.users (auth_bootstrap_write containment)", async () => {
    await assertAuthCanUpdateOnlyLastLogin(pool as pg.Pool);
  });

  describe("the server refuses the query, not merely the catalogue entry", () => {
    it("denies bms_tenant a select of password_hash while allowing the row", async () => {
      await assertTenantIsDeniedPasswordHashAtRuntime(pool as pg.Pool);
    });

    it("denies bms_fleet the same column despite BYPASSRLS", async () => {
      await assertFleetIsDeniedPasswordHashAtRuntime(pool as pg.Pool);
    });
  });

  it("reaches the hypertable and a continuous aggregate as bms_tenant", async () => {
    await assertTenantReachesTelemetry(pool as pg.Pool);
  });
});
