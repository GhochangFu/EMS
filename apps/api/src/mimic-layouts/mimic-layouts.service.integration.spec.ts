import { randomUUID } from "node:crypto";

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import type { JwtPayload, MimicLayoutDto } from "@bms/shared";

import { MIMIC_LAYOUT_IN_USE_MESSAGE, MIMIC_LAYOUT_STALE_MESSAGE } from "./mimic-layouts.schema";
import type { CreateMimicLayoutBody, PutMimicLayoutBody } from "./mimic-layouts.schema";
import type { MimicLayoutsController } from "./mimic-layouts.controller";
import type { MimicLayoutsService } from "./mimic-layouts.service";

/**
 * `F3.32c` U2 — what `MimicLayoutsService` does against a real database and
 * real row security (plan U2, C1–C11; C12–C17 from U7; C18–C23 from `F3.32e` U2,
 * the chosen symbol libraries). Assertions live here;
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
  /** Commits a throwaway `bms.asset_roles` row, tracked for cleanup by code; returns the code. */
  plantRole: (suffix: string) => Promise<string>;
  /** The controller over `service`: a raw body goes through the real Zod parse and its 400. */
  controller: MimicLayoutsController;
};

/** Nodes deliberately listed out of display order, so C1 proves the service orders them. */
export const layoutBody = (organizationId: string, slug: string): CreateMimicLayoutBody => ({
  organizationId,
  name: `F3.32c ${slug}`,
  slug,
  canvasW: 120,
  canvasH: 80,
  symbolLibraries: ["core"],
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

/**
 * C12 — a delete waits for a widget save that holds the layout, then counts its widget.
 *
 * The superuser client stands in for `DashboardsService.putWidgets`: it takes the same
 * `FOR KEY SHARE` lock `assertMimicLayoutsInOrganization` takes, and inserts the widget in the
 * same transaction. `remove()` must block on its `FOR UPDATE` until that commits, and then answer
 * 409. With the lock after the count, the count reads zero and the delete removes a named layout.
 */
export async function assertDeleteWaitsForAConcurrentWidgetSave(ctx: Ctx): Promise<void> {
  const dto = await create(ctx, "c12");
  // A dashboard the cleanup tracks; its own widget names another id, so it does not count.
  const dashboardId = await ctx.plantReferencingWidget(randomUUID());
  const client = await ctx.ownerPool.connect();
  let removal: Promise<unknown> | undefined;
  try {
    await client.query("BEGIN");
    const held = await client.query(`SELECT id FROM bms.mimic_layouts WHERE id = $1 FOR KEY SHARE`, [dto.id]);
    expect(held.rows).toHaveLength(1);

    let settled = false;
    removal = ctx.service.remove(ctx.globalAdmin, dto.id).then(
      (value) => {
        settled = true;
        return value;
      },
      (err: unknown) => {
        settled = true;
        return err;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled, "remove() must wait for the save that holds the layout").toBe(false);

    await client.query(
      `INSERT INTO bms.dashboard_widgets
         (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config)
       VALUES ($1, $2, 'mimic', 0, 6, 6, 6, $3::jsonb)`,
      [ctx.eskomOrgId, dashboardId, JSON.stringify({ source: "layout", layoutId: dto.id })],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  const outcome = await removal;
  expect(outcome).toBeInstanceOf(ConflictException);
  expect((outcome as Error).message).toBe(MIMIC_LAYOUT_IN_USE_MESSAGE(1));
  const still = await ctx.ownerPool.query(`SELECT 1 FROM bms.mimic_layouts WHERE id = $1`, [dto.id]);
  expect(still.rows).toHaveLength(1);
}

/**
 * C13 — a DELETE by the uppercase form of a referenced layout's id is a 409, and the layout stays.
 * The path id passes `z.string().uuid()` in either case; the in-use count must match it as the
 * same uuid, not as different text.
 */
export async function assertUppercaseIdDeleteOfReferencedLayoutIs409(ctx: Ctx): Promise<void> {
  const dto = await create(ctx, "c13");
  await ctx.plantReferencingWidget(dto.id);
  const upper = dto.id.toUpperCase();
  expect(upper).not.toBe(dto.id);
  const err = await rejection(ctx.service.remove(ctx.globalAdmin, upper));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(MIMIC_LAYOUT_IN_USE_MESSAGE(1));
  expect(await childCounts(ctx, dto.id)).toEqual([5, 2]);
}

/**
 * C14 — a PUT taking a slug another layout of the organization holds is a 409 with the slug
 * sentence, not the stale one, and the layout keeps its version, name and nodes.
 */
export async function assertReplaceOntoATakenSlugIs409AndChangesNothing(ctx: Ctx): Promise<void> {
  const taken = await create(ctx, "c14-taken");
  const dto = await create(ctx, "c14");
  const before = await nodeIds(ctx, dto.id);
  const body = { ...putBody(layoutBody(ctx.eskomOrgId, dto.slug), 1), slug: taken.slug, name: "F3.32c c14 edit" };
  const err = await rejection(ctx.service.replace(ctx.globalAdmin, dto.id, body));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(`A layout with slug "${taken.slug}" already exists in this organization`);
  expect((err as Error).message).not.toBe(MIMIC_LAYOUT_STALE_MESSAGE);
  const after = await ctx.service.get(ctx.globalAdmin, dto.id);
  expect({ version: after.version, name: after.name, slug: after.slug }).toEqual({
    version: 1,
    name: dto.name,
    slug: dto.slug,
  });
  expect(await nodeIds(ctx, dto.id)).toEqual(before);
}

/** Sets a role's `active` flag behind the service's back. */
const setRoleActive = async (ctx: Ctx, code: string, active: boolean): Promise<void> => {
  await ctx.ownerPool.query(`UPDATE bms.asset_roles SET active = $2 WHERE code = $1`, [code, active]);
};

/** C15 — a create naming a retired role is a 400 that does not echo the code, and writes nothing. */
export async function assertCreateWithARetiredRoleIs400(ctx: Ctx): Promise<void> {
  const code = await ctx.plantRole("c15");
  await setRoleActive(ctx, code, false);
  const body = layoutBody(ctx.eskomOrgId, ctx.slug("c15"));
  body.nodes = body.nodes.map((n) => (n.key === "pump" ? { ...n, roleCode: code } : n));
  const err = await rejection(ctx.service.create(ctx.globalAdmin, body));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("Unknown asset role code");
  expect(JSON.stringify((err as BadRequestException).getResponse())).not.toContain(code);
  const none = await ctx.ownerPool.query(`SELECT id FROM bms.mimic_layouts WHERE slug = $1`, [body.slug]);
  expect(none.rows).toEqual([]);
}

/** C16 — a PUT keeping a role the stored layout already carries saves after that role is retired. */
export async function assertReplaceKeepingAStoredRetiredRoleSaves(ctx: Ctx): Promise<void> {
  const code = await ctx.plantRole("c16");
  const body = layoutBody(ctx.eskomOrgId, ctx.slug("c16"));
  body.nodes = body.nodes.map((n) => (n.key === "pump" ? { ...n, roleCode: code } : n));
  const dto = await ctx.service.create(ctx.globalAdmin, body);
  ctx.track(dto.id);
  await setRoleActive(ctx, code, false);
  const saved = await ctx.service.replace(ctx.globalAdmin, dto.id, { ...putBody(body, 1), name: "F3.32c c16 re-save" });
  expect(saved.version).toBe(2);
  expect(saved.nodes.find((n) => n.key === "pump")?.roleCode).toBe(code);
}

/** C17 — a PUT adding a retired role the stored layout does not carry is a 400, and changes nothing. */
export async function assertReplaceAddingARetiredRoleIs400(ctx: Ctx): Promise<void> {
  const code = await ctx.plantRole("c17");
  await setRoleActive(ctx, code, false);
  const dto = await create(ctx, "c17");
  const body = layoutBody(ctx.eskomOrgId, dto.slug);
  const nodes = body.nodes.map((n) => (n.key === "pump" ? { ...n, roleCode: code } : n));
  const err = await rejection(ctx.service.replace(ctx.globalAdmin, dto.id, { ...putBody(body, 1), nodes }));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("Unknown asset role code");
  expect(JSON.stringify((err as BadRequestException).getResponse())).not.toContain(code);
  expect((await ctx.service.get(ctx.globalAdmin, dto.id)).version).toBe(1);
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

// `F3.32e` U2 — the chosen symbol libraries (ADR 0084 decision 8, plan D7).

/** The stored `symbol_libraries` of a layout, read behind the service's back. */
const storedLibraries = async (ctx: Ctx, layoutId: string): Promise<string[] | undefined> =>
  (
    await ctx.ownerPool.query<{ symbol_libraries: string[] }>(
      `SELECT symbol_libraries FROM bms.mimic_layouts WHERE id = $1`,
      [layoutId],
    )
  ).rows[0]?.symbol_libraries;

/** The fixture body with the pump drawn as an MDI heat pump, and `core` + `mdi` chosen. */
const mdiBody = (organizationId: string, slug: string): CreateMimicLayoutBody => {
  const body = layoutBody(organizationId, slug);
  return {
    ...body,
    symbolLibraries: ["core", "mdi"],
    nodes: body.nodes.map((n) => (n.key === "pump" ? { ...n, symbol: "mdi:heat-pump" } : n)),
  };
};

/** No layout carries `slug`; a row a broken guard wrote is tracked for cleanup first. */
const noLayoutWithSlug = async (ctx: Ctx, slug: string): Promise<void> => {
  const none = await ctx.ownerPool.query<{ id: string }>(`SELECT id FROM bms.mimic_layouts WHERE slug = $1`, [slug]);
  for (const row of none.rows) ctx.track(row.id);
  expect(none.rows).toEqual([]);
};

/** C18 — a create choosing `core` + `mdi` with an MDI unit stores both; the DTO and the list carry them. */
export async function assertCreateStoresTheChosenLibraries(ctx: Ctx): Promise<void> {
  const dto = await ctx.service.create(ctx.globalAdmin, mdiBody(ctx.eskomOrgId, ctx.slug("c18")));
  ctx.track(dto.id);
  expect(dto.symbolLibraries).toEqual(["core", "mdi"]);
  expect(dto.nodes.find((n) => n.key === "pump")?.symbol).toBe("mdi:heat-pump");
  expect(await storedLibraries(ctx, dto.id)).toEqual(["core", "mdi"]);
  const { items } = await ctx.service.list(ctx.globalAdmin);
  expect(items.find((i) => i.id === dto.id)?.symbolLibraries).toEqual(["core", "mdi"]);
}

/** C19 — a POST body without `symbolLibraries` stores `{core}` (ruling R2). */
export async function assertAnAbsentLibraryListStoresCore(ctx: Ctx): Promise<void> {
  const { symbolLibraries: _drop, ...raw } = layoutBody(ctx.eskomOrgId, ctx.slug("c19"));
  const dto = await ctx.controller.create(raw, ctx.globalAdmin);
  ctx.track(dto.id);
  expect(dto.symbolLibraries).toEqual(["core"]);
  expect(await storedLibraries(ctx, dto.id)).toEqual(["core"]);
}

/** C20 — a PUT dropping `mdi` while a unit still draws an MDI glyph is a 400, and changes nothing. */
export async function assertReplaceDroppingAUsedLibraryIs400(ctx: Ctx): Promise<void> {
  const body = mdiBody(ctx.eskomOrgId, ctx.slug("c20"));
  const dto = await ctx.service.create(ctx.globalAdmin, body);
  ctx.track(dto.id);
  const raw = { ...putBody(body, 1), symbolLibraries: ["core"] };
  const err = await rejection(ctx.controller.replace(dto.id, raw, ctx.globalAdmin));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(JSON.stringify((err as BadRequestException).getResponse())).toContain(
    "belongs to the Material Design Icons library, which this layout did not choose",
  );
  expect((await ctx.service.get(ctx.globalAdmin, dto.id)).version).toBe(1);
  expect(await storedLibraries(ctx, dto.id)).toEqual(["core", "mdi"]);
}

/** C21 — a PUT dropping `mdi` together with its unit saves, and the stored row reads `{core}` (R4). */
export async function assertReplaceDroppingAnUnusedLibrarySaves(ctx: Ctx): Promise<void> {
  const body = mdiBody(ctx.eskomOrgId, ctx.slug("c21"));
  const dto = await ctx.service.create(ctx.globalAdmin, body);
  ctx.track(dto.id);
  const nodes = body.nodes.map((n) => (n.key === "pump" ? { ...n, symbol: "pump" as const } : n));
  const saved = await ctx.service.replace(ctx.globalAdmin, dto.id, {
    ...putBody(body, 1),
    nodes,
    symbolLibraries: ["core"],
  });
  expect(saved.version).toBe(2);
  expect(saved.symbolLibraries).toEqual(["core"]);
  expect(await storedLibraries(ctx, dto.id)).toEqual(["core"]);
}

/**
 * C22 — a create choosing a library that is not active is a 400 `"Unknown symbol library"`,
 * and writes nothing. The flag is flipped on `ownerPool` (the `bms_fleet` role, which keeps UPDATE;
 * `bms_tenant` may only read the table) and restored in `finally`; another suite shares the database, so the window is short.
 */
export async function assertAnInactiveLibraryIs400(ctx: Ctx): Promise<void> {
  const body: CreateMimicLayoutBody = {
    ...layoutBody(ctx.eskomOrgId, ctx.slug("c22")),
    symbolLibraries: ["core", "lucide"],
  };
  try {
    await ctx.ownerPool.query(`UPDATE bms.mimic_symbol_libraries SET active = false WHERE code = 'lucide'`);
    const err = await rejection(ctx.service.create(ctx.globalAdmin, body));
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe("Unknown symbol library");
    await noLayoutWithSlug(ctx, body.slug);
  } finally {
    await ctx.ownerPool.query(`UPDATE bms.mimic_symbol_libraries SET active = true WHERE code = 'lucide'`);
  }
}

/**
 * C22b — a PUT choosing a library that is not active is a 400 `"Unknown symbol library"`, and
 * the layout keeps its version and its libraries (the `replace` call of `assertLibrariesLive`).
 */
export async function assertReplaceChoosingAnInactiveLibraryIs400(ctx: Ctx): Promise<void> {
  const body = layoutBody(ctx.eskomOrgId, ctx.slug("c22b"));
  const dto = await ctx.service.create(ctx.globalAdmin, body);
  ctx.track(dto.id);
  try {
    await ctx.ownerPool.query(`UPDATE bms.mimic_symbol_libraries SET active = false WHERE code = 'lucide'`);
    const err = await rejection(
      ctx.service.replace(ctx.globalAdmin, dto.id, { ...putBody(body, 1), symbolLibraries: ["core", "lucide"] }),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe("Unknown symbol library");
  } finally {
    await ctx.ownerPool.query(`UPDATE bms.mimic_symbol_libraries SET active = true WHERE code = 'lucide'`);
  }
  expect((await ctx.service.get(ctx.globalAdmin, dto.id)).version).toBe(1);
  expect(await storedLibraries(ctx, dto.id)).toEqual(["core"]);
}

/**
 * C23 — a unit symbol no `bms.mimic_symbols` row holds is a 400 `"Unknown mimic symbol"` that
 * does not echo the key, and writes nothing. The Zod enum refuses such a key first, so only a
 * cast body reaches the foreign key `mimic_layout_nodes_symbol_fkey`.
 */
export async function assertAnUnknownSymbolIs400WithoutTheKey(ctx: Ctx): Promise<void> {
  const base = layoutBody(ctx.eskomOrgId, ctx.slug("c23"));
  const body = {
    ...base,
    symbolLibraries: ["core", "tabler"],
    nodes: base.nodes.map((n) => (n.key === "outlet" ? { ...n, symbol: "tabler:no-such-icon" } : n)),
  } as unknown as CreateMimicLayoutBody;
  const err = await rejection(ctx.service.create(ctx.globalAdmin, body));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("Unknown mimic symbol");
  expect(JSON.stringify((err as BadRequestException).getResponse())).not.toContain("no-such-icon");
  await noLayoutWithSlug(ctx, base.slug);
}
