import { fireEvent, render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import type {
  DashboardMimicNodesResponseDto,
  GeneratedSiteAssetDto,
  MimicLayoutWidgetNodesDto,
  MimicNodeDto,
} from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { fromPreset } from "../../lib/mimic-editor";
import { MimicPreviewCanvas } from "./mimic-preview-canvas";

/**
 * `F4.308` T7 (ADR 0081 Amendment 2 decision 5, plan C10) — the preview's drawing surface: the
 * saved layout through `MimicScene` with the resolved nodes, and one select-only hit rect per
 * roled unit. No drag, no resize, no pipe mode. `mimic-preview-canvas.test.tsx` is the Vitest
 * entry; the `*Fixture` exports are shared with the inspector's and the page's preview specs.
 */

export const PREVIEW_LAYOUT_ID = "11111111-1111-4111-8111-111111111111";
export const PREVIEW_WTP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/** WTP: three listed points (one without a sample), a breaker state point, two open alarms. */
function wtpAsset(): GeneratedSiteAssetDto {
  return {
    id: PREVIEW_WTP_ID,
    code: "WTR-WTP-01",
    name: "Water treatment plant",
    domain: "water",
    latestTelemetryAt: isoAgo(1_000),
    freshness: "live",
    points: [
      { pointKey: "flow", name: "Flow", unit: "m3/h", headlineRank: 1, latest: { value: 10, time: isoAgo(1_000) } },
      { pointKey: "level", name: null, unit: "%", headlineRank: 2, latest: null },
      { pointKey: "pressure", name: "Pressure", unit: "bar", headlineRank: 3, latest: { value: 2.456, time: isoAgo(1_000) } },
    ],
  };
}

/** The saved water train, its roled units resolved: WTP has an asset (fan-out of 3), the rest none. */
export function previewEntryFixture(): MimicLayoutWidgetNodesDto {
  const layout = fromPreset("water_train");
  const nodes: MimicNodeDto[] = layout.nodes
    .filter((n) => n.kind === "unit" && n.roleCode !== null)
    .map((n) => ({
      key: n.key,
      label: n.label,
      roleCode: n.roleCode ?? "",
      asset: n.key === "wtp" ? wtpAsset() : null,
      memberCount: n.key === "wtp" ? 3 : 0,
      activeAlarms: n.key === "wtp" ? 2 : 0,
      topAlarm: null,
      statePoints:
        n.key === "wtp"
          ? [{ pointKey: "breaker_state", name: "Breaker", unit: null, headlineRank: null, latest: { value: 1, time: isoAgo(1_000) } }]
          : [],
      members: [],
    }));
  return {
    source: "layout",
    widgetId: PREVIEW_LAYOUT_ID,
    layoutId: PREVIEW_LAYOUT_ID,
    layout: {
      name: "Stored plant",
      canvasW: layout.canvasW,
      canvasH: layout.canvasH,
      nodes: [...layout.nodes],
      pipes: [...layout.pipes],
      orgSymbols: [],
    },
    nodes,
  };
}

/** The whole preview answer: the one entry, and the breaker key's state map. */
export function previewResponseFixture(): DashboardMimicNodesResponseDto {
  return {
    dashboardId: PREVIEW_LAYOUT_ID,
    resolvedAt: new Date().toISOString(),
    widgets: [previewEntryFixture()],
    stateMaps: [
      {
        pointKey: "breaker_state",
        states: [
          { value: 0, label: "OPEN", tone: "open" },
          { value: 1, label: "CLOSED", tone: "closed" },
        ],
      },
    ],
  };
}

/** Readings seeded from the entry's own samples, as `useSiteLiveReadings` seeds them. */
export function previewReadingsFixture(entry: MimicLayoutWidgetNodesDto): SiteLiveReadings {
  const nowMs = Date.now();
  return {
    nowMs,
    pointLatest: (assetId, point) => {
      for (const node of entry.nodes) {
        if (node.asset?.id !== assetId) continue;
        const found = [...node.asset.points, ...node.statePoints].find((p) => p.pointKey === point.pointKey);
        if (found?.latest != null) return { ...found.latest, atMs: nowMs - 1_000 };
      }
      return null;
    },
    assetLastSeenMs: () => nowMs - 1_000,
  };
}

function renderCanvas(selected: string | null = null) {
  const entry = previewEntryFixture();
  const onSelect = vi.fn<(key: string | null) => void>();
  render(
    <MimicPreviewCanvas
      entry={entry}
      readings={previewReadingsFixture(entry)}
      stateMaps={previewResponseFixture().stateMaps}
      selected={selected}
      onSelect={onSelect}
    />,
  );
  return { onSelect };
}

function hit(key: string): Element {
  const found = screen.getAllByTestId("mimic-preview-hit").find((el) => el.getAttribute("data-node-key") === key);
  if (found === undefined) throw new Error(`no hit rect for ${key}`);
  return found;
}

/** P1 — a resolved unit draws its asset's code, and no roled unit reads "Not assigned". */
export function aResolvedUnitDrawsItsAsset(): void {
  renderCanvas();
  expect(screen.getAllByText("WTR-WTP-01").length).toBeGreaterThan(0);
  expect(screen.queryByText("Not assigned")).toBeNull();
}

/** P2 — a unit the group has no member for draws "No asset at this site". */
export function anUnresolvedUnitReadsNoAssetAtThisSite(): void {
  renderCanvas();
  expect(screen.getAllByText("No asset at this site").length).toBeGreaterThan(0);
}

/** P3 — a click on a roled unit selects it. */
export function aClickOnARoledUnitSelectsIt(): void {
  const { onSelect } = renderCanvas();
  fireEvent.click(hit("wtp"));
  expect(onSelect).toHaveBeenCalledWith("wtp");
}

/** P4 — one hit rect per roled unit: the passive sink and the panels have none. */
export function onlyRoledUnitsHaveAHitRect(): void {
  renderCanvas();
  const keys = screen.getAllByTestId("mimic-preview-hit").map((el) => el.getAttribute("data-node-key"));
  expect(keys).toHaveLength(8);
  expect(keys).not.toContain("discharge");
  expect(keys.some((k) => k?.startsWith("panel"))).toBe(false);
}

/** P5 — a hit rect is unfilled and catches the pointer (the F3.65 gate refuses a named colour). */
export function hitRectsAreUnfilledAndCatchThePointer(): void {
  renderCanvas();
  const rects = screen.getAllByTestId("mimic-preview-hit");
  expect(rects.every((r) => r.getAttribute("fill") === "none" && r.getAttribute("pointer-events") === "all")).toBe(true);
}

/** P6 — the selected unit is outlined, and there is no resize handle. */
export function theSelectionIsOutlinedWithNoResizeHandle(): void {
  renderCanvas("wtp");
  const outline = screen.getByTestId("mimic-preview-selection");
  expect(outline).toHaveAttribute("data-node-key", "wtp");
  expect(outline).toHaveAttribute("class", "stroke-accent");
  expect(screen.queryByTestId("mimic-editor-resize")).toBeNull();
  expect(screen.queryByTestId("mimic-preview-resize")).toBeNull();
}

/**
 * P7 (review L2) — nothing in the preview offers a drag: every hit rect is a pointer (never the
 * editor's `cursor-move` or `cursor-se-resize`), no editor overlay or pipe mode is drawn, and a
 * pointer down, move and up on a unit select nothing (only a click does).
 */
export function nothingOffersADrag(): void {
  const { onSelect } = renderCanvas("wtp");
  const rects = screen.getAllByTestId("mimic-preview-hit");
  expect(rects.map((r) => r.getAttribute("class"))).toEqual(rects.map(() => "cursor-pointer"));
  expect(document.querySelector(".cursor-move, .cursor-se-resize, [data-pipe-mode]")).toBeNull();
  expect(screen.queryByTestId("mimic-editor-overlay")).toBeNull();
  fireEvent.pointerDown(hit("wtp"), { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(hit("wtp"), { clientX: 200, clientY: 200 });
  fireEvent.pointerUp(hit("wtp"), { clientX: 200, clientY: 200 });
  expect(onSelect).not.toHaveBeenCalled();
}

/** P8 — a click on the background clears the selection. */
export function aBackgroundClickClearsTheSelection(): void {
  const { onSelect } = renderCanvas("wtp");
  fireEvent.click(screen.getByTestId("mimic-preview-background"));
  expect(onSelect).toHaveBeenCalledWith(null);
}

/** P9 — the drawing is the editor's frame, marked as the preview. */
export function theFrameIsMarkedAsThePreview(): void {
  renderCanvas();
  expect(screen.getByTestId("mimic-preview-canvas")).toBeInTheDocument();
  expect(screen.queryByTestId("mimic-editor-canvas")).toBeNull();
}
