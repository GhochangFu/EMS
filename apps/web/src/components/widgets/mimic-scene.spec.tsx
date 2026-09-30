import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, vi } from "vitest";

import { mimicCoreSymbolSchema, mimicStaticSymbolSchema } from "@bms/shared/contracts";
import type { GeneratedSiteAssetDto, MimicLayoutNodeDto, MimicNodeDto, MimicSymbol } from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { layoutGeometry } from "../../lib/mimic-geometry";
import { LAYOUT, ORG_SYMBOL } from "../../lib/mimic-geometry.spec";
import { MIMIC_PANEL_CLASSES, type MimicGlyphKind } from "../../lib/mimic";
import { MimicGlyph, matrixScale } from "./mimic-glyphs";
import { MimicScene } from "./mimic-scene";
import { MIMIC_SHAPE_ATTRS, MIMIC_SHAPE_TAGS, librarySymbolShapes } from "./mimic-symbol-libraries";
import { NO_LIVE_READINGS } from "./mimic-widget";

/** S21 — the click spy the hostile stub shapes carry; hoisted so the `vi.mock` factory can read it. */
const HOSTILE = vi.hoisted(() => ({ click: vi.fn() }));

// S18 — a stubbed key whose one shape carries a fixed identity-matrix `transform`, independent of
// the vendored wmpid transforms. S21 — three stubbed keys whose shape objects also carry keys
// outside the whitelist, one per render site: stroke, stroke with a transform, and fill.
vi.mock("./mimic-symbol-libraries", async (importOriginal) => {
  const original = await importOriginal<typeof import("./mimic-symbol-libraries")>();
  const hostile = (extra: Record<string, string>) => [
    [
      "path",
      {
        d: "M0 0 L10 10",
        ...extra,
        style: { display: "none" },
        dangerouslySetInnerHTML: { __html: '<circle data-planted="1"></circle>' },
        onClick: HOSTILE.click,
        href: "#planted",
      },
    ],
  ];
  const stubs: Record<string, { style: "stroke" | "fill"; shapes: unknown }> = {
    "wmpid:test": { style: "stroke", shapes: [["path", { d: "M0 0 L10 10", transform: "matrix(1,0,0,1,2,3)" }]] },
    "wmpid:hostile": { style: "stroke", shapes: hostile({}) },
    "wmpid:hostile-transformed": { style: "stroke", shapes: hostile({ transform: "matrix(1,0,0,1,2,3)" }) },
    "mdi:hostile": { style: "fill", shapes: hostile({}) },
  };
  return {
    ...original,
    librarySymbolShapes: (key: string) =>
      Object.prototype.hasOwnProperty.call(stubs, key)
        ? (stubs[key] as ReturnType<typeof original.librarySymbolShapes>)
        : original.librarySymbolShapes(key),
  };
});

/** Every library key, core keys excluded, in shared-registry order (D1: core, then each library). */
const LIBRARY_KEYS = mimicStaticSymbolSchema.options.filter(
  (key) => !(mimicCoreSymbolSchema.options as readonly string[]).includes(key),
);

/** A CSS selector matching every whitelisted shape element (D8, ADR 0084 decision 5). */
const SHAPE_SELECTOR = MIMIC_SHAPE_TAGS.join(", ");

/**
 * `F3.32c` U4 — what `MimicScene` draws for a stored layout (ADR 0081, plan D10, D6).
 *
 * The layout is `mimic-geometry.spec.ts`' `LAYOUT`: a roled `tank_a` and a passive half-width
 * `pump_b` inside the `plant` panel, a passive `out` outside it, one free label, two pipes. The
 * preset's drawing is held by `mimic-widget.spec.tsx`, which renders through this scene.
 */

const TANK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = Date.parse("2026-09-28T10:00:00.000Z");

