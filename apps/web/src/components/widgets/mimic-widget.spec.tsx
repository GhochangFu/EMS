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

const PRESET_KEYS = MIMIC_PRESETS.water_train.nodes.map((n) => n.key);

function point(pointKey: string, name: string): GeneratedSitePointDto {
  return { pointKey, name, unit: "m3/h", headlineRank: null, latest: null };
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

/** Every preset node; `ro` has three members, `wtp` an open alarm, `softener` nobody. */
function nodes(): MimicNodeDto[] {
  return MIMIC_PRESETS.water_train.nodes
    .map((n): MimicNodeDto => {
      const base = { key: n.key, label: n.label, roleCode: n.roleCode };
      switch (n.key) {
        case "wtp":
          return { ...base, asset: WTP, memberCount: 1, activeAlarms: 1 };
        case "ro":
          return { ...base, asset: RO, memberCount: 3, activeAlarms: 0 };
        case "stp":
          return { ...base, asset: STP, memberCount: 1, activeAlarms: 0 };
        default:
          return { ...base, asset: null, memberCount: 0, activeAlarms: 0 };
      }
    })
    .reverse();
}

/** WTP and RO reported a second ago; STP never did. */
const READINGS: SiteLiveReadings = {
  nowMs: NOW,
  pointLatest: (assetId, p) =>
    assetId === WTP_ID ? { value: Number(p.pointKey.slice(1)) * 10.5, time: "t", atMs: NOW - 1_000 } : null,
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
