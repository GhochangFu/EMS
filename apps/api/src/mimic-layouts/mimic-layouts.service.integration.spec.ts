import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import type { JwtPayload, MimicLayoutDto } from "@bms/shared";

import { MIMIC_LAYOUT_IN_USE_MESSAGE, MIMIC_LAYOUT_STALE_MESSAGE } from "./mimic-layouts.schema";
import type { CreateMimicLayoutBody, PutMimicLayoutBody } from "./mimic-layouts.schema";
import type { MimicLayoutsService } from "./mimic-layouts.service";

/**
 * `F3.32c` U2 — what `MimicLayoutsService` does against a real database and
 * real row security (plan U2, C1–C11). Assertions live here;
 * `mimic-layouts.service.integration.test.ts` is the Vitest entry point
 * (ADR 0014) and owns the pools, the fixtures and the cleanup.
 *
 * The service is constructed directly, never through a Nest module (§4.6,
 * `F4.20`: esbuild emits no `design:paramtypes`).
 */

export type Ctx = {
  service: MimicLayoutsService;
  /** Superuser pool: reads the rows behind the service's back, and plants fixtures. */
  ownerPool: pg.Pool;
  eskomOrgId: string;
  phewbOrgId: string;
  globalAdmin: JwtPayload;
  /** `phe-admin@bms.local` — organization admin of PHEWB only. */
  phewbOrgAdmin: JwtPayload;
  /** `wc-admin@bms.local` — location admin inside ESKOM. */
  eskomLocationAdmin: JwtPayload;
  slug: (suffix: string) => string;
  /** Records a layout id for the entry point's cleanup. */
  track: (id: string) => void;
  /** Plants a committed ESKOM dashboard with one layout-arm mimic widget; returns the dashboard id. */
  plantReferencingWidget: (layoutId: string) => Promise<string>;
};

/** Nodes deliberately listed out of display order, so C1 proves the service orders them. */
export const layoutBody = (organizationId: string, slug: string): CreateMimicLayoutBody => ({
  organizationId,
  name: `F3.32c ${slug}`,
  slug,
  canvasW: 120,
  canvasH: 80,
  nodes: [
    { key: "outlet", kind: "unit", symbol: "discharge", label: "Outlet", x: 60, y: 10, w: 10, h: 10 },
    { key: "zone", kind: "panel", label: "Zone", tone: "info", x: 0, y: 0, w: 100, h: 40, z: 0 },
    { key: "pump", kind: "unit", symbol: "pump", label: "Pump", roleCode: "pump", x: 30, y: 10, w: 10, h: 10, z: 1 },
    { key: "intake", kind: "unit", symbol: "tank", label: "Intake", roleCode: "pump", x: 0, y: 10, w: 10, h: 10, z: 1 },
    { key: "title", kind: "label", label: "Plant", x: 0, y: 50, w: 20, h: 5, z: 1 },
  ],
  pipes: [
    { fromKey: "pump", toKey: "outlet" },
    { fromKey: "intake", toKey: "pump" },
  ],
});

const putBody = (body: CreateMimicLayoutBody, version: number): PutMimicLayoutBody => {
  const { organizationId: _org, ...rest } = body;
  return { ...rest, version };
};

const nodeIds = async (ctx: Ctx, layoutId: string): Promise<string[]> =>
  (
    await ctx.ownerPool.query<{ id: string }>(
      `SELECT id FROM bms.mimic_layout_nodes WHERE layout_id = $1 ORDER BY id`,
      [layoutId],
    )
  ).rows.map((r) => r.id);

const childCounts = async (ctx: Ctx, layoutId: string): Promise<[number, number]> => {
  const n = await ctx.ownerPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bms.mimic_layout_nodes WHERE layout_id = $1`,
    [layoutId],
  );
  const p = await ctx.ownerPool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM bms.mimic_layout_pipes WHERE layout_id = $1`,
    [layoutId],
  );
  return [n.rows[0]?.n ?? -1, p.rows[0]?.n ?? -1];
};

const create = async (ctx: Ctx, suffix: string, org = ctx.eskomOrgId): Promise<MimicLayoutDto> => {
  const dto = await ctx.service.create(ctx.globalAdmin, layoutBody(org, ctx.slug(suffix)));
  ctx.track(dto.id);
  return dto;
};

const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to be refused, and it succeeded");
};

