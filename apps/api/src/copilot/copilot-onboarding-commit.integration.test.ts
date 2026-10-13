import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb, onboardingSessions } from "@bms/db";
import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { attachCommitProposal, draftHash } from "../admin/onboarding/onboarding-commit-proposal";
import { OnboardingCommitService } from "../admin/onboarding/onboarding-commit.service";
import { EMPTY_TEMPLATE_CONTEXT } from "../admin/onboarding/onboarding-template-refs";
import { OnboardingValidateService } from "../admin/onboarding/onboarding-validate.service";
import { AccessControlService } from "../auth/access-control.service";
import { withTenant } from "../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects } from "../testing/seeded-subjects";
import { VocabulariesService } from "../vocabularies/vocabularies.service";
import { CopilotOnboardingCommitReader } from "./copilot-onboarding-commit";
import {
  aDraftChangedAfterTheProposalRefusesTheCard,
  anUnchangedDraftCommitsThroughTheCard,
  type CommitCardCtx,
} from "./copilot-onboarding-commit.integration.spec";

/**
 * `F3.86` PR 6 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle, on the `F4.228` suite's
 * harness: two draft sessions, each with a commit proposal stored on its draft
 * the way `OnboardingService.chat` stores one (the agent needs a model, so the
 * proposal is seeded). Every row this run writes carries `RUN` and is removed
 * in `afterAll`; an earlier run's leftovers are swept first.
 */
