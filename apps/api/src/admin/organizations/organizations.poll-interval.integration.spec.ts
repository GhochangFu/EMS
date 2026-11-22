import { ForbiddenException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { adminOrganizationDtoSchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type { OrganizationsAdminService } from "./organizations.service";

/**
 * `F1.2` (ADR 0141 decision 10, Amendment 1 (c); plan T7.3) — `PUT
 * /admin/organizations/:id/poll-interval` against the real database: what the column and the audit
 * log hold, and who may write it (ruling P12a: the global admin, or an `organization_admin` with a
 * direct grant on that organization). The sibling `.test.ts` owns the lifecycle: two fresh
 * organizations, an organization admin granted on A, a location admin on a location of A.
 * Cases write only organization rows this run created.
 */
export type PollIntervalFixtures = {
  svc: OrganizationsAdminService;
  observer: pg.Pool;
  orgA: string;
  orgB: string;
  globalAdmin: JwtPayload;
  organizationAdminA: JwtPayload;
  locationAdminA: JwtPayload;
};

const ACTION = "master.organization.poll_interval.update";

async function stored(ctx: PollIntervalFixtures, id: string): Promise<number | null> {
  const { rows } = await ctx.observer.query<{ v: number | null }>(
    "SELECT default_poll_interval_ms AS v FROM bms.organizations WHERE id = $1",
    [id],
  );
  return rows[0]!.v;
}

async function audits(ctx: PollIntervalFixtures, id: string) {
  const { rows } = await ctx.observer.query<{ organization_id: string | null; payload: Record<string, unknown> }>(
    `SELECT organization_id, payload FROM bms.audit_log
      WHERE entity_type = 'organization' AND entity_id = $1 AND action = $2 ORDER BY created_at, id`,
    [id, ACTION],
  );
  return rows;
}

/** O1 — the global admin sets any organization; the DTO and the column agree; `null` clears it. */
export async function assertTheGlobalAdminSetsAndClears(ctx: PollIntervalFixtures): Promise<void> {
  const set = await ctx.svc.setPollInterval(ctx.globalAdmin, ctx.orgB, { defaultPollIntervalMs: 45_000 });
  expect(adminOrganizationDtoSchema.parse(set).defaultPollIntervalMs).toBe(45_000);
  expect(await stored(ctx, ctx.orgB)).toBe(45_000);
  const cleared = await ctx.svc.setPollInterval(ctx.globalAdmin, ctx.orgB, { defaultPollIntervalMs: null });
  expect(cleared.defaultPollIntervalMs).toBeNull();
  expect(await stored(ctx, ctx.orgB)).toBeNull();
  const rows = await audits(ctx, ctx.orgB);
  expect(rows.map((row) => row.payload)).toEqual([
    { from: null, to: 45_000 },
    { from: 45_000, to: null },
  ]);
  expect(rows.every((row) => row.organization_id === ctx.orgB)).toBe(true);
}

/** O2 — an organization admin with a direct grant sets its own organization (P12a). */
export async function assertTheOrganizationAdminSetsItsOwn(ctx: PollIntervalFixtures): Promise<void> {
  await ctx.svc.setPollInterval(ctx.organizationAdminA, ctx.orgA, { defaultPollIntervalMs: 20_000 });
  expect(await stored(ctx, ctx.orgA)).toBe(20_000);
  const rows = await audits(ctx, ctx.orgA);
  expect(rows.at(-1)).toEqual({ organization_id: ctx.orgA, payload: { from: null, to: 20_000 } });
}

/** O3 — that admin on another organization, and a location admin on its own, are 403 and write nothing. */
export async function assertOtherCallersAreRefused(ctx: PollIntervalFixtures): Promise<void> {
  const beforeA = await stored(ctx, ctx.orgA);
  const beforeB = await stored(ctx, ctx.orgB);
  const auditsBefore = (await audits(ctx, ctx.orgA)).length + (await audits(ctx, ctx.orgB)).length;
  await expect(
    ctx.svc.setPollInterval(ctx.organizationAdminA, ctx.orgB, { defaultPollIntervalMs: 60_000 }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  await expect(
    ctx.svc.setPollInterval(ctx.locationAdminA, ctx.orgA, { defaultPollIntervalMs: 60_000 }),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(await stored(ctx, ctx.orgA)).toBe(beforeA);
  expect(await stored(ctx, ctx.orgB)).toBe(beforeB);
  expect((await audits(ctx, ctx.orgA)).length + (await audits(ctx, ctx.orgB)).length).toBe(auditsBefore);
}

/** O4 — the stored value again writes no audit row. */
export async function assertAnUnchangedValueWritesNothing(ctx: PollIntervalFixtures): Promise<void> {
  await ctx.svc.setPollInterval(ctx.globalAdmin, ctx.orgA, { defaultPollIntervalMs: 90_000 });
  const count = (await audits(ctx, ctx.orgA)).length;
  const again = await ctx.svc.setPollInterval(ctx.globalAdmin, ctx.orgA, { defaultPollIntervalMs: 90_000 });
  expect(again.defaultPollIntervalMs).toBe(90_000);
  expect((await audits(ctx, ctx.orgA)).length).toBe(count);
}

/** O5 — the migration's CHECK refuses an out-of-bound value even past the API (defence in depth). */
export async function assertTheColumnCheckHoldsTheBound(ctx: PollIntervalFixtures): Promise<void> {
  await expect(
    ctx.observer.query("UPDATE bms.organizations SET default_poll_interval_ms = 999 WHERE id = $1", [ctx.orgA]),
  ).rejects.toMatchObject({ code: "23514" });
}