const TANK: GeneratedSiteAssetDto = {
  id: TANK_ID,
  code: "WTR-TNK-09",
  name: "Tank",
  domain: "water",
  latestTelemetryAt: null,
  freshness: "none",
  points: [{ pointKey: "flow", name: "Flow", unit: "m3/h", headlineRank: 1, latest: null }],
};

const TANK_NODE: MimicNodeDto = {
  key: "tank_a",
  label: "Tank A",
  roleCode: "water_intake",
  asset: TANK,
  memberCount: 1,
  activeAlarms: 0,
  topAlarm: null,
};

const FRESH: SiteLiveReadings = {
  nowMs: NOW,
  pointLatest: () => ({ value: 12, time: "t", atMs: NOW - 1_000 }),
  assetLastSeenMs: () => NOW - 1_000,
};

function renderScene(nodes: readonly MimicNodeDto[] = [], readings = NO_LIVE_READINGS, extra: ReactElement | null = null): void {
  render(
    <MimicScene title="Plant B board" geometry={layoutGeometry(LAYOUT)} nodes={nodes} readings={readings}>
      {extra}
    </MimicScene>,
  );
}

function unitEl(key: string): HTMLElement {
  const el = screen.getAllByTestId("mimic-node").find((n) => n.getAttribute("data-node-key") === key);
  expect(el, `no mimic-node ${key}`).toBeDefined();
  return el as HTMLElement;
}

/** S1 — every unit draws once, with its symbol; the panel groups the two units it holds. */
export function drawsEveryUnitWithItsSymbol(): void {
  renderScene();
  const units = screen.getAllByTestId("mimic-node");
  expect(units.map((u) => [u.getAttribute("data-node-key"), within(u).getAllByTestId("mimic-glyph")[0]?.getAttribute("data-glyph")])).toEqual([
    ["tank_a", "tank"],
    ["pump_b", "pump"],
    ["out", "discharge"],
  ]);
  const panel = screen.getByTestId("mimic-panel");
  expect(within(panel).getAllByTestId("mimic-node").map((u) => u.getAttribute("data-node-key"))).toEqual(["tank_a", "pump_b"]);
}

/** S2 — a passive unit draws its symbol, marked passive, with no status, no value and no "Not assigned". */
export function passiveUnitDrawsNoStatus(): void {
  renderScene();
  const pump = unitEl("pump_b");
  expect(pump.getAttribute("data-status")).toBe("passive");
  expect(within(pump).getByTestId("mimic-glyph").getAttribute("data-glyph")).toBe("pump");
  expect(within(pump).queryByTestId("mimic-node-status")).toBeNull();
  expect(within(pump).queryAllByTestId("mimic-point")).toHaveLength(0);
  expect(within(pump).queryByText("Not assigned")).toBeNull();
  expect(pump.getAttribute("class") ?? "").not.toContain("opacity-50");
}

/** S3 — a roled unit the response does not list says "Not assigned", dimmed. */
export function roledUnitWithoutEntryIsNotAssigned(): void {
  renderScene();
  const tank = unitEl("tank_a");
  expect(tank.getAttribute("data-status")).toBe("unassigned");
  expect(within(tank).getByText("Not assigned")).toBeInTheDocument();
  expect(tank.getAttribute("class")).toContain("opacity-50");
}

/** S4 — a resolved roled unit shows its asset code, status and value, and its pipe flows; a passive one's does not. */
export function resolvedUnitShowsItsAsset(): void {
  renderScene([TANK_NODE], FRESH);
  const tank = unitEl("tank_a");
  expect(tank.getAttribute("data-status")).toBe("live");
  expect(within(tank).getByText("WTR-TNK-09")).toBeInTheDocument();
  expect(within(tank).getByTestId("mimic-point-value").textContent).toBe("12 m3/h");
  expect(screen.getAllByTestId("mimic-flow").map((f) => f.getAttribute("data-flow-from"))).toEqual(["tank_a"]);
}

