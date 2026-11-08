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
  assertAMetaTimezoneIsCommitted,
  assertNoTimezoneCommitsNull,
  assertTheTimezoneFieldIsCommitted,
  type TimezoneUnitCtx,
} from "./onboarding-commit.timezone-unit.integration.spec";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";

/**
 * `F4.339` (ADR 0117 decisions 10 and 11) — Vitest entry point. Assertions
 * live in the sibling `.spec` (ADR 0014); this file owns the database
 * lifecycle. The harness and the cleanup are
 * `onboarding-commit.seed-key.integration.test.ts`'s, for three simulator
 * drafts committed one after another.
 */
const connectionString = requireIntegrationDb({
  item: "F4.339",
  label: "OnboardingCommitService writes the draft timezone and the catalog unit",
  because:
    "the location and asset-point inserts run inside the commit's withTenant transaction, so only a " +
    "real commit and read-back can say what reached the rows.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";

const RUN = Date.now();
/** A row of this family older than this is an earlier run's, never a live one's. */
const STALE_AFTER = "30 minutes";

/**
 * Reaps what an earlier run committed but never cleaned (the F4.16 shape, as
 * `locations.seed-key.integration.test.ts` does): rows of this suite's family
 * older than 30 minutes, which no live run can own. The anchors are the
 * location, the session and the point key, each bounded by `created_at`; the
 * RTU and the asset are reached through their location, never by a code
 * pattern. Children first; the audit rows before the rows they name.
 */
async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  const staleLocations = `SELECT id FROM bms.locations
    WHERE code LIKE 'F4339-TZU-LOC-%' AND created_at < now() - $1::interval`;
  const staleAssets = `SELECT id FROM bms.assets WHERE location_id IN (${staleLocations})`;
  const staleRtus = `SELECT id FROM bms.rtus WHERE location_id IN (${staleLocations})`;
  const staleSessions = `SELECT id FROM bms.onboarding_sessions
    WHERE draft->'location'->>'code' LIKE 'F4339-TZU-LOC-%' AND created_at < now() - $1::interval`;
  const age = [STALE_AFTER];
  try {
    await pool.query(
      `DELETE FROM bms.audit_log
        WHERE (entity_type = 'location' AND entity_id IN (${staleLocations}))
           OR (entity_type = 'asset' AND entity_id IN (${staleAssets}))
           OR (entity_type = 'onboarding_session' AND entity_id IN (${staleSessions}))`,
      age,
    );
    await pool.query(`DELETE FROM bms.asset_points WHERE asset_id IN (${staleAssets})`, age);
    await pool.query(`DELETE FROM bms.assets WHERE id IN (${staleAssets})`, age);
    await pool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id IN (${staleRtus})`, age);
    await pool.query(`DELETE FROM bms.rtus WHERE id IN (${staleRtus})`, age);
    // `_` is a LIKE wildcard, so the point key family escapes it.
    await pool.query(
      `DELETE FROM bms.point_keys WHERE code LIKE 'F4339\_TZU\_PK\_%' AND created_at < now() - $1::interval`,
      age,
    );
    await pool.query(`DELETE FROM bms.locations WHERE id IN (${staleLocations})`, age);
    await pool.query(`DELETE FROM bms.onboarding_sessions WHERE id IN (${staleSessions})`, age);
  } catch (err) {
    process.stderr.write(
      `[F4.339] could not sweep stale fixture rows: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

type Variant = "field" | "meta" | "none";

function draftFor(domain: string, variant: Variant): OnboardingDraft {
  const tag = `${RUN}-${variant}`;
  return {
    location: {
      code: `F4339-TZU-LOC-${tag}`.toUpperCase(),
      slug: `f4339-tzu-loc-${tag}`,
      name: `F4.339 Onboarding timezone location ${variant}`,
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
      ...(variant === "field" ? { timezone: "Asia/Kolkata" } : {}),
      ...(variant === "meta" ? { meta: { timezone: "Asia/Kolkata" } } : {}),
    },
    rtus: [
      {
        code: `F4339-TZU-RTU-${tag}`.toUpperCase(),
        displayName: "F4.339 Onboarding RTU",
        protocol: "simulator",
        config: {},
      },
    ],
    pointKeys: [{ code: `F4339_TZU_PK_${RUN}_${variant}`.toUpperCase(), name: "F4.339 Onboarding Point Key", unit: "kW" }],
    assets: [
      {
        rtuIndex: 0,
        code: `F4339-TZU-AS-${tag}`.toUpperCase(),
        name: "F4.339 Onboarding Asset",
        siteName: "F4.339 Site",
        domain,
      },
    ],
    assetPoints: [{ assetIndex: 0, pointKey: `F4339_TZU_PK_${RUN}_${variant}`.toUpperCase(), sourceDataKey: `F4339/TZU/${tag}` }],
  } as OnboardingDraft;
}

describe.skipIf(!connectionString)("F4.339 — the onboarding commit writes the timezone and the catalog unit", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  const ctx: TimezoneUnitCtx = { ownerPool: undefined as unknown as pg.Pool };
  const sessionIds: string[] = [];

  let jwt: JwtPayload;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.339");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.339",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.339",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F4.339",
    );
    // F3.78: jwtFor carries the real bms.users.id as sub (ADR 0089 decision 4).
    await primeSeededSubjects(fleetPool);
    jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

    await sweepStaleRuns(ownerPool);

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(`F4.339: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    const organizationId = org.rows[0].id;

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("F4.339: no active asset_domain — run pnpm db:seed.");
    }

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const authDb = createDb(authPool);

    const commitSvc = new OnboardingCommitService(
      fleetDb,
      tenantDb,
      new AccessControlService(authDb, fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
      new OnboardingValidateService(),
      new VocabulariesService(fleetDb),
      { context: async () => EMPTY_TEMPLATE_CONTEXT, pointKeyQuota: async () => "exempt" } as never,
      // F3.22: the three template services; these drafts hold no template, so none is called.
      {} as never,
      {} as never,
      {} as never,
      // F4.243: the parent candidates validate reads.
      { listParentCandidates: async () => [] } as never,
    );

    ctx.ownerPool = ownerPool;
    for (const variant of ["field", "meta", "none"] as const) {
      const sessionId = await withTenant(tenantDb, organizationId, async (tx) => {
        const [row] = await tx
          .insert(onboardingSessions)
          .values({ organizationId, status: "draft", currentPhase: "review", draft: draftFor(dom.rows[0]!.code, variant) })
          .returning({ id: onboardingSessions.id });
        return row.id;
      });
      sessionIds.push(sessionId);
      ctx[variant] = await commitSvc.commit(jwt, sessionId);
    }
  }, 60_000);

  afterAll(async () => {
    if (ownerPool) {
      for (const committed of [ctx.field, ctx.meta, ctx.none]) {
        if (!committed) continue;
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1)`, [[...committed.assetIds, committed.locationId]]);
        await ownerPool.query(`DELETE FROM bms.asset_points WHERE id = ANY($1)`, [committed.assetPointIds]);
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [committed.assetIds]);
        await ownerPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`, [committed.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [committed.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.point_keys WHERE id = ANY($1)`, [committed.pointKeyIds]);
        await ownerPool.query(`DELETE FROM bms.locations WHERE id = $1`, [committed.locationId]);
      }
      if (sessionIds.length > 0) {
        // The commit audits the session as well as the location and assets.
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_type = 'onboarding_session' AND entity_id = ANY($1)`, [sessionIds]);
        await ownerPool.query(`DELETE FROM bms.onboarding_sessions WHERE id = ANY($1)`, [sessionIds]);
      }
    }
    await Promise.all([ownerPool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  }, 60_000);

  it("TZ1 commits location.timezone", async () => {
    await assertTheTimezoneFieldIsCommitted(ctx);
  }, 30_000);

  it("TZ2 commits a valid meta.timezone of an older draft", async () => {
    await assertAMetaTimezoneIsCommitted(ctx);
  }, 30_000);

  it("TZ3 commits NULL with neither", async () => {
    await assertNoTimezoneCommitsNull(ctx);
  }, 30_000);
});
