import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { expect } from "vitest";

import {
  MIMIC_PRESETS,
  type GeneratedSiteAssetDto,
  type GeneratedSitePointDto,
  type MimicNodeDto,
} from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import type { WidgetStatus } from "../../lib/widget-catalog";
import { MIMIC_NODE_GLYPHS } from "../../lib/mimic";
import { presetGeometry } from "../../lib/mimic-geometry";
import { FRESH_MS } from "../../lib/schematic-telemetry";
import { MimicWidget } from "./mimic-widget";

/**
 * `F3.32` U4 — what a person sees on a plant mimic (ADR 0079, plan §3 U4 "jsdom").
 *
 * The readings are a hand-built `SiteLiveReadings`, so every status is decided by the clock this
 * file sets, not by the DTO's `freshness` (which the fixtures deliberately set to `none`). The
 * nodes are handed over REVERSED: the drawing walks the preset, so the order case would redden
 * on a renderer that walked the response instead.
 */

const NOW = Date.parse("2026-09-28T10:00:00.000Z");
const WTP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RO_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STP_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STORAGE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const PRESET_KEYS = MIMIC_PRESETS.water_train.nodes.map((n) => n.key);

function point(pointKey: string, name: string, unit = "m3/h"): GeneratedSitePointDto {
  return { pointKey, name, unit, headlineRank: null, latest: null };
}

function asset(id: string, code: string, points: GeneratedSitePointDto[]): GeneratedSiteAssetDto {
  return { id, code, name: code, assetRtuName: null, assetLocationName: null, domain: "water", latestTelemetryAt: null, freshness: "none", points };
}

const WTP = asset(WTP_ID, "WTR-WTP-01", [
  point("p1", "Inlet flow"),
  point("p2", "Outlet flow"),
  point("p3", "Turbidity"),
  point("p4", "Chlorine"),
  point("p5", "Pressure"),
]);
const RO = asset(RO_ID, "WTR-RO-01", [point("p1", "Permeate")]);
const STP = asset(STP_ID, "WTR-STP-01", [point("p1", "Inflow")]);
const STORAGE = asset(STORAGE_ID, "WTR-TNK-01", [point("clearwell_level_pct", "Level", "%")]);

/**
 * WTP's open alarm, at a severity level added by an `INSERT` (ADR 0032 decision 9): its code, its
 * vocabulary tone and its vocabulary label all differ, so a callout coloured from the code (or
 * from the node's `alarm` status), or labelled from the code, reddens C1.
 */
const WTP_ALARM: NonNullable<MimicNodeDto["topAlarm"]> = {
  severity: "f332b_high_do",
  tone: "warning",
  label: "High D.O.",
  message: "High D.O. alarm · DO 2.1 mg/L",
  raisedAt: "2026-09-28T09:58:00.000Z",
};

/** A 60-character message: longer than the callout box holds. */
const LONG_MESSAGE = "Clarifier outlet turbidity above the high limit for 15 mins.";

/**
 * Every preset node; `ro` has three members, `wtp` an open alarm (and its callout), `softener`
 * nobody, `water_storage` a tank with a level point.
 */
function nodes(wtpAlarm: MimicNodeDto["topAlarm"] = WTP_ALARM): MimicNodeDto[] {
  return MIMIC_PRESETS.water_train.nodes
    .map((n): MimicNodeDto => {
      const base = { key: n.key, label: n.label, roleCode: n.roleCode, topAlarm: null, statePoints: [], members: [] };
      switch (n.key) {
        case "wtp":
          return { ...base, asset: WTP, memberCount: 1, activeAlarms: 1, topAlarm: wtpAlarm };
        case "ro":
          return { ...base, asset: RO, memberCount: 3, activeAlarms: 0 };
        case "stp":
          return { ...base, asset: STP, memberCount: 1, activeAlarms: 0 };
        case "water_storage":
          return { ...base, asset: STORAGE, memberCount: 1, activeAlarms: 0 };
        default:
          return { ...base, asset: null, memberCount: 0, activeAlarms: 0 };
      }
    })
    .reverse();
}

