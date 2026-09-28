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

/** WTP's open alarm. Its severity is `warning` while WTP's STATUS is `alarm` (critical), so a
 * callout coloured from the node's status rather than the alarm's severity reddens C1. */
const WTP_ALARM = { severity: "warning", message: "High D.O. alarm · DO 2.1 mg/L", raisedAt: "2026-09-28T09:58:00.000Z" };

/**
 * Every preset node; `ro` has three members, `wtp` an open alarm (and its callout), `softener`
 * nobody, `water_storage` a tank with a level point.
 */
function nodes(): MimicNodeDto[] {
  return MIMIC_PRESETS.water_train.nodes
    .map((n): MimicNodeDto => {
      const base = { key: n.key, label: n.label, roleCode: n.roleCode, topAlarm: null };
      switch (n.key) {
        case "wtp":
          return { ...base, asset: WTP, memberCount: 1, activeAlarms: 1, topAlarm: WTP_ALARM };
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

function renderMimic(status: WidgetStatus = "ready"): void {
  render(<MimicWidget title="Demo water plant" status={status} preset="water_train" nodes={nodes()} readings={READINGS} />);
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

/** W2 — an unassigned node says so, and is dimmed. */
export function unassignedNodeSaysNotAssigned(): void {
  renderMimic();
  const softener = nodeEl("softener");
  expect(softener.getAttribute("data-status")).toBe("unassigned");
  expect(within(softener).getByText("Not assigned")).toBeInTheDocument();
  expect(softener.getAttribute("class")).toContain("opacity-50");
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

/** C1 — a node with `topAlarm` draws one callout: its message, its severity's label and tone. */
export function alarmedNodeDrawsOneCallout(): void {
  renderMimic();
  const callouts = within(nodeEl("wtp")).getAllByTestId("mimic-alarm-callout");
  expect(callouts).toHaveLength(1);
  const callout = callouts[0] as HTMLElement;
  expect(callout.getAttribute("data-severity")).toBe("warning");
  expect(callout.getAttribute("data-tone")).toBe("warning");
  expect(callout.querySelector("rect")?.getAttribute("class")).toContain("fill-warning-wash");
  expect(within(callout).getByTestId("mimic-alarm-message").textContent).toBe(
    "High D.O. alarm · DO 2.1 mg/L".slice(0, 25) + "\u2026",
  );
  expect(callout.querySelector("title")?.textContent).toBe(WTP_ALARM.message);
  expect(within(callout).getByTestId("mimic-alarm-severity").textContent).toBe("Warning");
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

/** F1 — a moving dash rides only the pipes whose upstream node is live, and it can be reduced away. */
export function flowRunsOnlyFromLiveNodes(): void {
  renderMimic();
  const flows = screen.getAllByTestId("mimic-flow");
  expect(flows.map((f) => f.getAttribute("data-flow-from"))).toEqual(["ro", "water_storage", "water_storage"]);
  expect(flows[0]?.getAttribute("class")).toContain("motion-reduce:hidden");
}
