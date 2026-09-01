import { expect } from "vitest";
import pg from "pg";

import type { JwtPayload } from "@bms/shared";

import type { PointKeysAdminService } from "./point-keys.service";

/**
 * `F3.39` / ADR 0051 decisions 2-4 — **this suite used to prove the opposite of
 * what it proves now, and that inversion is the point.**
 *
 * It was `F4.16` Task 8: `bms.point_keys` carried a `tenant_isolation` policy
 * with FORCE, so the assertions were that `withTenant` really did scope a write,
 * that an `organization_admin` could not create a key in another organization,
 * that the create audit row was stamped with the key's own organization, and
 * that the policy's `WITH CHECK` refused a mismatched GUC.
 *
 * Migration `0057` removes the column, the policy and the FORCE flag. Every one
 * of those four assertions now tests a mechanism that does not exist. Deleting
 * them would have left the row's most consequential claim — a tenant boundary
 * was removed on purpose — held by nothing at all. So each is replaced by its
 * inverse, which is a stronger gate than silence:
 *
 * 1. The lifecycle still works, for a **global admin**, with no tenant context.
 * 2. An `organization_admin` is refused **every** write. The old suite proved
 *    they were refused another organization's catalog; the new one proves they
 *    are refused the only catalog there is.
 * 3. The create audit row carries **NULL**, on the fleet connection — the case
 *    ADR 0043 Amendment 5 admits `TO bms_fleet` and refuses `TO bms_tenant`.
 * 4. Every organization reads every code, proven without any tenant context.
 * 5. `asset_points.point_key` is a real foreign key now, so an unlisted code is
 *    refused by the database rather than only by the service.
 */
type SvcWithFixtures = {
  svc: PointKeysAdminService;
  ownerPool: pg.Pool;
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The lifecycle, run by a global admin with no tenant context anywhere.
 *
 * The owner read-back is what makes this more than an in-process check. Before
 * `0057`, `bms_owner` was bound by FORCE on this table and could only see a row
 * whose organization matched the GUC — which is why the old version of this
 * function asserted the stamped `organization_id` came back. Now the same read
 * with no GUC set must return the row, and that is the removal of the boundary
 * observed from outside the service rather than asserted about it.
 */
export async function assertGlobalAdminLifecycle(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
): Promise<string> {
  const { svc, ownerPool } = ctx;
  const created = await svc.create(jwt, {
    code: `f3.39-global-${Date.now()}`,
    name: "F3.39 global catalog write-path check",
  });
  expect(created.active).toBe(true);

  const [ownerRow] = (
    await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.point_keys WHERE id = $1",
      [created.id],
    )
  ).rows;
  expect(
    ownerRow?.code,
    "bms_owner must read the new row with NO app.current_organization set. If this is " +
      "undefined, 0057's DROP POLICY / NO FORCE did not take and the table is still " +
      "tenant-scoped.",
  ).toBe(created.code);

  const fetched = await svc.getById(jwt, created.id);
  expect(fetched.name).toBe("F3.39 global catalog write-path check");

  const updated = await svc.update(jwt, created.id, { name: "F3.39 renamed" });
  expect(updated.name).toBe("F3.39 renamed");

  const deactivated = await svc.deactivate(jwt, created.id);
  expect(deactivated.active).toBe(false);

  const reactivated = await svc.reactivate(jwt, created.id);
  expect(reactivated.active).toBe(true);
  return created.id;
}

/**
 * **The narrowed write gate, and the reason this row is not a pure widening.**
 *
 * An `organization_admin` could create a point key in their own organization
 * before `0057` and that was correct — the row belonged to their tenant. There
 * is no such row any more: a code they add is fleet-wide master data every other
 * organization then reads. `PointKeysAdminService.requireGlobalAdmin` refuses
 * them, which is ADR 0046's reasoning for audit reads applied to a write, and
 * the ruling `F3.40` repeats for `bms.asset_roles`.
 *
 * All four mutations are checked, not just `create`. A gate applied to one entry
 * point and forgotten on the other three is the shape this catches.
 */
export async function assertOrganizationAdminIsRefusedEveryWrite(
  ctx: SvcWithFixtures,
  orgAdminJwt: JwtPayload,
): Promise<void> {
  const { svc, ownerPool } = ctx;
  const { rows } = await ownerPool.query<{ id: string }>(
    "SELECT id FROM bms.point_keys WHERE active = true ORDER BY code LIMIT 1",
  );
  const existingId = rows[0]?.id;
  assert(
    Boolean(existingId),
    "F3.39: the seeded point key catalog is empty — run pnpm db:seed.",
  );

  await expect(
    svc.create(orgAdminJwt, {
      code: `f3.39-deny-${Date.now()}`,
      name: "must never be created",
    }),
    "an organization_admin must not create a fleet-wide point key",
  ).rejects.toThrow(/global administrator/i);

  await expect(
    svc.update(orgAdminJwt, existingId!, { name: "must never be renamed" }),
    "an organization_admin must not rename a fleet-wide point key",
  ).rejects.toThrow(/global administrator/i);

  await expect(
    svc.deactivate(orgAdminJwt, existingId!),
    "an organization_admin must not retire a fleet-wide point key",
  ).rejects.toThrow(/global administrator/i);

  await expect(
    svc.reactivate(orgAdminJwt, existingId!),
    "an organization_admin must not reinstate a fleet-wide point key",
  ).rejects.toThrow(/global administrator/i);
}

