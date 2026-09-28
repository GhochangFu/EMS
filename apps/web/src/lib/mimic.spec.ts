import { expect } from "vitest";

import { MIMIC_HEADLINE_POINTS } from "@bms/shared/contracts";
import {
  MIMIC_PRESETS,
  type GeneratedSiteAssetDto,
  type GeneratedSitePointDto,
  type MimicNodeDto,
  type MimicWidgetNodesDto,
} from "@bms/shared";

import {
  MIMIC_LAYOUTS,
  MIMIC_NODE_SIZE,
  mimicBadge,
  mimicNodePoints,
  mimicNodeStatus,
  mimicViewFor,
  pipePath,
} from "./mimic";
import { FRESH_MS } from "./schematic-telemetry";

/**
 * `F3.32` U4 — the pure half of the plant mimic (ADR 0079, plan §3 U4 "Tests first").
 *
 * Every fixture is built so the mutation it names reddens THIS assertion: the alarm node is also
 * fresh (so a freshness-first order reads it `live`), the headline asset carries five points (so
 * `HEADLINE_POINT_COUNT`'s four would show a fourth), and the badge reads `memberCount: 3` (so
 * `+3` and `+2` differ).
 */

const NOW = Date.parse("2026-09-28T10:00:00.000Z");
const WIDGET_ID = "11111111-1111-4111-8111-111111111111";
const WTP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RO_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function point(pointKey: string): GeneratedSitePointDto {
  return { pointKey, name: pointKey, unit: "m3/h", headlineRank: null, latest: null };
}

function asset(id: string, code: string, points: GeneratedSitePointDto[] = [point("flow")]): GeneratedSiteAssetDto {
  return {
    id,
    code,
    name: code,
    domain: "water",
    latestTelemetryAt: null,
    freshness: "none",
    points,
  };
}

function node(key: string, a: GeneratedSiteAssetDto | null, activeAlarms = 0): MimicNodeDto {
  return { key, label: key, roleCode: key, asset: a, memberCount: a === null ? 0 : 1, activeAlarms };
}

function widget(nodes: MimicNodeDto[]): MimicWidgetNodesDto {
  return { widgetId: WIDGET_ID, preset: "water_train", nodes };
}

/** M1 — the synthetic view holds the assigned assets only, in node order. */
export function viewHoldsOnlyAssignedAssets(): void {
  const view = mimicViewFor(
    widget([node("wtp", asset(WTP_ID, "WTR-WTP-01")), node("softener", null), node("ro", asset(RO_ID, "WTR-RO-01"))]),
    "2026-09-28T10:00:00.000Z",
  );
  const ids = view?.domains.flatMap((d) => d.assets.map((a) => a.id));
  expect(ids).toEqual([WTP_ID, RO_ID]);
}

/** M1b — one asset under two nodes is tracked once (the socket filter is a set, the view must agree). */
export function viewHoldsEachAssetOnce(): void {
  const shared = asset(WTP_ID, "WTR-WTP-01");
  const view = mimicViewFor(widget([node("wtp", shared), node("ro", shared)]), "2026-09-28T10:00:00.000Z");
  expect(view?.domains.flatMap((d) => d.assets.map((a) => a.id))).toEqual([WTP_ID]);
}

/** M1c — no widget entry is no view, not an empty one the hook would clamp. */
export function noWidgetIsNoView(): void {
  expect(mimicViewFor(undefined, "2026-09-28T10:00:00.000Z")).toBeUndefined();
}

/** M2a — an unassigned node is `unassigned`, even with alarms counted (precedence, plan D5). */
export function unassignedWinsOverAlarm(): void {
  expect(mimicNodeStatus(node("softener", null, 2), NOW - 1_000, NOW)).toBe("unassigned");
}

/** M2b — an alarmed node is `alarm` although its telemetry is fresh. */
export function alarmWinsOverFreshness(): void {
  expect(mimicNodeStatus(node("wtp", asset(WTP_ID, "W"), 1), NOW - 1_000, NOW)).toBe("alarm");
}