/** C1 — a create answers the layout with nodes by (z, y, x, key) and pipes by (fromKey, toKey), and audits. */
export async function assertCreateAnswersOrderedNodesAndPipes(ctx: Ctx): Promise<void> {
  const dto = await create(ctx, "c1");
  expect(dto.version).toBe(1);
  expect(dto.organizationId).toBe(ctx.eskomOrgId);
  expect(dto.nodes.map((n) => n.key)).toEqual(["zone", "outlet", "intake", "pump", "title"]);
  expect(dto.nodes.find((n) => n.key === "outlet")).toMatchObject({ roleCode: null, symbol: "discharge", tone: null, z: 0 });
  expect(dto.nodes.find((n) => n.key === "zone")).toMatchObject({ kind: "panel", symbol: null, tone: "info" });
  expect(dto.pipes).toEqual([
    { fromKey: "intake", toKey: "pump" },
    { fromKey: "pump", toKey: "outlet" },
  ]);
  const audit = await ctx.ownerPool.query(
    `SELECT action, organization_id FROM bms.audit_log WHERE entity_id = $1`,
    [dto.id],
  );
  expect(audit.rows).toEqual([{ action: "master.mimic_layout.create", organization_id: ctx.eskomOrgId }]);
}

/** C2 — a second layout with the same slug in the organization is a 409. */
export async function assertDuplicateSlugIs409(ctx: Ctx): Promise<void> {
  const first = await create(ctx, "c2");
  const err = await rejection(ctx.service.create(ctx.globalAdmin, layoutBody(ctx.eskomOrgId, first.slug)));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toContain("already exists");
}

/** C3 — a PUT at a stale version is a 409 with the stale message, and changes nothing. */
export async function assertStaleVersionIs409AndChangesNothing(ctx: Ctx): Promise<void> {
  const dto = await create(ctx, "c3");
  const body = layoutBody(ctx.eskomOrgId, dto.slug);
  const saved = await ctx.service.replace(ctx.globalAdmin, dto.id, putBody(body, 1));
  expect(saved.version).toBe(2);
  const before = await nodeIds(ctx, dto.id);

  const stale = { ...putBody(body, 1), name: "F3.32c stale edit", nodes: body.nodes.slice(0, 2), pipes: [] };
  const err = await rejection(ctx.service.replace(ctx.globalAdmin, dto.id, stale));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(MIMIC_LAYOUT_STALE_MESSAGE);

  const after = await ctx.service.get(ctx.globalAdmin, dto.id);
  expect(after.version).toBe(2);
  expect(after.name).toBe(saved.name);
  expect(await nodeIds(ctx, dto.id)).toEqual(before);
}

/** C4 — a replace regenerates every node id, and the pipes follow the keys. */
export async function assertReplaceRegeneratesIdsAndPipesFollowKeys(ctx: Ctx): Promise<void> {
  const dto = await create(ctx, "c4");
  const before = await nodeIds(ctx, dto.id);
  const body = layoutBody(ctx.eskomOrgId, dto.slug);
  // Move the pump and reverse one pipe: the keys carry the edit, not the ids.
  const nodes = body.nodes.map((n) => (n.key === "pump" ? { ...n, x: 50 } : n));
  const pipes = [
    { fromKey: "intake", toKey: "pump" },
    { fromKey: "outlet", toKey: "pump" },
  ];
  const saved = await ctx.service.replace(ctx.globalAdmin, dto.id, { ...putBody(body, 1), nodes, pipes });

  const after = await nodeIds(ctx, dto.id);
  expect(after).toHaveLength(before.length);
  expect(after.filter((id) => before.includes(id))).toEqual([]);
  expect(saved.nodes.find((n) => n.key === "pump")?.x).toBe(50);
  expect(saved.pipes).toEqual([
    { fromKey: "intake", toKey: "pump" },
    { fromKey: "outlet", toKey: "pump" },
  ]);
  expect(await childCounts(ctx, dto.id)).toEqual([5, 2]);
}

/** C5 — a DELETE while a dashboard widget names the layout is a 409, and the layout stays. */
export async function assertDeleteOfReferencedLayoutIs409(ctx: Ctx): Promise<void> {
  const dto = await create(ctx, "c5");
  await ctx.plantReferencingWidget(dto.id);
  const err = await rejection(ctx.service.remove(ctx.globalAdmin, dto.id));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(MIMIC_LAYOUT_IN_USE_MESSAGE(1));
  expect(await childCounts(ctx, dto.id)).toEqual([5, 2]);
}