/** S5 — the panel frame, the free label and the two pipes draw; a layout draws no pump and no sink. */
export function drawsPanelLabelAndPipes(): void {
  renderScene();
  expect(screen.getAllByTestId("mimic-panel-frame").map((p) => p.getAttribute("data-panel-key"))).toEqual(["plant"]);
  expect(screen.getByText("PLANT")).toBeInTheDocument();
  expect(screen.getByTestId("mimic-label").textContent).toBe("Line 1");
  expect(screen.getAllByTestId("mimic-pipe").map((p) => p.getAttribute("d"))).toEqual(["M230 136 H300", "M400 155.5 H800"]);
  expect(screen.queryByTestId("mimic-pump")).toBeNull();
  expect(screen.queryByTestId("mimic-sink")).toBeNull();
}

/** S6 — each unit draws in its slot scaled into its box: the half-width pump at half scale, centred. */
export function unitsDrawAtTheirScale(): void {
  renderScene();
  expect(unitEl("tank_a").getAttribute("transform")).toBe("translate(30 50) scale(1)");
  expect(unitEl("pump_b").getAttribute("transform")).toBe("translate(300 112.5) scale(0.5)");
}

/** S7 — the drawing is one image named by the title and the layout's name; the viewBox is the canvas. */
export function drawingIsNamedByTheLayout(): void {
  renderScene();
  const img = screen.getByRole("img", { name: "Plant B board: Plant B" });
  expect(img.getAttribute("viewBox")).toBe("0 0 1200 600");
}

/** S8 — children draw inside the `<svg>`, after every unit. */
export function childrenDrawInsideTheSvgLast(): void {
  renderScene([], NO_LIVE_READINGS, <rect data-testid="overlay" x={0} y={0} width={10} height={10} fill="none" />);
  const overlay = screen.getByTestId("overlay");
  const svg = screen.getByRole("img");
  expect(overlay.parentElement).toBe(svg);
  expect(svg.lastElementChild).toBe(overlay);
}

/** S9 — every symbol of the closed shared set draws a non-empty glyph (a missing path draws nothing). */
export function everySymbolDrawsAGlyph(): void {
  render(
    <svg>
      {mimicCoreSymbolSchema.options.map((kind) => (
        <MimicGlyph key={kind} kind={kind} x={0} y={0} size={24} className="stroke-ink" />
      ))}
    </svg>,
  );
  const glyphs = screen.getAllByTestId("mimic-glyph");
  expect(glyphs.map((g) => g.getAttribute("data-glyph"))).toEqual([...mimicCoreSymbolSchema.options]);
  for (const g of glyphs) {
    expect(g.childElementCount, g.getAttribute("data-glyph") ?? "").toBeGreaterThan(0);
  }
}

/**
 * S10 — no two symbols draw the same markup (29 distinct `renderToStaticMarkup` strings), by
 * their drawn contents alone: `data-glyph` names the kind on every glyph's wrapper, so it is
 * stripped first or the check would trivially pass without comparing a single path.
 */
export function noTwoSymbolsDrawTheSameMarkup(): void {
  const markup = mimicCoreSymbolSchema.options.map((kind) =>
    renderToStaticMarkup(
      <svg>
        <MimicGlyph kind={kind} x={0} y={0} size={24} className="stroke-ink" />
      </svg>,
    ).replace(/ data-glyph="[^"]*"/, ""),
  );
  expect(markup.some((m) => m.includes("data-glyph"))).toBe(false);
  expect(new Set(markup).size).toBe(mimicCoreSymbolSchema.options.length);
}

