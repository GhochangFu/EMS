import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, onboardingSessions } from "@bms/db";
import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../../testing/integration-db-gate";
import { buildInactiveFixture, dropInactiveFixture } from "../../testing/location-inactive-fixture";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { OnboardingCommitService } from "./onboarding-commit.service";
import {
  assertAGlobalAdminIsExemptAndStillStamps,
  assertAnOrganizationAtTheLimitIsRefusedOneMore,
  assertExistingCodesCommitAtTheLimit,
  assertTwoConcurrentCommitsCannotBothPassTheLimit,
  assertTwoHundredNewKeysCommitStamped,
  assertTwoHundredOneNewKeysAreRefusedAndWriteNothing,
  type PointKeyQuotaCtx,
} from "./onboarding-point-key-quota.integration.spec";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F4.111` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 *
 * **The suite runs in its own organization**, built for the run with its own
 * organization admin (`buildInactiveFixture`). The quota counts per
 * organization, and the claims move this one's count to 999 and 1,000; in the
 * seeded PHE organization that would refuse the new keys other suites commit
 * as `phe-admin@bms.local` while the two run side by side (review finding).
 * Everything the run wrote is deleted by organization id in `afterAll`, and an
 * earlier run's organization in `beforeAll`. A reused catalog row (`kw`) is
 * never deleted.
 */
const connectionString = requireIntegrationDb({
  item: "F4.111",
  label: "the onboarding commit enforces the point-key growth quota",
  because: "the quota counts stamped catalog rows under an advisory lock; only a real transaction can show both",
});

const PREFIX = "F4111";
const GLOBAL_ADMIN_EMAIL = "admin@bms.local";
const RUN = String(Date.now());

/** Deletes what one fixture organization holds beyond `dropInactiveFixture`'s reach, then the fixture. */
async function dropRun(pool: pg.Pool, run: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM bms.organizations WHERE code = $1", [`F210E-${PREFIX}-${run}`]);
  for (const { id } of rows) {
    await pool.query("DELETE FROM bms.audit_log WHERE organization_id = $1", [id]);
    await pool.query("DELETE FROM bms.asset_points WHERE asset_id IN (SELECT id FROM bms.assets WHERE organization_id = $1)", [id]);
    await pool.query("DELETE FROM bms.rtu_connection_configs WHERE rtu_id IN (SELECT id FROM bms.rtus WHERE organization_id = $1)", [id]);
    await pool.query("DELETE FROM bms.onboarding_sessions WHERE organization_id = $1", [id]);
    await pool.query("DELETE FROM bms.assets WHERE organization_id = $1", [id]);
    await pool.query("DELETE FROM bms.point_keys WHERE created_by_organization_id = $1", [id]);
  }
  await dropInactiveFixture(pool, PREFIX, run);
}

function draftFor(tag: string, domain: string, newKeys: number, extraCodes: readonly string[]): OnboardingDraft {
  const fresh = Array.from({ length: newKeys }, (_, i) => ({ code: `F4111_${tag}_${i}_${RUN}`, name: `F4.111 ${tag} ${i}` }));
  const reused = extraCodes.map((code) => ({ code, name: code }));
  const mapped = (fresh[0] ?? reused[0]).code;
  return {
    location: {
      code: `F4111-LOC-${tag}-${RUN}`,
      slug: `f4111-loc-${tag.toLowerCase()}-${RUN}`,
      name: `F4.111 Quota location ${tag}`,
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
    },
    rtus: [{ code: `F4111-RTU-${tag}-${RUN}`, displayName: `F4.111 RTU ${tag}`, protocol: "simulator", config: {} }],
    pointKeys: [...fresh, ...reused],
    assets: [{ rtuIndex: 0, code: `F4111-AS-${tag}-${RUN}`, name: `F4.111 Asset ${tag}`, siteName: "F4.111 Site", domain }],
    assetPoints: [{ assetIndex: 0, pointKey: mapped, sourceDataKey: `F4111/${tag}/${RUN}` }],
  } as OnboardingDraft;
}

describe.skipIf(!connectionString)("F4.111 — the onboarding commit enforces the point-key growth quota", () => {
  let superPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: PointKeyQuotaCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    superPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.111");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.111");
    tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F4.111");
    fleetPool = await openIntegrationPool(process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"), "F4.111");
    await primeSeededSubjects(fleetPool);
    const globalAdmin: JwtPayload = jwtFor(GLOBAL_ADMIN_EMAIL, "admin");

    // An earlier run killed before its afterAll left its organization behind.
    const { rows: stale } = await superPool.query<{ code: string }>("SELECT code FROM bms.organizations WHERE code LIKE $1", [
      `F210E-${PREFIX}-%`,
    ]);
    for (const { code } of stale) {
      await dropRun(superPool, code.slice(`F210E-${PREFIX}-`.length));
    }

    const fx = await buildInactiveFixture(superPool, PREFIX, RUN);
    const organizationId = fx.organizationId;
    const kw = await superPool.query("SELECT 1 FROM bms.point_keys WHERE code = 'kw' AND active");
    if (kw.rowCount !== 1) {
      throw new Error("F4.111: the seeded catalog holds no active `kw` — run pnpm db:seed.");
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
      { context: async () => EMPTY_TEMPLATE_CONTEXT } as never,
      // F3.22: the three template services; these drafts hold no template, so none is called.
      {} as never,
      {} as never,
      {} as never,
      // F4.243: the parent candidates validate reads.
      { listParentCandidates: async () => [] } as never,
    );

    ctx = {
      ownerPool: superPool,
      commitSvc,
      orgAdmin: fx.orgAdmin,
      globalAdmin,
      organizationId,
      run: Number(RUN),
      committed: [],
      seed: (tag, newKeys, extraCodes = []) =>
        withTenant(tenantDb, organizationId, async (tx) => {
          const [row] = await tx
            .insert(onboardingSessions)
            .values({ organizationId, status: "draft", currentPhase: "review", draft: draftFor(tag, fx.domain, newKeys, extraCodes) })
            .returning({ id: onboardingSessions.id });
          return row.id;
        }),
      fillTo: async (count) => {
        const { rows } = await superPool.query<{ total: number; filler: number }>(
          `SELECT count(*)::int AS total, count(*) FILTER (WHERE code LIKE 'F4111\\_FILL\\_%')::int AS filler
             FROM bms.point_keys WHERE created_by_organization_id = $1`,
          [organizationId],
        );
        const { total, filler } = rows[0];
        if (total < count) {
          await superPool.query(
            `INSERT INTO bms.point_keys (code, name, created_by_organization_id)
             SELECT 'F4111_FILL_' || $2::text || '_' || replace(gen_random_uuid()::text, '-', ''), 'F4.111 filler', $1
               FROM generate_series(1, $3::int) g`,
            [organizationId, RUN, count - total],
          );
        } else if (total > count) {
          if (filler < total - count) {
            throw new Error(`F4.111: the run's organization holds ${total - filler} committed rows, more than ${count}.`);
          }
          await superPool.query(
            `DELETE FROM bms.point_keys WHERE id IN (
               SELECT id FROM bms.point_keys
                WHERE created_by_organization_id = $1 AND code LIKE 'F4111\\_FILL\\_%'
                ORDER BY created_at, id
                LIMIT $2)`,
            [organizationId, total - count],
          );
        }
      },
    };
  }, 60_000);

  afterAll(async () => {
    if (superPool) {
      await dropRun(superPool, RUN);
    }
    await Promise.all([superPool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  }, 120_000);

  it("Q-I1 refuses 201 new keys and writes nothing", async () => {
    await assertTwoHundredOneNewKeysAreRefusedAndWriteNothing(ctx);
  }, 60_000);

  it("Q-I2 commits 200 new keys, stamped, and audits the count", async () => {
    await assertTwoHundredNewKeysCommitStamped(ctx);
  }, 60_000);

  it("Q-I3 refuses one more new key at 1,000", async () => {
    await assertAnOrganizationAtTheLimitIsRefusedOneMore(ctx);
  }, 60_000);

  it("Q-I4 commits existing codes at 1,000", async () => {
    await assertExistingCodesCommitAtTheLimit(ctx);
  }, 60_000);

  it("Q-I5 exempts a global admin and still stamps its rows", async () => {
    await assertAGlobalAdminIsExemptAndStillStamps(ctx);
  }, 60_000);

  it("Q-I6 lets only one of two concurrent commits pass the limit", async () => {
    await assertTwoConcurrentCommitsCannotBothPassTheLimit(ctx);
  }, 60_000);
});
