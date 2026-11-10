import { sql } from "drizzle-orm";
import { expect } from "vitest";
import type pg from "pg";

import { allocateWorkOrderReference, workOrders } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { withTenant } from "../database/tenant-context";
import type { WorkOrdersService } from "./work-orders.service";

/**
 * `E3.1` (ADR 0122 decisions 2 and 3; plan T1.4 and T1.5) — the reference allocator and
 * the SLA snapshot, against real `bms_tenant` and `bms_fleet` roles. Assertions live
 * here; `work-order-reference.integration.test.ts` owns the database lifecycle
 * (ADR 0014).
 */
export type WorkOrderReferenceFixtures = {
  svc: WorkOrdersService;
  tenantDb: BmsDb;
  fleetPool: pg.Pool;
  actor: Pick<JwtPayload, "sub" | "email">;
  organizationId: string;
  foreignOrgId: string;
  /** Pinned to a template whose prefix is `STP`, in domain `water`. */
  stpAssetId: string;
  stpTemplateId: string;
  /** Pinned to a template with no prefix, in domain `water`. */
  plainTemplateAssetId: string;
  /** No template, in domain `water`. */
  domainAssetId: string;
  /** No template, in a fixture domain that has no prefix. */
  genAssetId: string;
  /** An asset of the second organization. */
  foreignAssetId: string;
};

const TITLE = "E3.1 reference fixture";

async function nextSeq(pool: pg.Pool, organizationId: string): Promise<number | null> {
  const { rows } = await pool.query<{ next_seq: number }>(
    "SELECT next_seq FROM bms.work_order_counters WHERE organization_id = $1",
    [organizationId],
  );
  return rows[0]?.next_seq ?? null;
}

async function insertOne(ctx: WorkOrderReferenceFixtures, organizationId: string, assetId: string): Promise<{ seq: number; reference: string }> {
  return withTenant(ctx.tenantDb, organizationId, async (tx) => {
    const allocated = await allocateWorkOrderReference(tx, organizationId, assetId);
    await tx.insert(workOrders).values({ organizationId, ...allocated, assetId, title: TITLE, status: "open", priority: "low" });
    return allocated;
  });
}

/** Twenty concurrent creates in one organization: twenty distinct, contiguous numbers and no unique violation. */
export async function assertConcurrentCreatesGetContiguousNumbers(ctx: WorkOrderReferenceFixtures): Promise<void> {
  const before = (await nextSeq(ctx.fleetPool, ctx.organizationId)) ?? 1;
  const allocated = await Promise.all(
    Array.from({ length: 20 }, () => insertOne(ctx, ctx.organizationId, ctx.domainAssetId)),
  );
  const seqs = allocated.map((row) => row.seq).sort((a, b) => a - b);
  expect(new Set(seqs).size, "every seq is distinct").toBe(20);
  expect(seqs, "the seqs are contiguous from the counter").toEqual(Array.from({ length: 20 }, (_, i) => before + i));
  expect(new Set(allocated.map((row) => row.reference)).size, "every reference is distinct").toBe(20);
  expect(await nextSeq(ctx.fleetPool, ctx.organizationId), "the counter sits one past the highest seq").toBe(before + 20);
}

/** A second organization counts from its own number, not the first one's. */
export async function assertEachOrganizationCountsOnItsOwn(ctx: WorkOrderReferenceFixtures): Promise<void> {
  const ownBefore = (await nextSeq(ctx.fleetPool, ctx.organizationId)) ?? 1;
  const foreignBefore = (await nextSeq(ctx.fleetPool, ctx.foreignOrgId)) ?? 1;
  const foreign = await insertOne(ctx, ctx.foreignOrgId, ctx.foreignAssetId);
  expect(foreign.seq, "the second organization's own next number").toBe(foreignBefore);
  expect(await nextSeq(ctx.fleetPool, ctx.organizationId), "the first organization's counter did not move").toBe(ownBefore);
}

