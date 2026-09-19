import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { LocationsAdminService } from "./locations.service";
import {
  createRefusesALowercaseZone,
  createRefusalInsertsNoRow,
  createRefusesAnUnknownZone,
  createStoresAKnownZone,
  createWithoutTheKeyStoresNull,
  dtoParsesWithTheSharedContract,
  updateWithNullClearsTheZone,
  updateWithoutTheKeyKeepsTheZone,
  type TimezoneCtx,
} from "./locations.timezone.integration.spec";

/**
 * `E4.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle, on the
 * `locations.rls.integration.test.ts` harness.
 */
const connectionString = requireIntegrationDb({
  item: "E4.1b",
  label: "bms.locations.timezone on the LocationsAdminService write path",
  because:
    "the valid set is pg_timezone_names, a Postgres view; only the real database can say " +
    "whether 'Not/AZone' is refused and 'asia/kolkata' is not the canonical spelling.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000001";

/** Per-run family; every row this suite writes carries it (`code LIKE 'E41B-TZ-<run>-%'`). */
const FAMILY = `E41B-TZ-${Date.now()}`;
/** The family every run shares, for the stale sweep. */
const FAMILY_PATTERN = "E41B-TZ-%";

/** Reaps rows an earlier run committed but never cleaned (the F4.16 shape). */
async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM bms.audit_log
        WHERE entity_type = 'location'
          AND entity_id IN (
            SELECT id FROM bms.locations
             WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'
          )`,
      [FAMILY_PATTERN],
    );
    await pool.query(
      `DELETE FROM bms.locations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`,
      [FAMILY_PATTERN],
    );
  } catch (err) {
    process.stderr.write(
      `[E4.1b] could not sweep stale fixture rows: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

function jwtFor(email: string): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role: "organization_admin" };
}

describe.skipIf(!connectionString)("E4.1b — locations.timezone on the admin write path", () => {
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: TimezoneCtx;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    // `requireIntegrationDb` names bms_fleet by default; asRole makes that explicit.
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "E4.1b",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E4.1b",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E4.1b",
    );

    await sweepStaleRuns(fleetPool);

    const { rows } = await fleetPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!rows[0]) {
      throw new Error(
        `E4.1b: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
      );
    }

    const svc = new LocationsAdminService(
      createDb(fleetPool),
      createDb(tenantPool),
      new AccessControlService(createDb(authPool), createDb(fleetPool)),
      new MasterDataAuditService(createDb(tenantPool), createDb(fleetPool)),
    );
    ctx = {
      svc,
      fleetPool,
      organizationId: rows[0].id,
      jwt: jwtFor(ORGANIZATION_ADMIN_EMAIL),
      register: (id) => createdIds.push(id),
      family: FAMILY,
    };
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await fleetPool.query(
        "DELETE FROM bms.audit_log WHERE entity_type = 'location' AND entity_id = ANY($1)",
        [createdIds],
      );
      await fleetPool.query("DELETE FROM bms.locations WHERE id = ANY($1)", [createdIds]);
    }
    await Promise.all([fleetPool.end(), authPool.end(), tenantPool.end()]);
  });

  it("T1 create with Asia/Kolkata stores it on the DTO and the row", async () => {
    await createStoresAKnownZone(ctx);
  });

  it("T2a create with Not/AZone is a 400 naming the example zone and the value", async () => {
    await createRefusesAnUnknownZone(ctx);
  });

  it("T2b the refusal inserts no row", async () => {
    await createRefusalInsertsNoRow(ctx);
  });

  it("T3 create with asia/kolkata is a 400 (exact, case-sensitive match — Q14)", async () => {
    await createRefusesALowercaseZone(ctx);
  });

  it("T4 create without the key stores NULL", async () => {
    await createWithoutTheKeyStoresNull(ctx);
  });

  it("T5 update with timezone: null clears it", async () => {
    await updateWithNullClearsTheZone(ctx);
  });

  it("T6 update without the key keeps it", async () => {
    await updateWithoutTheKeyKeepsTheZone(ctx);
  });

  it("T7 the DTO parses with adminLocationDtoSchema", async () => {
    await dtoParsesWithTheSharedContract(ctx);
  });
});
