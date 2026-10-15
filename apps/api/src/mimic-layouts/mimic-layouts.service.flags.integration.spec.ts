import { BadRequestException, NotFoundException } from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { MIMIC_LAYOUT_FLAGS_MESSAGE, mimicLayoutDtoSchema } from "@bms/shared";
import type { CreateMimicLayoutBody, JwtPayload, MimicLayoutDto, PutMimicLayoutBody } from "@bms/shared";

import { MimicLayoutsService } from "./mimic-layouts.service";

/**
 * `F3.74` Task 1.6 (plan D3b, ADR 0088 Amendment 1 OQ3b) — the unit flags `fanOut` / `isSource`
 * on `MimicLayoutsService`'s write path, against a real database and real row security.
 * Assertions live here; `mimic-layouts.service.flags.integration.test.ts` is the Vitest entry
 * point (ADR 0014) and owns the pools, the fixtures and the cleanup.
 */

export type FlagsCtx = {
  service: MimicLayoutsService;
  /** Superuser pool: reads the rows behind the service's back. */
  ownerPool: pg.Pool;
  /** `bms_tenant` pool: the role every layout write runs as. */
  tenantPool: pg.Pool;
  eskomOrgId: string;
  globalAdmin: JwtPayload;
  /** `phe-admin@bms.local` — organization admin of PHEWB only. */
  phewbOrgAdmin: JwtPayload;
  slug: (suffix: string) => string;
  /** Records a layout id for the entry point's cleanup. */
  track: (id: string) => void;
};

/** A source unit that fans out, a breaker downstream of it, a panel and a label. */
const flagsBody = (organizationId: string, slug: string): CreateMimicLayoutBody => ({
  organizationId,
  name: `F3.74 ${slug}`,
  slug,
  canvasW: 120,
  canvasH: 80,
  symbolLibraries: ["core"],
  nodes: [
    {
      key: "incoming",
      kind: "unit",
      symbol: "transformer",
      label: "Incoming",
      roleCode: "transformer",
      fanOut: true,
      isSource: true,
      x: 0,
      y: 10,
      w: 10,
      h: 10,
    },
    { key: "main", kind: "unit", symbol: "breaker", label: "Main", roleCode: "main-breaker", x: 30, y: 10, w: 10, h: 10 },
    { key: "zone", kind: "panel", label: "Zone", tone: "info", x: 0, y: 0, w: 100, h: 40 },
    { key: "title", kind: "label", label: "LV board", x: 0, y: 50, w: 20, h: 5 },
  ],
  pipes: [{ fromKey: "incoming", toKey: "main" }],
});

const putOf = (body: CreateMimicLayoutBody, version: number): PutMimicLayoutBody => {
  const { organizationId: _org, ...rest } = body;
  return { ...rest, version };
};

const create = async (ctx: FlagsCtx, suffix: string): Promise<MimicLayoutDto> => {
  const dto = await ctx.service.create(ctx.globalAdmin, flagsBody(ctx.eskomOrgId, ctx.slug(suffix)));
  ctx.track(dto.id);
  return dto;
};

type Flags = { fanOut: boolean; isSource: boolean; isSwitching: boolean };

const flagsOf = (dto: MimicLayoutDto, key: string): Flags | undefined => {
  const node = dto.nodes.find((n) => n.key === key);
  return node ? { fanOut: node.fanOut, isSource: node.isSource, isSwitching: node.isSwitching } : undefined;
};

/** The stored columns, read behind the service's back. */
const storedFlags = async (ctx: FlagsCtx, layoutId: string, key: string): Promise<unknown> =>
  (
    await ctx.ownerPool.query(
      `SELECT fan_out, is_source, is_switching FROM bms.mimic_layout_nodes WHERE layout_id = $1 AND key = $2`,
      [layoutId, key],
    )
  ).rows[0];

const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to be refused, and it succeeded");
};

/** FL1 — a PUT carrying a fan-out source unit round-trips both flags on `GET`; every other node reads `false`. */
export async function assertAPutRoundTripsBothFlags(ctx: FlagsCtx): Promise<void> {
  const dto = await create(ctx, "fl1");
  const body = flagsBody(ctx.eskomOrgId, dto.slug);
  // The PUT moves the source to the breaker, so the read can only be the PUT's.
  const nodes = body.nodes.map((n) =>
    n.key === "incoming" ? { ...n, fanOut: undefined, isSource: undefined } : n.key === "main" ? { ...n, fanOut: true, isSource: true } : n,
  );
  await ctx.service.replace(ctx.globalAdmin, dto.id, { ...putOf(body, 1), nodes });

  const read = mimicLayoutDtoSchema.parse(await ctx.service.get(ctx.globalAdmin, dto.id));
  expect(flagsOf(read, "main")).toEqual({ fanOut: true, isSource: true, isSwitching: false });
  expect(flagsOf(read, "incoming")).toEqual({ fanOut: false, isSource: false, isSwitching: false });
  expect(flagsOf(read, "zone")).toEqual({ fanOut: false, isSource: false, isSwitching: false });
  expect(flagsOf(read, "title")).toEqual({ fanOut: false, isSource: false, isSwitching: false });
  expect(await storedFlags(ctx, dto.id, "main")).toEqual({ fan_out: true, is_source: true, is_switching: false });
}