/** WTP, RO and storage reported a second ago; STP never did. Storage's level reads 64 %. */
const READINGS: SiteLiveReadings = {
  nowMs: NOW,
  pointLatest: (assetId, p) =>
    assetId === WTP_ID
      ? { value: Number(p.pointKey.slice(1)) * 10.5, time: "t", atMs: NOW - 1_000 }
      : assetId === STORAGE_ID
        ? { value: 64, time: "t", atMs: NOW - 1_000 }
        : null,
  assetLastSeenMs: (a) => (a.id === STP_ID ? null : NOW - 1_000),
};

function renderMimic(
  status: WidgetStatus = "ready",
  wtpAlarm: MimicNodeDto["topAlarm"] = WTP_ALARM,
  readings: SiteLiveReadings = READINGS,
  motion = false,
): void {
  render(
    <MimicWidget
      title="Demo water plant"
      status={status}
      geometry={presetGeometry("water_train")}
      nodes={nodes(wtpAlarm)}
      readings={readings}
      motion={motion}
    />,
  );
}

function nodeEl(key: string): HTMLElement {
  const el = screen.getAllByTestId("mimic-node").find((n) => n.getAttribute("data-node-key") === key);
  expect(el, `no mimic-node ${key}`).toBeDefined();
  return el as HTMLElement;
}

/** W1 — eight nodes, in the preset's order. */
export function drawsEightNodesInPresetOrder(): void {
  renderMimic();
  const keys = screen.getAllByTestId("mimic-node").map((n) => n.getAttribute("data-node-key"));
  expect(keys).toEqual(PRESET_KEYS);
  expect(keys).toHaveLength(8);
}

/**
 * W2 — a node the read resolved with no member says "No asset at this site", dimmed — never "Not
 * assigned" (F3.73 critique: it read like a fault). The no-entry case is S3 in `mimic-scene.spec`.
 */
export function aNodeWithNoMemberSaysNoAssetAtThisSite(): void {
  renderMimic();
  const softener = nodeEl("softener");
  expect(softener.getAttribute("data-status")).toBe("no-asset");
  expect(within(softener).getByText("No asset at this site")).toBeInTheDocument();
  expect(within(softener).queryByText("Not assigned")).toBeNull();
  expect(softener.getAttribute("class")).toContain("opacity-50");
}

/** W2c — the no-asset frame is neutral: a solid `stroke-line` outline, no dash, no alarm stroke. */
export function aNoAssetNodeDrawsANeutralSolidFrame(): void {
  renderMimic();
  const frame = nodeEl("softener").querySelector("rect");
  expect(frame?.getAttribute("stroke-dasharray")).toBeNull();
  expect(frame?.getAttribute("class")).toContain("stroke-line");
  expect(frame?.getAttribute("class")).not.toContain("stroke-critical");
}

/** W2b — an assigned node shows its asset code and is not dimmed. */
export function assignedNodeShowsItsAssetCode(): void {
  renderMimic();
  const ro = nodeEl("ro");
  expect(within(ro).getByText("WTR-RO-01")).toBeInTheDocument();
  expect(ro.getAttribute("class") ?? "").not.toContain("opacity-50");
}

/** W3 — three members read `+2`; a single member reads no badge. */
export function badgeCountsTheOtherMembers(): void {
  renderMimic();
  expect(within(nodeEl("ro")).getByTestId("mimic-badge").textContent).toBe("+2");
  expect(within(nodeEl("stp")).queryByTestId("mimic-badge")).toBeNull();
}

/** W4 — an alarmed, fresh node is `alarm`, outlined critical; a fresh, quiet one is `live`. */
export function alarmNodeIsAlarm(): void {
  renderMimic();
  const wtp = nodeEl("wtp");
  expect(wtp.getAttribute("data-status")).toBe("alarm");
  expect(wtp.querySelector("rect")?.getAttribute("class")).toContain("stroke-critical");
  expect(nodeEl("ro").getAttribute("data-status")).toBe("live");
  expect(nodeEl("stp").getAttribute("data-status")).toBe("none");
}

/** W5 — one pipe per preset pipe, plus the Discharge sink label, drawn once. */
export function drawsEveryPipeAndTheSink(): void {
  renderMimic();
  expect(screen.getAllByTestId("mimic-pipe")).toHaveLength(MIMIC_PRESETS.water_train.pipes.length);
  expect(screen.getAllByTestId("mimic-sink")).toHaveLength(1);
  expect(screen.getByText("Discharge")).toBeInTheDocument();
}

