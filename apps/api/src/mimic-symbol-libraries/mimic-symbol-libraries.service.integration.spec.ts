import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import type pg from "pg";
import { expect } from "vitest";

import { mimicLayoutDtoSchema, mimicSymbolLibrariesResponseSchema } from "@bms/shared";
import type { JwtPayload, MimicLayoutDto, MimicOrgSymbolDto, MimicOrgSymbolLibraryDto } from "@bms/shared";

import type { MimicNodesService } from "../dashboard-builder/mimic-nodes.service";
import type { CreateMimicLayoutBody, PutMimicLayoutBody } from "../mimic-layouts/mimic-layouts.schema";
import type { MimicLayoutsService } from "../mimic-layouts/mimic-layouts.service";
import type { MimicSymbolLibrariesService } from "./mimic-symbol-libraries.service";
import { parseSvgSymbol } from "./svg-symbol-parser";

/**
 * `F3.32f` slice 3 U2 (plan §3 U2) — `MimicSymbolLibrariesService` and the organization-aware
 * write checks of `MimicLayoutsService` against a real database and real row security.
 * Assertions live here; `mimic-symbol-libraries.service.integration.test.ts` is the Vitest entry
 * point (ADR 0014) and owns the pools, the fixtures and the cleanup.
 *
 * Each case creates its own library under its own code, so the cases do not depend on order.
 * The services are constructed directly, never through a Nest module (`F4.20`).
 */

export type Ctx = {
  libraries: MimicSymbolLibrariesService;
  layouts: MimicLayoutsService;
  /** The resolver, over the fleet pool. */
  nodes: MimicNodesService;
  /** Superuser pool: reads rows behind the services' back, plants fixtures, cleans up. */
  ownerPool: pg.Pool;
  eskomOrgId: string;
  phewbOrgId: string;
  /**
   * A throwaway organization planted for this run. The switch cases turn a global library off
   * only here: every static code is chosen by another suite, and the DB suites run in parallel.
   */
  switchOrgId: string;
  globalAdmin: JwtPayload;
  /** `phe-admin@bms.local` — organization admin of PHEWB only. */
  phewbOrgAdmin: JwtPayload;
  /** `wc-admin@bms.local` — location admin inside ESKOM. */
  eskomLocationAdmin: JwtPayload;
  /** A library code unique to this run and `suffix` (lower-case letters and digits). */
  code: (suffix: string) => string;
  /** A layout slug unique to this run and `suffix`. */
  slug: (suffix: string) => string;
  trackLibrary: (id: string) => void;
  trackLayout: (id: string) => void;
  /** Plants a committed dashboard in `organizationId` with one layout-arm widget; returns its id. */
  plantDashboard: (organizationId: string, layoutId: string) => Promise<string>;
  /** Transactions the layouts service has opened on the tenant pool — each write opens one. */
  layoutWrites: () => number;
  /** Deletes `organizationId`'s switch row for `libraryCode` (restores "enabled"). */
  resetSetting: (organizationId: string, libraryCode: string) => Promise<void>;
};

export const INLET_SVG =
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24" width="48mm">' +
  '<title>Inlet</title><g transform="translate(2 2)"><rect x="0" y="0" width="20" height="10" style="fill:red"/>' +
  '<path d="M20 5 L44 5" onload="alert(1)"/></g></svg>';

const svgBuffer = (xml = INLET_SVG): Buffer => Buffer.from(xml, "utf8");

const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to be refused, and it succeeded");
};

async function createLibrary(ctx: Ctx, suffix: string, organizationId = ctx.eskomOrgId): Promise<MimicOrgSymbolLibraryDto> {
  const dto = await ctx.libraries.create(ctx.globalAdmin, {
    organizationId,
    code: ctx.code(suffix),
    label: `F3.32f ${suffix}`,
    style: "stroke",
    licence: "CC BY 4.0",
    attribution: "Drawn for the integration suite",
    sourceUrl: null,
  });
  ctx.trackLibrary(dto.id);
  return dto;
}

async function upload(ctx: Ctx, library: MimicOrgSymbolLibraryDto, name = "inlet", xml = INLET_SVG): Promise<MimicOrgSymbolDto> {
  return ctx.libraries.uploadSymbol(ctx.globalAdmin, library.id, {
    buffer: svgBuffer(xml),
    declaredType: "image/svg+xml",
    originalFilename: `${name}.svg`,
    name,
  });
}

