import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect } from "vitest";

import { mimicSymbolSchema } from "@bms/shared/contracts";
import type { GeneratedSiteAssetDto, MimicNodeDto } from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { layoutGeometry } from "../../lib/mimic-geometry";
import { LAYOUT } from "../../lib/mimic-geometry.spec";
import { MimicGlyph } from "./mimic-glyphs";
import { MimicScene } from "./mimic-scene";
import { NO_LIVE_READINGS } from "./mimic-widget";

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
      {mimicSymbolSchema.options.map((kind) => (
        <MimicGlyph key={kind} kind={kind} x={0} y={0} size={24} className="stroke-ink" />
      ))}
    </svg>,
  );
  const glyphs = screen.getAllByTestId("mimic-glyph");
  expect(glyphs.map((g) => g.getAttribute("data-glyph"))).toEqual([...mimicSymbolSchema.options]);
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
  const markup = mimicSymbolSchema.options.map((kind) =>
    renderToStaticMarkup(
      <svg>
        <MimicGlyph kind={kind} x={0} y={0} size={24} className="stroke-ink" />
      </svg>,
    ).replace(/ data-glyph="[^"]*"/, ""),
  );
  expect(markup.some((m) => m.includes("data-glyph"))).toBe(false);
  expect(new Set(markup).size).toBe(mimicSymbolSchema.options.length);
}

/** S11 — every glyph names no colour: no `fill`/`stroke` other than `none`, no `className` on paths. */
export function everyGlyphNamesNoColour(): void {
  for (const kind of mimicSymbolSchema.options) {
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
