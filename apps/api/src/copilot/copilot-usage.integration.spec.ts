import { sql } from "drizzle-orm";
import type pg from "pg";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";

import { withUser } from "../database/user-context";
import type { CopilotUsageLimits } from "./copilot-config";
import { CopilotUsageService, type UsageIdentity } from "./copilot-usage.service";

/**
 * `F3.85` PR 6 / ADR 0099 decision 11, Amendment 1 A1 and A2 —
 * `CopilotUsageService` against migration `0106` on a real database, as
 * `bms_tenant`: the upsert's limit, the rollback, the zone-keyed days, the
 * per-user policy and the `bms_fleet` revoke. Each case uses its own calendar
 * day, so no case reads another's rows. Vitest entry point: the sibling
 * `.test.ts` (ADR 0014).
 */
export type UsageCtx = {
  tenantDb: BmsDb;
  fleetPool: pg.Pool;
  /** Fixture organization in `Asia/Kolkata`. */
  orgK: string;
  /** Fixture organization in `UTC`. */
  orgU: string;
  /** `organization_admin`, home `orgK`. */
  userA: UsageIdentity;
  /** `organization_admin`, home `orgK`. */
  userB: UsageIdentity;
  /** The global admin: `admin`, no home organization. */
  globalAdmin: UsageIdentity;
};

const LIMITS: CopilotUsageLimits = { userDailyTurns: 150, organizationDailyTurns: 1500 };

const service = (ctx: UsageCtx, limits: CopilotUsageLimits = LIMITS) => new CopilotUsageService(ctx.tenantDb, limits);

async function userTurns(ctx: UsageCtx, userId: string, day: string): Promise<number | null> {
  const { rows } = await withUser(ctx.tenantDb, userId, (tx) =>
    tx.execute<{ turns: number }>(sql`SELECT turns FROM bms.copilot_usage WHERE user_id = ${userId} AND day = ${day}::date`),
  );
  return rows[0]?.turns ?? null;
}

async function orgTurns(ctx: UsageCtx, userId: string, organizationId: string, day: string): Promise<number | null> {
  const { rows } = await withUser(
    ctx.tenantDb,
    userId,
    (tx) =>
      tx.execute<{ turns: number }>(
        sql`SELECT turns FROM bms.copilot_org_usage WHERE organization_id = ${organizationId} AND day = ${day}::date`,
      ),
    { organizationId },
  );
  return rows[0]?.turns ?? null;
}

async function seedUserTurns(ctx: UsageCtx, userId: string, day: string, turns: number): Promise<void> {
  await withUser(ctx.tenantDb, userId, (tx) =>
    tx.execute(sql`INSERT INTO bms.copilot_usage (user_id, day, turns) VALUES (${userId}, ${day}::date, ${turns})`),
  );
}

async function seedOrgTurns(ctx: UsageCtx, userId: string, organizationId: string, day: string, turns: number) {
  await withUser(
    ctx.tenantDb,
    userId,
    (tx) =>
      tx.execute(
        sql`INSERT INTO bms.copilot_org_usage (organization_id, day, turns) VALUES (${organizationId}, ${day}::date, ${turns})`,
      ),
    { organizationId },
  );
}

/** Turns 149 and 150 pass, 151 is refused with the next 00:00 IST as an instant; the counter stays at 150. */
export async function turn150AllowedAnd151RefusedOnTheDatabase(ctx: UsageCtx): Promise<void> {
  const now = new Date("2030-01-01T10:00:00.000Z");
  await seedUserTurns(ctx, ctx.userA.id, "2030-01-01", 148);
  expect(await service(ctx).consumeTurn(ctx.userA, null, now)).toEqual({ ok: true });
  expect(await service(ctx).consumeTurn(ctx.userA, null, now)).toEqual({ ok: true });
  expect(await userTurns(ctx, ctx.userA.id, "2030-01-01")).toBe(150);
  expect(await service(ctx).consumeTurn(ctx.userA, null, now)).toEqual({
    ok: false,
    scope: "user",
    resetsAt: "2030-01-01T18:30:00.000Z",
  });
  expect(await userTurns(ctx, ctx.userA.id, "2030-01-01")).toBe(150);
}

/** Two concurrent turns at 149: exactly one passes and the counter ends at 150. */
export async function concurrentTurnsAt149ExactlyOnePasses(ctx: UsageCtx): Promise<void> {
  const now = new Date("2030-01-02T10:00:00.000Z");
  await seedUserTurns(ctx, ctx.userA.id, "2030-01-02", 149);
  const results = await Promise.all([
    service(ctx).consumeTurn(ctx.userA, ctx.orgK, now),
    service(ctx).consumeTurn(ctx.userA, ctx.orgK, now),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, scope: "user", resetsAt: "2030-01-02T18:30:00.000Z" }]);
  expect(await userTurns(ctx, ctx.userA.id, "2030-01-02")).toBe(150);
  expect(await orgTurns(ctx, ctx.userA.id, ctx.orgK, "2030-01-02"), "the refused turn counts nowhere").toBe(1);
}

