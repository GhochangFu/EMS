import type { ExecutionContext } from "@nestjs/common";
import type pg from "pg";
import { defer, from, lastValueFrom } from "rxjs";
import { expect, vi } from "vitest";

import { type JwtPayload, MIMIC_LAYOUT_STALE_MESSAGE, type PutMimicLayoutBody } from "@bms/shared";
import { COPILOT_CHANGE_HEADER, hashExcludedKeysFor } from "@bms/shared/copilot";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import type { MimicLayoutsController } from "../mimic-layouts/mimic-layouts.controller";
import type { MimicLayoutsService } from "../mimic-layouts/mimic-layouts.service";
import { bodyHash } from "./body-hash";
import type { CopilotChangeInterceptor } from "./copilot-change.interceptor";
import type { CopilotPendingChangesService, FinishedChange } from "./copilot-pending-changes.service";
import { copilotContext } from "./copilot-request-context";

/**
 * `F3.87` PR 5 (ADR 0099 Amendment 3 A2, owner ruling Q5; critique A5 item 5) — a
 * `mimicLayout.replace` card on a real database, confirmed through the real
 * `CopilotChangeInterceptor` and the real controller: the card stores the
 * baseline its proposal read; when the layout moves on outside the copilot,
 * the Confirm (the body without `baseline`, as the web sends it) answers the
 * route's 409, the row is `failed` with 409, and the follow-up turn reads that
 * result (`finished()`), so it is returned to the model. The positive control
 * applies the card at the live version. A second case leaves `baseline` in
 * the sent body: the strict schema answers 400, so the web's strip is
 * load-bearing. Assertions here; the `.test` sibling owns the database.
 */
export interface LayoutConfirmCtx {
  readonly superPool: pg.Pool;
  readonly service: MimicLayoutsService;
  readonly controller: MimicLayoutsController;
  readonly pending: CopilotPendingChangesService;
  readonly interceptor: CopilotChangeInterceptor;
  /** What each follow-up turn read through `finished()`, in call order. */
  readonly followUps: Array<FinishedChange | null>;
  readonly jwt: JwtPayload;
  readonly identity: ResolvedIdentity;
  readonly organizationId: string;
  /** A conversation of the caller in the organization, one per case. */
  newConversation(): Promise<string>;
  /** A layout created for this run (tracked for cleanup), at version 1. */
  newLayout(suffix: string): Promise<{ id: string; body: PutMimicLayoutBody }>;
}

/** Two units and a pipe on the core library, with no role (the vocabulary is not this suite's subject). */
export function layoutGraph(slug: string): Omit<PutMimicLayoutBody, "version"> {
  return {
    name: `F3.87 layout ${slug}`,
    slug,
    canvasW: 120,
    canvasH: 80,
    nodes: [
      { key: "pump_1", kind: "unit", symbol: "pump", label: "Pump 1", x: 0, y: 0, w: 20, h: 25, z: 10, isSource: true },
      { key: "tank_1", kind: "unit", symbol: "tank", label: "Tank 1", x: 40, y: 0, w: 20, h: 25, z: 10 },
    ],
    pipes: [{ fromKey: "pump_1", toKey: "tank_1" }],
    symbolLibraries: ["core"],
  };
}

/** The card a turn stores for `body`: the propose path's baseline and hash, as `copilot-propose-tools.ts` makes them. */
async function storeCard(ctx: LayoutConfirmCtx, layoutId: string, body: PutMimicLayoutBody): Promise<string> {
  const { baseline } = await ctx.service.validateProposal(ctx.jwt, { kind: "replace", id: layoutId, body });
  const stored = { ...body, baseline } as Record<string, unknown>;
  const change = await ctx.pending.propose(ctx.identity.id, {
    conversationId: await ctx.newConversation(),
    organizationId: ctx.organizationId,
    catalogId: "mimicLayout.replace",
    method: "PUT",
    path: `/api/v1/mimic-layouts/${layoutId}`,
    body: stored,
    bodyHash: bodyHash(stored, hashExcludedKeysFor("mimicLayout.replace")),
    summary: `Replace the layout (version ${body.version}).`,
    risk: "edit",
  });
  if (change === null) throw new Error("F3.87: the card was not stored");
  return change.id;
}