/** C6 — a DELETE of an unreferenced layout answers `{ id, deleted: true }` and cascades. */
export async function assertDeleteOfUnreferencedLayoutCascades(ctx: Ctx): Promise<void> {
  const dto = await create(ctx, "c6");
  expect(await childCounts(ctx, dto.id)).toEqual([5, 2]);
  expect(await ctx.service.remove(ctx.globalAdmin, dto.id)).toEqual({ id: dto.id, deleted: true });
  expect(await childCounts(ctx, dto.id)).toEqual([0, 0]);
  const gone = await ctx.ownerPool.query(`SELECT 1 FROM bms.mimic_layouts WHERE id = $1`, [dto.id]);
  expect(gone.rows).toEqual([]);
}

/** C7 — a PHEWB organization admin opening an ESKOM layout gets a 404. */
export async function assertCrossOrganizationGetIs404(ctx: Ctx): Promise<void> {
  const dto = await create(ctx, "c7");
  // Positive control: the global admin reads it.
  expect((await ctx.service.get(ctx.globalAdmin, dto.id)).id).toBe(dto.id);
  const err = await rejection(ctx.service.get(ctx.phewbOrgAdmin, dto.id));
  expect(err).toBeInstanceOf(NotFoundException);
}

/** C8 — a location admin cannot create a layout, even in its own organization. */
export async function assertLocationAdminCreateIs403(ctx: Ctx): Promise<void> {
  const body = layoutBody(ctx.eskomOrgId, ctx.slug("c8"));
  const err = await rejection(ctx.service.create(ctx.eskomLocationAdmin, body));
  expect(err).toBeInstanceOf(ForbiddenException);
  const none = await ctx.ownerPool.query(`SELECT id FROM bms.mimic_layouts WHERE slug = $1`, [body.slug]);
  for (const row of none.rows) ctx.track(row.id as string);
  expect(none.rows).toEqual([]);
}

/** C9 — an organization admin of PHEWB cannot create in ESKOM (and can in PHEWB). */
export async function assertOrgAdminCreatingInAnotherOrganizationIs403(ctx: Ctx): Promise<void> {
  const own = await ctx.service.create(ctx.phewbOrgAdmin, layoutBody(ctx.phewbOrgId, ctx.slug("c9-own")));
  ctx.track(own.id);
  expect(own.organizationId).toBe(ctx.phewbOrgId);
  const err = await rejection(ctx.service.create(ctx.phewbOrgAdmin, layoutBody(ctx.eskomOrgId, ctx.slug("c9"))));
  expect(err).toBeInstanceOf(ForbiddenException);
}

/** C10 — a PHEWB organization admin's list holds its own layouts and no ESKOM one. */
export async function assertListExcludesAnotherOrganization(ctx: Ctx): Promise<void> {
  const eskom = await create(ctx, "c10-eskom");
  const phewb = await create(ctx, "c10-phewb", ctx.phewbOrgId);
  const { items } = await ctx.service.list(ctx.phewbOrgAdmin);
  const ids = items.map((i) => i.id);
  expect(ids).toContain(phewb.id);
  expect(ids).not.toContain(eskom.id);
  expect(items.every((i) => i.organizationId === ctx.phewbOrgId)).toBe(true);
  expect(items.find((i) => i.id === phewb.id)?.unitCount).toBe(3);
}

/** C11 — an unknown role code is a 400 that does not echo the code, and writes nothing. */
export async function assertUnknownRoleIs400WithoutTheCode(ctx: Ctx): Promise<void> {
  const body = layoutBody(ctx.eskomOrgId, ctx.slug("c11"));
  const code = `f332c-no-such-role-${ctx.slug("x").slice(-8)}`;
  body.nodes = body.nodes.map((n) => (n.key === "pump" ? { ...n, roleCode: code } : n));
  const err = await rejection(ctx.service.create(ctx.globalAdmin, body));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("Unknown asset role code");
  expect(JSON.stringify((err as BadRequestException).getResponse())).not.toContain(code);
  const none = await ctx.ownerPool.query(`SELECT id FROM bms.mimic_layouts WHERE slug = $1`, [body.slug]);
  expect(none.rows).toEqual([]);
}