/** A rolled-back create gives its number back. */
export async function assertARollbackLeavesNoGap(ctx: WorkOrderReferenceFixtures): Promise<void> {
  const before = (await nextSeq(ctx.fleetPool, ctx.organizationId)) ?? 1;
  await expect(
    withTenant(ctx.tenantDb, ctx.organizationId, async (tx) => {
      await allocateWorkOrderReference(tx, ctx.organizationId, ctx.domainAssetId);
      throw new Error("roll back");
    }),
  ).rejects.toThrow("roll back");
  expect(await nextSeq(ctx.fleetPool, ctx.organizationId), "the counter is where it was").toBe(before);
  expect((await insertOne(ctx, ctx.organizationId, ctx.domainAssetId)).seq).toBe(before);
}

/** Template prefix, else domain prefix, else `GEN` (decision 2.5, ruling Q4). */
export async function assertThePrefixPrecedence(ctx: WorkOrderReferenceFixtures): Promise<void> {
  const prefixOf = async (assetId: string): Promise<string> => {
    const { reference } = await insertOne(ctx, ctx.organizationId, assetId);
    expect(reference).toMatch(/^[A-Z0-9]{2,8}-[0-9]{6,}$/);
    return reference.split("-")[0] as string;
  };
  expect(await prefixOf(ctx.stpAssetId), "a template prefix wins over the domain's").toBe("STP");
  expect(await prefixOf(ctx.plainTemplateAssetId), "a template with no prefix falls back to the domain").toBe("WATER");
  expect(await prefixOf(ctx.domainAssetId), "an asset with no template reads its domain").toBe("WATER");
  expect(await prefixOf(ctx.genAssetId), "a domain with no prefix reads GEN").toBe("GEN");
}

/** Under another organization's setting the allocator can neither read nor bump a counter. */
export async function assertAForeignSettingCannotTouchTheCounter(ctx: WorkOrderReferenceFixtures): Promise<void> {
  const before = await nextSeq(ctx.fleetPool, ctx.organizationId);
  expect(before, "the first organization has a counter by now").not.toBeNull();
  await expect(
    withTenant(ctx.tenantDb, ctx.foreignOrgId, (tx) => allocateWorkOrderReference(tx, ctx.organizationId, ctx.domainAssetId)),
    "the counter's WITH CHECK refuses another organization's row",
  ).rejects.toThrow();
  expect(await nextSeq(ctx.fleetPool, ctx.organizationId), "the counter did not move").toBe(before);
  const visible = await withTenant(ctx.tenantDb, ctx.foreignOrgId, (tx) =>
    tx.execute(sql`SELECT 1 FROM bms.work_order_counters WHERE organization_id = ${ctx.organizationId}::uuid`),
  );
  expect(visible.rows.length, "the second organization reads none of the first one's counter").toBe(0);
}

/** Seq 1,000,000 formats to seven digits rather than being cut to six. */
export async function assertTheReferenceWidensPastSixDigits(ctx: WorkOrderReferenceFixtures): Promise<void> {
  await expect(
    withTenant(ctx.tenantDb, ctx.organizationId, async (tx) => {
      await tx.execute(sql`UPDATE bms.work_order_counters SET next_seq = 1000000 WHERE organization_id = ${ctx.organizationId}::uuid`);
      const allocated = await allocateWorkOrderReference(tx, ctx.organizationId, ctx.domainAssetId);
      expect(allocated).toEqual({ seq: 1_000_000, reference: "WATER-1000000" });
      throw new Error("roll back");
    }),
  ).rejects.toThrow("roll back");
}

