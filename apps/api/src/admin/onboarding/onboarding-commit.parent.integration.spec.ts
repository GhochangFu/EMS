import { HttpException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import type { JwtPayload, OnboardingDraft } from "@bms/shared";

import type { TreeFixture } from "../locations/locations.tree.integration.spec";
import type { OnboardingCommitService } from "./onboarding-commit.service";
import type { ParentCandidate } from "./onboarding-location-parent";

/**
 * `F4.243` (ADR 0098 Amendment 2, B3, B9, B10) — the onboarding commit places
 * the new location under the parent the draft names by code, inside its own
 * transaction. Assertions live here (§4.6); the sibling `.test.ts` owns the
 * pools and the two per-run organizations of `locations.tree.integration.spec.ts`.
 *
 * **The commit's validate is given a stale placement on purpose.** The
 * commit runs `validate` before the transaction with the parent candidates
 * `OnboardingInventoryService` read, so a bad parent is normally its field
 * error. The cases below hand the commit an inventory that says every named
 * parent is an active root — the read a concurrent tree write has since made
 * stale — so the refusal they see is the transaction's own (B3). C2 and C2b
 * are the lookup's own not-found. C3 and C4 are `assertParentPlacement`'s, and
 * the `locations_tree_guard` trigger answers the same body behind it.
 */
export type ParentCommitCtx = {
  readonly superPool: pg.Pool;
  readonly fx: TreeFixture;
  /** The commit service with an inventory that answers `candidates`. */
  commitService(candidates: readonly ParentCandidate[]): OnboardingCommitService;
  /** A draft session in the run's organization whose location names `parentCode`. */
  session(tag: string, parentCode: string | null): Promise<{ sessionId: string; draft: OnboardingDraft }>;
};

function fail(message: string): never {
  throw new Error(message);
}

/** The stale read: every code is an active root. */
function staleCandidates(...codes: string[]): ParentCandidate[] {
  return codes.map((code) => ({ code, name: code, active: true, depth: 1 }));
}

async function codeOf(ctx: ParentCommitCtx, id: string): Promise<string> {
  const { rows } = await ctx.superPool.query<{ code: string }>("SELECT code FROM bms.locations WHERE id = $1", [id]);
  return rows[0]?.code ?? fail(`location ${id} has no row`);
}

async function commitAs(ctx: ParentCommitCtx, jwt: JwtPayload, sessionId: string, candidates: string[]) {
  return ctx.commitService(staleCandidates(...candidates)).commit(jwt, sessionId);
}

async function refusalOf(run: () => Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await run();
  } catch (err) {
    if (err instanceof HttpException) {
      return { status: err.getStatus(), body: err.getResponse() };
    }
    throw err;
  }
  return fail("the commit was expected to refuse");
}

async function placedParent(ctx: ParentCommitCtx, locationId: string): Promise<string | null> {
  const { rows } = await ctx.superPool.query<{ parent_id: string | null }>(
    "SELECT parent_id FROM bms.locations WHERE id = $1",
    [locationId],
  );
  return rows[0] === undefined ? fail(`location ${locationId} has no row`) : rows[0].parent_id;
}

