import { expect } from "vitest";
import type pg from "pg";

import type { JwtPayload, OnboardingCommitResponseDto } from "@bms/shared";

import type { OnboardingCommitService } from "./onboarding-commit.service";

/**
 * `F4.111` (ADR 0104 decisions 1, 4 and 6) — the commit is the growth quota's
 * authority: it refuses under the organization's advisory lock, stamps
 * `created_by_organization_id` on every row it adds, and skips both limits for
 * a global admin. Assertions live here (ADR 0014); the `.test` sibling owns the
 * database lifecycle and seeds one session per claim.
 */
export interface PointKeyQuotaCtx {
  readonly ownerPool: pg.Pool;
  readonly commitSvc: OnboardingCommitService;
  readonly orgAdmin: JwtPayload;
  readonly globalAdmin: JwtPayload;
  readonly organizationId: string;
  readonly run: number;
  /** One fresh draft session per call; `tag` names its rows. */
  seed(tag: string, newKeys: number, extraCodes?: readonly string[]): Promise<string>;
  /** Sets the organization's stamped row count to exactly `count` with filler rows. */
  fillTo(count: number): Promise<void>;
  /** Every commit a claim made, for the cleanup. */
  readonly committed: OnboardingCommitResponseDto[];
}

async function rowsOfTag(ctx: PointKeyQuotaCtx, tag: string): Promise<{ code: string; created_by_organization_id: string | null }[]> {
  const { rows } = await ctx.ownerPool.query<{ code: string; created_by_organization_id: string | null }>(
    "SELECT code, created_by_organization_id FROM bms.point_keys WHERE code LIKE $1",
    [`F4111\\_${tag}\\_%`],
  );
  return rows;
}

async function sessionStatus(ctx: PointKeyQuotaCtx, sessionId: string): Promise<string> {
  const { rows } = await ctx.ownerPool.query<{ status: string }>("SELECT status FROM bms.onboarding_sessions WHERE id = $1", [sessionId]);
  return rows[0]?.status ?? "missing";
}

/** Q-I1 — 201 new keys are refused, and the rolled-back transaction leaves no row. */
export async function assertTwoHundredOneNewKeysAreRefusedAndWriteNothing(ctx: PointKeyQuotaCtx): Promise<void> {
  const sessionId = await ctx.seed("OVER", 201);
  await expect(ctx.commitSvc.commit(ctx.orgAdmin, sessionId)).rejects.toThrow(/adds 201 point keys .* remove 1 of them/);
  expect({ rows: (await rowsOfTag(ctx, "OVER")).length, status: await sessionStatus(ctx, sessionId) }).toEqual({
    rows: 0,
    status: "draft",
  });
}

/** Q-I2 — 200 new keys and one existing code commit; each new row carries the organization; the audit counts 200. */
export async function assertTwoHundredNewKeysCommitStamped(ctx: PointKeyQuotaCtx): Promise<void> {
  await ctx.fillTo(0);
  const sessionId = await ctx.seed("AT", 200, ["kw"]);
  const result = await ctx.commitSvc.commit(ctx.orgAdmin, sessionId);
  ctx.committed.push(result);
  const rows = await rowsOfTag(ctx, "AT");
  const { rows: audit } = await ctx.ownerPool.query<{ n: string | null }>(
    "SELECT payload->>'newPointKeys' AS n FROM bms.audit_log WHERE action = 'master.onboarding.commit' AND entity_id = $1",
    [sessionId],
  );
  expect({
    rows: rows.length,
    stamped: rows.every((row) => row.created_by_organization_id === ctx.organizationId),
    audit: audit[0]?.n,
  }).toEqual({ rows: 200, stamped: true, audit: "200" });
}

/** Q-I3 — an organization at 1,000 is refused one more new key. */
export async function assertAnOrganizationAtTheLimitIsRefusedOneMore(ctx: PointKeyQuotaCtx): Promise<void> {
  await ctx.fillTo(1000);
  const sessionId = await ctx.seed("FULL", 1);
  await expect(ctx.commitSvc.commit(ctx.orgAdmin, sessionId)).rejects.toThrow(/has added 1000 point keys .* past the 1000/);
  expect((await rowsOfTag(ctx, "FULL")).length).toBe(0);
}

/** Q-I4 — at 1,000, a draft whose keys the catalog already holds still commits. */
export async function assertExistingCodesCommitAtTheLimit(ctx: PointKeyQuotaCtx): Promise<void> {
  await ctx.fillTo(1000);
  const sessionId = await ctx.seed("REUSE", 0, ["kw"]);
  const result = await ctx.commitSvc.commit(ctx.orgAdmin, sessionId);
  ctx.committed.push(result);
  expect(result.pointKeyIds.length).toBe(1);
}

/** Q-I5 — a global admin's commit passes both limits, and its rows still carry the organization (decision 6). */
export async function assertAGlobalAdminIsExemptAndStillStamps(ctx: PointKeyQuotaCtx): Promise<void> {
  await ctx.fillTo(1000);
  const sessionId = await ctx.seed("ADMIN", 201);
  const result = await ctx.commitSvc.commit(ctx.globalAdmin, sessionId);
  ctx.committed.push(result);
  const rows = await rowsOfTag(ctx, "ADMIN");
  expect({
    rows: rows.length,
    stamped: rows.every((row) => row.created_by_organization_id === ctx.organizationId),
  }).toEqual({ rows: 201, stamped: true });
}

/**
 * Q-I6 — at 999, two concurrent commits of one new key each: the advisory lock
 * makes the second count the first's row, so exactly one commits.
 *
 * The overlap is forced, not hoped for: a held session lock on the same key
 * stops both commits at their `pg_advisory_xact_lock`, the test waits until
 * `pg_locks` shows both waiting, then releases. With the lock removed nobody
 * waits; with it moved below the count both have counted 999 before it — either
 * way both commit and the expectation goes red.
 */
export async function assertTwoConcurrentCommitsCannotBothPassTheLimit(ctx: PointKeyQuotaCtx): Promise<void> {
  await ctx.fillTo(999);
  const [first, second] = await Promise.all([ctx.seed("RACEA", 1), ctx.seed("RACEB", 1)]);
  const key = `bms.point_keys.quota:${ctx.organizationId}`;
  const holder = await ctx.ownerPool.connect();
  let waiting = 0;
  let pending: Promise<PromiseSettledResult<OnboardingCommitResponseDto>[]> | undefined;
  try {
    await holder.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
    pending = Promise.allSettled([ctx.commitSvc.commit(ctx.orgAdmin, first), ctx.commitSvc.commit(ctx.orgAdmin, second)]);
    for (let i = 0; i < 200 && waiting < 2; i++) {
      const { rows } = await ctx.ownerPool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = hashtext($1)::oid",
        [key],
      );
      waiting = rows[0]?.n ?? 0;
      if (waiting < 2) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  } finally {
    await holder.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
    holder.release();
  }
  const outcomes = await (pending ?? Promise.resolve([]));
  for (const outcome of outcomes) {
    if (outcome.status === "fulfilled") {
      ctx.committed.push(outcome.value);
    }
  }
  const refusals = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected").map((o) => String(o.reason));
  expect({
    waiting,
    fulfilled: outcomes.filter((o) => o.status === "fulfilled").length,
    refusedByQuota: refusals.filter((r) => r.includes("past the 1000")).length,
  }).toEqual({ waiting: 2, fulfilled: 1, refusedByQuota: 1 });
}