/** W6 — at most three value rows, the first three, with the live value. */
export function atMostThreeValueRows(): void {
  renderMimic();
  const rows = within(nodeEl("wtp")).getAllByTestId("mimic-point");
  expect(rows.map((r) => r.getAttribute("data-point-key"))).toEqual(["p1", "p2", "p3"]);
  expect(within(rows[1] as HTMLElement).getByTestId("mimic-point-value").textContent).toBe("21 m3/h");
}

/** W7 — loading draws the frame's line and no node. */
export function loadingDrawsNoNodes(): void {
  renderMimic("loading");
  expect(screen.getByText("Loading…")).toBeInTheDocument();
  expect(screen.queryAllByTestId("mimic-node")).toHaveLength(0);
}

/**
 * C1 — a node with `topAlarm` draws one callout: its message, and its severity's VOCABULARY tone
 * and label — a code the widget has never seen draws in its declared `warning` colour.
 */
export function alarmedNodeDrawsOneCallout(): void {
  renderMimic();
  const callouts = within(nodeEl("wtp")).getAllByTestId("mimic-alarm-callout");
  expect(callouts).toHaveLength(1);
  const callout = callouts[0] as HTMLElement;
  expect(callout.getAttribute("data-severity")).toBe("f332b_high_do");
  expect(callout.getAttribute("data-tone")).toBe("warning");
  expect(callout.querySelector("rect")?.getAttribute("class")).toContain("fill-warning-wash");
  expect(within(callout).getByTestId("mimic-alarm-message").textContent).toBe(
    "High D.O. alarm · DO 2.1 mg/L".slice(0, 19) + "\u2026",
  );
  expect(callout.querySelector("title")?.textContent).toBe(WTP_ALARM.message);
  expect(within(callout).getByTestId("mimic-alarm-severity").textContent).toBe("High D.O.");
}

/** C3 — a 60-character message shows at most 21 characters; the full text is the hover title. */
export function longMessageIsCutWithFullTitle(): void {
  renderMimic("ready", { ...WTP_ALARM, message: LONG_MESSAGE });
  const callout = within(nodeEl("wtp")).getByTestId("mimic-alarm-callout");
  const shown = within(callout).getByTestId("mimic-alarm-message").textContent ?? "";
  expect(Array.from(shown).length).toBeLessThanOrEqual(21);
  expect(callout.querySelector("title")?.textContent).toBe(LONG_MESSAGE);
}

/** C4 — the callout's text is clipped to its box: its group names a `<clipPath>` that exists. */
export function calloutTextIsClippedToItsBox(): void {
  renderMimic();
  const callout = within(nodeEl("wtp")).getByTestId("mimic-alarm-callout");
  const text = within(callout).getByTestId("mimic-alarm-text");
  const ref = /^url\(#(.+)\)$/.exec(text.getAttribute("clip-path") ?? "")?.[1];
  expect(ref, "the callout text group carries no clip-path url").toBeDefined();
  expect(callout.querySelector(`clipPath[id="${ref}"] rect`)).not.toBeNull();
  expect(within(text).getByTestId("mimic-alarm-message")).toBeInTheDocument();
}

/** X1 — the drawing's accessible name names the alarmed unit, its severity label and full message. */
export function accessibleNameNamesTheAlarmedUnit(): void {
  renderMimic("ready", { ...WTP_ALARM, message: LONG_MESSAGE });
  expect(
    screen.getByRole("img", {
      name: `Demo water plant: ${MIMIC_PRESETS.water_train.label}. Open alarms: WTP, High D.O.: ${LONG_MESSAGE}`,
    }),
  ).toBeInTheDocument();
}

/** X2 — with no open alarm anywhere, the name is the title and the preset, and names no unit. */
export function accessibleNameOfAQuietPlantNamesNoUnit(): void {
  renderMimic("ready", null);
  expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
    `Demo water plant: ${MIMIC_PRESETS.water_train.label}`,
  );
}

/** C2 — a node without `topAlarm` draws none: the whole drawing holds exactly WTP's one. */
export function quietNodesDrawNoCallout(): void {
  renderMimic();
  expect(within(nodeEl("ro")).queryAllByTestId("mimic-alarm-callout")).toHaveLength(0);
  const owners = screen
    .getAllByTestId("mimic-alarm-callout")
    .map((c) => c.closest("[data-testid='mimic-node']")?.getAttribute("data-node-key"));
  expect(owners).toEqual(["wtp"]);
}

