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
  MIMIC_NODE_GLYPHS,
  MIMIC_NODE_SIZE,
  MIMIC_PANELS,
  MIMIC_PIPE_Y,
  MIMIC_SINK_W,
  mimicAlarmSeverityLabel,
  mimicAlarmTone,
  mimicBadge,
  mimicCalloutText,
  mimicLevelFraction,
  mimicLevelPoint,
  mimicPanelBox,
  pipeMidpoint,
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
  return { key, label: key, roleCode: key, asset: a, memberCount: a === null ? 0 : 1, activeAlarms, topAlarm: null };
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

/** M6a — a same-row pipe runs edge to edge at the symbol's centre height, in flow direction. */
export function sameRowPipeRunsEdgeToEdge(): void {
  const { w } = MIMIC_NODE_SIZE;
  expect(pipePath({ x: 0, y: 0 }, { x: 300, y: 0 })).toBe(`M${w} ${MIMIC_PIPE_Y} H300`);
  expect(pipePath({ x: 300, y: 0 }, { x: 0, y: 0 })).toBe(`M300 ${MIMIC_PIPE_Y} H${w}`);
}

/** M6b — a cross-row pipe leaves the bottom centre and lands on the top centre. */
export function crossRowPipeLandsOnTheTopCentre(): void {
  const { w, h } = MIMIC_NODE_SIZE;
  const d = pipePath({ x: 0, y: 0 }, { x: 400, y: 300 });
  expect(d.startsWith(`M${w / 2} ${h} `)).toBe(true);
  expect(d.endsWith(`H${400 + w / 2} V300`)).toBe(true);
}

/** M7 — every preset node sits in exactly one panel, and every panel key names a preset node. */
export function panelsPartitionThePresetNodes(): void {
  for (const preset of Object.keys(MIMIC_PRESETS) as (keyof typeof MIMIC_PRESETS)[]) {
    const inPanels: string[] = MIMIC_PANELS[preset].flatMap((p) => [...p.nodes]);
    expect([...inPanels].sort(), preset).toEqual(MIMIC_PRESETS[preset].nodes.map((n) => n.key).sort());
  }
}

/** M7b — the panel frames fit the viewBox and do not overlap one another. */
export function panelFramesFitAndDoNotOverlap(): void {
  const def = MIMIC_PRESETS.water_train;
  const layout = MIMIC_LAYOUTS.water_train;
  const [, , vw, vh] = layout.viewBox.split(" ").map(Number);
  const boxes = MIMIC_PANELS.water_train.map((p) => {
    const box = mimicPanelBox(
      p.nodes.map((k) => layout.nodes[k]),
      (p.nodes as readonly string[]).includes(def.sink.from) ? layout.sink : null,
    );
    expect(box, p.key).not.toBeNull();
    return [p.key, box as NonNullable<typeof box>] as const;
  });
  for (const [key, b] of boxes) {
    expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= vw && b.y + b.h <= vh, key).toBe(true);
  }
  for (const [ka, a] of boxes) {
    for (const [kb, b] of boxes) {
      if (ka >= kb) continue;
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      expect(apart, `${ka} overlaps ${kb}`).toBe(true);
    }
  }
}

/** M7c — the panel holding the sink's node widens to hold the sink symbol; no node, no frame. */
export function panelBoxHoldsTheSink(): void {
  const without = mimicPanelBox([{ x: 500, y: 100 }], null);
  const withSink = mimicPanelBox([{ x: 500, y: 100 }], { x: 450, y: 186 });
  expect(withSink?.x).toBe((without?.x ?? 0) - (500 - (450 - MIMIC_SINK_W)));
  expect(mimicPanelBox([], null)).toBeNull();
}

/** M8 — the symbol map names every preset node and nothing else; intake and storage are tanks. */
export function glyphMapCoversEveryPresetNode(): void {
  for (const preset of Object.keys(MIMIC_PRESETS) as (keyof typeof MIMIC_PRESETS)[]) {
    expect(Object.keys(MIMIC_NODE_GLYPHS[preset]).sort(), preset).toEqual(
      MIMIC_PRESETS[preset].nodes.map((n) => n.key).sort(),
    );
  }
  expect(MIMIC_NODE_GLYPHS.water_train.water_intake).toBe("tank");
  expect(MIMIC_NODE_GLYPHS.water_train.water_storage).toBe("tank");
  expect(MIMIC_NODE_GLYPHS.water_train.ro).toBe("membrane");
}

/** M9a — the level point is a `level` key in `%`; a level flag with unit "" is not one. */
export function levelPointNeedsLevelAndPercent(): void {
  const flag: GeneratedSitePointDto = { pointKey: "oil_level_low", name: null, unit: "", headlineRank: null, latest: null };
  const pct: GeneratedSitePointDto = { pointKey: "clearwell_level_pct", name: null, unit: "%", headlineRank: null, latest: null };
  const eff: GeneratedSitePointDto = { pointKey: "efficiency", name: "Efficiency", unit: "%", headlineRank: null, latest: null };
  expect(mimicLevelPoint(asset(WTP_ID, "W", [flag, eff, pct]))?.pointKey).toBe("clearwell_level_pct");
  expect(mimicLevelPoint(asset(WTP_ID, "W", [flag, eff]))).toBeNull();
}

/** M9b — the fill fraction is clamped to 0–1, and a missing or non-finite value is no fill. */
export function levelFractionClamps(): void {
  expect(mimicLevelFraction(42)).toBe(0.42);
  expect(mimicLevelFraction(150)).toBe(1);
  expect(mimicLevelFraction(-5)).toBe(0);
  expect(mimicLevelFraction(Number.NaN)).toBeNull();
  expect(mimicLevelFraction(null)).toBeNull();
}

/** M10 — a seeded severity is its own tone and capitalised label; an unknown code is neutral, raw. */
export function severityToneAndLabel(): void {
  expect(mimicAlarmTone("warning")).toBe("warning");
  expect(mimicAlarmTone("critical")).toBe("critical");
  expect(mimicAlarmTone("info")).toBe("info");
  expect(mimicAlarmTone("sev9")).toBe("neutral");
  expect(mimicAlarmSeverityLabel("warning")).toBe("Warning");
  expect(mimicAlarmSeverityLabel("sev9")).toBe("sev9");
}

/** M11 — a long callout line is cut with an ellipsis, by code point, never splitting a pair. */
export function calloutTextIsCutByCodePoint(): void {
  expect(mimicCalloutText("DO high", 10)).toBe("DO high");
  expect(mimicCalloutText("abcdefghijkl", 10)).toBe("abcdefghi\u2026");
  expect(mimicCalloutText("\u{1F600}\u{1F600}\u{1F600}\u{1F600}", 3)).toBe("\u{1F600}\u{1F600}\u2026");
}

/** M12 — a pump sits at the gap's midpoint on a same-row pipe, either direction; none across rows. */
export function pumpSitsMidGap(): void {
  const { w } = MIMIC_NODE_SIZE;
  expect(pipeMidpoint({ x: 0, y: 10 }, { x: 300, y: 10 })).toEqual({ x: (w + 300) / 2, y: 10 + MIMIC_PIPE_Y });
  expect(pipeMidpoint({ x: 300, y: 10 }, { x: 0, y: 10 })).toEqual({ x: (w + 300) / 2, y: 10 + MIMIC_PIPE_Y });
  expect(pipeMidpoint({ x: 0, y: 0 }, { x: 0, y: 400 })).toBeNull();
}
