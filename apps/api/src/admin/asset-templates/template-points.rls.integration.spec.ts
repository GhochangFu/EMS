import { expect } from "vitest";

import { sql } from "drizzle-orm";

import { templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { withTenant } from "../../database/tenant-context";

/**
 * `E7.1b` (ADR 0043 decision 5, plan Task 4 "banked proof") — `template_points`
 * is isolated by its **own** `organization_id`, not its parent template's.
 *
 * The asset-templates write-path unit made `replacePoints` stamp every point
 * row with the parent template's org inside `withTenant`, so the service can no
 * longer introduce a point whose org diverges from its template's. The `0047`
 * policy on `template_points` is a plain `tenant_isolation` on its own column
 * (0047:165-168), NOT a junction-style subquery through `asset_templates`. The
 * proof of that — that the row's own column governs, not the parent's — needs a
 * divergent row the service cannot produce, so the fixtures insert it directly
 * on `fleetDb` (BYPASSRLS), then read it back under real `bms_tenant` GUCs.
 *
 * This distinguishes `template_points`' policy from the `rule_notifications` /
 * `asset_group_members` junction policies, which DO key on the parent's org.
 */

/**
 * A `template_points` row whose org (B) diverges from its parent template's org
 * (A) is visible only under B's GUC, never A's — and a same-template row in A is
 * visible only under A. The policy follows each row's own `organization_id`.
 *
 * Before `0047` both rows were visible under any GUC (no policy), so the
 * discriminating assertions are the cross-org zeros.
 */
export async function assertDivergentTemplatePointIsolatedByOwnOrg(
  tenantDb: BmsDb,
  matchingPointId: string,
  divergentPointId: string,
  parentOrgId: string,
  childOrgId: string,
): Promise<void> {
  // Under the parent template's org: the row stamped with that org shows; the
  // divergent row (stamped the other org) is invisible — the policy does NOT
  // reach through template_id to the template's org.
  await withTenant(tenantDb, parentOrgId, async (tx) => {
    const matching = await tx.execute(
      sql`SELECT id FROM bms.template_points WHERE id = ${matchingPointId}`,
    );
    expect(matching.rows).toHaveLength(1);
    const divergent = await tx.execute(
      sql`SELECT id FROM bms.template_points WHERE id = ${divergentPointId}`,
    );
    expect(divergent.rows).toHaveLength(0);
  });

  // Under the divergent row's own org: it shows, and the parent-org row is now
  // the invisible one — confirming isolation is per-row on the own column.
  await withTenant(tenantDb, childOrgId, async (tx) => {
    const divergent = await tx.execute(
      sql`SELECT id FROM bms.template_points WHERE id = ${divergentPointId}`,
    );
    expect(divergent.rows).toHaveLength(1);
    const matching = await tx.execute(
      sql`SELECT id FROM bms.template_points WHERE id = ${matchingPointId}`,
    );
    expect(matching.rows).toHaveLength(0);
  });
}

/**
 * `WITH CHECK` on `template_points` refuses a row that claims a foreign org even
 * when its parent template is visible under the current GUC — the id passed to
 * `withTenant` and the row's own `organization_id` disagree, which the service
 * never produces (it stamps the parent's org), so this is the policy's own
 * defence exercised directly. Same idiom as
 * `locations.rls.integration.spec`'s `assertPolicyRefusesMismatchedOrg`.
 */
export async function assertTemplatePointWithCheckRefusesForeignOrg(
  tenantDb: BmsDb,
  templateId: string,
  currentOrgId: string,
  foreignOrgId: string,
  pointKey: string,
): Promise<void> {
  await expect(
    withTenant(tenantDb, currentOrgId, (tx) =>
      tx.insert(templatePoints).values({
        organizationId: foreignOrgId,
        templateId,
        pointKey,
      }),
    ),
  ).rejects.toThrow(/row-level security/i);
}
