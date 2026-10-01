import { expect } from "vitest";

import { MIMIC_LAYOUT_BOUNDS } from "@bms/shared";

import { createMimicLayoutBodySchema, putMimicLayoutBodySchema } from "./mimic-layouts.schema";

/**
 * `F3.32c` U2 — the mimic layout write bodies (plan U2 "Bodies"). One exported
 * function per refusal, one `it()` per function in the sibling `.test.ts`, so
 * a dropped rule reddens its own case. Each refusal asserts the exact issue
 * paths, so a refusal by a neighbouring rule cannot pass for the one named.
 */

const ORG = "11111111-1111-4111-8111-111111111111";

type Body = Record<string, unknown> & { nodes: Array<Record<string, unknown>>; pipes: Array<Record<string, unknown>> };

/** A valid body: two roled units, a passive unit, a panel, a label, two pipes. */
export const validCreateBody = (): Body => ({
  organizationId: ORG,
  name: "Water train",
  slug: "water-train",
  canvasW: 120,
  canvasH: 80,
  nodes: [
    { key: "intake", kind: "unit", symbol: "tank", label: "Intake", roleCode: "pump", x: 0, y: 0, w: 10, h: 10 },
    { key: "filter", kind: "unit", symbol: "filter", label: "Filter", roleCode: "wtp", x: 20, y: 0, w: 10, h: 10, z: 2 },
    { key: "discharge", kind: "unit", symbol: "discharge", label: "Discharge", x: 40, y: 0, w: 10, h: 10 },
    { key: "pre", kind: "panel", label: "Pre-treatment", tone: "info", x: 0, y: 20, w: 60, h: 30 },
    { key: "title", kind: "label", label: "Plant A", x: 0, y: 60, w: 30, h: 5 },
  ],
  pipes: [
    { fromKey: "intake", toKey: "filter" },
    { fromKey: "filter", toKey: "discharge" },
  ],
});

type Issue = { path: (string | number)[]; message: string };

type Schema = typeof createMimicLayoutBodySchema | typeof putMimicLayoutBodySchema;

const issuesOf = (schema: Schema, value: unknown): Issue[] => {
  const result = schema.safeParse(value);
  return result.success ? [] : (result.error.issues as Issue[]);
};

/** The body is refused, and every issue sits at exactly `paths`. */
const refusedAt = (value: unknown, paths: string[], schema: Schema = createMimicLayoutBodySchema): void => {
  const issues = issuesOf(schema, value);
  expect(issues.length, "the body must be refused").toBeGreaterThan(0);
  expect(issues.map((i) => i.path.join(".")).sort()).toEqual([...paths].sort());
};

const withNode = (index: number, patch: Record<string, unknown>): Body => {
  const body = validCreateBody();
  body.nodes[index] = { ...body.nodes[index], ...patch };
  return body;
};

export function acceptsAValidCreateBody(): void {
  expect(issuesOf(createMimicLayoutBodySchema, validCreateBody())).toEqual([]);
}

export function acceptsAValidPutBodyWithAVersion(): void {
  const { organizationId: _drop, ...rest } = validCreateBody();
  expect(issuesOf(putMimicLayoutBodySchema, { ...rest, version: 3 })).toEqual([]);
}

export function refusesAnUnknownBodyKey(): void {
  refusedAt({ ...validCreateBody(), colour: "red" }, [""]);
}

export function refusesAnUnknownNodeKey(): void {
  refusedAt(withNode(0, { colour: "red" }), ["nodes.0"]);
}

export function refusesAUnitWithoutASymbol(): void {
  const body = validCreateBody();
  delete body.nodes[0]!.symbol;
  refusedAt(body, ["nodes.0.symbol"]);
}

export function refusesAUnitWithATone(): void {
  refusedAt(withNode(0, { tone: "info" }), ["nodes.0.tone"]);
}

export function refusesAPanelWithASymbol(): void {
  refusedAt(withNode(3, { symbol: "tank" }), ["nodes.3.symbol"]);
}

export function refusesAPanelWithARole(): void {
  refusedAt(withNode(3, { roleCode: "pump" }), ["nodes.3.roleCode"]);
}

export function refusesAPanelWithoutATone(): void {
  refusedAt(withNode(3, { tone: undefined }), ["nodes.3.tone"]);
}

export function refusesALabelWithATone(): void {
  refusedAt(withNode(4, { tone: "neutral" }), ["nodes.4.tone"]);
}

export function refusesAnUnknownSymbol(): void {
  refusedAt(withNode(0, { symbol: "reactor" }), ["nodes.0.symbol"]);
}

export function refusesANodeKeyOutsideTheCharset(): void {
  const body = validCreateBody();
  body.nodes[4] = { ...body.nodes[4], key: "Title" };
  refusedAt(body, ["nodes.4.key"]);
}

export function refusesADuplicateNodeKey(): void {
  const body = validCreateBody();
  body.nodes[4] = { ...body.nodes[4], key: "pre" };
  refusedAt(body, ["nodes.4.key"]);
}