async function slaRow(pool: pg.Pool, id: string): Promise<{ sla_minutes: number | null; gap_minutes: number | null; reference: string }> {
  const { rows } = await pool.query<{ sla_minutes: number | null; gap_minutes: number | null; reference: string }>(
    `SELECT sla_minutes, reference,
            (extract(epoch FROM (sla_due_at - created_at)) / 60)::float8 AS gap_minutes
       FROM bms.work_orders WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new Error(`work order ${id} not found`);
  return rows[0];
}

/** The SLA is the body's override, else the organization's policy, else the platform default; `sla_due_at` is exactly that far from `created_at`. */
export async function assertTheSlaSnapshotFollowsOverridePolicyDefault(ctx: WorkOrderReferenceFixtures): Promise<void> {
  const create = (priority: "high" | "low", slaMinutes?: number) =>
    ctx.svc.create({ assetId: ctx.domainAssetId, title: TITLE, priority, ...(slaMinutes === undefined ? {} : { slaMinutes }) }, ctx.actor, null);

  const byDefault = await create("high");
  expect(byDefault.slaMinutes, "no policy row: the platform default for high").toBe(60);
  expect(byDefault.reference).toMatch(/^WATER-[0-9]{6,}$/);
  expect(byDefault.slaState).toBe("on_track");
  expect(byDefault.slaDueAt).not.toBeNull();

  await ctx.fleetPool.query(
    "INSERT INTO bms.work_order_sla_policies (organization_id, priority, resolution_minutes) VALUES ($1, 'high', 45)",
    [ctx.organizationId],
  );
  const byPolicy = await create("high");
  expect(byPolicy.slaMinutes, "the organization's policy row").toBe(45);
  expect((await create("low")).slaMinutes, "another priority keeps its default").toBe(1440);

  const byOverride = await create("high", 7);
  expect(byOverride.slaMinutes, "the body's override wins over the policy").toBe(7);

  for (const [item, minutes] of [[byDefault, 60], [byPolicy, 45], [byOverride, 7]] as const) {
    const row = await slaRow(ctx.fleetPool, item.id);
    expect(row.sla_minutes).toBe(minutes);
    expect(row.gap_minutes, "sla_due_at - created_at, read from the database").toBe(minutes);
  }

  // A later policy edit does not move a ticket that exists (decision 3.2).
  await ctx.fleetPool.query(
    "UPDATE bms.work_order_sla_policies SET resolution_minutes = 99 WHERE organization_id = $1 AND priority = 'high'",
    [ctx.organizationId],
  );
  expect((await slaRow(ctx.fleetPool, byPolicy.id)).sla_minutes).toBe(45);
}

/** A ticket older than the SLA columns reads `none`. */
export async function assertATicketWithNoSlaReadsNone(ctx: WorkOrderReferenceFixtures): Promise<void> {
  await insertOne(ctx, ctx.organizationId, ctx.domainAssetId);
  const { items } = await ctx.svc.list({ limit: 100, assetIds: [ctx.domainAssetId] });
  const legacy = items.filter((item) => item.slaMinutes === null);
  expect(legacy.length, "the suite's direct inserts carry no SLA").toBeGreaterThan(0);
  for (const item of legacy) {
    expect(item.slaState).toBe("none");
    expect(item.slaDueAt).toBeNull();
  }
}

/** A reference is frozen: changing the template's prefix afterwards does not move it. */
export async function assertAReferenceDoesNotFollowTheTemplate(ctx: WorkOrderReferenceFixtures): Promise<void> {
  const created = await ctx.svc.create({ assetId: ctx.stpAssetId, title: TITLE, priority: "medium" }, ctx.actor, null);
  expect(created.reference).toMatch(/^STP-/);
  await ctx.fleetPool.query("UPDATE bms.asset_templates SET work_order_prefix = 'ETP' WHERE id = $1", [ctx.stpTemplateId]);
  try {
    expect((await slaRow(ctx.fleetPool, created.id)).reference, "the existing reference is unchanged").toBe(created.reference);
    const next = await ctx.svc.create({ assetId: ctx.stpAssetId, title: TITLE, priority: "medium" }, ctx.actor, null);
    expect(next.reference, "a new ticket reads the new prefix").toMatch(/^ETP-/);
  } finally {
    await ctx.fleetPool.query("UPDATE bms.asset_templates SET work_order_prefix = 'STP' WHERE id = $1", [ctx.stpTemplateId]);
  }
}

/** An asset of another organization is refused, and the counter does not move. */
export async function assertAnUnseenAssetIsRefused(ctx: WorkOrderReferenceFixtures): Promise<void> {
  const before = await nextSeq(ctx.fleetPool, ctx.organizationId);
  await expect(
    withTenant(ctx.tenantDb, ctx.organizationId, (tx) => allocateWorkOrderReference(tx, ctx.organizationId, ctx.foreignAssetId)),
  ).rejects.toThrow("the asset is not visible in this organization");
  expect(await nextSeq(ctx.fleetPool, ctx.organizationId), "no number was spent").toBe(before);
}

async function stamps(pool: pg.Pool, id: string): Promise<{ resolved_at: Date | null; closed_at: Date | null }> {
  const { rows } = await pool.query<{ resolved_at: Date | null; closed_at: Date | null }>(
    "SELECT resolved_at, closed_at FROM bms.work_orders WHERE id = $1",
    [id],
  );
  if (!rows[0]) throw new Error(`work order ${id} not found`);
  return rows[0];
}

/**
 * `resolvedAt` is stamped on the move into `resolved` and not again. The board sends
 * every row on every drag, so a re-stamp would move a resolved ticket's time to "now"
 * and turn a `met` SLA into `missed`.
 */
export async function assertResolvedAtIsStampedOnce(ctx: WorkOrderReferenceFixtures): Promise<void> {
  const created = await ctx.svc.create({ assetId: ctx.domainAssetId, title: TITLE, priority: "high", slaMinutes: 60 }, ctx.actor, null);
  const resolved = await ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null);
  expect(resolved.slaState).toBe("met");
  // Move the stamp into the past, where a re-stamp to "now" is visible whatever the clock's resolution.
  await ctx.fleetPool.query("UPDATE bms.work_orders SET resolved_at = created_at + interval '1 minute' WHERE id = $1", [created.id]);
  const first = (await stamps(ctx.fleetPool, created.id)).resolved_at;

  await ctx.svc.reorder({ items: [{ id: created.id, status: "resolved", sortOrder: 3 }] }, ctx.actor, null);
  expect((await stamps(ctx.fleetPool, created.id)).resolved_at, "a reorder within resolved keeps the stamp").toEqual(first);

  await ctx.svc.updateStatus(created.id, { status: "resolved", sortOrder: 4 }, ctx.actor, null);
  expect((await stamps(ctx.fleetPool, created.id)).resolved_at, "a status write within resolved keeps the stamp").toEqual(first);

  await ctx.svc.updateStatus(created.id, { status: "in_progress" }, ctx.actor, null);
  await ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null);
  expect((await stamps(ctx.fleetPool, created.id)).resolved_at, "re-entering resolved stamps again").not.toEqual(first);
}

/** A ticket closed without being resolved stops its clock at the close: `met`, not `breached` for good. */
export async function assertACloseStopsTheSlaClock(ctx: WorkOrderReferenceFixtures): Promise<void> {
  const created = await ctx.svc.create({ assetId: ctx.domainAssetId, title: TITLE, priority: "high", slaMinutes: 60 }, ctx.actor, null);
  const closed = await ctx.svc.close(created.id, ctx.actor, { reason: "Closed without a resolve" }, null);
  expect((await stamps(ctx.fleetPool, created.id)).resolved_at, "the ticket was never resolved").toBeNull();
  expect(closed.slaState, "closed inside its window").toBe("met");
  // Push the due time into the past: an open ticket would now read breached.
  await ctx.fleetPool.query(
    "UPDATE bms.work_orders SET created_at = created_at - interval '3 hours', sla_due_at = sla_due_at - interval '3 hours', closed_at = closed_at - interval '3 hours' WHERE id = $1",
    [created.id],
  );
  const { items } = await ctx.svc.list({ limit: 100, assetIds: [ctx.domainAssetId] });
  expect(items.find((item) => item.id === created.id)?.slaState, "still met three hours on").toBe("met");
}