/** S11 — every glyph names no colour: no `fill`/`stroke` other than `none`, no `className` on paths. */
export function everyGlyphNamesNoColour(): void {
  for (const kind of mimicCoreSymbolSchema.options) {
    const { container } = render(
      <svg>
        <MimicGlyph kind={kind} x={0} y={0} size={24} className="stroke-ink" />
      </svg>,
    );
    const paths = container.querySelectorAll("path, circle, rect, ellipse, polyline, polygon, line");
    expect(paths.length, `${kind} draws no shape`).toBeGreaterThan(0);
    for (const el of Array.from(paths)) {
      const fill = el.getAttribute("fill");
      const stroke = el.getAttribute("stroke");
      expect(fill === null || fill === "none", `${kind} fill=${fill}`).toBe(true);
      expect(stroke === null || stroke === "none", `${kind} stroke=${stroke}`).toBe(true);
      expect(el.getAttribute("class"), `${kind} className on shape`).toBeNull();
    }
    cleanup();
  }
}

/** S12 — every library key (`tabler:*`, `lucide:*`, `mdi:*`) draws at least one shape, no fallback. */
export function everyLibraryKeyDrawsAGlyphWithNoFallback(): void {
  render(
    <svg>
      {LIBRARY_KEYS.map((kind) => (
        <MimicGlyph key={kind} kind={kind as MimicGlyphKind} x={0} y={0} size={24} className="stroke-ink" />
      ))}
    </svg>,
  );
  const glyphs = screen.getAllByTestId("mimic-glyph");
  expect(glyphs).toHaveLength(LIBRARY_KEYS.length);
  for (const g of glyphs) {
    expect(g.getAttribute("data-glyph-fallback"), g.getAttribute("data-glyph") ?? "").toBeNull();
    expect(g.childElementCount, g.getAttribute("data-glyph") ?? "").toBeGreaterThan(0);
  }
}

/** S13 — an unknown key draws the `unit` fallback, marked, and never throws. */
export function anUnknownKeyFallsBackToUnitAndDoesNotThrow(): void {
  expect(() =>
    render(
      <svg>
        <MimicGlyph kind={"nope:missing" as MimicGlyphKind} x={0} y={0} size={24} className="stroke-ink" />
      </svg>,
    ),
  ).not.toThrow();
  const glyph = screen.getByTestId("mimic-glyph");
  expect(glyph.getAttribute("data-glyph-fallback")).toBe("true");
}

/**
 * S13b — a key that names an inherited object property (`constructor`) is not a core symbol: it
 * draws the marked `unit` fallback, never a function as a child.
 */
export function anInheritedPropertyNameFallsBackToUnit(): void {
  render(
    <svg>
      <MimicGlyph kind={"constructor" as MimicGlyphKind} x={0} y={0} size={24} className="stroke-ink" />
    </svg>,
  );
  const glyph = screen.getByTestId("mimic-glyph");
  expect(glyph.getAttribute("data-glyph-fallback")).toBe("true");
  expect(glyph.children.length).toBeGreaterThan(0);
}

/** S14 — a stroke library glyph draws like a core glyph: `fill="none"`, no colour on a shape. */
export function strokeLibraryGlyphHasNoFillAndNoShapeColour(): void {
  for (const kind of ["tabler:bolt", "lucide:factory"] as const) {
    render(
      <svg>
        <MimicGlyph kind={kind} x={0} y={0} size={24} className="stroke-accent" />
      </svg>,
    );
    const glyph = screen.getByTestId("mimic-glyph");
    expect(glyph.getAttribute("fill"), kind).toBe("none");
    expect(glyph.getAttribute("class"), kind).toBe("stroke-accent");
    const shapes = glyph.querySelectorAll(SHAPE_SELECTOR);
    expect(shapes.length, kind).toBeGreaterThan(0);
    for (const shape of Array.from(shapes)) {
      expect(shape.getAttribute("fill"), `${kind} shape fill`).toBeNull();
      expect(shape.getAttribute("stroke"), `${kind} shape stroke`).toBeNull();
      expect(shape.getAttribute("class"), `${kind} shape class`).toBeNull();
    }
    cleanup();
  }
}

