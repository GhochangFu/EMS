import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, onboardingSessions } from "@bms/db";
import type { JwtPayload, OnboardingCommitResponseDto, OnboardingDraft } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { withTenant } from "../../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { OnboardingCommitService } from "./onboarding-commit.service";
import { OnboardingValidateService } from "./onboarding-validate.service";
import {
  assertAnotherOrganizationsHolderKeepsTheFixedText,
  assertAReleasedTopicCommits,
  assertASameOrganizationHolderIsNamed,
  type TopicHolderCtx,
} from "./onboarding-commit.topic-holder.integration.spec";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";

/**
 * `F4.339` (ADR 0117 decision 8, plan R8) — Vitest entry point. Assertions live
 * in the sibling `.spec` (ADR 0014); this file owns the database lifecycle, in
 * the shape of `onboarding-commit.timezone-unit.integration.test.ts`, for three
 * ingest-off MQTT drafts and two fixture holder RTUs.
 */
const connectionString = requireIntegrationDb({
  item: "F4.339",
  label: "OnboardingCommitService naming a same-organization RTU that holds a draft topic",
  because:
    "the pre-check reads bms.rtus inside the commit's tenant transaction, where RLS shows only the " +
    "caller's organization; only a real database shows the holder named, a released topic committing, " +
    "and another organization's holder left to the index.",
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
    WHERE code LIKE 'F4339-TH-LOC-%' AND created_at < now() - $1::interval`;
  const staleAssets = `SELECT id FROM bms.assets WHERE location_id IN (${staleLocations})`;
  const staleRtus = `SELECT id FROM bms.rtus WHERE location_id IN (${staleLocations})`;
  const staleSessions = `SELECT id FROM bms.onboarding_sessions
    WHERE draft->'location'->>'code' LIKE 'F4339-TH-LOC-%' AND created_at < now() - $1::interval`;
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
      `DELETE FROM bms.point_keys WHERE code LIKE 'F4339\_TH\_PK\_%' AND created_at < now() - $1::interval`,
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

type Variant = "same" | "released" | "other";

function draftFor(domain: string, variant: Variant, topic: string): OnboardingDraft {
  const tag = `${RUN}-${variant}`;
  return {
    location: {
      code: `F4339-TH-LOC-${tag}`.toUpperCase(),
      slug: `f4339-th-loc-${tag}`,
      name: `F4.339 Onboarding topic holder ${variant}`,
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
    },
    rtus: [
      {
        code: `F4339-TH-RTU-${tag}`.toUpperCase(),
        displayName: "F4.339 Onboarding RTU",
        protocol: "mqtt",
        config: { host: "broker.f4339.example", port: 8883, topic },
        credentialsSet: false,
        ingestEnabled: false,
      },
    ],
    pointKeys: [{ code: `F4339_TH_PK_${RUN}_${variant}`.toUpperCase(), name: "F4.339 Onboarding Point Key", unit: "kW" }],
    assets: [
      { rtuIndex: 0, code: `F4339-TH-AS-${tag}`.toUpperCase(), name: "F4.339 Onboarding Asset", siteName: "F4.339 Site", domain },
    ],
    assetPoints: [{ assetIndex: 0, pointKey: `F4339_TH_PK_${RUN}_${variant}`.toUpperCase(), sourceDataKey: `F4339/TH/${tag}` }],
  } as OnboardingDraft;
}

describe.skipIf(!connectionString)("F4.339 — the onboarding commit names a same-organization topic holder", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  const ctx: TopicHolderCtx = { holderCode: `F4339-TH-HOLD-${RUN}`, draftCode: `F4339-TH-RTU-${RUN}-SAME`, otherHolderCode: `F4339-TH-OTHER-${RUN}` };
  const sessionIds: string[] = [];
  const holderIds: string[] = [];
  const committed: OnboardingCommitResponseDto[] = [];

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

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const authDb = createDb(authPool);
    const dom = await ownerPool.query<{ code: string }>("SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1");
    const ownLocation = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1",
      [organizationId],
    );
    const other = await ownerPool.query<{ id: string; organization_id: string }>(
      "SELECT id, organization_id FROM bms.locations WHERE organization_id <> $1 ORDER BY created_at, code LIMIT 1",
      [organizationId],
    );
    if (!dom.rows[0] || !ownLocation.rows[0] || !other.rows[0]) {
      throw new Error("F4.339: the seed needs an asset domain and locations in two organizations — run pnpm db:seed.");
    }
    const sameTopic = `f4339/th/${RUN}/same`;
    const otherTopic = `f4339/th/${RUN}/other`;
    const insertHolder = async (orgId: string, locationId: string, code: string, topic: string): Promise<string> => {
      const { rows } = await ownerPool.query<{ id: string }>(
        "INSERT INTO bms.rtus (organization_id, location_id, code, display_name, mqtt_topic) VALUES ($1, $2, $3, $3, $4) RETURNING id",
        [orgId, locationId, code, topic],
      );
      holderIds.push(rows[0]!.id);
      return rows[0]!.id;
    };
    const sameHolder = await insertHolder(organizationId, ownLocation.rows[0].id, ctx.holderCode, sameTopic);
    await insertHolder(other.rows[0].organization_id, other.rows[0].id, ctx.otherHolderCode, otherTopic);

    const commitSvc = new OnboardingCommitService(
      fleetDb,
      tenantDb,
      new AccessControlService(authDb, fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
      new OnboardingValidateService(),
      new VocabulariesService(fleetDb),
      { context: async () => EMPTY_TEMPLATE_CONTEXT, pointKeyQuota: async () => "exempt" } as never,
      {} as never,
      {} as never,
      {} as never,
      { listParentCandidates: async () => [] } as never,
    );
    const attempt = async (variant: Variant, topic: string): Promise<unknown> => {
      const sessionId = await withTenant(tenantDb, organizationId, async (tx) => {
        const [row] = await tx
          .insert(onboardingSessions)
          .values({ organizationId, status: "draft", currentPhase: "review", draft: draftFor(dom.rows[0]!.code, variant, topic) })
          .returning({ id: onboardingSessions.id });
        return row.id;
      });
      sessionIds.push(sessionId);
      try {
        const result = await commitSvc.commit(jwt, sessionId);
        committed.push(result);
        return result;
      } catch (err) {
        return err;
      }
    };
    ctx.sameOrg = await attempt("same", sameTopic);
    // Release the holder's topic as RtusAdminService.deactivate does.
    await ownerPool.query("UPDATE bms.rtus SET active = false, released_mqtt_topic = mqtt_topic, mqtt_topic = NULL WHERE id = $1", [sameHolder]);
    ctx.released = await attempt("released", sameTopic);
    ctx.otherOrg = await attempt("other", otherTopic);
  }, 60_000);

  afterAll(async () => {
    if (ownerPool) {
      for (const result of committed) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1)`, [[...result.assetIds, result.locationId]]);
        await ownerPool.query(`DELETE FROM bms.asset_points WHERE id = ANY($1)`, [result.assetPointIds]);
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = ANY($1)`, [result.assetIds]);
        await ownerPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)`, [result.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [result.rtuIds]);
        await ownerPool.query(`DELETE FROM bms.point_keys WHERE id = ANY($1)`, [result.pointKeyIds]);
        await ownerPool.query(`DELETE FROM bms.locations WHERE id = $1`, [result.locationId]);
      }
      if (holderIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.rtus WHERE id = ANY($1)`, [holderIds]);
      }
      if (sessionIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_type = 'onboarding_session' AND entity_id = ANY($1)`, [sessionIds]);
        await ownerPool.query(`DELETE FROM bms.onboarding_sessions WHERE id = ANY($1)`, [sessionIds]);
      }
    }
    await Promise.all([ownerPool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  }, 60_000);

  it("TH1 names a same-organization holder of a draft topic", () => {
    assertASameOrganizationHolderIsNamed(ctx);
  }, 30_000);

  it("TH2 commits a topic its holder released", () => {
    assertAReleasedTopicCommits(ctx);
  }, 30_000);

  it("TH3 leaves another organization's holder to the index's fixed text", () => {
    assertAnotherOrganizationsHolderKeepsTheFixedText(ctx);
  }, 30_000);
});
