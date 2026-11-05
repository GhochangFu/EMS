import { randomUUID } from "node:crypto";

import type pg from "pg";
import { expect } from "vitest";

import { POINT_KEY_STATE_SEED } from "@bms/db";
import type { JwtPayload } from "@bms/shared";
import { catalogEntry } from "@bms/shared/copilot";

import type { ResolvedIdentity } from "../auth/identity-resolver";
import type { CopilotReadTools, CopilotToolContext } from "./copilot-read-tools";
import type { CopilotTargetResolver } from "./copilot-target-resolver";
import { COPILOT_POINT_KEY_STATES_ROLE_REFUSAL } from "./tools/list-point-key-states.tool";

/**
 * `F4.309` PR 3 (ADR 0099 Amendment 13 decisions 1, 3 and 4, rulings Q1 and Q2; plan T14, T15)
 * — the `pointKeyState` target and `list_point_key_states` on a real database: the resolver reads
 * the row on `bms_tenant` (which keeps `SELECT` on the table, migration `0097`) behind the real
 * `AccessControlService` gate on `bms_auth`, and the read tool lists through the real
 * `PointKeyStatesAdminService` on `bms_fleet`. Needs **Postgres** (CI runs it).
 *
 * Mutation, applied once and seen red: drop `seededPointKeyStateRefusal` from the resolver's fleet
 * branch — {@link aSeededRowIsRefusedWithItsSentence} reddens.
 * Vitest entry point and the fixture lifecycle: the sibling `.test.ts` (ADR 0014).
 */
export type PointKeyStateTargetsCtx = {
  resolver: CopilotTargetResolver;
  tools: CopilotReadTools;
  observer: pg.Pool;
  /** The conversation's bound organization (any seeded one). */
  organizationId: string;
  /** The per-run point key, and the committed admin row on it (`value` 3, label `F4309T`). */
  pointKey: string;
  rowId: string;
  admin: JwtPayload;
  organizationAdmin: JwtPayload;
};

const update = () => catalogEntry("pointKeyState.update")!;
const create = () => catalogEntry("pointKeyState.create")!;

function toolCtx(ctx: PointKeyStateTargetsCtx, user: JwtPayload, role: string): CopilotToolContext {
  return {
    identity: { id: user.sub, role, organizationId: role === "admin" ? null : ctx.organizationId } as ResolvedIdentity,
    user,
    conversationId: randomUUID(),
    conversationOrganizationId: ctx.organizationId,
    allowedOrganizationIds: [ctx.organizationId],
    turnKind: "user",
    now: new Date(),
  };
}

/** The id of the seeded `(breaker_main, 1)` row, read as the observer. */
async function seededRowId(observer: pg.Pool): Promise<string> {
  const { rows } = await observer.query<{ id: string }>(
    "SELECT id FROM bms.point_key_states WHERE point_key_code = 'breaker_main' AND value = 1",
  );
  if (!rows[0]) throw new Error("F4.309: the seeded (breaker_main, 1) row is missing — run pnpm db:seed.");
  return rows[0].id;
}

/** Decision 1: the global admin resolves the admin row, in the bound organization, named "`<key>` = `<value>` (`<label>`)". */
export async function theAdminRowResolvesByItsName(ctx: PointKeyStateTargetsCtx): Promise<void> {
  const resolved = await ctx.resolver.resolve(update(), { id: ctx.rowId }, { label: "X" }, [ctx.organizationId], ctx.admin, ctx.organizationId);
  expect([resolved?.organizationId, resolved?.targetName]).toEqual([ctx.organizationId, `${ctx.pointKey} = 3 (F4309T)`]);
}

/** The gate is the global admin's: an `organization_admin` is refused the admin row and the seeded one alike. */
export async function anOrganizationAdminIsRefused(ctx: PointKeyStateTargetsCtx): Promise<void> {
  const allowed = [ctx.organizationId];
  expect(await ctx.resolver.resolve(update(), { id: ctx.rowId }, {}, allowed, ctx.organizationAdmin, ctx.organizationId)).toBeNull();
  const seeded = await seededRowId(ctx.observer);
  expect(await ctx.resolver.resolve(update(), { id: seeded }, {}, allowed, ctx.organizationAdmin, ctx.organizationId)).toBeNull();
}

