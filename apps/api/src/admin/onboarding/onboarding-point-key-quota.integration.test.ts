import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, onboardingSessions } from "@bms/db";
import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
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
 * (ADR 0014); this file owns the database lifecycle. Each claim seeds its own
 * session; the filler rows that move the organization's count carry the
 * `F4111_FILL_` prefix and are deleted in `afterAll`, with every row a commit
 * added under the `F4111_` prefix. A reused catalog row (`kw`) is never deleted.
 */
const connectionString = requireIntegrationDb({
  item: "F4.111",
  label: "the onboarding commit enforces the point-key growth quota",
  because: "the quota counts stamped catalog rows under an advisory lock; only a real transaction can show both",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const GLOBAL_ADMIN_EMAIL = "admin@bms.local";
const RUN = Date.now();
/** A row of this family older than this is an earlier run's, never a live one's. */
const STALE_AFTER = "30 minutes";

async function sweep(pool: pg.Pool, olderThan: string | null): Promise<void> {
  const age = olderThan === null ? "" : ` AND created_at < now() - '${olderThan}'::interval`;
  const locations = `SELECT id FROM bms.locations WHERE code LIKE 'F4111-LOC-%'${age}`;
  const assets = `SELECT id FROM bms.assets WHERE location_id IN (${locations})`;
  const rtus = `SELECT id FROM bms.rtus WHERE location_id IN (${locations})`;
  const sessions = `SELECT id FROM bms.onboarding_sessions WHERE draft->'location'->>'code' LIKE 'F4111-LOC-%'${age}`;
  await pool.query(
    `DELETE FROM bms.audit_log
      WHERE (entity_type = 'location' AND entity_id IN (${locations}))
         OR (entity_type = 'asset' AND entity_id IN (${assets}))
         OR (entity_type = 'onboarding_session' AND entity_id IN (${sessions}))`,
  );
  await pool.query(`DELETE FROM bms.asset_points WHERE asset_id IN (${assets})`);
  await pool.query(`DELETE FROM bms.assets WHERE id IN (${assets})`);
  await pool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id IN (${rtus})`);
  await pool.query(`DELETE FROM bms.rtus WHERE id IN (${rtus})`);
  // `_` is a LIKE wildcard, so the family escapes it.
  await pool.query(`DELETE FROM bms.point_keys WHERE code LIKE 'F4111\\_%'${age}`);
  await pool.query(`DELETE FROM bms.locations WHERE id IN (${locations})`);
  await pool.query(`DELETE FROM bms.onboarding_sessions WHERE id IN (${sessions})`);
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
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: PointKeyQuotaCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.111");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.111");
    tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F4.111");
    fleetPool = await openIntegrationPool(process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"), "F4.111");
    await primeSeededSubjects(fleetPool);
    const orgAdmin: JwtPayload = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");
    const globalAdmin: JwtPayload = jwtFor(GLOBAL_ADMIN_EMAIL, "admin");

    await sweep(ownerPool, STALE_AFTER);

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(`F4.111: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    const organizationId = org.rows[0].id;
    const dom = await ownerPool.query<{ code: string }>("SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1");
    if (!dom.rows[0]) {
      throw new Error("F4.111: no active asset_domain — run pnpm db:seed.");
    }
    const domain = dom.rows[0].code;
    const kw = await ownerPool.query("SELECT 1 FROM bms.point_keys WHERE code = 'kw' AND active");
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
    );

    ctx = {
      ownerPool,
      commitSvc,
      orgAdmin,
      globalAdmin,
      organizationId,
      run: RUN,
      committed: [],
      seed: (tag, newKeys, extraCodes = []) =>
        withTenant(tenantDb, organizationId, async (tx) => {
          const [row] = await tx
            .insert(onboardingSessions)
            .values({ organizationId, status: "draft", currentPhase: "review", draft: draftFor(tag, domain, newKeys, extraCodes) })
            .returning({ id: onboardingSessions.id });
          return row.id;
        }),
      fillTo: async (count) => {
        const { rows } = await ownerPool.query<{ total: number; filler: number }>(
          `SELECT count(*)::int AS total, count(*) FILTER (WHERE code LIKE 'F4111\\_FILL\\_%')::int AS filler
             FROM bms.point_keys WHERE created_by_organization_id = $1`,
          [organizationId],
        );
        const { total, filler } = rows[0];
        if (total < count) {
          await ownerPool.query(
            `INSERT INTO bms.point_keys (code, name, created_by_organization_id)
             SELECT 'F4111_FILL_' || $2::text || '_' || replace(gen_random_uuid()::text, '-', ''), 'F4.111 filler', $1
               FROM generate_series(1, $3::int) g`,
            [organizationId, String(RUN), count - total],
          );
        } else if (total > count) {
          if (filler < total - count) {
            throw new Error(`F4.111: the organization holds ${total - filler} stamped rows outside this suite, more than ${count}.`);
          }
          await ownerPool.query(
            `DELETE FROM bms.point_keys WHERE id IN (
               SELECT id FROM bms.point_keys
                WHERE created_by_organization_id = $1 AND code LIKE 'F4111\\_FILL\\_%'
                LIMIT $2)`,
            [organizationId, total - count],
          );
        }
      },
    };
  }, 60_000);

  afterAll(async () => {
    if (ownerPool) {
      await sweep(ownerPool, null);
    }
    await Promise.all([ownerPool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
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