/** FL2 — a create answers the flags it stored. */
export async function assertACreateAnswersTheFlags(ctx: FlagsCtx): Promise<void> {
  const dto = await create(ctx, "fl2");
  expect(flagsOf(dto, "incoming")).toEqual({ fanOut: true, isSource: true, isSwitching: false });
  expect(flagsOf(dto, "main")).toEqual({ fanOut: false, isSource: false, isSwitching: false });
  expect(await storedFlags(ctx, dto.id, "incoming")).toEqual({ fan_out: true, is_source: true, is_switching: false });
}

/** FL3 — the replace-all rule: a PUT that omits the flags resets a stored `true` to `false`. */
export async function assertAPutOmittingTheFlagsResetsThem(ctx: FlagsCtx): Promise<void> {
  const dto = await create(ctx, "fl3");
  // Positive control: the stored row holds `true` before the PUT.
  expect(await storedFlags(ctx, dto.id, "incoming")).toEqual({ fan_out: true, is_source: true, is_switching: false });
  const body = flagsBody(ctx.eskomOrgId, dto.slug);
  const nodes = body.nodes.map(({ fanOut: _f, isSource: _s, ...rest }) => rest);
  const saved = await ctx.service.replace(ctx.globalAdmin, dto.id, { ...putOf(body, 1), nodes });

  expect(flagsOf(saved, "incoming")).toEqual({ fanOut: false, isSource: false, isSwitching: false });
  expect(await storedFlags(ctx, dto.id, "incoming")).toEqual({ fan_out: false, is_source: false, is_switching: false });
}

/**
 * FL4 — the database backstop. A panel with `fan_out = true`, inserted as `bms_tenant` under
 * the layout's own organization GUC (so row security admits the row and only the CHECK can
 * refuse it), is refused by `mimic_layout_nodes_flags_units_check`; the service's translation
 * answers 400 with a message that names neither the layout nor the node.
 */
