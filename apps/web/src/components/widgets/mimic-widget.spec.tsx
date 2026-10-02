import { render, screen, within } from "@testing-library/react";
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
  return { id, code, name: code, domain: "water", latestTelemetryAt: null, freshness: "none", points };
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
): void {
  render(
    <MimicWidget
      title="Demo water plant"
      status={status}
      geometry={presetGeometry("water_train")}
      nodes={nodes(wtpAlarm)}
      readings={readings}
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
