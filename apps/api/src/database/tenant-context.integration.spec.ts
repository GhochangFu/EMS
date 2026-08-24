import pg from "pg";
import { expect } from "vitest";

import { withTenant } from "./tenant-context";
import { createDb, locations } from "@bms/db";

/**
 * `F4.16` / ADR 0043 decisions 8 and 10. Every assertion runs on a **tenant**
 * pool — a query that passed as the owner proves nothing, because an owner
 * bypasses RLS unless the table is FORCE ROW LEVEL SECURITY.
 */
export async function assertTenantSeesOnlyItsOwnLocations(
  tenantPool: pg.Pool,
  organizationId: string,
  otherOrganizationId: string,
): Promise<void> {
  const client = await tenantPool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.current_organization', $1, true)", [
      organizationId,
    ]);
    const { rows } = await client.query<{ organization_id: string }>(
      "select distinct organization_id from bms.locations",
    );
    await client.query("commit");
    expect(rows.map((r) => r.organization_id)).toEqual([organizationId]);
    expect(rows.map((r) => r.organization_id)).not.toContain(otherOrganizationId);
  } finally {
    client.release();
  }
}

/**
 * Decision 10 names this test: two sequential requests for different
 * organizations **on the same pooled connection** must see different rows. A
 * plain `SET` passes the first half and fails here, which is the whole point.
 */
export async function assertTenantDoesNotLeakAcrossPooledRequests(
  tenantPool: pg.Pool,
  firstOrganizationId: string,
  secondOrganizationId: string,
): Promise<void> {
  const single = new pg.Pool({ ...tenantPool.options, max: 1 });
  try {
    const read = async (organizationId: string): Promise<string[]> => {
      const client = await single.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.current_organization', $1, true)", [
          organizationId,
        ]);
        const { rows } = await client.query<{ organization_id: string }>(
          "select distinct organization_id from bms.locations",
        );
        await client.query("commit");
        return rows.map((r) => r.organization_id);
      } finally {
        client.release();
      }
    };
    expect(await read(firstOrganizationId)).toEqual([firstOrganizationId]);
    expect(await read(secondOrganizationId)).toEqual([secondOrganizationId]);
  } finally {
    await single.end();
  }
}

/**
 * With no organization set, a tenant connection sees nothing. Fail closed.
 *
 * The positive control is not optional. An empty result also happens when the
 * role has no `USAGE` on the schema, when the grant is missing, or when the
 * table is empty — three broken states that all look exactly like working
 * isolation. So the same query is run again **with** a tenant set and must
 * return rows.
 */
export async function assertTenantWithoutContextSeesNothing(
  tenantPool: pg.Pool,
  organizationId: string,
): Promise<void> {
  const { rows: unset } = await tenantPool.query("select 1 from bms.locations limit 1");
  expect(unset).toEqual([]);

  const client = await tenantPool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.current_organization', $1, true)", [
      organizationId,
    ]);
    const { rows: set } = await client.query("select 1 from bms.locations limit 1");
    await client.query("commit");
    expect(set.length).toBe(1);
  } finally {
    client.release();
  }
}

/** `bms_fleet` carries BYPASSRLS, so it sees both organizations at once. */
export async function assertFleetSeesEveryOrganization(
  fleetPool: pg.Pool,
  organizationIds: string[],
): Promise<void> {
  const { rows } = await fleetPool.query<{ organization_id: string }>(
    "select distinct organization_id from bms.locations",
  );
  expect(rows.map((r) => r.organization_id).sort()).toEqual([...organizationIds].sort());
}

/**
 * `withTenant` must produce exactly what a hand-written transaction produces —
 * and must not leak the setting past its own transaction, which is what
 * `SET LOCAL` buys over `SET`.
 */
export async function assertWithTenantScopesAndDoesNotLeak(
  tenantPool: pg.Pool,
  firstOrganizationId: string,
  secondOrganizationId: string,
): Promise<void> {
  const db = createDb(tenantPool);
  const first = await withTenant(db, firstOrganizationId, (tx) =>
    tx.select({ organizationId: locations.organizationId }).from(locations),
  );
  expect(new Set(first.map((r) => r.organizationId))).toEqual(new Set([firstOrganizationId]));

  const second = await withTenant(db, secondOrganizationId, (tx) =>
    tx.select({ organizationId: locations.organizationId }).from(locations),
  );
  expect(new Set(second.map((r) => r.organizationId))).toEqual(new Set([secondOrganizationId]));

  // Outside any withTenant call the GUC is unset again, so an unwrapped read
  // sees nothing rather than the last tenant's rows.
  const unwrapped = await db.select({ organizationId: locations.organizationId }).from(locations);
  expect(unwrapped).toEqual([]);
}