/** S15 — a fill library glyph draws with no stroke, the matching fill class, no `fill="none"`, no shape colour. */
export function fillLibraryGlyphHasNoStrokeAndTheFillClass(): void {
  render(
    <svg>
      <MimicGlyph kind="mdi:heat-pump" x={0} y={0} size={24} className="stroke-info" />
    </svg>,
  );
  const glyph = screen.getByTestId("mimic-glyph");
  expect(glyph.getAttribute("stroke")).toBe("none");
  expect(glyph.getAttribute("data-glyph-style")).toBe("fill");
  expect(glyph.getAttribute("class")).toBe("fill-info");
  expect(glyph.getAttribute("stroke-width")).toBeNull();
  expect(glyph.getAttribute("fill")).toBeNull();
  const shapes = glyph.querySelectorAll(SHAPE_SELECTOR);
  expect(shapes.length).toBeGreaterThan(0);
  for (const shape of Array.from(shapes)) {
    expect(shape.getAttribute("fill"), "shape fill").toBeNull();
    expect(shape.getAttribute("stroke"), "shape stroke").toBeNull();
    expect(shape.getAttribute("class"), "shape class").toBeNull();
  }
}

/** S16a — every panel glyph class, plus `stroke-ink-faint`, draws with the same role's fill class. */
export function everyPanelGlyphClassDrawsItsFillRole(): void {
  const strokeClasses = [...Object.values(MIMIC_PANEL_CLASSES).map((c) => c.glyph), "stroke-ink-faint"];
  for (const strokeClass of strokeClasses) {
    render(
      <svg>
        <MimicGlyph kind="mdi:heat-pump" x={0} y={0} size={24} className={strokeClass} />
      </svg>,
    );
    const role = strokeClass.replace(/^stroke-/, "");
    expect(screen.getByTestId("mimic-glyph").getAttribute("class"), strokeClass).toBe(`fill-${role}`);
    cleanup();
  }
}

/** S16b — a class with no fill counterpart falls back to `fill-ink-muted`. */
export function anUnmappedGlyphClassFallsBackToFillInkMuted(): void {
  render(
    <svg>
      <MimicGlyph kind="mdi:heat-pump" x={0} y={0} size={24} className="stroke-something-unmapped" />
    </svg>,
  );
  expect(screen.getByTestId("mimic-glyph").getAttribute("class")).toBe("fill-ink-muted");
}

/**
 * `F3.32f` slice 3 (ADR 0086 decision 7, plan D8) — a layout whose units draw organization
 * symbols: `org_passive` (no role) and `org_roled` both name `ORG_SYMBOL`; `org_missing` names a
 * key the layout did not embed.
 */
function renderOrgScene(): void {
  const node = (key: string, x: number, roleCode: string | null, symbol: string): MimicLayoutNodeDto => ({
    key,
    kind: "unit",
    symbol: symbol as MimicSymbol,
    label: key,
    roleCode,
    tone: null,
    x,
    y: 5,
    w: 20,
    h: 25,
    z: 0,
  });
  const geometry = layoutGeometry({
    name: "Org plant",
    canvasW: 120,
    canvasH: 60,
    nodes: [
      node("org_passive", 5, null, ORG_SYMBOL.key),
      node("org_roled", 35, "water_intake", ORG_SYMBOL.key),
      node("org_missing", 65, null, "org.plant:missing"),
    ],
    pipes: [],
    orgSymbols: [ORG_SYMBOL],
  });
  render(<MimicScene title="Org plant" geometry={geometry} nodes={[]} readings={NO_LIVE_READINGS} />);
}

function glyphOf(key: string): HTMLElement {
  return within(unitEl(key)).getAllByTestId("mimic-glyph")[0] as HTMLElement;
}

/**
 * S18 — a unit whose key matches an `orgSymbols` entry draws that symbol's shapes, at both unit
 * call sites (passive and roled). Mutation: drop `orgSymbol=` at either call site → this claim reddens.
 */