export function refusesANodeOutsideTheCanvas(): void {
  // Inside the grid's 240 maximum, outside this layout's 120-wide canvas.
  refusedAt(withNode(0, { x: 115, w: 6 }), ["nodes.0"]);
}

export function acceptsANodeTouchingTheCanvasEdge(): void {
  expect(issuesOf(createMimicLayoutBodySchema, withNode(0, { x: 110, w: 10 }))).toEqual([]);
}

export function refusesAPipeToAPanel(): void {
  const body = validCreateBody();
  body.pipes[1] = { fromKey: "filter", toKey: "pre" };
  refusedAt(body, ["pipes.1.toKey"]);
}

export function refusesAPipeToAnUnknownKey(): void {
  const body = validCreateBody();
  body.pipes[1] = { fromKey: "ghost", toKey: "discharge" };
  refusedAt(body, ["pipes.1.fromKey"]);
}

export function refusesAPipeFromAUnitToItself(): void {
  const body = validCreateBody();
  body.pipes[1] = { fromKey: "filter", toKey: "filter" };
  refusedAt(body, ["pipes.1"]);
}

export function refusesADuplicatePipe(): void {
  const body = validCreateBody();
  body.pipes.push({ fromKey: "intake", toKey: "filter" });
  refusedAt(body, ["pipes.2"]);
}

export function refusesACanvasWiderThanTheGrid(): void {
  refusedAt({ ...validCreateBody(), canvasW: MIMIC_LAYOUT_BOUNDS.canvasW.max + 1 }, ["canvasW"]);
}

export function refusesMoreNodesThanTheBound(): void {
  const nodes = Array.from({ length: MIMIC_LAYOUT_BOUNDS.maxNodes + 1 }, (_, i) => ({
    key: `l${i}`,
    kind: "label",
    label: `L${i}`,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
  }));
  refusedAt({ ...validCreateBody(), nodes, pipes: [] }, ["nodes"]);
}

export function refusesAnUnsafeSlug(): void {
  refusedAt({ ...validCreateBody(), slug: "Water Train" }, ["slug"]);
}

export function refusesAPutBodyWithoutAVersion(): void {
  const { organizationId: _drop, ...rest } = validCreateBody();
  refusedAt(rest, ["version"], putMimicLayoutBodySchema);
}

export function refusesAPutBodyWithVersionZero(): void {
  const { organizationId: _drop, ...rest } = validCreateBody();
  refusedAt({ ...rest, version: 0 }, ["version"], putMimicLayoutBodySchema);
}

export function refusesAPutBodyThatNamesAnOrganization(): void {
  refusedAt({ ...validCreateBody(), version: 1 }, [""], putMimicLayoutBodySchema);
}

// `F3.32e` U2 — the layout's chosen symbol libraries (ADR 0084 decision 8, plan D7).

/** A body whose first unit draws `symbol`, with `symbolLibraries` set, or left out when `undefined`. */
const withLibraries = (symbolLibraries: unknown, symbol = "tank"): Body => {
  const body = withNode(0, { symbol });
  if (symbolLibraries !== undefined) body.symbolLibraries = symbolLibraries;
  return body;
};

export function defaultsAnAbsentLibraryListToCore(): void {
  const result = createMimicLayoutBodySchema.safeParse(validCreateBody());
  expect(result.success && result.data.symbolLibraries).toEqual(["core"]);
}

export function defaultsAnAbsentLibraryListToCoreOnAPut(): void {
  const { organizationId: _drop, ...rest } = validCreateBody();
  const result = putMimicLayoutBodySchema.safeParse({ ...rest, version: 1 });
  expect(result.success && result.data.symbolLibraries).toEqual(["core"]);
}

export function refusesALibraryListedTwice(): void {
  refusedAt(withLibraries(["core", "core"]), ["symbolLibraries.1"]);
}

export function refusesAnEmptyLibraryList(): void {
  refusedAt(withLibraries([]), ["symbolLibraries"]);
}

export function refusesAnUnknownLibraryCode(): void {
  refusedAt(withLibraries(["core", "fontawesome"]), ["symbolLibraries.1"]);
}

export function refusesAUnitFromALibraryTheLayoutDidNotChoose(): void {
  const issues = issuesOf(createMimicLayoutBodySchema, withLibraries(["core"], "tabler:bolt"));
  expect(issues.map((i) => i.path.join("."))).toEqual(["nodes.0.symbol"]);
  expect(issues[0]?.message).toBe(
    'Symbol "tabler:bolt" belongs to the Tabler Icons library, which this layout did not choose',
  );
}

