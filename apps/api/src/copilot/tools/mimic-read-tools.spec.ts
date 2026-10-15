import { NotFoundException } from "@nestjs/common";
import { expect } from "vitest";

import { type JwtPayload, type MimicLayoutWriteNode, putMimicLayoutBodySchema } from "@bms/shared";

import type { ResolvedIdentity } from "../../auth/identity-resolver";
import { TOOL_RESULT_CUT_TAIL, toolResultContent } from "../../llm/tool-result";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import type { CopilotReadServices } from "./copilot-read-tool";
import { getMimicLayoutTool } from "./get-mimic-layout.tool";
import { listAssetRolesTool } from "./list-asset-roles.tool";
import { listMimicLayoutsTool } from "./list-mimic-layouts.tool";
import { listMimicSymbolsTool } from "./list-mimic-symbols.tool";

/**
 * `F3.87` PR 2 (ADR 0099 Amendment 3 drafter choice 1, plan D9, D10, D16) —
 * the four mimic read tools over fake services. The layout round trip is the
 * claim a replace depends on: a layout read page by page and sent back is the
 * layout it was read from, every `tone`, `z` and flag included. Vitest entry
 * point: the sibling `.test.ts` (ADR 0014).
 */

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_X = "00000000-0000-4000-8000-0000000000aa";
const ORG_Y = "00000000-0000-4000-8000-0000000000bb";
const LAYOUT = "60000000-0000-4000-8000-000000000001";
const LIBRARY = "70000000-0000-4000-8000-000000000001";
const STAMP = "2026-10-15T06:00:00.000Z";

function ctx(allowed: readonly string[]): CopilotToolContext {
  return {
    identity: { id: USER, role: "organization_admin", organizationId: ORG_X } as ResolvedIdentity,
    user: { sub: USER, role: "organization_admin" } as JwtPayload,
    conversationId: "22222222-2222-4222-8222-222222222222",
    conversationOrganizationId: allowed.length === 1 ? (allowed[0] as string) : null,
    allowedOrganizationIds: allowed,
    turnKind: "user",
    now: new Date(STAMP),
  };
}

/** The largest layout the caps allow: 100 units, 10 panels and 10 labels; 160 pipes. Every optional field is set. */
function bigLayoutBody() {
  const nodes: MimicLayoutWriteNode[] = [];
  for (let i = 0; i < 120; i += 1) {
    const at = { x: (i % 20) * 10, y: Math.floor(i / 20) * 10, w: 4, h: 4, z: i % 7 };
    if (i < 100) {
      nodes.push({
        key: `u${i}`,
        kind: "unit",
        symbol: "breaker",
        label: `Feeder breaker number ${i} on the main incomer`,
        ...(i % 3 === 0 ? { roleCode: "transformer" } : {}),
        ...at,
        fanOut: i % 11 === 0,
        isSource: i === 0,
        isSwitching: i % 5 === 1,
      });
    } else if (i < 110) {
      nodes.push({ key: `p${i}`, kind: "panel", label: `Panel ${i}`, tone: i % 2 === 0 ? "info" : "accent", ...at, fanOut: false, isSource: false, isSwitching: false });
    } else {
      nodes.push({ key: `l${i}`, kind: "label", label: `Label ${i}`, ...at, fanOut: false, isSource: false, isSwitching: false });
    }
  }
  const pipes = [
    ...Array.from({ length: 99 }, (_, i) => ({ fromKey: `u${i}`, toKey: `u${i + 1}` })),
    ...Array.from({ length: 61 }, (_, i) => ({ fromKey: `u${i}`, toKey: `u${i + 2}` })),
  ];
  return { version: 4, name: "HT/LT incomer", slug: "ht-lt-incomer", canvasW: 240, canvasH: 160, symbolLibraries: ["core" as const], nodes, pipes };
}

type Body = ReturnType<typeof bigLayoutBody>;

