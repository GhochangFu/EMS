import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { LocationsAdminService } from "./locations.service";
import {
  createAuditRecordsTheStoredMeta,
  createStoresNoSeedKey,
  type SeedKeyCtx,
  updateAuditRecordsTheStoredMeta,
  updateCannotForgeAKey,
  updateCannotMoveTheKey,
  updateWithEmptyMetaKeepsTheKey,
  updateWithMetaKeepsAKeyWrittenAfterTheRead,
  updateWithoutMetaKeepsAKeyWrittenAfterTheRead,
  updateWithoutMetaKeepsTheKey,
} from "./locations.seed-key.integration.spec";

/**
 * `F4.170` owner ruling 20 — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle, on the
 * `locations.timezone.integration.test.ts` harness.
 */
const connectionString = requireIntegrationDb({
  item: "F4.170",
  label: "meta.seedKey is seed-owned on the LocationsAdminService write path",
  because:
    "the stored meta is what the seed reads its identity from, so only a real write and " +
    "read-back can say whether a request's seedKey reached the row.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000001";

const RUN = Date.now();
/** Per-run family; every row this suite writes carries it (`code LIKE 'F4170-SK-<run>-%'`). */
const FAMILY = `F4170-SK-${RUN}`;
/** The family every run shares, for the stale sweep. */
const FAMILY_PATTERN = "F4170-SK-%";

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
      `[F4.170] could not sweep stale fixture rows: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

/**
 * The real vocabulary check, with a one-shot hook run first. `update` calls
 * `assertLocationType` after its fleet read of the row and before its write
 * transaction opens, so the hook lands a write in exactly that window (P6, P7).
 */
class HookedVocabularies extends VocabulariesService {
  private hook: (() => Promise<void>) | undefined;

  setHook(hook: () => Promise<void>): void {
    this.hook = hook;
  }

  override async assertLocationType(code: string): Promise<void> {
    const hook = this.hook;
    this.hook = undefined;
    if (hook) {
      await hook();
    }
    await super.assertLocationType(code);
  }
}

function jwtFor(email: string): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role: "organization_admin" };
}

describe.skipIf(!connectionString)("F4.170 ruling 20 — meta.seedKey on the location admin write path", () => {
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: SeedKeyCtx;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F4.170",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.170",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.170",
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
      throw new Error(`F4.170: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }

    const vocabularies = new HookedVocabularies(createDb(tenantPool));
    const svc = new LocationsAdminService(
      createDb(fleetPool),
      createDb(tenantPool),
      new AccessControlService(createDb(authPool), createDb(fleetPool)),
      new MasterDataAuditService(createDb(tenantPool), createDb(fleetPool)),
      vocabularies,
    );
    ctx = {
      svc,
      fleetPool,
      organizationId: rows[0].id,
      jwt: jwtFor(ORGANIZATION_ADMIN_EMAIL),
      register: (id) => createdIds.push(id),
      family: FAMILY,
      keyValue: (suffix) => `f4170-api-${RUN}-${suffix.toLowerCase()}`,
      beforeNextTypeCheck: (hook) => vocabularies.setHook(hook),
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

  it("P1 a POST with meta.seedKey stores no key", async () => {
    await createStoresNoSeedKey(ctx);
  });

  it("P2 a PATCH meta: {} on a keyed row keeps the key", async () => {
    await updateWithEmptyMetaKeepsTheKey(ctx);
  });

  it("P3 a PATCH meta: { seedKey } on a keyed row leaves the stored key unchanged", async () => {
    await updateCannotMoveTheKey(ctx);
  });

  it("P4 a PATCH meta: { seedKey } on an unkeyed row stores no key", async () => {
    await updateCannotForgeAKey(ctx);
  });

  it("P5 a PATCH without meta on a keyed row keeps the key", async () => {
    await updateWithoutMetaKeepsTheKey(ctx);
  });

  it("P6 a PATCH with meta keeps a key written after the service's read", async () => {
    await updateWithMetaKeepsAKeyWrittenAfterTheRead(ctx);
  });

  it("P7 a PATCH without meta keeps a key written after the service's read", async () => {
    await updateWithoutMetaKeepsAKeyWrittenAfterTheRead(ctx);
  });

  it("A1 the create's audit row records the stored meta, not the request's seedKey", async () => {
    await createAuditRecordsTheStoredMeta(ctx);
  });

  it("A2 the update's audit row records the stored meta, not the request's seedKey", async () => {
    await updateAuditRecordsTheStoredMeta(ctx);
  });
});
