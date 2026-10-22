import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { OnboardingDraft } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { buildFixture, dropFixture } from "../locations/locations.tree.integration.spec";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertANullParentCommitsARoot,
  assertAnInactiveParentIsRefused,
  assertAnotherOrganizationsParentIsNotFound,
  assertAnUnknownParentIsNotFound,
  assertAParentAtTheCapIsRefused,
  assertARefusedPlacementWritesNothing,
  assertARootsCreateAuditSaysNull,
  assertTheCommitPlacesTheNodeUnderTheParent,
  assertTheCreateAuditCarriesTheParentId,
  type ParentCommitCtx,
} from "./onboarding-commit.parent.integration.spec";
import { OnboardingCommitService } from "./onboarding-commit.service";
import { EMPTY_TEMPLATE_CONTEXT } from "./onboarding-template-refs";
import { OnboardingValidateService } from "./onboarding-validate.service";

/**
 * `F4.243` (ADR 0098 Amendment 2) — Vitest entry point. Assertions live in the
 * sibling `.spec` (§4.6). This file owns the pools and the two per-run
 * organizations, built and dropped by `locations.tree.integration.spec.ts`'s
 * own `buildFixture` / `dropFixture` (never a seeded organization: the tree
 * guard takes an advisory lock per organization). The commit runs on the real
 * `bms_auth`, `bms_tenant` and `bms_fleet` roles; the superuser pool writes the
 * fixture and reads the rows back.
 */
const connectionString = requireIntegrationDb({
  item: "F4.243",
  label: "OnboardingCommitService places the new location under its parent",
  because:
    "the parent lookup, the placement guards and the location_tree_guard trigger run inside the " +
    "commit's withTenant transaction, so only a real commit can show parent_id, the audit payload " +
    "and each refusal.",
  connection: "owner",
});

describe.skipIf(!connectionString)("F4.243 — the onboarding commit places the node in the tree", () => {
  const run = randomUUID().slice(0, 8);
  const pools: pg.Pool[] = [];
  let superPool: pg.Pool | undefined;
  let ctx: ParentCommitCtx | undefined;

  const use = (): ParentCommitCtx => {
    if (!ctx) throw new Error("F4.243: the fixture was not built");
    return ctx;
  };

  beforeAll(async () => {
    const url = connectionString as string;
    superPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.243");
    pools.push(superPool);
    const authPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "auth", process.env), "F4.243");
    pools.push(authPool);
    const tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.243",
    );
    pools.push(tenantPool);
    const fleetPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F4.243");
    pools.push(fleetPool);

    const fleetDb = createDb(fleetPool);
    const tenantDb = createDb(tenantPool);
    const fx = await buildFixture(superPool, run);
    const domain = await superPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1",
    );
    const assetDomain = domain.rows[0]?.code ?? "electrical";
    const pool = superPool;

    ctx = {
      superPool: pool,
      fx,
      commitService: (candidates) =>
        new OnboardingCommitService(
          fleetDb,
          tenantDb,
          new AccessControlService(createDb(authPool), fleetDb),
          new MasterDataAuditService(tenantDb, fleetDb),
          new OnboardingValidateService(),
          new VocabulariesService(fleetDb),
          {
            context: async () => ({ ...EMPTY_TEMPLATE_CONTEXT, pointKeys: new Map([["kw", true]]) }),
            pointKeyQuota: async () => "exempt",
          } as never,
          // F3.22: the three template services; these drafts hold no template.
          {} as never,
          {} as never,
          {} as never,
          { listParentCandidates: async () => [...candidates] } as never,
        ),
      async session(tag, parentCode) {
        const code = `F4243-${run}-${tag}`.toUpperCase();
        const draft = {
          location: {
            code,
            slug: code.toLowerCase(),
            name: `F4.243 ${tag}`,
            type: "campus",
            latitude: 0,
            longitude: 0,
            parentCode,
          },
          rtus: [
            {
              code: `${code}-RTU`,
              displayName: `F4.243 ${tag} RTU`,
              protocol: "simulator",
              config: {},
              credentialsSet: false,
              ingestEnabled: false,
            },
          ],
          onboardingMeta: { useExistingPointKeys: true },
          assets: [
            { rtuIndex: 0, code: `${code}-AS`, name: `F4.243 ${tag} asset`, siteName: "F4.243 site", domain: assetDomain },
          ],
          assetPoints: [{ assetIndex: 0, pointKey: "kw", sourceDataKey: `f4243/${run}/${tag}` }],
        } as OnboardingDraft;
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO bms.onboarding_sessions (organization_id, status, current_phase, draft)
           VALUES ($1, 'draft', 'review', $2::jsonb) RETURNING id`,
          [fx.organizationId, JSON.stringify(draft)],
        );
        const sessionId = rows[0]?.id;
        if (!sessionId) throw new Error(`F4.243: session ${tag} was not inserted`);
        return { sessionId, draft };
      },
    };
  }, 60_000);

  afterAll(async () => {
    try {
      if (superPool && ctx) {
        // What a commit adds beyond `dropFixture`'s rows, children first.
        const orgs = [ctx.fx.organizationId, ctx.fx.otherOrganizationId];
        const assets = "SELECT id FROM bms.assets WHERE organization_id = ANY($1::uuid[])";
        const rtus = "SELECT id FROM bms.rtus WHERE organization_id = ANY($1::uuid[])";
        await superPool.query(`DELETE FROM bms.asset_points WHERE asset_id IN (${assets})`, [orgs]);
        await superPool.query(`DELETE FROM bms.assets WHERE organization_id = ANY($1::uuid[])`, [orgs]);
        await superPool.query(`DELETE FROM bms.rtu_connection_configs WHERE rtu_id IN (${rtus})`, [orgs]);
        await superPool.query(`DELETE FROM bms.rtus WHERE organization_id = ANY($1::uuid[])`, [orgs]);
        await superPool.query(`DELETE FROM bms.onboarding_sessions WHERE organization_id = ANY($1::uuid[])`, [orgs]);
      }
      if (superPool) await dropFixture(superPool, run);
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  }, 60_000);

  it("C1 a named active parent: the committed location's parent_id is that parent", async () => {
    await assertTheCommitPlacesTheNodeUnderTheParent(use());
  }, 30_000);
  it("C1b the master.location.create audit carries the parentId", async () => {
    await assertTheCreateAuditCarriesTheParentId(use());
  }, 30_000);
  it("C1c a null parent commits a root", async () => {
    await assertANullParentCommitsARoot(use());
  }, 30_000);
  it("C1d a root's create audit says parentId: null", async () => {
    await assertARootsCreateAuditSaysNull(use());
  }, 30_000);
  it("C2 an unknown parent code is 400 location_parent_not_found", async () => {
    await assertAnUnknownParentIsNotFound(use());
  }, 30_000);
  it("C2b another organization's code is the same 400", async () => {
    await assertAnotherOrganizationsParentIsNotFound(use());
  }, 30_000);
  it("C3 an inactive parent is 409 location_parent_inactive", async () => {
    await assertAnInactiveParentIsRefused(use());
  }, 30_000);
  it("C4 a parent at depth 8 is 400 location_depth_exceeded", async () => {
    await assertAParentAtTheCapIsRefused(use());
  }, 30_000);
  it("C5 a refused placement writes no location", async () => {
    await assertARefusedPlacementWritesNothing(use());
  }, 30_000);
});