async function auditedParent(ctx: ParentCommitCtx, locationId: string): Promise<unknown> {
  const { rows } = await ctx.superPool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM bms.audit_log WHERE action = 'master.location.create' AND entity_id = $1`,
    [locationId],
  );
  expect(rows.length, "one master.location.create row for the committed location").toBe(1);
  return rows[0]?.payload.parentId;
}

/** C1 — a named active parent: the committed location's `parent_id` is that parent. */
export async function assertTheCommitPlacesTheNodeUnderTheParent(ctx: ParentCommitCtx): Promise<void> {
  const parentId = await ctx.fx.node("c1-parent", null);
  const parentCode = await codeOf(ctx, parentId);
  const { sessionId } = await ctx.session("c1", parentCode);
  const committed = await commitAs(ctx, ctx.fx.orgAdmin, sessionId, [parentCode]);
  expect(await placedParent(ctx, committed.locationId)).toBe(parentId);
}

/** C1b (B10) — the onboarding `master.location.create` audit names the parent. */
export async function assertTheCreateAuditCarriesTheParentId(ctx: ParentCommitCtx): Promise<void> {
  const parentId = await ctx.fx.node("c1b-parent", null);
  const parentCode = await codeOf(ctx, parentId);
  const { sessionId } = await ctx.session("c1b", parentCode);
  const committed = await commitAs(ctx, ctx.fx.orgAdmin, sessionId, [parentCode]);
  expect(await auditedParent(ctx, committed.locationId)).toBe(parentId);
}

/** C1c — `null` is a root: the committed location has no parent. */
export async function assertANullParentCommitsARoot(ctx: ParentCommitCtx): Promise<void> {
  const { sessionId } = await ctx.session("c1c", null);
  const committed = await commitAs(ctx, ctx.fx.orgAdmin, sessionId, []);
  expect(await placedParent(ctx, committed.locationId)).toBeNull();
}

/** C1d (B10) — a root's create audit says `parentId: null`, not an absent key. */
export async function assertARootsCreateAuditSaysNull(ctx: ParentCommitCtx): Promise<void> {
  const { sessionId } = await ctx.session("c1d", null);
  const committed = await commitAs(ctx, ctx.fx.orgAdmin, sessionId, []);
  expect(await auditedParent(ctx, committed.locationId)).toBeNull();
}

/** C2 — a code no location of the organization holds: 400 `location_parent_not_found`. */
export async function assertAnUnknownParentIsNotFound(ctx: ParentCommitCtx): Promise<void> {
  const code = `F4243-NOPE-${ctx.fx.run}`;
  const { sessionId } = await ctx.session("c2", code);
  const refused = await refusalOf(() => commitAs(ctx, ctx.fx.orgAdmin, sessionId, [code]));
  expect(refused).toEqual({
    status: 400,
    body: { message: "Parent location not found", reason: "location_parent_not_found" },
  });
}

/**
 * C2b — another organization's code is the same 400: the lookup names the
 * session's organization and runs under its row-level security, so the answer
 * is no existence oracle.
 */
export async function assertAnotherOrganizationsParentIsNotFound(ctx: ParentCommitCtx): Promise<void> {
  const foreignId = await ctx.fx.node("c2b-foreign", null, { organizationId: ctx.fx.otherOrganizationId });
  const foreignCode = await codeOf(ctx, foreignId);
  const { sessionId } = await ctx.session("c2b", foreignCode);
  const refused = await refusalOf(() => commitAs(ctx, ctx.fx.orgAdmin, sessionId, [foreignCode]));
  expect(refused).toEqual({
    status: 400,
    body: { message: "Parent location not found", reason: "location_parent_not_found" },
  });
}

/** C3 — an inactive parent: 409 `location_parent_inactive`. Mutation 3 (`nodeActive: false`) reddens it. */
export async function assertAnInactiveParentIsRefused(ctx: ParentCommitCtx): Promise<void> {
  const parentId = await ctx.fx.node("c3-parent", null, { active: false });
  const parentCode = await codeOf(ctx, parentId);
  const { sessionId } = await ctx.session("c3", parentCode);
  const refused = await refusalOf(() => commitAs(ctx, ctx.fx.orgAdmin, sessionId, [parentCode]));
  expect(refused).toEqual({
    status: 409,
    body: { message: "The parent location is inactive", reason: "location_parent_inactive" },
  });
}

/** C4 — a parent at depth 8: the node would be at 9, 400 `location_depth_exceeded`. */
export async function assertAParentAtTheCapIsRefused(ctx: ParentCommitCtx): Promise<void> {
  let parentId: string | null = null;
  for (let depth = 1; depth <= 8; depth += 1) {
    parentId = await ctx.fx.node(`c4-d${depth}`, parentId);
  }
  const parentCode = await codeOf(ctx, parentId ?? fail("no chain was built"));
  const { sessionId } = await ctx.session("c4", parentCode);
  const refused = await refusalOf(() => commitAs(ctx, ctx.fx.orgAdmin, sessionId, [parentCode]));
  expect(refused).toEqual({
    status: 400,
    body: { message: "A location tree may be at most 8 levels deep", reason: "location_depth_exceeded" },
  });
}

/** C5 — a refused placement writes nothing: no location with the draft's code exists afterwards. */
export async function assertARefusedPlacementWritesNothing(ctx: ParentCommitCtx): Promise<void> {
  const parentId = await ctx.fx.node("c5-parent", null, { active: false });
  const parentCode = await codeOf(ctx, parentId);
  const { sessionId, draft } = await ctx.session("c5", parentCode);
  await refusalOf(() => commitAs(ctx, ctx.fx.orgAdmin, sessionId, [parentCode]));
  const { rows } = await ctx.superPool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM bms.locations WHERE organization_id = $1 AND code = $2",
    [ctx.fx.organizationId, draft.location?.code],
  );
  expect(rows[0]?.n).toBe(0);
}
