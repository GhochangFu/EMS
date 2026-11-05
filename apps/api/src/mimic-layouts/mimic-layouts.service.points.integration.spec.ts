import { BadRequestException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { mimicLayoutDtoSchema } from "@bms/shared";
import type { CreateMimicLayoutBody, JwtPayload, MimicLayoutDto, PutMimicLayoutBody } from "@bms/shared";

import { MimicLayoutsService, UNKNOWN_POINT_KEY_MESSAGE } from "./mimic-layouts.service";

/**
 * `F4.307` T4 (ADR 0081 Amendment 1, plan C7) — a roled unit's ordered point list on
 * `MimicLayoutsService`'s write and read paths, against a real database and real row security.
 * Assertions live here; `mimic-layouts.service.points.integration.test.ts` is the Vitest entry
 * point (ADR 0014) and owns the pools, the fixtures (three planted point keys) and the cleanup.
 * The `mimic-layouts.service.flags.integration.*` split, so neither file nears the line cap.
 */

export type PointsCtx = {
  service: MimicLayoutsService;
  /** Superuser pool: reads the rows behind the service's back. */
  ownerPool: pg.Pool;
  eskomOrgId: string;
  globalAdmin: JwtPayload;
  /** Three active `bms.point_keys` codes this run planted, in creation order. */
  keys: readonly [string, string, string];
  /** Plants one more active point key for this run and returns its code. */
  plantPointKey: (suffix: string) => Promise<string>;
  slug: (suffix: string) => string;
  /** Records a layout id for the entry point's cleanup. */
  track: (id: string) => void;
};

/** A roled pump that lists `pointKeys`, a second roled unit, a passive outlet, a panel; two pipes. */
const pointsBody = (ctx: PointsCtx, slug: string, pointKeys?: string[]): CreateMimicLayoutBody => ({
  organizationId: ctx.eskomOrgId,
  name: `F4.307 ${slug}`,
  slug,
  canvasW: 120,
  canvasH: 80,
  symbolLibraries: ["core"],
  nodes: [
    {
      key: "pump",
      kind: "unit",
      symbol: "pump",
      label: "Pump",
      roleCode: "pump",
      x: 0,
      y: 10,
      w: 10,
      h: 10,
      ...(pointKeys !== undefined ? { pointKeys } : {}),
    },
    { key: "tank", kind: "unit", symbol: "tank", label: "Tank", roleCode: "pump", x: 30, y: 10, w: 10, h: 10 },
    { key: "outlet", kind: "unit", symbol: "discharge", label: "Outlet", x: 60, y: 10, w: 10, h: 10 },
    { key: "zone", kind: "panel", label: "Zone", tone: "info", x: 0, y: 0, w: 100, h: 40 },
  ],
  pipes: [
    { fromKey: "pump", toKey: "tank" },
    { fromKey: "tank", toKey: "outlet" },
  ],
});

const putOf = (body: CreateMimicLayoutBody, version: number): PutMimicLayoutBody => {
  const { organizationId: _org, ...rest } = body;
  return { ...rest, version };
};

const create = async (ctx: PointsCtx, suffix: string, pointKeys?: string[]): Promise<MimicLayoutDto> => {
  const dto = await ctx.service.create(ctx.globalAdmin, pointsBody(ctx, ctx.slug(suffix), pointKeys));
  ctx.track(dto.id);
  return dto;
};

const listOf = (dto: MimicLayoutDto, key: string): string[] | undefined => dto.nodes.find((n) => n.key === key)?.pointKeys;

/** The stored rows of one node, read behind the service's back, by `ord`. */
const storedList = async (ctx: PointsCtx, layoutId: string, key: string): Promise<unknown[]> =>
  (
    await ctx.ownerPool.query<{ point_key: string; ord: number }>(
      `SELECT np.point_key, np.ord, np.organization_id
         FROM bms.mimic_layout_node_points np
         JOIN bms.mimic_layout_nodes n ON n.id = np.node_id
        WHERE n.layout_id = $1 AND n.key = $2
        ORDER BY np.ord`,
      [layoutId, key],
    )
  ).rows;

const setPointKeyActive = async (ctx: PointsCtx, code: string, active: boolean): Promise<void> => {
  await ctx.ownerPool.query(`UPDATE bms.point_keys SET active = $2 WHERE code = $1`, [code, active]);
};

const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to be refused, and it succeeded");
};