export function aUnitMatchingAnOrgSymbolReceivesIt(): void {
  renderOrgScene();
  expect(
    ["org_passive", "org_roled"].map((key) => {
      const glyph = glyphOf(key);
      return [key, glyph.getAttribute("data-glyph-source"), glyph.getAttribute("data-glyph-fallback"), glyph.querySelectorAll("rect").length];
    }),
  ).toEqual([
    ["org_passive", "org", null, ORG_SYMBOL.shapes.length],
    ["org_roled", "org", null, ORG_SYMBOL.shapes.length],
  ]);
}

/** S19 — an organization key the layout did not embed draws the marked fallback and nothing of an org symbol. */
export function anOrgKeyWithNoMatchDrawsTheFallback(): void {
  expect(() => renderOrgScene()).not.toThrow();
  const glyph = glyphOf("org_missing");
  expect([glyph.getAttribute("data-glyph-fallback"), glyph.getAttribute("data-glyph-source")]).toEqual(["true", null]);
}

/** S17 — every library shape's tag and attribute names are the whitelisted geometry set. */
export function everyLibraryShapeUsesWhitelistedTagsAndAttrs(): void {
  for (const key of LIBRARY_KEYS) {
    const result = librarySymbolShapes(key);
    expect(result, key).not.toBeNull();
    for (const [tag, attrs] of result!.shapes) {
      expect((MIMIC_SHAPE_TAGS as readonly string[]).includes(tag), `${key} tag ${tag}`).toBe(true);
      for (const attr of Object.keys(attrs)) {
        expect((MIMIC_SHAPE_ATTRS as readonly string[]).includes(attr), `${key} attr ${attr}`).toBe(true);
      }
    }
  }
}

/** S18 — a shape carrying a `transform` renders it verbatim, with no attribute outside the whitelist. */
export function aShapeCarryingATransformRendersItVerbatim(): void {
  render(
    <svg>
      <MimicGlyph kind={"wmpid:test" as MimicGlyphKind} x={0} y={0} size={24} className="stroke-ink" />
    </svg>,
  );
  const glyph = screen.getByTestId("mimic-glyph");
  expect(glyph.getAttribute("data-glyph-fallback")).toBeNull();
  const path = glyph.querySelector("path");
  expect(path).not.toBeNull();
  expect(path?.getAttribute("transform")).toBe("matrix(1,0,0,1,2,3)");
  for (const name of path?.getAttributeNames() ?? []) {
    expect((MIMIC_SHAPE_ATTRS as readonly string[]).includes(name), `attribute ${name}`).toBe(true);
  }
}

/** The vendored library keys that hold at least one shape carrying a `transform`, in registry order. */
function keysWithATransformedShape(): string[] {
  return LIBRARY_KEYS.filter((key) => librarySymbolShapes(key)?.shapes.some(([, attrs]) => "transform" in attrs));
}

/** S20a — every vendored `transform` is one `matrix(...)`, the only form `matrixScale` reads (positive control: >= 1). */
export function everyVendoredTransformIsOneMatrix(): void {
  const keys = keysWithATransformedShape();
  expect(keys.length, "keys holding a transformed shape").toBeGreaterThan(0);
  for (const key of keys) {
    for (const [, attrs] of librarySymbolShapes(key)!.shapes) {
      const transform = (attrs as { transform?: string }).transform;
      if (transform === undefined) continue;
      expect(transform, key).toMatch(/^matrix\([^()]*\)$/);
    }
  }
}

/** S20b — `matrixScale` is the square root of |ad − bc|, and 1 for a degenerate or unreadable transform. */
export function matrixScaleReadsTheLinearPart(): void {
  expect(matrixScale("matrix(0,0.5,0.5,0,3,4)")).toBeCloseTo(0.5, 10);
  expect(matrixScale("matrix(2 0 0 0.5 0 0)")).toBeCloseTo(1, 10);
  expect(matrixScale("matrix(0,0,0,0,0,0)")).toBe(1);
  expect(matrixScale("rotate(30)")).toBe(1);
  expect(matrixScale(undefined)).toBe(1);
}

