import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, onboardingSessions } from "@bms/db";
import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { OnboardingCommitService } from "./onboarding-commit.service";
import { OnboardingValidateService } from "./onboarding-validate.service";
import {
  assertCommittedLocationHasNoSeedKey,
  type OnboardingSeedKeyCtx,
} from "./onboarding-commit.seed-key.integration.spec";

/**
 * `F4.170` owner ruling 20 — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle. The
 * harness and the cleanup are `onboarding-commit.telemetry-source.integration
 * .test.ts`'s (children first, by the ids `commit()` returned, the session by
 * id), for one simulator draft.
 */
const connectionString = requireIntegrationDb({
  item: "F4.170",
  label: "OnboardingCommitService never writes meta.seedKey from a draft",
  because:
    "the location insert runs inside the commit's withTenant transaction, so only a real " +
    "commit and read-back can say whether the draft's seedKey reached the row.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000007";

const RUN = Date.now();

function draftFor(domain: string): OnboardingDraft {
  return {
    location: {
      code: `F4170-SKO-LOC-${RUN}`,
      slug: `f4170-sko-loc-${RUN}`,
      name: "F4.170 Onboarding seed key location",
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
      // A per-run value, never a canonical slug: this row is committed.
      meta: { seedKey: `f4170-api-${RUN}-onboarding`, note: "kept" },
    },
    rtus: [
      {
        code: `F4170-SKO-RTU-${RUN}`,
        displayName: "F4.170 Onboarding RTU",
        protocol: "simulator",
        config: {},
      },
    ],
    pointKeys: [{ code: `F4170_SKO_PK_${RUN}`, name: "F4.170 Onboarding Point Key", unit: "kW" }],
    assets: [
      {
        rtuIndex: 0,
        code: `F4170-SKO-AS-${RUN}`,
        name: "F4.170 Onboarding Asset",
        siteName: "F4.170 Site",
        domain,
      },
    ],
    assetPoints: [{ assetIndex: 0, pointKey: `F4170_SKO_PK_${RUN}`, sourceDataKey: `F4170/SKO/${RUN}` }],
  } as OnboardingDraft;
}

describe.skipIf(!connectionString)("F4.170 ruling 20 — the onboarding commit strips meta.seedKey", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  const ctx: OnboardingSeedKeyCtx = { ownerPool: undefined as unknown as pg.Pool };
  let sessionId = "";

  const jwt: JwtPayload = {
    sub: SYNTHETIC_SUB,
    email: ORGANIZATION_ADMIN_EMAIL,
    name: `integration:${ORGANIZATION_ADMIN_EMAIL}`,
    role: "organization_admin",
  };

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.170");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.170",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.170",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F4.170",
    );

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(`F4.170: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    const organizationId = org.rows[0].id;

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("F4.170: no active asset_domain — run pnpm db:seed.");
    }

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const authDb = createDb(authPool);

    sessionId = await withTenant(tenantDb, organizationId, async (tx) => {
      const [row] = await tx
        .insert(onboardingSessions)
        .values({ organizationId, status: "draft", currentPhase: "review", draft: draftFor(dom.rows[0].code) })
        .returning({ id: onboardingSessions.id });
      return row.id;
    });

    const commitSvc = new OnboardingCommitService(
      fleetDb,
      tenantDb,
      new AccessControlService(authDb, fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
      new OnboardingValidateService(),
      new VocabulariesService(fleetDb),
    );

    ctx.ownerPool = ownerPool;
    ctx.committed = await commitSvc.commit(jwt, sessionId);
  }, 60_000);

  afterAll(async () => {
    const committed = ctx.committed;
    if (ownerPool) {
      if (committed) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1)`, [
          [...committed.assetIds, committed.locationId],
        ]);
        await ownerPool.query(`DELETE FROM bms.asset_points WHERE id = ANY($1)`, [committed.assetPointIds]);
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [committed.assetIds]);
        await ownerPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`, [committed.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [committed.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.point_keys WHERE id = ANY($1)`, [committed.pointKeyIds]);
        await ownerPool.query(`DELETE FROM bms.locations WHERE id = $1`, [committed.locationId]);
      }
      if (sessionId) {
        await ownerPool.query(`DELETE FROM bms.onboarding_sessions WHERE id = $1`, [sessionId]);
      }
    }
    await Promise.all([ownerPool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  }, 60_000);

  it("OK1 the committed location carries no seedKey", async () => {
    await assertCommittedLocationHasNoSeedKey(ctx);
  }, 30_000);
});