/** P1 — three panels, each holding exactly its train's nodes, in preset order. */
export function panelsHoldTheirTrains(): void {
  renderMimic();
  const panels = screen.getAllByTestId("mimic-panel");
  const byPanel = Object.fromEntries(
    panels.map((p) => [
      p.getAttribute("data-panel-key"),
      within(p).getAllByTestId("mimic-node").map((n) => n.getAttribute("data-node-key")),
    ]),
  );
  expect(byPanel).toEqual({
    treatment: ["water_intake", "wtp", "ro", "softener", "water_storage"],
    utilities: ["cooling_tower"],
    wastewater: ["stp", "etp"],
  });
  expect(screen.getAllByTestId("mimic-panel-frame")).toHaveLength(3);
}

/** G1 — every node draws its mapped symbol; the storage tank fills to its live level. */
export function everyNodeDrawsItsSymbol(): void {
  renderMimic();
  for (const key of PRESET_KEYS) {
    const glyphs = within(nodeEl(key)).getAllByTestId("mimic-glyph");
    expect(glyphs[0]?.getAttribute("data-glyph"), key).toBe(MIMIC_NODE_GLYPHS.water_train[key]);
  }
  expect(within(nodeEl("water_storage")).getByTestId("mimic-tank-level").getAttribute("data-level")).toBe("64");
  expect(within(nodeEl("water_intake")).queryByTestId("mimic-tank-level")).toBeNull();
}

/**
 * F1 — a moving dash rides the pipes whose upstream unit has fresh data: `live` RO and storage,
 * and `alarm` WTP whose reading is a second old. Silent STP does not flow. It can be reduced away.
 */
export function flowRunsFromFreshNodes(): void {
  renderMimic();
  const flows = screen.getAllByTestId("mimic-flow");
  expect(flows.map((f) => f.getAttribute("data-flow-from"))).toEqual(["wtp", "ro", "water_storage", "water_storage"]);
  expect(flows[0]?.getAttribute("class")).toContain("motion-reduce:hidden");
}

/** F2 — WTP still in `alarm` but its reading old, and RO `stale`: neither pipe flows. */
export function staleNodesDoNotFlow(): void {
  const old = NOW - FRESH_MS - 1_000;
  renderMimic("ready", WTP_ALARM, {
    ...READINGS,
    assetLastSeenMs: (a) => (a.id === STP_ID ? null : a.id === WTP_ID || a.id === RO_ID ? old : NOW - 1_000),
  });
  expect([nodeEl("wtp").getAttribute("data-status"), nodeEl("ro").getAttribute("data-status")]).toEqual([
    "alarm",
    "stale",
  ]);
  const froms = screen.getAllByTestId("mimic-flow").map((f) => f.getAttribute("data-flow-from"));
  expect(froms).toEqual(["water_storage", "water_storage"]);
}

/**
 * L1 (`F3.77` follow-up, owner ruling Q4) — the drawing sits in an `absolute inset-0` box inside a
 * `relative min-h-0 flex-1` scene box, so the drawing adds no height of its own: the tile is as tall
 * as the canvas's minimum height (the aspect height, or the wall's cap), and the `meet` drawing
 * letterboxes inside it. Mutation: drop `absolute` from the drawing's box => red.
 */
export function theDrawingAddsNoHeightOfItsOwn(): void {
  renderMimic();
  const drawingBox = screen.getByRole("img", { name: /Demo water plant/ }).parentElement;
  const sceneBox = drawingBox?.parentElement;
  expect(drawingBox?.className.split(" ")).toEqual(expect.arrayContaining(["absolute", "inset-0"]));
  expect(sceneBox?.className.split(" ")).toEqual(expect.arrayContaining(["relative", "min-h-0", "flex-1"]));
}

/**
 * `F4.321` — the Expand control and its full-view dialog. One helper: the tile as the live
 * widget draws it (`expandable`), optionally `compact` (owner Q1, 2026-11-07: the dialog still
 * draws the full values).
 */