/**
 * The audit row is org-less, and it reaches the table.
 *
 * `E7.1c` item D's original version of this asserted the row carried the point
 * key's own organization. It cannot: a global-vocabulary edit is a fleet event
 * and no tenant owns it. What makes this worth asserting rather than assuming is
 * that ADR 0043 Amendment 5 narrowed the NULL-organization `WITH CHECK` to
 * `TO bms_fleet` alone — so a NULL written on the tenant pool is REFUSED. The
 * row appearing at all is the proof that the write went out on `fleetDb`.
 */
export async function assertCreateAuditRowIsOrgLess(
  ctx: SvcWithFixtures,
  jwt: JwtPayload,
): Promise<void> {
  const { svc, ownerPool } = ctx;
  const created = await svc.create(jwt, {
    code: `f3.39-audit-${Date.now()}`,
    name: "F3.39 org-less audit row check",
  });
  try {
    const { rows } = await ownerPool.query<{ organization_id: string | null }>(
      `SELECT organization_id FROM bms.audit_log
        WHERE action = 'master.point_key.create' AND entity_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [created.id],
    );
    expect(
      rows.length,
      "create wrote no audit row. Under ADR 0043 Amendment 5 a NULL organization is " +
        "admitted TO bms_fleet only, so a missing row means the write went out on the " +
        "tenant pool and the policy refused it.",
    ).toBe(1);
    expect(
      rows[0]?.organization_id,
      "the audit row for a fleet-wide vocabulary edit must carry no organization",
    ).toBeNull();
  } finally {
    await ownerPool.query("DELETE FROM bms.audit_log WHERE entity_id = $1", [created.id]);
    await ownerPool.query("DELETE FROM bms.point_keys WHERE id = $1", [created.id]);
  }
}

/**
 * **The boundary removal, stated positively.**
 *
 * The row's closure says "after this every organization sees every point-key
 * code". That sentence needs a gate or it is only a claim in a document. Every
 * code is visible with no tenant context at all, and — the half that would
 * otherwise go unchecked — a code seeded for one organization is now visible
 * from every organization's context.
 */
export async function assertEveryOrganizationSeesEveryCode(
  ownerPool: pg.Pool,
): Promise<void> {
  const { rows: all } = await ownerPool.query<{ n: string }>(
    "SELECT COUNT(*)::text AS n FROM bms.point_keys",
  );
  const total = Number(all[0]?.n ?? "0");
  expect(
    total,
    "the point key catalog is empty with no tenant context set — run pnpm db:seed",
  ).toBeGreaterThan(0);

  const { rows: orgs } = await ownerPool.query<{ id: string }>(
    "SELECT id FROM bms.organizations ORDER BY code",
  );
  assert(orgs.length >= 2, "F3.39: need two organizations to prove the merge.");

  for (const org of orgs) {
    const client = await ownerPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_organization', $1, true)", [org.id]);
      const { rows } = await client.query<{ n: string }>(
        "SELECT COUNT(*)::text AS n FROM bms.point_keys",
      );
      expect(
        Number(rows[0]?.n ?? "0"),
        `organization ${org.id} sees a partial catalog. After 0057 the table has no ` +
          "policy, so a tenant context must make no difference to what it returns.",
      ).toBe(total);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }

  const { rows: dupes } = await ownerPool.query<{ code: string }>(
    "SELECT code FROM bms.point_keys GROUP BY code HAVING COUNT(*) > 1",
  );
  expect(
    dupes.map((r) => r.code),
    "a code appears twice in the merged catalog. 0057's dedupe and its unique index " +
      "on (code) should make that impossible.",
  ).toEqual([]);
}

/**
 * ADR 0051 decision 4 — the vocabulary is a constraint, not a decoration.
 *
 * `resolveCatalogPointKey` already refused an unlisted code at the service
 * layer, and it still does. This asserts the database refuses one too, which is
 * the difference between a rule the admin surface honours and a rule the schema
 * holds: `apps/ingest`, `phe-pilot-seed.ts` and any future writer reach
 * `bms.asset_points` without passing through that service.
 */
export async function assertAssetPointsRejectsAnUnlistedKey(
  ownerPool: pg.Pool,
): Promise<void> {
  const { rows } = await ownerPool.query<{ id: string; organization_id: string }>(
    `SELECT a.id, a.organization_id
       FROM bms.assets a
      WHERE a.organization_id IS NOT NULL
      ORDER BY a.code
      LIMIT 1`,
  );
  const asset = rows[0];
  assert(Boolean(asset), "F3.39: no seeded asset to test the foreign key against.");

  const client = await ownerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organization', $1, true)", [
      asset!.organization_id,
    ]);
    await expect(
      client.query(
        `INSERT INTO bms.asset_points
           (organization_id, asset_id, point_key, source_data_key, source_kind, active)
         VALUES ($1, $2, $3, $4, 'manual', true)`,
        [
          asset!.organization_id,
          asset!.id,
          `f3.39-no-such-key-${Date.now()}`,
          `F3.39_NO_SUCH_KEY_${Date.now()}`,
        ],
      ),
      "bms.asset_points accepted a point_key that is in no vocabulary. 0057's foreign " +
        "key is missing, or it was added before the orphans were admitted and never " +
        "validated.",
    ).rejects.toThrow(/foreign key|violates/i);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}