/** An id no row has is refused. */
export async function anUnknownIdIsRefused(ctx: PointKeyStateTargetsCtx): Promise<void> {
  const out = await ctx.resolver.resolve(update(), { id: randomUUID() }, {}, [ctx.organizationId], ctx.admin, ctx.organizationId);
  expect(out).toBeNull();
}

/** Ruling Q2: the seeded row is refused at propose with its sentence. */
export async function aSeededRowIsRefusedWithItsSentence(ctx: PointKeyStateTargetsCtx): Promise<void> {
  const seeded = await seededRowId(ctx.observer);
  await expect(
    ctx.resolver.resolve(update(), { id: seeded }, { label: "X" }, [ctx.organizationId], ctx.admin, ctx.organizationId),
  ).rejects.toThrow("The state label breaker_main = 1 is seeded and read-only");
}

/** Ruling Q2: a create of a seeded pair is refused at propose; a free pair on the run's key resolves. */
export async function aSeededPairCreateIsRefused(ctx: PointKeyStateTargetsCtx): Promise<void> {
  const allowed = [ctx.organizationId];
  const body = { pointKey: "breaker_main", value: 1, label: "SHUT", tone: "open" };
  await expect(ctx.resolver.resolve(create(), {}, body, allowed, ctx.admin, ctx.organizationId)).rejects.toThrow("seeded and read-only");
  const free = { pointKey: ctx.pointKey, value: 4, label: "FREE", tone: "open" };
  expect((await ctx.resolver.resolve(create(), {}, free, allowed, ctx.admin, ctx.organizationId))?.organizationId).toBe(ctx.organizationId);
}

/** Decision 3: the read tool lists every seeded row as seeded and the admin row as not, by key then value, and writes no audit row. */
export async function theReadToolListsTheRowsAndWritesNoAudit(ctx: PointKeyStateTargetsCtx): Promise<void> {
  const audits = async () =>
    Number(
      // The run's own row only: another suite may audit its own state labels meanwhile.
      (await ctx.observer.query<{ n: string }>("SELECT count(*) AS n FROM bms.audit_log WHERE entity_id = $1", [ctx.rowId])).rows[0]?.n,
    );
  const before = await audits();
  // One call per key (`pointKey`), so rows other suites add can never push a seeded one out of the fitted answer.
  type Item = { id: string; pointKey: string; value: number; seeded: boolean };
  const list = async (pointKey: string): Promise<Item[]> => {
    const out = await ctx.tools.dispatch("list_point_key_states", { pointKey }, toolCtx(ctx, ctx.admin, "admin"));
    if (!out.ok) throw new Error(out.error);
    const items = out.result.items as Item[];
    expect(items.map((item) => item.value), pointKey).toEqual([...items.map((item) => item.value)].sort((a, b) => a - b));
    return items;
  };
  for (const seed of POINT_KEY_STATE_SEED) {
    const items = await list(seed.pointKeyCode);
    expect(items.find((item) => item.value === seed.value)?.seeded, `${seed.pointKeyCode} = ${seed.value}`).toBe(true);
  }
  expect(await list(ctx.pointKey)).toEqual([
    { id: ctx.rowId, pointKey: ctx.pointKey, value: 3, label: "F4309T", tone: "open", seeded: false },
  ]);
  expect(await audits()).toBe(before);
}

/** Ruling Q1: an `organization_admin`'s conversation is refused the list. */
export async function theReadToolRefusesAnOrganizationAdmin(ctx: PointKeyStateTargetsCtx): Promise<void> {
  expect(await ctx.tools.dispatch("list_point_key_states", {}, toolCtx(ctx, ctx.organizationAdmin, "organization_admin"))).toEqual({
    ok: false,
    error: COPILOT_POINT_KEY_STATES_ROLE_REFUSAL,
  });
}
