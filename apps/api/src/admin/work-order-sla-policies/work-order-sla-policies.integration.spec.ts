import { ForbiddenException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type pg from "pg";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import { type JwtPayload, WORK_ORDER_SLA_DEFAULT_MINUTES, workOrderSlaPoliciesResponseSchema } from "@bms/shared";

import { withTenant } from "../../database/tenant-context";
import type { WorkOrderSlaPoliciesAdminController } from "./work-order-sla-policies.controller";

/**
 * `E3.1` (ADR 0122 decisions 3.2, 9 and 10; plan D8 and T1.6) — the SLA policy admin
 * routes through the real controller, the real `AccessControlService` and the real
 * service, against `bms_tenant`, `bms_fleet` and `bms_auth`. Assertions live here;
 * `work-order-sla-policies.integration.test.ts` owns the database lifecycle (ADR 0014).
 *
 * Organization A is a per-run fixture organization, so no other suite's policy rows
 * (`work-order-reference.integration.spec.ts` writes the seeded organization's) can race
 * these. Organization B is `phe-admin@bms.local`'s seeded organization, which this suite
 * reads and never writes.
 */
export type SlaPolicyFixtures = {
  controller: WorkOrderSlaPoliciesAdminController;
  tenantDb: BmsDb;
  fleetPool: pg.Pool;
  /** The seeded global admin. */
  admin: JwtPayload;
  /** `phe-admin@bms.local`, the `organization_admin` of B. */
  organizationAdminOfB: JwtPayload;
  /** `wc-admin@bms.local`, a `location_admin` with a node in `locationAdminOrgId`. */
  locationAdmin: JwtPayload;
  orgA: string;
  orgB: string;
  locationAdminOrgId: string;
};

const DEFAULTS = [
  { priority: "critical", resolutionMinutes: WORK_ORDER_SLA_DEFAULT_MINUTES.critical, source: "default" },
  { priority: "high", resolutionMinutes: WORK_ORDER_SLA_DEFAULT_MINUTES.high, source: "default" },
  { priority: "medium", resolutionMinutes: WORK_ORDER_SLA_DEFAULT_MINUTES.medium, source: "default" },
  { priority: "low", resolutionMinutes: WORK_ORDER_SLA_DEFAULT_MINUTES.low, source: "default" },
] as const;

async function auditRows(ctx: SlaPolicyFixtures, organizationId: string): Promise<Array<{ payload: Record<string, unknown> }>> {
  const { rows } = await ctx.fleetPool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM bms.audit_log
      WHERE organization_id = $1 AND action = 'work_order_sla_policy_update' AND entity_type = 'work_order_sla_policy'
      ORDER BY created_at, id`,
    [organizationId],
  );
  return rows;
}

async function policyRowCount(ctx: SlaPolicyFixtures, organizationId: string): Promise<number> {
  const { rows } = await ctx.fleetPool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.work_order_sla_policies WHERE organization_id = $1",
    [organizationId],
  );
  return rows[0]?.n ?? 0;
}

/** An organization with no rows reads four `default` rows, 30/60/240/1440, in priority order. */
export async function aGetWithNoRowsAnswersFourDefaults(ctx: SlaPolicyFixtures): Promise<void> {
  const answer = await ctx.controller.get(ctx.admin, ctx.orgA);
  expect(workOrderSlaPoliciesResponseSchema.parse(answer)).toEqual(answer);
  expect(answer).toEqual({ organizationId: ctx.orgA, items: DEFAULTS });
  expect(DEFAULTS.map((row) => row.resolutionMinutes)).toEqual([30, 60, 240, 1440]);
}

/**
 * `PUT [{high:45}]` answers and reads back high 45 `organization`, the other three `default`;
 * it wrote exactly one audit row stamped with A, carrying the before and after minutes; a
 * second `PUT []` returns all four to `default` (replace semantics) and leaves no row.
 */
export async function aPutReplacesTheSetAndAuditsOnce(ctx: SlaPolicyFixtures): Promise<void> {
  const auditBefore = (await auditRows(ctx, ctx.orgA)).length;
  const expected = {
    organizationId: ctx.orgA,
    items: [DEFAULTS[0], { priority: "high", resolutionMinutes: 45, source: "organization" }, DEFAULTS[2], DEFAULTS[3]],
  };

  const put = await ctx.controller.put(ctx.admin, {
    organizationId: ctx.orgA,
    policies: [{ priority: "high", resolutionMinutes: 45 }],
  });
  expect(workOrderSlaPoliciesResponseSchema.parse(put)).toEqual(put);
  expect(put, "the PUT answers the read-back").toEqual(expected);
  expect(await ctx.controller.get(ctx.admin, ctx.orgA), "a GET agrees").toEqual(expected);

  const audits = await auditRows(ctx, ctx.orgA);
  expect(audits.length - auditBefore, "the PUT wrote exactly one audit row with organization_id = A").toBe(1);
  const payload = audits[audits.length - 1]?.payload ?? {};
  expect(payload.before).toEqual({ critical: 30, high: 60, medium: 240, low: 1440 });
  expect(payload.after).toEqual({ critical: 30, high: 45, medium: 240, low: 1440 });

  const cleared = await ctx.controller.put(ctx.admin, { organizationId: ctx.orgA, policies: [] });
  expect(cleared, "an empty set returns every priority to its default").toEqual({ organizationId: ctx.orgA, items: DEFAULTS });
  expect(await policyRowCount(ctx, ctx.orgA), "replace semantics: no row is left").toBe(0);
  expect((await auditRows(ctx, ctx.orgA)).length - auditBefore, "one audit row per PUT").toBe(2);
}

/** The `organization_admin` of B is refused for A on both routes, and writes nothing. */
export async function anOrganizationAdminOfBIsRefusedForA(ctx: SlaPolicyFixtures): Promise<void> {
  const auditBefore = (await auditRows(ctx, ctx.orgA)).length;
  await expect(ctx.controller.get(ctx.organizationAdminOfB, ctx.orgA)).rejects.toBeInstanceOf(ForbiddenException);
  await expect(
    ctx.controller.put(ctx.organizationAdminOfB, {
      organizationId: ctx.orgA,
      policies: [{ priority: "low", resolutionMinutes: 5 }],
    }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(await policyRowCount(ctx, ctx.orgA), "nothing was written").toBe(0);
  expect((await auditRows(ctx, ctx.orgA)).length, "nothing was audited").toBe(auditBefore);

  const own = await ctx.controller.get(ctx.organizationAdminOfB, ctx.orgB);
  expect(own.organizationId, "B's own admin reads B").toBe(ctx.orgB);
  expect(own.items.map((row) => row.priority)).toEqual(["critical", "high", "medium", "low"]);
}

/**
 * A `location_admin` holding a node in an organization is still refused there: the check is
 * organization-level, not `writableOrganizationIds`, which a location grant satisfies.
 */
export async function aLocationAdminIsRefusedInItsOwnOrganization(ctx: SlaPolicyFixtures): Promise<void> {
  await expect(ctx.controller.get(ctx.locationAdmin, ctx.locationAdminOrgId)).rejects.toBeInstanceOf(ForbiddenException);
  await expect(
    ctx.controller.put(ctx.locationAdmin, { organizationId: ctx.locationAdminOrgId, policies: [] }),
  ).rejects.toBeInstanceOf(ForbiddenException);
}

/** Under B's tenant setting a direct read of the table sees none of A's rows; under A's it sees them. */
export async function bsTenantSettingReadsNoneOfAsRows(ctx: SlaPolicyFixtures): Promise<void> {
  await ctx.controller.put(ctx.admin, {
    organizationId: ctx.orgA,
    policies: [{ priority: "critical", resolutionMinutes: 20 }],
  });
  try {
    const read = (organizationId: string) =>
      withTenant(ctx.tenantDb, organizationId, (tx) =>
        tx.execute(sql`SELECT priority FROM bms.work_order_sla_policies WHERE organization_id = ${ctx.orgA}::uuid`),
      );
    expect((await read(ctx.orgA)).rows, "A's own setting sees its row").toEqual([{ priority: "critical" }]);
    expect((await read(ctx.orgB)).rows, "B's setting sees none of A's rows").toEqual([]);
  } finally {
    await ctx.controller.put(ctx.admin, { organizationId: ctx.orgA, policies: [] });
  }
}

/** An id that names no organization is 404 on both routes, for the global admin who passes the gate. */
export async function anUnknownOrganizationIsNotFound(ctx: SlaPolicyFixtures): Promise<void> {
  const unknown = "00000000-0000-4000-8000-00000000e311";
  await expect(ctx.controller.get(ctx.admin, unknown)).rejects.toMatchObject({ status: 404 });
  await expect(
    ctx.controller.put(ctx.admin, { organizationId: unknown, policies: [{ priority: "high", resolutionMinutes: 45 }] }),
  ).rejects.toMatchObject({ status: 404 });
}