/** The Confirm request through the interceptor and the controller; resolves to the response or the thrown error. */
async function confirm(ctx: LayoutConfirmCtx, changeId: string, layoutId: string, sent: Record<string, unknown>) {
  const path = `/api/v1/mimic-layouts/${layoutId}`;
  const req = {
    method: "PUT",
    path,
    originalUrl: path,
    headers: { [COPILOT_CHANGE_HEADER.toLowerCase()]: changeId, "content-type": "application/json" },
    body: sent,
    user: ctx.jwt,
  };
  const context = {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ctx.controller.replace,
  } as unknown as ExecutionContext;
  const next = { handle: () => defer(() => from(ctx.controller.replace(layoutId, req.body, ctx.jwt))) };
  return copilotContext.run({ change: null }, async () => {
    try {
      return { ok: true as const, value: await lastValueFrom(await ctx.interceptor.intercept(context, next)) };
    } catch (err) {
      return { ok: false as const, error: err as { getStatus?: () => number; message?: string } };
    }
  });
}

async function rowOf(ctx: LayoutConfirmCtx, changeId: string): Promise<{ status: string; result_status: number | null; has_baseline: boolean }> {
  const { rows } = await ctx.superPool.query<{ status: string; result_status: number | null; has_baseline: boolean }>(
    "SELECT status, result_status, body ? 'baseline' AS has_baseline FROM bms.copilot_pending_changes WHERE id = $1",
    [changeId],
  );
  if (!rows[0]) throw new Error(`F3.87: no pending change ${changeId}`);
  return rows[0];
}

const withoutBaseline = (body: PutMimicLayoutBody): Record<string, unknown> => ({ ...body });

/**
 * The layout moved to version 2 outside the copilot after the card was built at version 1: the
 * Confirm answers the route's 409, the row is `failed` with 409 (its stored body still holds the
 * baseline), and the follow-up turn reads that result.
 */
export async function aStaleCardIs409FailedAndReturnedToTheModel(ctx: LayoutConfirmCtx): Promise<void> {
  const { id, body } = await ctx.newLayout("stale");
  const changeId = await storeCard(ctx, id, body);
  expect((await rowOf(ctx, changeId)).has_baseline).toBe(true);
  // The layout moves on outside the copilot (the editor's own save).
  await ctx.service.replace(ctx.jwt, id, { ...body, name: `${body.name} (edited)` });

  const answer = await confirm(ctx, changeId, id, withoutBaseline(body));
  expect(answer.ok).toBe(false);
  expect(answer.ok ? null : { status: answer.error.getStatus?.(), message: answer.error.message }).toEqual({
    status: 409,
    message: MIMIC_LAYOUT_STALE_MESSAGE,
  });
  expect(await rowOf(ctx, changeId)).toEqual({ status: "failed", result_status: 409, has_baseline: true });
  await vi.waitFor(() => expect(ctx.followUps.length).toBeGreaterThan(0));
  expect(ctx.followUps.at(-1)).toMatchObject({ catalogId: "mimicLayout.replace", status: "failed", resultStatus: 409 });
}

/** Positive control: the same card at the live version applies — 200, `applied`, and the layout is at version 2. */
export async function aCardAtTheLiveVersionApplies(ctx: LayoutConfirmCtx): Promise<void> {
  const { id, body } = await ctx.newLayout("live");
  const changeId = await storeCard(ctx, id, body);
  const before = ctx.followUps.length;
  const answer = await confirm(ctx, changeId, id, withoutBaseline(body));
  expect(answer.ok).toBe(true);
  expect(answer.ok ? (answer.value as { id: string; version: number }) : null).toMatchObject({ id, version: 2 });
  expect(await rowOf(ctx, changeId)).toMatchObject({ status: "applied", result_status: 200 });
  await vi.waitFor(() => expect(ctx.followUps.length).toBeGreaterThan(before));
  expect(ctx.followUps.at(-1)).toMatchObject({ status: "applied", resultStatus: 200, resourceId: id });
}

/**
 * A Confirm that leaves `baseline` in the body: the interceptor's hash leaves it out (so it
 * passes), and the route's strict body refuses it — 400, and the row is `failed`.
 */
export async function aConfirmCarryingTheBaselineIs400(ctx: LayoutConfirmCtx): Promise<void> {
  const { id, body } = await ctx.newLayout("carried");
  const changeId = await storeCard(ctx, id, body);
  const { baseline } = await ctx.service.validateProposal(ctx.jwt, { kind: "replace", id, body });
  const answer = await confirm(ctx, changeId, id, { ...body, baseline });
  expect(answer.ok ? null : answer.error.getStatus?.()).toBe(400);
  expect(await rowOf(ctx, changeId)).toMatchObject({ status: "failed", result_status: 400 });
  // The layout is untouched: still at version 1.
  expect((await ctx.service.get(ctx.jwt, id)).version).toBe(1);
}