const expectUnknownPointKey = (err: unknown, code: string): void => {
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe(UNKNOWN_POINT_KEY_MESSAGE);
  expect(JSON.stringify((err as BadRequestException).getResponse())).not.toContain(code);
};

/** PT1 — a create stores the list in its order, answers it, and a `GET` reads it back; every other node reads `[]`. */
export async function assertTheListOrderRoundTrips(ctx: PointsCtx): Promise<void> {
  const [a, b, c] = ctx.keys;
  const dto = await create(ctx, "pt1", [c, a, b]);
  expect(listOf(dto, "pump")).toEqual([c, a, b]);
  const read = mimicLayoutDtoSchema.parse(await ctx.service.get(ctx.globalAdmin, dto.id));
  expect(listOf(read, "pump")).toEqual([c, a, b]);
  for (const key of ["tank", "outlet", "zone"]) expect(listOf(read, key), key).toEqual([]);
  expect(await storedList(ctx, dto.id, "pump")).toEqual([
    { point_key: c, ord: 0, organization_id: ctx.eskomOrgId },
    { point_key: a, ord: 1, organization_id: ctx.eskomOrgId },
    { point_key: b, ord: 2, organization_id: ctx.eskomOrgId },
  ]);
  // A PUT reorders: the read is the PUT's, not the create's.
  const saved = await ctx.service.replace(ctx.globalAdmin, dto.id, putOf(pointsBody(ctx, dto.slug, [b, c]), 1));
  expect(listOf(saved, "pump")).toEqual([b, c]);
  expect(listOf(await ctx.service.get(ctx.globalAdmin, dto.id), "pump")).toEqual([b, c]);
}

/** PT2 — the replace-all rule: a PUT whose unit omits `pointKeys` clears the stored list. */
export async function assertAPutOmittingTheListClearsIt(ctx: PointsCtx): Promise<void> {
  const [a, b] = ctx.keys;
  const dto = await create(ctx, "pt2", [a, b]);
  // Positive control: the rows exist before the PUT.
  expect(await storedList(ctx, dto.id, "pump")).toHaveLength(2);
  const saved = await ctx.service.replace(ctx.globalAdmin, dto.id, putOf(pointsBody(ctx, dto.slug), 1));
  expect(listOf(saved, "pump")).toEqual([]);
  expect(await storedList(ctx, dto.id, "pump")).toEqual([]);
}

/** PT3 — an unknown code is a 400 that does not echo it, and a create writes nothing. */
export async function assertAnUnknownCodeIs400AndWritesNothing(ctx: PointsCtx): Promise<void> {
  const code = `f4307_no_such_key_${ctx.slug("x").slice(-8)}`;
  const body = pointsBody(ctx, ctx.slug("pt3"), [ctx.keys[0], code]);
  expectUnknownPointKey(await rejection(ctx.service.create(ctx.globalAdmin, body)), code);
  const none = await ctx.ownerPool.query<{ id: string }>(`SELECT id FROM bms.mimic_layouts WHERE slug = $1`, [body.slug]);
  for (const row of none.rows) ctx.track(row.id);
  expect(none.rows).toEqual([]);
  // The same refusal on a PUT changes nothing.
  const dto = await create(ctx, "pt3b", [ctx.keys[0]]);
  const err = await rejection(ctx.service.replace(ctx.globalAdmin, dto.id, putOf(pointsBody(ctx, dto.slug, [code]), 1)));
  expectUnknownPointKey(err, code);
  const after = await ctx.service.get(ctx.globalAdmin, dto.id);
  expect(after.version).toBe(1);
  expect(listOf(after, "pump")).toEqual([ctx.keys[0]]);
}

/**
 * PT4 — a retired code the stored layout already lists re-saves (the retired-code rule), and a
 * create or a replace that adds it to a layout that does not list it is the same 400 as unknown.
 */