/** A library with one uploaded symbol, `org.<code>:inlet`. */
async function plantLibrary(ctx: Ctx, suffix: string): Promise<{ library: MimicOrgSymbolLibraryDto; symbol: MimicOrgSymbolDto }> {
  const library = await createLibrary(ctx, suffix);
  const symbol = await upload(ctx, library);
  return { library, symbol };
}

function layoutBody(
  ctx: Ctx,
  organizationId: string,
  suffix: string,
  symbolLibraries: string[],
  symbol: string,
): CreateMimicLayoutBody {
  return {
    organizationId,
    name: `F3.32f ${suffix}`,
    slug: ctx.slug(suffix),
    canvasW: 120,
    canvasH: 80,
    symbolLibraries: symbolLibraries as CreateMimicLayoutBody["symbolLibraries"],
    nodes: [
      { key: "inlet", kind: "unit", symbol: symbol as CreateMimicLayoutBody["nodes"][number]["symbol"], label: "Inlet", x: 0, y: 0, w: 10, h: 10 },
      { key: "tank", kind: "unit", symbol: "tank", label: "Tank", x: 20, y: 0, w: 10, h: 10 },
    ],
    pipes: [{ fromKey: "inlet", toKey: "tank" }],
  };
}

async function createLayout(ctx: Ctx, body: CreateMimicLayoutBody): Promise<MimicLayoutDto> {
  const dto = await ctx.layouts.create(ctx.globalAdmin, body);
  ctx.trackLayout(dto.id);
  return dto;
}

const putBodyOf = (dto: MimicLayoutDto): PutMimicLayoutBody => ({
  version: dto.version,
  name: dto.name,
  slug: dto.slug,
  canvasW: dto.canvasW,
  canvasH: dto.canvasH,
  symbolLibraries: dto.symbolLibraries,
  nodes: dto.nodes.map((node) => ({
    key: node.key,
    kind: node.kind,
    symbol: node.symbol,
    label: node.label,
    roleCode: node.roleCode,
    tone: node.tone,
    x: node.x,
    y: node.y,
    w: node.w,
    h: node.h,
    z: node.z,
  })),
  pipes: dto.pipes,
});

const layoutCount = async (ctx: Ctx, slug: string): Promise<number> =>
  (await ctx.ownerPool.query<{ n: number }>(`SELECT count(*)::int AS n FROM bms.mimic_layouts WHERE slug = $1`, [slug])).rows[0]
    ?.n ?? -1;

// ---------------------------------------------------------------------------
// Libraries: create and access
// ---------------------------------------------------------------------------

/** L1 — a global admin creates a library in ESKOM; the DTO names it `org.<code>`, and it is audited. */
export async function assertCreateAnswersTheOrgKeyAndAudits(ctx: Ctx): Promise<void> {
  const dto = await createLibrary(ctx, "la");
  expect(dto).toMatchObject({ organizationId: ctx.eskomOrgId, code: ctx.code("la"), key: `org.${ctx.code("la")}`, active: true, symbolCount: 0, symbols: [] });
  const audit = await ctx.ownerPool.query(`SELECT action, organization_id FROM bms.audit_log WHERE entity_id = $1`, [dto.id]);
  expect(audit.rows).toEqual([{ action: "master.mimic_org_symbol_library.create", organization_id: ctx.eskomOrgId }]);
}

/** L2 — PHEWB's organization admin creating in ESKOM is a 403, and no row is written. */
export async function assertOrgAdminCreatingInAnotherOrganizationIs403(ctx: Ctx): Promise<void> {
  const err = await rejection(
    ctx.libraries.create(ctx.phewbOrgAdmin, {
      organizationId: ctx.eskomOrgId,
      code: ctx.code("lb"),
      label: "x",
      style: "stroke",
      licence: "x",
      attribution: "",
    }),
  );
  expect(err).toBeInstanceOf(ForbiddenException);
  const rows = await ctx.ownerPool.query(`SELECT 1 FROM bms.mimic_org_symbol_libraries WHERE code = $1`, [ctx.code("lb")]);
  expect(rows.rows).toEqual([]);
}