const connectionString = requireIntegrationDb({
  item: "F3.86 PR 6",
  label: "the onboarding commit card is refused after a draft change",
  because: "the card's hash is read from the stored draft as bms_tenant, and only a real commit shows that no location is written",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const RUN = Date.now();
const STALE_AFTER = "30 minutes";
const CODE = "F386-OC-LOC-";

/** Reaps what an earlier run committed but never cleaned (the `F4.228` sweep, this family's prefix). */
async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  const staleLocations = `SELECT id FROM bms.locations WHERE code LIKE '${CODE}%' AND created_at < now() - $1::interval`;
  const staleAssets = `SELECT id FROM bms.assets WHERE location_id IN (${staleLocations})`;
  const staleRtus = `SELECT id FROM bms.rtus WHERE location_id IN (${staleLocations})`;
  const staleSessions = `SELECT id FROM bms.onboarding_sessions
    WHERE draft->'location'->>'code' LIKE '${CODE}%' AND created_at < now() - $1::interval`;
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
    await pool.query(`DELETE FROM bms.point_keys WHERE code LIKE 'F386\\_OC\\_PK\\_%' AND created_at < now() - $1::interval`, age);
    await pool.query(`DELETE FROM bms.locations WHERE id IN (${staleLocations})`, age);
    await pool.query(`DELETE FROM bms.onboarding_sessions WHERE id IN (${staleSessions})`, age);
  } catch (err) {
    process.stderr.write(`[F3.86] could not sweep stale fixture rows: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

/** One simulator RTU, one point key, one asset, one asset point: a draft that validates. */
function draftFor(tag: string, domain: string): OnboardingDraft {
  return {
    location: {
      code: `${CODE}${tag}-${RUN}`,
      slug: `f386-oc-loc-${tag.toLowerCase()}-${RUN}`,
      name: `F3.86 Commit card location ${tag}`,
      type: "smoc_campus",
      latitude: 0,
      longitude: 0,
    },
    rtus: [{ code: `F386-OC-RTU-${tag}-${RUN}`, displayName: `F3.86 RTU ${tag}`, protocol: "simulator", config: {} }],
    pointKeys: [{ code: `F386_OC_PK_${tag}_${RUN}`, name: `F3.86 Point Key ${tag}`, unit: "kW" }],
    assets: [{ rtuIndex: 0, code: `F386-OC-AS-${tag}-${RUN}`, name: `F3.86 Asset ${tag}`, siteName: "F3.86 Site", domain }],
    assetPoints: [{ assetIndex: 0, pointKey: `F386_OC_PK_${tag}_${RUN}`, sourceDataKey: `F386/OC/${tag}/${RUN}` }],
  } as OnboardingDraft;
}

describe.skipIf(!connectionString)("F3.86 PR 6 — the onboarding commit card is refused after a draft change", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  const sessionIds: string[] = [];
  const committed: CommitCardCtx["committed"] = {};
  let ctx: CommitCardCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F3.86");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F3.86");
    tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F3.86");
    fleetPool = await openIntegrationPool(process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"), "F3.86");
    await primeSeededSubjects(fleetPool);
    const jwt: JwtPayload = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");
    await sweepStaleRuns(ownerPool);

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id WHERE u.email = $1 LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) throw new Error(`F3.86: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    const organizationId = org.rows[0].id;
    const dom = await ownerPool.query<{ code: string }>("SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1");
    if (!dom.rows[0]) throw new Error("F3.86: no active asset_domain — run pnpm db:seed.");
    const domain = dom.rows[0].code;

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const authDb = createDb(authPool);

    // The proposal as `OnboardingService.chat` attaches it: bound to the hash of the draft it is stored with.
    const seedProposed = async (tag: string): Promise<string> => {
      const draft = draftFor(tag, domain);
      const hash = draftHash(draft);
      if (hash === null) throw new Error("F3.86: the fixture draft does not hash");
      const stored = attachCommitProposal(draft, { draftHash: hash, summary: "fixture", proposedAt: new Date().toISOString() });
      const id = await withTenant(tenantDb, organizationId, async (tx) => {
        const [row] = await tx
          .insert(onboardingSessions)
          .values({ organizationId, status: "draft", currentPhase: "review", draft: stored })
          .returning({ id: onboardingSessions.id });
        return row!.id;
      });
      sessionIds.push(id);
      return id;
    };
    const changedSessionId = await seedProposed("A");
    const keptSessionId = await seedProposed("B");

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
    const codes = new Map([
      [changedSessionId, `${CODE}A-${RUN}`],
      [keptSessionId, `${CODE}B-${RUN}`],
    ]);
    ctx = {
      ownerPool,
      reader: new CopilotOnboardingCommitReader(tenantDb),
      commitSvc,
      jwt,
      organizationId,
      changedSessionId,
      keptSessionId,
      locationCodeOf: (id) => codes.get(id) ?? "",
      committed,
    };
  }, 60_000);

  afterAll(async () => {
    if (ownerPool) {
      for (const c of [committed.kept, committed.changed]) {
        if (!c) continue;
        await ownerPool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1)", [[...c.assetIds, c.locationId]]);
        await ownerPool.query("DELETE FROM bms.asset_points WHERE id = ANY($1)", [c.assetPointIds]);
        await ownerPool.query("DELETE FROM bms.assets WHERE id = ANY($1)", [c.assetIds]);
        await ownerPool.query("DELETE FROM bms.rtu_connection_configs WHERE rtu_id = ANY($1)", [c.rtuIds]);
        await ownerPool.query("DELETE FROM bms.rtus WHERE id = ANY($1)", [c.rtuIds]);
        await ownerPool.query("DELETE FROM bms.point_keys WHERE id = ANY($1)", [c.pointKeyIds]);
        await ownerPool.query("DELETE FROM bms.locations WHERE id = $1", [c.locationId]);
      }
      if (sessionIds.length > 0) {
        await ownerPool.query("DELETE FROM bms.audit_log WHERE entity_type = 'onboarding_session' AND entity_id = ANY($1)", [sessionIds]);
        await ownerPool.query("DELETE FROM bms.onboarding_sessions WHERE id = ANY($1)", [sessionIds]);
      }
    }
    await Promise.all([ownerPool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  }, 60_000);

  it("C1 refuses the card's commit after a draft change, and writes no location", async () => {
    await aDraftChangedAfterTheProposalRefusesTheCard(ctx);
  }, 30_000);

  it("C2 commits the unchanged draft through the card (positive control)", async () => {
    await anUnchangedDraftCommitsThroughTheCard(ctx);
  }, 30_000);
});