function renderExpandable({
  status = "ready",
  expandable = true,
  compact = false,
  motion = false,
  glyphSet,
}: { status?: WidgetStatus; expandable?: boolean; compact?: boolean; motion?: boolean; glyphSet?: "core" | "iso" } = {}): void {
  render(
    <MimicWidget
      title="Demo water plant"
      status={status}
      geometry={presetGeometry("water_train")}
      nodes={nodes()}
      readings={READINGS}
      compact={compact}
      expandable={expandable}
      motion={motion}
      glyphSet={glyphSet}
    />,
  );
}

const EXPAND_NAME = "Expand Demo water plant";
const DIALOG_NAME = "Demo water plant — full view";

function openDialog(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: EXPAND_NAME }));
  return screen.getByRole("dialog", { name: DIALOG_NAME });
}

/** E1 — Expand shows on a ready, expandable tile only: not while loading, not without the prop. */
export function expandShowsOnlyOnAReadyExpandableTile(): void {
  renderExpandable();
  expect(screen.getByRole("button", { name: EXPAND_NAME }).getAttribute("aria-haspopup")).toBe("dialog");
  cleanup();
  renderExpandable({ status: "loading" });
  expect(screen.queryByRole("button", { name: EXPAND_NAME })).toBeNull();
  cleanup();
  renderExpandable({ expandable: false });
  expect(screen.queryByRole("button", { name: EXPAND_NAME })).toBeNull();
}

/**
 * E2 — Expand opens a modal dialog named for the widget, portalled out of the tile, holding a
 * second drawing of the same plant. No dialog before the click.
 */
export function expandOpensANamedDialogWithASecondDrawing(): void {
  renderExpandable();
  expect(screen.queryByRole("dialog")).toBeNull();
  const dialog = openDialog();
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.closest(".surface-raised")).toBeNull();
  expect(within(dialog).getByRole("img", { name: /^Demo water plant: / })).toBeInTheDocument();
  expect(screen.getAllByRole("img", { name: /^Demo water plant: / })).toHaveLength(2);
  expect(within(dialog).getAllByTestId("mimic-node")).toHaveLength(8);
}

/** E3 — Escape closes the dialog and focus returns to Expand. Close opens focused. */
export function escapeClosesAndFocusReturnsToExpand(): void {
  renderExpandable();
  const dialog = openDialog();
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close" }));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: EXPAND_NAME }));
}

/** E4 — Close and a click on the scrim close it; a click inside the dialog does not. */
export function closeAndTheScrimCloseTheDialog(): void {
  renderExpandable();
  let dialog = openDialog();
  fireEvent.click(dialog);
  expect(screen.getByRole("dialog", { name: DIALOG_NAME })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: EXPAND_NAME }));
  dialog = openDialog();
  fireEvent.click(screen.getByTestId("mimic-expand-scrim"));
  expect(screen.queryByRole("dialog")).toBeNull();
}

/**
 * E5 — Tab inside the dialog keeps focus on Close, its one control. jsdom does not move focus on
 * Tab, so the case asserts the cancelled default (`fireEvent` returns false) as well as the focus.
 * The last step is the review finding: after a click on the drawing focus sits on `body`, and a
 * Tab from there must still land on Close, not on the page behind the scrim.
 */
export function tabStaysInsideTheDialog(): void {
  renderExpandable();
  const dialog = openDialog();
  const close = within(dialog).getByRole("button", { name: "Close" });
  expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(false);
  expect(document.activeElement).toBe(close);
  expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(false);
  expect(document.activeElement).toBe(close);
  close.blur();
  expect(document.activeElement).toBe(document.body);
  expect(fireEvent.keyDown(document.body, { key: "Tab" })).toBe(false);
  expect(document.activeElement).toBe(close);
}

/**
 * E8 (review finding) — a refetch that takes the drawing away closes the dialog for good: when the
 * tile is ready again, no dialog opens until Expand is clicked. Mutation: drop the reset => red.
 */
export function aLostDrawingDoesNotReopenTheDialog(): void {
  const props = {
    title: "Demo water plant",
    geometry: presetGeometry("water_train"),
    nodes: nodes(),
    readings: READINGS,
    expandable: true,
  };
  const { rerender } = render(<MimicWidget {...props} status="ready" />);
  openDialog();
  rerender(<MimicWidget {...props} status="loading" />);
  expect(screen.queryByRole("dialog")).toBeNull();
  rerender(<MimicWidget {...props} status="ready" />);
  expect(screen.queryByRole("dialog")).toBeNull();
}