/** An organization refusal rolls back the user increment of the same transaction. */
export async function organizationRefusalLeavesTheUserCounterUnchanged(ctx: UsageCtx): Promise<void> {
  const now = new Date("2030-01-03T10:00:00.000Z");
  const tight: CopilotUsageLimits = { userDailyTurns: 150, organizationDailyTurns: 5 };
  await seedUserTurns(ctx, ctx.userA.id, "2030-01-03", 7);
  await seedOrgTurns(ctx, ctx.userA.id, ctx.orgU, "2030-01-03", 5);
  expect(await service(ctx, tight).consumeTurn(ctx.userA, ctx.orgU, now)).toEqual({
    ok: false,
    scope: "organization",
    resetsAt: "2030-01-04T00:00:00.000Z",
  });
  expect(await userTurns(ctx, ctx.userA.id, "2030-01-03")).toBe(7);
  expect(await orgTurns(ctx, ctx.userA.id, ctx.orgU, "2030-01-03")).toBe(5);
  // Positive control: bound to the other organization, the same user counts.
  expect(await service(ctx, tight).consumeTurn(ctx.userA, ctx.orgK, now)).toEqual({ ok: true });
  expect(await userTurns(ctx, ctx.userA.id, "2030-01-03")).toBe(8);
}

/** One user, two organizations: the 151st turn across both is refused (A1: no per-organization user key). */
export async function oneUserTwoOrganizationsShareTheUserLimitOnTheDatabase(ctx: UsageCtx): Promise<void> {
  const now = new Date("2030-01-04T10:00:00.000Z");
  await seedUserTurns(ctx, ctx.userA.id, "2030-01-04", 149);
  expect(await service(ctx).consumeTurn(ctx.userA, ctx.orgK, now)).toEqual({ ok: true });
  expect(await service(ctx).consumeTurn(ctx.userA, ctx.orgU, now)).toMatchObject({ ok: false, scope: "user" });
  expect(await orgTurns(ctx, ctx.userA.id, ctx.orgU, "2030-01-04")).toBeNull();
}

/** A cross-organization turn writes the user counter and no organization counter. */
export async function crossOrganizationTurnTouchesTheUserCounterOnlyOnTheDatabase(ctx: UsageCtx): Promise<void> {
  const now = new Date("2030-01-05T10:00:00.000Z");
  expect(await service(ctx).consumeTurn(ctx.globalAdmin, null, now)).toEqual({ ok: true });
  expect(await userTurns(ctx, ctx.globalAdmin.id, "2030-01-05")).toBe(1);
  expect(await orgTurns(ctx, ctx.globalAdmin.id, ctx.orgK, "2030-01-05")).toBeNull();
  expect(await orgTurns(ctx, ctx.globalAdmin.id, ctx.orgU, "2030-01-05")).toBeNull();
}

/** A2: 18:29Z and 18:31Z fall on different Asia/Kolkata days; the global admin's UTC day is one. */
export async function aKolkataMidnightSplitsTheOrganizationDayOnTheDatabase(ctx: UsageCtx): Promise<void> {
  await service(ctx).consumeTurn(ctx.globalAdmin, ctx.orgK, new Date("2030-01-06T18:29:00.000Z"));
  await service(ctx).consumeTurn(ctx.globalAdmin, ctx.orgK, new Date("2030-01-06T18:31:00.000Z"));
  expect(await orgTurns(ctx, ctx.globalAdmin.id, ctx.orgK, "2030-01-06")).toBe(1);
  expect(await orgTurns(ctx, ctx.globalAdmin.id, ctx.orgK, "2030-01-07")).toBe(1);
  expect(await userTurns(ctx, ctx.globalAdmin.id, "2030-01-06")).toBe(2);
}

/** Home Asia/Kolkata, bound UTC, at 20:00Z: the user row is the 9th, the organization row the 8th. */
export async function userDayAndOrganizationDayDifferOnTheDatabase(ctx: UsageCtx): Promise<void> {
  const now = new Date("2030-01-08T20:00:00.000Z");
  expect(await service(ctx).consumeTurn(ctx.userB, ctx.orgU, now)).toEqual({ ok: true });
  expect(await userTurns(ctx, ctx.userB.id, "2030-01-09")).toBe(1);
  expect(await userTurns(ctx, ctx.userB.id, "2030-01-08")).toBeNull();
  expect(await orgTurns(ctx, ctx.userB.id, ctx.orgU, "2030-01-08")).toBe(1);
  expect(await orgTurns(ctx, ctx.userB.id, ctx.orgU, "2030-01-09")).toBeNull();
}

/** User B cannot read A's counter; A can (positive control). */
export async function anotherUserCannotSeeTheCounter(ctx: UsageCtx): Promise<void> {
  const now = new Date("2030-01-10T10:00:00.000Z");
  expect(await service(ctx).consumeTurn(ctx.userA, null, now)).toEqual({ ok: true });
  const countAs = async (userId: string) => {
    const { rows } = await withUser(ctx.tenantDb, userId, (tx) =>
      tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM bms.copilot_usage WHERE user_id = ${ctx.userA.id} AND day = '2030-01-10'`,
      ),
    );
    return rows[0]?.n;
  };
  expect(await countAs(ctx.userA.id)).toBe(1);
  expect(await countAs(ctx.userB.id)).toBe(0);
}

/** `bms_fleet` holds no privilege on either counter: a select fails with 42501, it does not read an empty set. */
export async function fleetHasNoPrivilegeOnEitherCounter(ctx: UsageCtx): Promise<void> {
  // Positive control: the fleet pool is connected and reads a table it is granted.
  const ok = await ctx.fleetPool.query<{ n: number }>("SELECT count(*)::int AS n FROM bms.organizations");
  expect(ok.rows[0]?.n).toBeGreaterThan(0);
  for (const table of ["bms.copilot_usage", "bms.copilot_org_usage"]) {
    const error = await ctx.fleetPool.query(`SELECT count(*) FROM ${table}`).then(
      () => null,
      (err: { code?: string }) => err,
    );
    expect(error?.code, `${table}: 42501 is the permission refusal`).toBe("42501");
  }
}