/** The body as `MimicLayoutsService.get` serves it: absent becomes `null`, each flag and `z` always present. */
function layoutDtoOf(body: Body, organizationId: string) {
  return {
    id: LAYOUT,
    organizationId,
    name: body.name,
    slug: body.slug,
    canvasW: body.canvasW,
    canvasH: body.canvasH,
    version: body.version,
    symbolLibraries: body.symbolLibraries,
    nodes: body.nodes.map((node) => ({
      key: node.key,
      kind: node.kind,
      symbol: node.symbol ?? null,
      label: node.label,
      roleCode: node.roleCode ?? null,
      tone: node.tone ?? null,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      z: node.z ?? 0,
      fanOut: node.fanOut ?? false,
      isSource: node.isSource ?? false,
      isSwitching: node.isSwitching ?? false,
    })),
    pipes: body.pipes,
    orgSymbols: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function services(over: Partial<Record<keyof CopilotReadServices, unknown>>): CopilotReadServices {
  return over as unknown as CopilotReadServices;
}

const okResult = (result: CopilotToolResult): Record<string, unknown> => {
  if (!result.ok) throw new Error(`F3.87: the tool refused: ${result.error}`);
  return result.result;
};

/** A 120-node, 160-pipe layout read page by page is the body it was read from, and it parses as a replace. */
export async function aLayoutReadPageByPageRoundTrips(): Promise<void> {
  const body = bigLayoutBody();
  expect(putMimicLayoutBodySchema.safeParse(body).success).toBe(true);
  const fake = services({ layouts: { get: async () => layoutDtoOf(body, ORG_X) } });
  const nodes: unknown[] = [];
  const pipes: unknown[] = [];
  let page: number | null = 0;
  let pages = 0;
  let header: Record<string, unknown> = {};
  while (page !== null) {
    const result = okResult(await getMimicLayoutTool.run(fake, { id: LAYOUT, page }, ctx([ORG_X])));
    expect(toolResultContent({ ok: true, result })).not.toContain(TOOL_RESULT_CUT_TAIL);
    nodes.push(...(result.nodes as unknown[]));
    pipes.push(...(result.pipes as unknown[]));
    header = result.layout as Record<string, unknown>;
    page = result.nextPage as number | null;
    pages += 1;
    expect(pages).toBeLessThan(50);
  }
  expect(pages).toBeGreaterThan(1);
  const sentBack = {
    version: header.version,
    name: header.name,
    slug: header.slug,
    canvasW: header.canvasW,
    canvasH: header.canvasH,
    symbolLibraries: header.symbolLibraries,
    nodes,
    pipes,
  };
  const parsed = putMimicLayoutBodySchema.safeParse(sentBack);
  expect(parsed.success).toBe(true);
  expect(sentBack).toEqual(body);
}

/** A layout of an organization outside the turn, or one the service will not read, is the one refusal. */
export async function aLayoutOutsideTheTurnIsRefused(): Promise<void> {
  const body = bigLayoutBody();
  const other = services({ layouts: { get: async () => layoutDtoOf(body, ORG_Y) } });
  expect((await getMimicLayoutTool.run(other, { id: LAYOUT }, ctx([ORG_X]))).ok).toBe(false);
  const missing = services({
    layouts: {
      get: async () => {
        throw new NotFoundException("Mimic layout not found");
      },
    },
  });
  expect((await getMimicLayoutTool.run(missing, { id: LAYOUT }, ctx([ORG_X]))).ok).toBe(false);
}

/** Any other failure (a database error) is the tool's error, never "out of scope". */
export async function aLayoutReadFailureIsNotOutOfScope(): Promise<void> {
  const broken = services({
    layouts: {
      get: async () => {
        throw new Error("connection reset");
      },
    },
  });
  await expect(getMimicLayoutTool.run(broken, { id: LAYOUT }, ctx([ORG_X]))).rejects.toThrow("connection reset");
}

/** The layout list keeps only the turn's organizations. */
export async function theLayoutListKeepsTheTurnsOrganizations(): Promise<void> {
  const row = (organizationId: string, name: string) => ({
    id: LAYOUT,
    organizationId,
    name,
    slug: "plant",
    canvasW: 240,
    canvasH: 160,
    version: 1,
    unitCount: 3,
    symbolLibraries: ["core"],
    updatedAt: STAMP,
  });
  const fake = services({ layouts: { list: async () => ({ items: [row(ORG_X, "Plant X"), row(ORG_Y, "Plant Y")] }) } });
  const result = okResult(await listMimicLayoutsTool.run(fake, {}, ctx([ORG_X])));
  expect((result.items as Array<{ name: string }>).map((item) => item.name)).toEqual(["Plant X"]);
}

const SYMBOL = (key: string, active: boolean) => ({
  id: LIBRARY,
  libraryId: LIBRARY,
  key,
  label: key,
  group: "electrical",
  style: "stroke",
  viewBox: [0, 0, 24, 24],
  shapes: [],
  active,
  sourceFilename: "a.svg",
  sha256: "a".repeat(64),
  updatedAt: STAMP,
});

const ORG_LIBRARY = (code: string, active: boolean, symbols: unknown[]) => ({
  id: LIBRARY,
  organizationId: ORG_X,
  code,
  key: `org.${code}`,
  label: code,
  style: "stroke",
  licence: "Own work",
  attribution: "",
  sourceUrl: null,
  active,
  symbolCount: symbols.length,
  symbols,
  createdAt: STAMP,
  updatedAt: STAMP,
});

function librariesFake() {
  return services({
    symbolLibraries: {
      list: async () => ({
        global: [
          { code: "core", label: "Core", style: "stroke", licence: "MIT", active: true, enabled: true, inactiveSymbolKeys: ["valve"] },
          { code: "tabler", label: "Tabler", style: "stroke", licence: "MIT", active: true, enabled: false, inactiveSymbolKeys: [] },
          { code: "mdi", label: "MDI", style: "fill", licence: "Apache", active: false, enabled: true, inactiveSymbolKeys: [] },
        ],
        organization: [
          ORG_LIBRARY("plant", true, [SYMBOL("org.plant:pump", true), SYMBOL("org.plant:old", false)]),
          ORG_LIBRARY("gone", false, [SYMBOL("org.gone:fan", true)]),
        ],
      }),
    },
  });
}

/** Only the live libraries and live symbols are listed: a disabled or retired library and a retired symbol are absent. */
export async function theSymbolListHoldsLiveLibrariesOnly(): Promise<void> {
  const result = okResult(await listMimicSymbolsTool.run(librariesFake(), {}, ctx([ORG_X])));
  const [organization] = result.organizations as Array<{
    global: Array<{ code: string }>;
    organization: Array<{ key: string; symbols: Array<{ key: string }> }>;
  }>;
  expect(organization?.global.map((library) => library.code)).toEqual(["core"]);
  expect(organization?.organization.map((library) => library.key)).toEqual(["org.plant"]);
  expect(organization?.organization[0]?.symbols.map((symbol) => symbol.key)).toEqual(["org.plant:pump"]);
}

/** The symbol list never carries a shape or an SVG body. */
export async function theSymbolListCarriesNoShape(): Promise<void> {
  const text = JSON.stringify(okResult(await listMimicSymbolsTool.run(librariesFake(), {}, ctx([ORG_X]))));
  expect(text).not.toContain("shapes");
  expect(text).not.toContain("viewBox");
  expect(text).not.toContain("svg");
}

/** The role list holds active roles only, code and label. */
export async function theRoleListHoldsActiveRolesOnly(): Promise<void> {
  const fake = services({
    vocabularies: {
      list: async () => ({
        ruleCategories: [],
        assetDomains: [],
        alarmSeverities: [],
        alarmSkills: [],
        assetRoles: [
          { code: "transformer", label: "Transformer", sortOrder: 110, active: true },
          { code: "old_role", label: "Old", sortOrder: 120, active: false },
        ],
        dashboardSections: [],
      }),
    },
  });
  const result = await listAssetRolesTool.run(fake, {}, ctx([ORG_X]));
  expect(result).toEqual({ ok: true, result: { items: [{ code: "transformer", label: "Transformer" }] }, organizationIds: [] });
}

/** A 500-symbol library stays inside the budget: whole rows only, never cut, and `truncated` says more exist. */
export async function aLargeSymbolListIsBoundedAndSaysSo(): Promise<void> {
  const many = Array.from({ length: 500 }, (_, i) => SYMBOL(`org.plant:symbol-number-${i}`, true));
  const fake = services({
    symbolLibraries: { list: async () => ({ global: [], organization: [ORG_LIBRARY("plant", true, many)] }) },
  });
  const result = okResult(await listMimicSymbolsTool.run(fake, {}, ctx([ORG_X])));
  expect(toolResultContent({ ok: true, result })).not.toContain(TOOL_RESULT_CUT_TAIL);
  expect(result.truncated).toBe(true);
  const listed = (result.organizations as Array<{ organization: Array<{ symbols: unknown[] }> }>)[0]?.organization[0]?.symbols ?? [];
  expect(listed.length).toBeGreaterThan(10);
  expect(listed.length).toBeLessThan(500);
  const small = okResult(await listMimicSymbolsTool.run(librariesFake(), {}, ctx([ORG_X])));
  expect(small.truncated).toBe(false);
}