export async function assertADirectPanelInsertWithAFlagIs400WithoutAnId(ctx: FlagsCtx): Promise<void> {
  const dto = await create(ctx, "fl4");
  const key = "fl4_panel";
  const client = await ctx.tenantPool.connect();
  let caught: unknown;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_organization', $1, true)`, [ctx.eskomOrgId]);
    try {
      await client.query(
        `INSERT INTO bms.mimic_layout_nodes
           (organization_id, layout_id, key, kind, label, tone, x, y, w, h, fan_out)
         VALUES ($1, $2, $3, 'panel', 'Backstop', 'info', 0, 0, 10, 10, true)`,
        [ctx.eskomOrgId, dto.id, key],
      );
    } catch (err) {
      caught = err;
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  expect((caught as { constraint?: string } | undefined)?.constraint).toBe("mimic_layout_nodes_flags_units_check");
  const translated = MimicLayoutsService.translateWriteError(caught, dto.slug);
  expect(translated).toBeInstanceOf(BadRequestException);
  expect((translated as Error).message).toBe(MIMIC_LAYOUT_FLAGS_MESSAGE);
  const response = JSON.stringify((translated as BadRequestException).getResponse());
  expect(response).not.toContain(dto.id);
  expect(response).not.toContain(key);
}

/** FL5 — the same refusal through the service: a body that skips the parse reaches the CHECK and answers 400. */
export async function assertAServiceWriteOfAFlaggedPanelIs400(ctx: FlagsCtx): Promise<void> {
  const body = flagsBody(ctx.eskomOrgId, ctx.slug("fl5"));
  body.nodes = body.nodes.map((n) => (n.key === "zone" ? { ...n, fanOut: true } : n));
  const err = await rejection(ctx.service.create(ctx.globalAdmin, body));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe(MIMIC_LAYOUT_FLAGS_MESSAGE);
  const none = await ctx.ownerPool.query<{ id: string }>(`SELECT id FROM bms.mimic_layouts WHERE slug = $1`, [
    body.slug,
  ]);
  for (const row of none.rows) ctx.track(row.id);
  expect(none.rows).toEqual([]);
}

/** FL6 — an ESKOM layout carrying flags stays invisible to a PHEWB organization admin through `get`. */
export async function assertAFlaggedLayoutOfAnotherOrganizationIs404(ctx: FlagsCtx): Promise<void> {
  const dto = await create(ctx, "fl6");
  // Positive control: the global admin reads it, flags included.
  expect(flagsOf(await ctx.service.get(ctx.globalAdmin, dto.id), "incoming")).toEqual({ fanOut: true, isSource: true, isSwitching: false });
  const err = await rejection(ctx.service.get(ctx.phewbOrgAdmin, dto.id));
  expect(err).toBeInstanceOf(NotFoundException);
}

// `F3.80` Task 1.4 (ADR 0101, migration `0109`) — the switching flag `isSwitching`.

/** FL7 — a PUT with `isSwitching` true on a unit answers true and stores true; the other units stay false. */
export async function assertAPutWithASwitchingUnitAnswersAndStoresIt(ctx: FlagsCtx): Promise<void> {
  const dto = await create(ctx, "fl7");
  // Positive control: the create stored no switching unit.
  expect(await storedFlags(ctx, dto.id, "main")).toEqual({ fan_out: false, is_source: false, is_switching: false });
  const body = flagsBody(ctx.eskomOrgId, dto.slug);
  const nodes = body.nodes.map((n) => (n.key === "main" ? { ...n, isSwitching: true } : n));
  const saved = await ctx.service.replace(ctx.globalAdmin, dto.id, { ...putOf(body, 1), nodes });

  expect(flagsOf(saved, "main")).toEqual({ fanOut: false, isSource: false, isSwitching: true });
  expect(flagsOf(saved, "incoming")).toEqual({ fanOut: true, isSource: true, isSwitching: false });
  const read = mimicLayoutDtoSchema.parse(await ctx.service.get(ctx.globalAdmin, dto.id));
  expect(flagsOf(read, "main")).toEqual({ fanOut: false, isSource: false, isSwitching: true });
  expect(await storedFlags(ctx, dto.id, "main")).toEqual({ fan_out: false, is_source: false, is_switching: true });
}

/** FL8 — the replace-all rule for the switching flag: a PUT body without it clears a stored `true`. */
export async function assertAPutOmittingTheSwitchingFlagClearsIt(ctx: FlagsCtx): Promise<void> {
  const body = flagsBody(ctx.eskomOrgId, ctx.slug("fl8"));
  body.nodes = body.nodes.map((n) => (n.key === "main" ? { ...n, isSwitching: true } : n));
  const dto = await ctx.service.create(ctx.globalAdmin, body);
  ctx.track(dto.id);
  // Positive control: the stored row holds `true` before the PUT.
  expect(await storedFlags(ctx, dto.id, "main")).toEqual({ fan_out: false, is_source: false, is_switching: true });
  const nodes = body.nodes.map(({ isSwitching: _w, ...rest }) => rest);
  const saved = await ctx.service.replace(ctx.globalAdmin, dto.id, { ...putOf(body, 1), nodes });

  expect(flagsOf(saved, "main")).toEqual({ fanOut: false, isSource: false, isSwitching: false });
  expect(await storedFlags(ctx, dto.id, "main")).toEqual({ fan_out: false, is_source: false, is_switching: false });
}

/**
 * FL4′ — the second database backstop. A panel with `is_switching = true`, inserted as
 * `bms_tenant` under the layout's own organization GUC (row security admits the row; only the
 * CHECK can refuse it), is refused by `0109`'s `mimic_layout_nodes_switching_units_check`, not
 * by `0097`'s flags CHECK; the translation answers 400 naming neither the layout, the node nor
 * the constraint.
 */
export async function assertADirectSwitchingPanelInsertIs400WithoutAnId(ctx: FlagsCtx): Promise<void> {
  const dto = await create(ctx, "fl4s");
  const key = "fl4s_panel";
  const client = await ctx.tenantPool.connect();
  let caught: unknown;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_organization', $1, true)`, [ctx.eskomOrgId]);
    try {
      await client.query(
        `INSERT INTO bms.mimic_layout_nodes
           (organization_id, layout_id, key, kind, label, tone, x, y, w, h, is_switching)
         VALUES ($1, $2, $3, 'panel', 'Backstop', 'info', 0, 0, 10, 10, true)`,
        [ctx.eskomOrgId, dto.id, key],
      );
    } catch (err) {
      caught = err;
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  expect((caught as { constraint?: string } | undefined)?.constraint).toBe("mimic_layout_nodes_switching_units_check");
  const translated = MimicLayoutsService.translateWriteError(caught, dto.slug);
  expect(translated).toBeInstanceOf(BadRequestException);
  expect((translated as Error).message).toBe(MIMIC_LAYOUT_FLAGS_MESSAGE);
  const response = JSON.stringify((translated as BadRequestException).getResponse());
  expect(response).not.toContain(dto.id);
  expect(response).not.toContain(key);
  expect(response).not.toContain("switching_units_check");
}

/** FL5′ — the same refusal through the service: a switching panel that skips the parse answers 400 and writes nothing. */
export async function assertAServiceWriteOfASwitchingPanelIs400(ctx: FlagsCtx): Promise<void> {
  const body = flagsBody(ctx.eskomOrgId, ctx.slug("fl5s"));
  body.nodes = body.nodes.map((n) => (n.key === "zone" ? { ...n, isSwitching: true } : n));
  const err = await rejection(ctx.service.create(ctx.globalAdmin, body));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe(MIMIC_LAYOUT_FLAGS_MESSAGE);
  const none = await ctx.ownerPool.query<{ id: string }>(`SELECT id FROM bms.mimic_layouts WHERE slug = $1`, [
    body.slug,
  ]);
  for (const row of none.rows) ctx.track(row.id);
  expect(none.rows).toEqual([]);
}