export function refusesAPutUnitFromALibraryTheLayoutDidNotChoose(): void {
  const { organizationId: _drop, ...rest } = withLibraries(["core", "tabler"], "mdi:heat-pump");
  const issues = issuesOf(putMimicLayoutBodySchema, { ...rest, version: 2 });
  expect(issues.map((i) => i.path.join("."))).toEqual(["nodes.0.symbol"]);
  expect(issues[0]?.message).toBe(
    'Symbol "mdi:heat-pump" belongs to the Material Design Icons library, which this layout did not choose',
  );
}

export function acceptsAUnitFromAChosenLibrary(): void {
  const result = createMimicLayoutBodySchema.safeParse(withLibraries(["core", "tabler"], "tabler:bolt"));
  expect(result.success ? [] : result.error.issues).toEqual([]);
  expect(result.success && result.data.symbolLibraries).toEqual(["core", "tabler"]);
}

export function acceptsALayoutWithoutCore(): void {
  // R3: core is not mandatory. Every unit of this body draws an MDI glyph.
  const body = validCreateBody();
  body.symbolLibraries = ["mdi"];
  body.nodes = body.nodes.map((n) => (n.kind === "unit" ? { ...n, symbol: "mdi:heat-pump" } : n));
  expect(issuesOf(createMimicLayoutBodySchema, body)).toEqual([]);
}

export function refusesAKeyInNoLibrary(): void {
  refusedAt(withLibraries(["core", "tabler"], "nope:x"), ["nodes.0.symbol"]);
}

// `F3.32f` slice 3 U2 — organization libraries and symbols in a write body (ADR 0086 decision 2).

export function acceptsAnOrgSymbolFromAChosenOrgLibrary(): void {
  const result = createMimicLayoutBodySchema.safeParse(withLibraries(["core", "org.plant"], "org.plant:inlet"));
  expect(result.success ? [] : result.error.issues).toEqual([]);
  expect(result.success && result.data.symbolLibraries).toEqual(["core", "org.plant"]);
  expect(result.success && result.data.nodes[0]?.symbol).toBe("org.plant:inlet");
}

export function refusesAnOrgSymbolFromAnOrgLibraryTheLayoutDidNotChoose(): void {
  const issues = issuesOf(createMimicLayoutBodySchema, withLibraries(["core"], "org.plant:inlet"));
  expect(issues.map((i) => i.path.join("."))).toEqual(["nodes.0.symbol"]);
  expect(issues[0]?.message).toBe(
    'Symbol "org.plant:inlet" belongs to the org.plant library, which this layout did not choose',
  );
}

export function refusesAnOrgLibraryListedTwice(): void {
  // `core` too: the fixture's other units draw core symbols.
  refusedAt(withLibraries(["core", "org.plant", "org.plant"], "org.plant:inlet"), ["symbolLibraries.2"]);
}

export function refusesAnOrgSymbolKeyWithAnUppercaseCode(): void {
  refusedAt(withLibraries(["core", "org.plant"], "org.Plant:x"), ["nodes.0.symbol"]);
}

export function refusesAnOrgLibraryKeyWithAnUppercaseCode(): void {
  refusedAt(withLibraries(["core", "org.Plant"]), ["symbolLibraries.1"]);
}

// `F3.74` Task 1.6 (plan D3b, ADR 0088 Amendment 1 OQ3b) — the unit flags `fanOut` / `isSource`.

/** The parsed node at `index`, for a body that parses. */
const parsedNode = (value: unknown, index: number): Record<string, unknown> => {
  const result = createMimicLayoutBodySchema.safeParse(value);
  if (!result.success) throw new Error(`the body must parse: ${JSON.stringify(result.error.issues)}`);
  return result.data.nodes[index] as Record<string, unknown>;
};

export function acceptsAUnitThatFansOutAndIsASource(): void {
  const node = parsedNode(withNode(0, { fanOut: true, isSource: true }), 0);
  expect(node.fanOut).toBe(true);
  expect(node.isSource).toBe(true);
}

export function refusesAPanelThatFansOut(): void {
  refusedAt(withNode(3, { fanOut: true }), ["nodes.3.fanOut"]);
}

export function refusesALabelThatIsASource(): void {
  refusedAt(withNode(4, { isSource: true }), ["nodes.4.isSource"]);
}

/** An explicit `false` on a panel says nothing: only a `true` flag is a unit's. */
export function acceptsAPanelWithFalseFlags(): void {
  expect(issuesOf(createMimicLayoutBodySchema, withNode(3, { fanOut: false, isSource: false }))).toEqual([]);
}

/** Absent flags stay absent: the service, not the parse, decides the stored `false`. */
export function leavesAbsentFlagsAbsent(): void {
  const node = parsedNode(validCreateBody(), 0);
  expect(Object.keys(node)).not.toContain("fanOut");
  expect(Object.keys(node)).not.toContain("isSource");
  // Positive control: the same read sees a key the body does carry.
  expect(Object.keys(node)).toContain("roleCode");
}

export function refusesAFlagThatIsNotABoolean(): void {
  refusedAt(withNode(0, { fanOut: "yes" }), ["nodes.0.fanOut"]);
}