/** L3 — a location admin inside ESKOM is refused by role, before the scope check. */
export async function assertLocationAdminCreateIs403(ctx: Ctx): Promise<void> {
  const err = await rejection(
    ctx.libraries.create(ctx.eskomLocationAdmin, {
      organizationId: ctx.eskomOrgId,
      code: ctx.code("lc"),
      label: "x",
      style: "stroke",
      licence: "x",
      attribution: "",
    }),
  );
  expect(err).toBeInstanceOf(ForbiddenException);
  expect((err as Error).message).toBe("Only an organization admin can manage symbol libraries");
}

/** L4 — a second library with the same code in the organization is a 409. */
export async function assertDuplicateCodeIs409(ctx: Ctx): Promise<void> {
  await createLibrary(ctx, "ld");
  const err = await rejection(createLibrary(ctx, "ld"));
  expect(err).toBeInstanceOf(ConflictException);
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/** U1 — a valid upload stores geometry only, the buffer's hash, and an audit row with the hash. */
export async function assertUploadStoresGeometryAndTheHash(ctx: Ctx): Promise<void> {
  const library = await createLibrary(ctx, "ua");
  const symbol = await upload(ctx, library);
  const sha256 = createHash("sha256").update(svgBuffer()).digest("hex");
  const parsed = parseSvgSymbol(svgBuffer());
  expect(symbol).toMatchObject({ key: `org.${library.code}:inlet`, label: "inlet", group: "general", sha256, active: true });
  const row = await ctx.ownerPool.query(
    `SELECT organization_id, key, sha256, shapes, view_box, org_symbol_count
       FROM bms.mimic_org_symbols s,
            LATERAL (SELECT count(*)::int AS org_symbol_count FROM bms.mimic_org_symbols WHERE library_id = s.library_id) c
      WHERE s.id = $1`,
    [symbol.id],
  );
  expect(row.rows).toEqual([
    {
      organization_id: ctx.eskomOrgId,
      key: symbol.key,
      sha256,
      shapes: parsed.shapes,
      view_box: parsed.viewBox,
      org_symbol_count: 1,
    },
  ]);
  expect(JSON.stringify(row.rows[0]?.shapes)).not.toContain("onload");
  expect(JSON.stringify(row.rows[0]?.shapes)).not.toContain("fill:red");
  const audit = await ctx.ownerPool.query(
    `SELECT action, organization_id, payload FROM bms.audit_log WHERE entity_id = $1`,
    [symbol.id],
  );
  expect(audit.rows).toEqual([
    {
      action: "master.mimic_org_symbol.create",
      organization_id: ctx.eskomOrgId,
      payload: { libraryId: library.id, key: symbol.key, sha256, byteSize: svgBuffer().length, shapes: parsed.shapes.length },
    },
  ]);
}

/** U2 — a second upload of the same name into the library is a 409. */
export async function assertASecondUploadOfTheSameNameIs409(ctx: Ctx): Promise<void> {
  const { library } = await plantLibrary(ctx, "ub");
  const err = await rejection(upload(ctx, library));
  expect(err).toBeInstanceOf(ConflictException);
}

/** U3 — a parser refusal is a 400 with its message, never the content, and stores nothing. */
export async function assertAParserRefusalIs400AndStoresNothing(ctx: Ctx): Promise<void> {
  const library = await createLibrary(ctx, "uc");
  const err = await rejection(upload(ctx, library, "bad", '<svg viewBox="0 0 1 1"><script>pwn7f3e()</script></svg>'));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("Element <script> is not allowed in a symbol");
  const rows = await ctx.ownerPool.query(`SELECT 1 FROM bms.mimic_org_symbols WHERE library_id = $1`, [library.id]);
  expect(rows.rows).toEqual([]);
}

/** U4 — a declared type other than image/svg+xml is a 400. */
export async function assertAWrongDeclaredTypeIs400(ctx: Ctx): Promise<void> {
  const library = await createLibrary(ctx, "ud");
  const err = await rejection(
    ctx.libraries.uploadSymbol(ctx.globalAdmin, library.id, { buffer: svgBuffer(), declaredType: "image/png", originalFilename: "x.svg" }),
  );
  expect(err).toBeInstanceOf(BadRequestException);
}

/** U5 — a buffer over the byte cap is a 413, whatever multer let through. */
export async function assertABufferOverTheCapIs413(ctx: Ctx): Promise<void> {
  const library = await createLibrary(ctx, "ue");
  const err = await rejection(
    ctx.libraries.uploadSymbol(ctx.globalAdmin, library.id, {
      buffer: Buffer.alloc(65537, 32),
      declaredType: "image/svg+xml",
      originalFilename: "x.svg",
    }),
  );
  expect(err).toBeInstanceOf(PayloadTooLargeException);
}

/** U6 — the name and label default from the filename stem (plan R3). */
export async function assertTheNameDefaultsFromTheFilename(ctx: Ctx): Promise<void> {
  const library = await createLibrary(ctx, "uf");
  const symbol = await ctx.libraries.uploadSymbol(ctx.globalAdmin, library.id, {
    buffer: svgBuffer(),
    declaredType: "image/svg+xml",
    originalFilename: "Inlet Screen (v2).svg",
  });
  expect(symbol.key).toBe(`org.${library.code}:inlet-screen-v2`);
  expect(symbol.label).toBe("Inlet Screen (v2)");
}

/** U7 — PHEWB's organization admin cannot upload into an ESKOM library: a 404, the id reveals nothing. */
export async function assertUploadIntoAnotherOrganizationsLibraryIs404(ctx: Ctx): Promise<void> {
  const library = await createLibrary(ctx, "ug");
  const err = await rejection(ctx.libraries.assertCanUploadTo(ctx.phewbOrgAdmin, library.id));
  expect(err).toBeInstanceOf(NotFoundException);
}

// ---------------------------------------------------------------------------
// The catalog read
// ---------------------------------------------------------------------------

/** R1 — PHEWB's admin lists no ESKOM library, and naming ESKOM is a 404. */
export async function assertTheCatalogIsScopedToTheCallersOrganizations(ctx: Ctx): Promise<void> {
  const { library } = await plantLibrary(ctx, "ra");
  const phewb = await ctx.libraries.list(ctx.phewbOrgAdmin);
  expect(mimicSymbolLibrariesResponseSchema.safeParse(phewb).success).toBe(true);
  expect(phewb.organization.filter((lib) => lib.organizationId === ctx.eskomOrgId)).toEqual([]);
  expect(phewb.organization.map((lib) => lib.id)).not.toContain(library.id);
  const err = await rejection(ctx.libraries.list(ctx.phewbOrgAdmin, ctx.eskomOrgId));
  expect(err).toBeInstanceOf(NotFoundException);
}

/** R2 — ESKOM's catalog carries the library with its symbol, retired symbols included with the flag. */
export async function assertTheCatalogListsSymbolsRetiredOnesIncluded(ctx: Ctx): Promise<void> {
  const { library, symbol } = await plantLibrary(ctx, "rb");
  await ctx.libraries.updateSymbol(ctx.globalAdmin, library.id, symbol.id, { active: false });
  const catalog = await ctx.libraries.list(ctx.globalAdmin, ctx.eskomOrgId);
  expect(mimicSymbolLibrariesResponseSchema.safeParse(catalog).success).toBe(true);
  const listed = catalog.organization.find((lib) => lib.id === library.id);
  expect(listed?.symbols.map((s) => [s.key, s.active])).toEqual([[symbol.key, false]]);
  expect(listed?.symbols[0]?.shapes.length).toBeGreaterThan(0);
  expect(catalog.global.find((lib) => lib.code === "core")).toMatchObject({ enabled: true, active: true });
}

/** R3 — a stored symbol the contract refuses is omitted from the catalog, never a 400. */
export async function assertAStoredSymbolOutsideTheContractIsOmitted(ctx: Ctx): Promise<void> {
  const { library, symbol } = await plantLibrary(ctx, "rc");
  // Behind the parser's back: a key the contract's tags refuse, as a `bms_fleet` write could plant.
  await ctx.ownerPool.query(`UPDATE bms.mimic_org_symbols SET shapes = '[["script", {}]]'::jsonb WHERE id = $1`, [symbol.id]);
  const catalog = await ctx.libraries.list(ctx.globalAdmin, ctx.eskomOrgId);
  const listed = catalog.organization.find((lib) => lib.id === library.id);
  expect(listed?.symbols).toEqual([]);
  expect(listed?.symbolCount).toBe(1);
}

// ---------------------------------------------------------------------------
// Layouts: organization symbols
// ---------------------------------------------------------------------------

/** Y1 — an ESKOM layout drawing its organization symbol saves; the row holds the key in org_symbol_key. */
export async function assertALayoutDrawsAnOrgSymbol(ctx: Ctx): Promise<void> {
  const { library, symbol } = await plantLibrary(ctx, "ya");
  const dto = await createLayout(ctx, layoutBody(ctx, ctx.eskomOrgId, "ya", ["core", library.key], symbol.key));
  expect(mimicLayoutDtoSchema.safeParse(dto).success).toBe(true);
  expect(dto.nodes.find((node) => node.key === "inlet")?.symbol).toBe(symbol.key);
  expect(dto.orgSymbols.map((s) => s.key)).toEqual([symbol.key]);
  expect(dto.orgSymbols[0]?.shapes).toEqual(symbol.shapes);
  const row = await ctx.ownerPool.query(
    `SELECT symbol, org_symbol_key FROM bms.mimic_layout_nodes WHERE layout_id = $1 AND key = 'inlet'`,
    [dto.id],
  );
  expect(row.rows).toEqual([{ symbol: null, org_symbol_key: symbol.key }]);
}

/**
 * Y2 — a PHEWB layout naming ESKOM's symbol is refused by the service, before any write: PHEWB
 * owns a library of the **same code** (so the library check passes), without the symbol. The
 * write counter proves the service refused it, not the composite foreign key at the insert.
 */
export async function assertACrossOrganizationSymbolIsRefusedBeforeAnyWrite(ctx: Ctx): Promise<void> {
  const { library, symbol } = await plantLibrary(ctx, "yb");
  await createLibrary(ctx, "yb", ctx.phewbOrgId);
  const before = ctx.layoutWrites();
  const body = layoutBody(ctx, ctx.phewbOrgId, "yb", ["core", library.key], symbol.key);
  const err = await rejection(ctx.layouts.create(ctx.globalAdmin, body));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("Unknown mimic symbol");
  expect(ctx.layoutWrites()).toBe(before);
  expect(await layoutCount(ctx, body.slug)).toBe(0);
}

/** Y3 — a cast body naming a symbol that does not exist is a 400 that echoes no key. */
export async function assertAnUnknownOrgSymbolIs400WithoutTheKey(ctx: Ctx): Promise<void> {
  const library = await createLibrary(ctx, "yc");
  const body = layoutBody(ctx, ctx.eskomOrgId, "yc", ["core", library.key], `org.${library.code}:no-such`);
  const err = await rejection(ctx.layouts.create(ctx.globalAdmin, body));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("Unknown mimic symbol");
  expect((err as Error).message).not.toContain("no-such");
  expect(await layoutCount(ctx, body.slug)).toBe(0);
}

/** Y4 — a PHEWB layout choosing an org library only ESKOM owns is a 400 "Unknown symbol library". */
export async function assertAnotherOrganizationsLibraryIs400(ctx: Ctx): Promise<void> {
  const library = await createLibrary(ctx, "yd");
  const body = layoutBody(ctx, ctx.phewbOrgId, "yd", ["core", library.key], "tank");
  const err = await rejection(ctx.layouts.create(ctx.globalAdmin, body));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("Unknown symbol library");
}

// ---------------------------------------------------------------------------
// The per-organization switch
// ---------------------------------------------------------------------------

const TABLER_UNIT = "tabler:bolt";

/** S1 — with tabler off for the fixture organization, a new layout there choosing it is a 400. */
export async function assertADisabledLibraryRefusesANewLayout(ctx: Ctx): Promise<void> {
  try {
    await ctx.libraries.putSetting(ctx.globalAdmin, "tabler", { organizationId: ctx.switchOrgId, enabled: false });
    const body = layoutBody(ctx, ctx.switchOrgId, "sa", ["core", "tabler"], TABLER_UNIT);
    const err = await rejection(ctx.layouts.create(ctx.globalAdmin, body));
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe("Unknown symbol library");
  } finally {
    await ctx.resetSetting(ctx.switchOrgId, "tabler");
  }
}

/** S2 — the switch is the fixture organization's alone: PHEWB (no row = enabled) still saves a tabler layout. */
export async function assertTheSwitchBindsOnlyItsOrganization(ctx: Ctx): Promise<void> {
  try {
    await ctx.libraries.putSetting(ctx.globalAdmin, "tabler", { organizationId: ctx.switchOrgId, enabled: false });
    const dto = await createLayout(ctx, layoutBody(ctx, ctx.phewbOrgId, "sb", ["core", "tabler"], TABLER_UNIT));
    expect(dto.symbolLibraries).toEqual(["core", "tabler"]);
  } finally {
    await ctx.resetSetting(ctx.switchOrgId, "tabler");
  }
}

/** S3 — a stored layout of the fixture organization that already chose tabler re-saves after tabler is switched off. */
export async function assertAStoredDisabledLibraryReSaves(ctx: Ctx): Promise<void> {
  const dto = await createLayout(ctx, layoutBody(ctx, ctx.switchOrgId, "sc", ["core", "tabler"], TABLER_UNIT));
  try {
    await ctx.libraries.putSetting(ctx.globalAdmin, "tabler", { organizationId: ctx.switchOrgId, enabled: false });
    const saved = await ctx.layouts.replace(ctx.globalAdmin, dto.id, putBodyOf(dto));
    expect(saved.version).toBe(dto.version + 1);
  } finally {
    await ctx.resetSetting(ctx.switchOrgId, "tabler");
  }
}

/**
 * S7 — the stored-library exemption carries no new unit: a stored layout that already chose
 * tabler, with tabler switched off, refuses a newly placed tabler symbol. S3 is the positive
 * control — the same layout without the new unit re-saves.
 */
export async function assertAStoredDisabledLibraryRefusesANewUnit(ctx: Ctx): Promise<void> {
  const dto = await createLayout(ctx, layoutBody(ctx, ctx.switchOrgId, "sd", ["core", "tabler"], TABLER_UNIT));
  try {
    await ctx.libraries.putSetting(ctx.globalAdmin, "tabler", { organizationId: ctx.switchOrgId, enabled: false });
    const body = putBodyOf(dto);
    const added = {
      key: "gauge",
      kind: "unit",
      symbol: "tabler:activity",
      label: "Gauge",
      x: 40,
      y: 0,
      w: 10,
      h: 10,
    } as PutMimicLayoutBody["nodes"][number];
    const err = await rejection(ctx.layouts.replace(ctx.globalAdmin, dto.id, { ...body, nodes: [...body.nodes, added] }));
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe("Unknown mimic symbol");
  } finally {
    await ctx.resetSetting(ctx.switchOrgId, "tabler");
  }
}

/** S4 — core cannot be switched off. */
export async function assertCoreCannotBeDisabled(ctx: Ctx): Promise<void> {
  const err = await rejection(ctx.libraries.putSetting(ctx.globalAdmin, "core", { organizationId: ctx.switchOrgId, enabled: false }));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("The core library cannot be disabled");
}

/** S5 — an unknown code is one 400 with no echo. */
export async function assertAnUnknownLibraryCodeIs400(ctx: Ctx): Promise<void> {
  const err = await rejection(
    ctx.libraries.putSetting(ctx.globalAdmin, "fontawesome", { organizationId: ctx.switchOrgId, enabled: false }),
  );
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("Unknown symbol library");
}

/** S6 — the switch is audited with no entity id, naming the organization and the code. */
export async function assertTheSwitchIsAudited(ctx: Ctx): Promise<void> {
  // The database's clock, not this process's: the two can differ, and `created_at` is the former's.
  const since = (await ctx.ownerPool.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0]?.now;
  try {
    const dto = await ctx.libraries.putSetting(ctx.globalAdmin, "mdi", { organizationId: ctx.switchOrgId, enabled: false });
    expect(dto).toMatchObject({ organizationId: ctx.switchOrgId, libraryCode: "mdi", enabled: false });
    const catalog = await ctx.libraries.list(ctx.globalAdmin, ctx.switchOrgId);
    expect(catalog.global.find((lib) => lib.code === "mdi")?.enabled).toBe(false);
    const audit = await ctx.ownerPool.query(
      `SELECT entity_id, payload FROM bms.audit_log
        WHERE action = 'master.mimic_library_setting.update' AND organization_id = $1 AND created_at >= $2`,
      [ctx.switchOrgId, since],
    );
    expect(audit.rows).toContainEqual({ entity_id: null, payload: { libraryCode: "mdi", enabled: false } });
  } finally {
    await ctx.resetSetting(ctx.switchOrgId, "mdi");
  }
}

// ---------------------------------------------------------------------------
// Retirement
// ---------------------------------------------------------------------------

/** T1 — after the library is retired, a new layout choosing it is a 400. */
export async function assertARetiredLibraryRefusesANewLayout(ctx: Ctx): Promise<void> {
  const { library, symbol } = await plantLibrary(ctx, "ta");
  await ctx.libraries.update(ctx.globalAdmin, library.id, { active: false });
  const err = await rejection(ctx.layouts.create(ctx.globalAdmin, layoutBody(ctx, ctx.eskomOrgId, "ta", ["core", library.key], symbol.key)));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("Unknown symbol library");
}

/** T2 — a stored layout on a library retired afterwards re-saves, and its read still embeds the symbol. */
export async function assertAStoredRetiredLibraryReSavesAndStillDraws(ctx: Ctx): Promise<void> {
  const { library, symbol } = await plantLibrary(ctx, "tb");
  const dto = await createLayout(ctx, layoutBody(ctx, ctx.eskomOrgId, "tb", ["core", library.key], symbol.key));
  await ctx.libraries.update(ctx.globalAdmin, library.id, { active: false });
  const saved = await ctx.layouts.replace(ctx.globalAdmin, dto.id, putBodyOf(dto));
  expect(saved.version).toBe(dto.version + 1);
  const read = await ctx.layouts.get(ctx.globalAdmin, dto.id);
  expect(read.symbolLibraries).toEqual(["core", library.key]);
  expect(read.orgSymbols.map((s) => s.key)).toEqual([symbol.key]);
}

/** T3 — after a symbol is retired, a new layout placing it is a 400. */
export async function assertARetiredSymbolRefusesANewLayout(ctx: Ctx): Promise<void> {
  const { library, symbol } = await plantLibrary(ctx, "tc");
  await ctx.libraries.updateSymbol(ctx.globalAdmin, library.id, symbol.id, { active: false });
  const err = await rejection(ctx.layouts.create(ctx.globalAdmin, layoutBody(ctx, ctx.eskomOrgId, "tc", ["core", library.key], symbol.key)));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe("Unknown mimic symbol");
}

/** T4 — a stored layout drawing a symbol retired afterwards re-saves. */
export async function assertAStoredRetiredSymbolReSaves(ctx: Ctx): Promise<void> {
  const { library, symbol } = await plantLibrary(ctx, "td");
  const dto = await createLayout(ctx, layoutBody(ctx, ctx.eskomOrgId, "td", ["core", library.key], symbol.key));
  await ctx.libraries.updateSymbol(ctx.globalAdmin, library.id, symbol.id, { active: false });
  const saved = await ctx.layouts.replace(ctx.globalAdmin, dto.id, putBodyOf(dto));
  expect(saved.version).toBe(dto.version + 1);
  expect(saved.orgSymbols.map((s) => [s.key, s.active])).toEqual([[symbol.key, false]]);
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/** V1 — a dashboard widget on the layout answers `layout.orgSymbols` with the shapes. */
export async function assertTheResolverEmbedsOrgSymbols(ctx: Ctx): Promise<void> {
  const { library, symbol } = await plantLibrary(ctx, "va");
  const dto = await createLayout(ctx, layoutBody(ctx, ctx.eskomOrgId, "va", ["core", library.key], symbol.key));
  const dashboardId = await ctx.plantDashboard(ctx.eskomOrgId, dto.id);
  const resolved = await ctx.nodes.read(ctx.eskomOrgId, dashboardId, null, Date.now());
  const widget = resolved.widgets[0];
  expect(widget?.source).toBe("layout");
  if (widget?.source !== "layout") return;
  expect(widget.layout.nodes.find((node) => node.key === "inlet")?.symbol).toBe(symbol.key);
  expect(widget.layout.orgSymbols.map((s) => s.key)).toEqual([symbol.key]);
  expect(widget.layout.orgSymbols[0]?.shapes).toEqual(symbol.shapes);
}
