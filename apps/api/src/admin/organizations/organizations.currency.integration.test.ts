import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { OrganizationsAdminService } from "./organizations.service";
import {
  createRefusesALowercaseCurrency,
  createRefusesAnUnknownCurrency,
  createStoresAKnownCurrency,
  createWithoutTheKeyIsRefusedAndInsertsNoRow,
  dtoParsesWithTheSharedContract,
  updateChangesAndAbsentKeeps,
  type CurrencyCtx,
} from "./organizations.currency.integration.spec";

/**
 * `E4.1c` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle, on the
 * `locations.timezone.integration.test.ts` harness.
 *
 * **Cleanup is not optional here.** `verifyHierarchySeed` asserts
 * `count(*) FROM bms.organizations = 2` on every `db:seed`, and `compose up`'s
 * `migrate` service is what the `api` service waits on — one leaked fixture
 * organization stops the whole stack from starting (`pue-ratio`'s lesson).
 * Every row is registered the moment it exists and deleted in `afterAll`;
 * a stale sweep bounded by `created_at` reaps a run that died before it.
 */
const connectionString = requireIntegrationDb({
  item: "E4.1c",
  label: "bms.organizations.currency on the OrganizationsAdminService write path",
  because:
    "the column is NOT NULL with no default and the DTO is read back off the row; only the " +
    "real database can say what a create without the key does and what the row carries after an update.",
});

const GLOBAL_ADMIN_EMAIL = "admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000001";

/** Per-run family; every row this suite writes carries it (`code LIKE 'E41C-CUR-<run>-%'`). */
const FAMILY = `E41C-CUR-${Date.now()}`;
/** The family every run shares, for the stale sweep. */
const FAMILY_PATTERN = "E41C-CUR-%";

/** Reaps rows an earlier run committed but never cleaned (the F4.16 shape). */
async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM bms.audit_log
        WHERE entity_type = 'organization'
          AND entity_id IN (
            SELECT id FROM bms.organizations
             WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'
          )`,
      [FAMILY_PATTERN],
    );
    await pool.query(
      `DELETE FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`,
      [FAMILY_PATTERN],
    );
  } catch (err) {
    process.stderr.write(
      `[E4.1c] could not sweep stale fixture rows: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

function jwtFor(email: string): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role: "admin" };
}

describe.skipIf(!connectionString)("E4.1c — organizations.currency on the admin write path", () => {
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: CurrencyCtx;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "E4.1c",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E4.1c",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E4.1c",
    );

    await sweepStaleRuns(fleetPool);

    const { rows } = await fleetPool.query<{ id: string }>(
      `SELECT id FROM bms.users WHERE email = $1 AND role = 'admin' LIMIT 1`,
      [GLOBAL_ADMIN_EMAIL],
    );
    if (!rows[0]) {
      throw new Error(`E4.1c: ${GLOBAL_ADMIN_EMAIL} is not a seeded global admin — run pnpm db:seed.`);
    }

    const svc = new OrganizationsAdminService(
      createDb(fleetPool),
      createDb(tenantPool),
      new AccessControlService(createDb(authPool), createDb(fleetPool)),
      new MasterDataAuditService(createDb(tenantPool), createDb(fleetPool)),
    );
    ctx = {
      svc,
      fleetPool,
      jwt: jwtFor(GLOBAL_ADMIN_EMAIL),
      register: (id) => createdIds.push(id),
      family: FAMILY,
    };
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await fleetPool.query(
        "DELETE FROM bms.audit_log WHERE entity_type = 'organization' AND entity_id = ANY($1)",
        [createdIds],
      );
      await fleetPool.query("DELETE FROM bms.organizations WHERE id = ANY($1)", [createdIds]);
    }
    await Promise.all([fleetPool.end(), authPool.end(), tenantPool.end()]);
  });

  it("T1 create with INR stores it on the DTO and the row", async () => {
    await createStoresAKnownCurrency(ctx);
  });

  it("T2 create without the key is a 400 and inserts no row", async () => {
    await createWithoutTheKeyIsRefusedAndInsertsNoRow(ctx);
  });

  it("T3 create with XYZ is a 400 naming ISO 4217", async () => {
    await createRefusesAnUnknownCurrency(ctx);
  });

  it("T4 create with zar is a 400 (three upper-case letters)", async () => {
    await createRefusesALowercaseCurrency(ctx);
  });

  it("T5 update to USD changes the row; an update without the key keeps it", async () => {
    await updateChangesAndAbsentKeeps(ctx);
  });

  it("T6 the DTO parses with adminOrganizationDtoSchema", async () => {
    await dtoParsesWithTheSharedContract(ctx);
  });
});