export async function assertARetiredListedCodeReSavesButCannotBeAdded(ctx: PointsCtx): Promise<void> {
  const retired = await ctx.plantPointKey("pt4");
  const dto = await create(ctx, "pt4", [retired, ctx.keys[0]]);
  await setPointKeyActive(ctx, retired, false);
  const saved = await ctx.service.replace(ctx.globalAdmin, dto.id, {
    ...putOf(pointsBody(ctx, dto.slug, [ctx.keys[0], retired]), 1),
    name: "F4.307 pt4 re-save",
  });
  expect(saved.version).toBe(2);
  expect(listOf(saved, "pump")).toEqual([ctx.keys[0], retired]);
  // Kept per layout, not per unit: the same layout may move it to another of its units.
  const moved = pointsBody(ctx, dto.slug, [ctx.keys[0]]);
  moved.nodes = moved.nodes.map((n) => (n.key === "tank" ? { ...n, pointKeys: [retired] } : n));
  expect(listOf(await ctx.service.replace(ctx.globalAdmin, dto.id, putOf(moved, 2)), "tank")).toEqual([retired]);
  // Another layout cannot add it.
  expectUnknownPointKey(await rejection(ctx.service.create(ctx.globalAdmin, pointsBody(ctx, ctx.slug("pt4b"), [retired]))), retired);
  const other = await create(ctx, "pt4c");
  expectUnknownPointKey(
    await rejection(ctx.service.replace(ctx.globalAdmin, other.id, putOf(pointsBody(ctx, other.slug, [retired]), 1))),
    retired,
  );
  expect((await ctx.service.get(ctx.globalAdmin, other.id)).version).toBe(1);
}

/** PT5 — `validateProposal`: a replace's baseline carries the stored list; a create with an unknown code is the save's 400. */
export async function assertAProposalCarriesAndChecksTheList(ctx: PointsCtx): Promise<void> {
  const [a, b] = ctx.keys;
  const dto = await create(ctx, "pt5", [b, a]);
  const checked = await ctx.service.validateProposal(ctx.globalAdmin, {
    kind: "replace",
    id: dto.id,
    body: putOf(pointsBody(ctx, dto.slug, [a]), 1),
  });
  expect(checked.baseline?.nodes.find((n) => n.key === "pump")?.pointKeys).toEqual([b, a]);
  expect(checked.baseline).toEqual({ version: 1, nodes: dto.nodes, pipes: dto.pipes });
  const code = `f4307_no_such_key_${ctx.slug("y").slice(-8)}`;
  const body = pointsBody(ctx, ctx.slug("pt5b"), [code]);
  expectUnknownPointKey(await rejection(ctx.service.validateProposal(ctx.globalAdmin, { kind: "create", body })), code);
}

/** PT6 — the audit payload counts the units that list points (a count, never the codes). */
export async function assertTheAuditCountsListedUnits(ctx: PointsCtx): Promise<void> {
  const dto = await create(ctx, "pt6", [ctx.keys[0]]);
  const listed = pointsBody(ctx, dto.slug, [ctx.keys[1]]);
  listed.nodes = listed.nodes.map((n) => (n.key === "tank" ? { ...n, pointKeys: [ctx.keys[2]] } : n));
  await ctx.service.replace(ctx.globalAdmin, dto.id, putOf(listed, 1));
  const audit = await ctx.ownerPool.query<{ action: string; payload: Record<string, unknown> }>(
    `SELECT action, payload FROM bms.audit_log WHERE entity_id = $1 ORDER BY created_at, id`,
    [dto.id],
  );
  expect(audit.rows.map((r) => [r.action, r.payload.listedUnits])).toEqual([
    ["master.mimic_layout.create", 1],
    ["master.mimic_layout.replace", 2],
  ]);
  expect(JSON.stringify(audit.rows)).not.toContain(ctx.keys[2]);
}

/**
 * PT7 — the database backstop: a body that skipped the parse with an unknown code still reaches
 * `translateWriteError` as the point-key FK and answers the same 400 (the FK name the migration's
 * proof asserts).
 */
export function assertThePointKeyFkTranslatesTo400(): void {
  const translated = MimicLayoutsService.translateWriteError(
    { constraint: "mimic_layout_node_points_point_key_fkey" },
    "slug",
  );
  expect(translated).toBeInstanceOf(BadRequestException);
  expect((translated as Error).message).toBe(UNKNOWN_POINT_KEY_MESSAGE);
}
