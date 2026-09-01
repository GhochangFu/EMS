import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { registerFixturePointKeys } from "../../testing/integration-fixtures";
import { asRole } from "../../testing/role-urls";
import {
  assertDivergentTemplatePointIsolatedByOwnOrg,
  assertTemplatePointWithCheckRefusesForeignOrg,
} from "./template-points.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. It seeds one template in
 * organization A and two `template_points` rows under it — one stamped A (the
 * parent's org, as the service would) and one stamped B (a divergent org the
 * service cannot produce) — both on the fleet (BYPASSRLS) pool, then drives the
 * `0047` `template_points` policy with a real `bms_tenant` connection.
 *
 * This is the child/parent org-divergence proof the asset-templates unit banked
 * for Task 4: that `template_points` is isolated by its own `organization_id`,
 * not its template's.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "template_points 0047 own-column isolation against real, non-owner roles",
  because:
    "The asset-templates unit made replacePoints stamp the parent template's org on every point, so " +
    "the service can no longer create a point whose org diverges from its template's. Proving the " +
    "0047 policy keys on template_points' own organization_id (not a subquery through the template) " +
    "needs a divergent row inserted on fleetDb and read back under real bms_tenant GUCs — the owner " +
    "connection would bypass the policy and show both rows regardless.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";

// Per-run fixture codes. asset_templates has a UNIQUE (organization_id, code)
// identity and template_points has no unique code; cleanup is by cascade on the
// template id (below), not a `code LIKE` sweep, so randomUUID here is
// collision-avoidance, not the isolation invariant's per-run-prefix rule.
const RUN = randomUUID().replace(/-/g, "").slice(0, 12);
const TEMPLATE_CODE = `E71B-TP-${RUN}`;
const MATCHING_KEY = `e71b_tp_match_${RUN}`;
const DIVERGENT_KEY = `e71b_tp_diverge_${RUN}`;

describe.skipIf(!connectionString)("E7.1b — template_points own-column isolation under real RLS", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let tenantDb: BmsDb;
  let parentOrgId = "";
  let foreignOrgId = "";
  let templateId = "";
  let matchingPointId = "";
  let divergentPointId = "";
  let removeFixtureKeys: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "E7.1b");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E7.1b",
    );
    tenantDb = createDb(tenantPool);

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(`E7.1b: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    parentOrgId = org.rows[0].id;

    const other = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 LIMIT 1",
      [parentOrgId],
    );
    if (!other.rows[0]) {
      throw new Error("E7.1b: need a second organization to stamp a divergent template point.");
    }
    foreignOrgId = other.rows[0].id;

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("E7.1b: no active asset_domain — run pnpm db:seed.");
    }

    // Template in organization A, on the fleet pool.
    const tpl = await ownerPool.query<{ id: string }>(
      `INSERT INTO bms.asset_templates (organization_id, code, name, asset_type, domain, status)
         VALUES ($1, $2, $3, 'test_rig', $4, 'published') RETURNING id`,
      [parentOrgId, TEMPLATE_CODE, "E7.1b template-points RLS", dom.rows[0].code],
    );
    templateId = tpl.rows[0]!.id;

    // `F3.42`: both codes must exist in the fleet-wide catalog before the rows
    // below. Migration `0058` makes `template_points.point_key` a foreign key
    // into `bms.point_keys`, and these are invented per-run codes — the product
    // reaches this state through `replacePoints`, which registers nothing but
    // gates every code through `assertPointKeysActive` first.
    removeFixtureKeys = await registerFixturePointKeys(ownerPool, [MATCHING_KEY, DIVERGENT_KEY]);

    // Two points under it: one stamped the parent's org (A, what the service
    // does), one stamped the OTHER org (B, a divergence the service cannot
    // make — the org is not part of the point-key reference, so `0058`'s
    // single-column foreign key does not reject it, which is the whole point of
    // the assertion below).
    const matching = await ownerPool.query<{ id: string }>(
      `INSERT INTO bms.template_points (organization_id, template_id, point_key)
         VALUES ($1, $2, $3) RETURNING id`,
      [parentOrgId, templateId, MATCHING_KEY],
    );
    matchingPointId = matching.rows[0]!.id;

    const divergent = await ownerPool.query<{ id: string }>(
      `INSERT INTO bms.template_points (organization_id, template_id, point_key)
         VALUES ($1, $2, $3) RETURNING id`,
      [foreignOrgId, templateId, DIVERGENT_KEY],
    );
    divergentPointId = divergent.rows[0]!.id;
  });

  afterAll(async () => {
    // The sweep is bracketed and the pools close in the `finally`. If the
    // template DELETE raises — a foreign key this suite does not own, a lost
    // connection — the un-bracketed form would skip both `removeFixtureKeys()`
    // and the teardown, leaking two connections AND the catalog rows on top of
    // whatever actually failed.
    try {
      // template_points cascade on the template FK, so dropping the template on
      // the fleet (BYPASSRLS) pool clears both points regardless of their org.
      if (ownerPool && templateId) {
        await ownerPool.query("DELETE FROM bms.asset_templates WHERE id = $1", [templateId]);
      }
      // After the cascade, because `0058` makes those rows reference these codes.
      if (removeFixtureKeys) {
        await removeFixtureKeys();
      }
    } finally {
      await Promise.all([ownerPool, tenantPool].filter(Boolean).map((p) => p.end()));
    }
  });

  it("isolates each template_points row by its own org, not the parent template's", async () => {
    await assertDivergentTemplatePointIsolatedByOwnOrg(
      tenantDb,
      matchingPointId,
      divergentPointId,
      parentOrgId,
      foreignOrgId,
    );
  });

  it("refuses a template_points insert that claims a foreign org (WITH CHECK)", async () => {
    await assertTemplatePointWithCheckRefusesForeignOrg(
      tenantDb,
      templateId,
      parentOrgId,
      foreignOrgId,
      `e71b_tp_check_${RUN}`,
    );
  });
});