/**
 * S20c — a transformed shape of a stroke library draws its stroke at the glyph's 1.5 units: its
 * wrapper `g` divides the width by the matrix scale. A baked sibling sits directly under the glyph.
 */
export function aTransformedShapeKeepsTheGlyphStrokeWidth(): void {
  const key = keysWithATransformedShape().find((k) =>
    librarySymbolShapes(k)!.shapes.some(([, attrs]) => !("transform" in attrs)),
  );
  expect(key, "a key holding a transformed and a baked shape").toBeDefined();
  const { shapes, style } = librarySymbolShapes(key!)!;
  expect(style).toBe("stroke");
  render(
    <svg>
      <MimicGlyph kind={key as MimicGlyphKind} x={0} y={0} size={24} className="stroke-ink" />
    </svg>,
  );
  const glyph = screen.getByTestId("mimic-glyph");
  const all = [...glyph.querySelectorAll(SHAPE_SELECTOR)];
  const transformed = all.filter((el) => el.hasAttribute("transform"));
  const baked = all.filter((el) => !el.hasAttribute("transform"));
  expect(transformed.length).toBe(shapes.filter(([, attrs]) => "transform" in attrs).length);
  expect(baked.length).toBeGreaterThan(0);
  for (const el of transformed) {
    const wrapper = el.parentElement!;
    expect(wrapper.tagName.toLowerCase()).toBe("g");
    expect(wrapper).not.toBe(glyph);
    const scale = matrixScale(el.getAttribute("transform") ?? undefined);
    expect(scale).toBeLessThan(1);
    expect(Number(wrapper.getAttribute("stroke-width"))).toBeCloseTo(1.5 / scale, 3);
  }
  for (const el of baked) {
    expect(el.parentElement).toBe(glyph);
    expect(el.hasAttribute("stroke-width")).toBe(false);
  }
}

/**
 * S21 — ADR 0086 decision 6: the renderer copies only the whitelisted keys into props. A stubbed
 * shape object also carrying `style`, `dangerouslySetInnerHTML`, `onClick` and `href` draws its
 * path with `d` (and its `transform`) and none of the four. One claim per render site, so a
 * mutation that restores one spread reddens that claim alone.
 */
function aStoredShapeObjectIsNeverSpread(kind: string, transform: string | null): void {
  HOSTILE.click.mockClear();
  render(
    <svg>
      <MimicGlyph kind={kind as MimicGlyphKind} x={0} y={0} size={24} className="stroke-ink" />
    </svg>,
  );
  const glyph = screen.getByTestId("mimic-glyph");
  expect(glyph.getAttribute("data-glyph-fallback")).toBeNull();
  const path = glyph.querySelector("path");
  expect(path?.getAttribute("d")).toBe("M0 0 L10 10");
  expect(path?.getAttribute("transform") ?? null).toBe(transform);
  expect(path?.hasAttribute("style")).toBe(false);
  expect(path?.hasAttribute("href")).toBe(false);
  expect(path?.innerHTML).toBe("");
  expect(glyph.querySelector("[data-planted]")).toBeNull();
  path?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(HOSTILE.click).not.toHaveBeenCalled();
}

/** S21a — the stroke site, a shape with no transform. */
export function strokeShapeIsNotSpread(): void {
  aStoredShapeObjectIsNeverSpread("wmpid:hostile", null);
}

/** S21b — the stroke site, a shape inside its stroke-width wrapper. */
export function transformedStrokeShapeIsNotSpread(): void {
  aStoredShapeObjectIsNeverSpread("wmpid:hostile-transformed", "matrix(1,0,0,1,2,3)");
}

/** S21c — the fill site. */
export function fillShapeIsNotSpread(): void {
  aStoredShapeObjectIsNeverSpread("mdi:hostile", null);
}
