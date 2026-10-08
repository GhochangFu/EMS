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
  assertAnEmptyTopicBesideALegacyKeyIsNull,
  assertASecondOnboardedRtuWithAnEmptyTopicSaves,
  assertBothOnboardedEmptyTopicsAreNull,
  type OnboardingEmptyTopicCtx,
} from "./onboarding-commit.empty-topic.integration.spec";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F4.228` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. The harness and the
 * cleanup are the seed-key suite's, looped over three sessions. Only the first
 * commit runs in `beforeAll`; the second and third run inside their own cells
 * so a mutation reddens the named assertion and not the hook. A refused commit
 * rolls back and leaves nothing.
 */
const connectionString = requireIntegrationDb({
  item: "F4.228",
  label: "the onboarding commit stores an empty RTU topic as NULL",
  because:
    "rtus_mqtt_topic_idx is a partial unique index; only a real second insert can show " +
    "whether Postgres raises 23505 on the stored value",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";

const RUN = Date.now();
/** A row of this family older than this is an earlier run's, never a live one's. */
const STALE_AFTER = "30 minutes";

/** Reaps what an earlier run committed but never cleaned; see the seed-key suite. */
async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  const staleLocations = `SELECT id FROM bms.locations
    WHERE code LIKE 'F4228-ET-LOC-%' AND created_at < now() - $1::interval`;
  const staleAssets = `SELECT id FROM bms.assets WHERE location_id IN (${staleLocations})`;
  const staleRtus = `SELECT id FROM bms.rtus WHERE location_id IN (${staleLocations})`;
  const staleSessions = `SELECT id FROM bms.onboarding_sessions
    WHERE draft->'location'->>'code' LIKE 'F4228-ET-LOC-%' AND created_at < now() - $1::interval`;
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
      `DELETE FROM bms.point_keys WHERE code LIKE 'F4228\\_ET\\_PK\\_%' AND created_at < now() - $1::interval`,
      age,
    );
    await pool.query(`DELETE FROM bms.locations WHERE id IN (${staleLocations})`, age);
    await pool.query(`DELETE FROM bms.onboarding_sessions WHERE id IN (${staleSessions})`, age);
  } catch (err) {
    process.stderr.write(
      `[F4.228] could not sweep stale fixture rows: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

/** One simulator RTU, one point key, one asset, one asset point. */
function draftFor(tag: string, domain: string, config: Record<string, unknown>): OnboardingDraft {
  return {
    location: {
      code: `F4228-ET-LOC-${tag}-${RUN}`,
      slug: `f4228-et-loc-${tag.toLowerCase()}-${RUN}`,
      name: `F4.228 Empty topic location ${tag}`,
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
    },
    rtus: [
      {
        code: `F4228-ET-RTU-${tag}-${RUN}`,
        displayName: `F4.228 Empty topic RTU ${tag}`,
        protocol: "simulator",
        config,
      },
    ],
    pointKeys: [{ code: `F4228_ET_PK_${tag}_${RUN}`, name: `F4.228 Point Key ${tag}`, unit: "kW" }],
    assets: [
      {
        rtuIndex: 0,
        code: `F4228-ET-AS-${tag}-${RUN}`,
        name: `F4.228 Asset ${tag}`,
        siteName: "F4.228 Site",
        domain,
      },
    ],
    assetPoints: [
      { assetIndex: 0, pointKey: `F4228_ET_PK_${tag}_${RUN}`, sourceDataKey: `F4228/ET/${tag}/${RUN}` },
    ],
  } as OnboardingDraft;
}

describe.skipIf(!connectionString)("F4.228 — the onboarding commit stores an empty RTU topic as NULL", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let firstSessionId = "";
  let secondSessionId = "";
  let thirdSessionId = "";
  let jwt: JwtPayload;
  const committed: OnboardingEmptyTopicCtx["committed"] = {};
  let ctx: OnboardingEmptyTopicCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.228");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.228",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.228",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F4.228",
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
      throw new Error(`F4.228: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    const organizationId = org.rows[0].id;

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("F4.228: no active asset_domain — run pnpm db:seed.");
    }
    const domain = dom.rows[0].code;

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const authDb = createDb(authPool);

    const seedSession = async (draft: OnboardingDraft): Promise<string> =>
      withTenant(tenantDb, organizationId, async (tx) => {
        const [row] = await tx
          .insert(onboardingSessions)
          .values({ organizationId, status: "draft", currentPhase: "review", draft })
          .returning({ id: onboardingSessions.id });
        return row.id;
      });

    firstSessionId = await seedSession(draftFor("A", domain, { topic: "" }));
    secondSessionId = await seedSession(draftFor("B", domain, { topic: "" }));
    thirdSessionId = await seedSession(
      draftFor("C", domain, { topic: "", mqttTopic: `F4228-legacy-${RUN}` }),
    );

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

    ctx = { ownerPool, commitSvc, jwt, secondSessionId, thirdSessionId, committed };
    committed.first = await commitSvc.commit(jwt, firstSessionId);
  }, 60_000);

  afterAll(async () => {
    if (ownerPool) {
      for (const c of [committed.first, committed.second, committed.third]) {
        if (!c) continue;
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1)`, [
          [...c.assetIds, c.locationId],
        ]);
        await ownerPool.query(`DELETE FROM bms.asset_points WHERE id = ANY($1)`, [c.assetPointIds]);
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [c.assetIds]);
        await ownerPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`, [c.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [c.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.point_keys WHERE id = ANY($1)`, [c.pointKeyIds]);
        await ownerPool.query(`DELETE FROM bms.locations WHERE id = $1`, [c.locationId]);
      }
      const sessionIds = [firstSessionId, secondSessionId, thirdSessionId].filter(Boolean);
      if (sessionIds.length > 0) {
        // The commit audits the session as well as the location and assets.
        await ownerPool.query(
          `DELETE FROM bms.audit_log WHERE entity_type = 'onboarding_session' AND entity_id = ANY($1)`,
          [sessionIds],
        );
        await ownerPool.query(`DELETE FROM bms.onboarding_sessions WHERE id = ANY($1)`, [sessionIds]);
      }
    }
    await Promise.all([ownerPool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  }, 60_000);

  it("E1 a second onboarded RTU with an empty topic saves", async () => {
    await assertASecondOnboardedRtuWithAnEmptyTopicSaves(ctx);
  }, 30_000);

  it("E2 both onboarded empty topics are stored as NULL", async () => {
    await assertBothOnboardedEmptyTopicsAreNull(ctx);
  }, 30_000);

  it("E3 an empty topic beside a legacy mqttTopic is stored as NULL", async () => {
    await assertAnEmptyTopicBesideALegacyKeyIsNull(ctx);
  }, 30_000);
});