/** M2c — no alarm, a sample inside `FRESH_MS`: `live`. */
export function freshNodeIsLive(): void {
  expect(mimicNodeStatus(node("wtp", asset(WTP_ID, "W")), NOW - 1_000, NOW)).toBe("live");
}

/** M2d — no alarm, a sample older than `FRESH_MS`: `stale`. */
export function oldNodeIsStale(): void {
  expect(mimicNodeStatus(node("wtp", asset(WTP_ID, "W")), NOW - FRESH_MS - 1_000, NOW)).toBe("stale");
}

/** M2e — no alarm, no sample at all: `none`. */
export function silentNodeIsNone(): void {
  expect(mimicNodeStatus(node("wtp", asset(WTP_ID, "W")), null, NOW)).toBe("none");
}

/** M3 — a node shows at most `MIMIC_HEADLINE_POINTS` rows, the server's first ones. */
export function atMostThreeValueRows(): void {
  const five = asset(WTP_ID, "W", ["p1", "p2", "p3", "p4", "p5"].map(point));
  expect(MIMIC_HEADLINE_POINTS).toBe(3);
  expect(mimicNodePoints(five).map((p) => p.pointKey)).toEqual(["p1", "p2", "p3"]);
}

/** M4a — every preset node has a position, and every position names a preset node. */
export function layoutKeysMatchPresetKeys(): void {
  for (const preset of Object.keys(MIMIC_PRESETS) as (keyof typeof MIMIC_PRESETS)[]) {
    const presetKeys = MIMIC_PRESETS[preset].nodes.map((n) => n.key).sort();
    const layoutKeys = Object.keys(MIMIC_LAYOUTS[preset].nodes).sort();
    expect(layoutKeys, preset).toEqual(presetKeys);
  }
}

/** M4b — every node box lies inside the viewBox, and no two boxes overlap. */
export function nodesFitAndDoNotOverlap(): void {
  const layout = MIMIC_LAYOUTS.water_train;
  const [, , vw, vh] = layout.viewBox.split(" ").map(Number);
  const boxes = Object.entries(layout.nodes);
  for (const [key, at] of boxes) {
    expect(at.x >= 0 && at.y >= 0 && at.x + MIMIC_NODE_SIZE.w <= vw && at.y + MIMIC_NODE_SIZE.h <= vh, key).toBe(true);
  }
  for (const [ka, a] of boxes) {
    for (const [kb, b] of boxes) {
      if (ka >= kb) continue;
      const apart =
        a.x + MIMIC_NODE_SIZE.w <= b.x ||
        b.x + MIMIC_NODE_SIZE.w <= a.x ||
        a.y + MIMIC_NODE_SIZE.h <= b.y ||
        b.y + MIMIC_NODE_SIZE.h <= a.y;
      expect(apart, `${ka} overlaps ${kb}`).toBe(true);
    }
  }
}

/** M5 — the badge counts the members NOT shown: three members read `+2`; one reads nothing. */
export function badgeCountsTheHiddenMembers(): void {
  expect(mimicBadge(3)).toBe("+2");
  expect(mimicBadge(1)).toBeNull();
  expect(mimicBadge(0)).toBeNull();
}

/** M6a — a same-row pipe runs edge to edge at the box mid-height, in flow direction. */
export function sameRowPipeRunsEdgeToEdge(): void {
  const { w, h } = MIMIC_NODE_SIZE;
  expect(pipePath({ x: 0, y: 0 }, { x: 300, y: 0 })).toBe(`M${w} ${h / 2} H300`);
  expect(pipePath({ x: 300, y: 0 }, { x: 0, y: 0 })).toBe(`M300 ${h / 2} H${w}`);
}

/** M6b — a cross-row pipe leaves the bottom centre and lands on the top centre. */
export function crossRowPipeLandsOnTheTopCentre(): void {
  const { w, h } = MIMIC_NODE_SIZE;
  const d = pipePath({ x: 0, y: 0 }, { x: 400, y: 300 });
  expect(d.startsWith(`M${w / 2} ${h} `)).toBe(true);
  expect(d.endsWith(`H${400 + w / 2} V300`)).toBe(true);
}