/**
 * E6 (owner Q1) — a compact tile draws no value row, but its dialog draws them: the full view
 * ignores `compact`. Mutation: pass `compact` through to the dialog's scene => red.
 */
export function aCompactTilesDialogDrawsTheValueRows(): void {
  renderExpandable({ compact: true });
  expect(screen.queryAllByTestId("mimic-point")).toHaveLength(0);
  const dialog = openDialog();
  const wtp = within(dialog)
    .getAllByTestId("mimic-node")
    .find((n) => n.getAttribute("data-node-key") === "wtp") as HTMLElement;
  expect(within(wtp).getAllByTestId("mimic-point").map((r) => r.getAttribute("data-point-key"))).toEqual([
    "p1",
    "p2",
    "p3",
  ]);
}

/** E7 — the tile and the dialog draw their own arrow marker: no two `<marker>` ids are equal. */
export function theTwoDrawingsShareNoMarkerId(): void {
  renderExpandable();
  openDialog();
  const ids = Array.from(document.querySelectorAll("marker")).map((m) => m.id);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
}

/** A unit's glyph motion in `root`, or `null` when it is still. */
function motionIn(root: HTMLElement, key: string): string | null {
  const el = within(root).getAllByTestId("mimic-node").find((n) => n.getAttribute("data-node-key") === key);
  expect(el, `no mimic-node ${key}`).toBeDefined();
  return el?.querySelector("[data-motion]")?.getAttribute("data-motion") ?? null;
}

/**
 * WM1 — `F4.344` (ADR 0120): with `motion` the tile's units move by state — RO (live) breathes,
 * WTP (alarm, tone `warning`) pulses, STP (never seen: none) is still — and each class sits behind
 * `motion-safe:`. jsdom evaluates no media query; `tests/f4.344-mimic-motion-gate.test.ts` MG3
 * holds that the compiled rule lives only under `prefers-reduced-motion: no-preference`.
 */
export function withMotionTheTileMovesByState(): void {
  renderMimic("ready", WTP_ALARM, READINGS, true);
  const tile = document.body;
  expect(motionIn(tile, "ro")).toBe("breathe");
  expect(motionIn(tile, "wtp")).toBe("pulse");
  expect(motionIn(tile, "stp")).toBeNull();
  for (const el of Array.from(document.querySelectorAll("[data-motion]"))) {
    expect(el.getAttribute("class") ?? "").toContain("motion-safe:animate-mimic-");
  }
}

/** WM2 — `F4.344`: the Expand dialog's drawing moves too when the tile does. */
export function theExpandDialogMovesWithTheTile(): void {
  renderExpandable({ motion: true });
  const dialog = openDialog();
  expect(motionIn(dialog, "ro")).toBe("breathe");
  expect(motionIn(dialog, "wtp")).toBe("pulse");
}

/**
 * E-ISO — `F4.345` (ADR 0121 decision 5): an iso tile's Expand dialog draws the isometric units too,
 * and the 24-px water-train markers (pump, discharge) and the alarm callout stay core (plan R6).
 */
export function anIsoTileExpandsIntoAnIsoDialogAndKeepsTheMarkersCore(): void {
  renderExpandable({ glyphSet: "iso" });
  const dialog = openDialog();
  const unitGlyphs = [...dialog.querySelectorAll("[data-testid=mimic-node] [data-testid=mimic-glyph]")]
    .map((g) => g.getAttribute("data-glyph") ?? "")
    .filter((k) => k !== "alert"); // the alarm callout's icon stays core (plan R6)
  expect(unitGlyphs.length).toBeGreaterThanOrEqual(8);
  expect(unitGlyphs.filter((k) => !k.startsWith("iso:"))).toEqual([]);
  const others = [...dialog.querySelectorAll("[data-testid=mimic-glyph]")]
    .filter((g) => g.closest("[data-testid=mimic-node]") === null)
    .map((g) => g.getAttribute("data-glyph") ?? "");
  // Positive control: the markers are drawn, and none is an isometric twin.
  expect(others).toEqual(expect.arrayContaining(["pump", "discharge"]));
  expect(others.filter((k) => k.startsWith("iso:"))).toEqual([]);
}
