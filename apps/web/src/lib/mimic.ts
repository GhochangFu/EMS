import { MIMIC_HEADLINE_POINTS } from "@bms/shared/contracts";
import type {
  GeneratedSiteAssetDto,
  GeneratedSitePointDto,
  GeneratedSiteViewDto,
  MIMIC_PRESETS,
  MimicNodeDto,
  MimicPreset,
  MimicWidgetNodesDto,
} from "@bms/shared";

import { assetStatus, type AssetStatus } from "./generated-site-view";

/**
 * `F3.32` U4 — the pure half of the plant mimic widget (ADR 0079, plan §3 U4).
 *
 * The topology (which nodes, which pipes, which role each resolves against) is
 * `MIMIC_PRESETS` in `packages/shared`, because the API answers nodes in its order. Where a node
 * sits on the canvas is presentation, and lives here (plan D3).
 *
 * **The live overlay is F3.68's, unchanged** (plan D2). `mimicViewFor` hands the assigned assets
 * to `useSiteLiveReadings` as a synthetic `GeneratedSiteViewDto`, so the clamp-once rule, the
 * one socket, the one tick and the shared `isStale` gate are reused rather than restated.
 */

/** A node's status. Precedence, highest first: `unassigned`, `alarm`, then freshness (plan D5). */
export type MimicNodeStatus = "unassigned" | "alarm" | AssetStatus;

/** Every node box is this size, in viewBox units. */
export const MIMIC_NODE_SIZE = { w: 200, h: 120 } as const;

/** A position in viewBox units — a node's top-left corner, or a sink's arrow tip. */
export type MimicPoint = { readonly x: number; readonly y: number };

type NodeKeyOf<P extends MimicPreset> = (typeof MIMIC_PRESETS)[P]["nodes"][number]["key"];

type MimicLayout<K extends string> = {
  readonly viewBox: string;
  readonly nodes: { readonly [key in K]: MimicPoint };
  /** Where the sink pipe ends; the sink label is drawn just past it. */
  readonly sink: MimicPoint;
};

/**
 * `water_train` — the treatment chain across the top, left to right; storage feeds the cooling
 * tower straight down and the STP → ETP chain back along the bottom row, ending in the
 * Discharge sink label (owner ruling 1: a label, not a node).
 */
const WATER_TRAIN_LAYOUT = {
  viewBox: "0 0 1200 420",
  nodes: {
    water_intake: { x: 20, y: 30 },
    wtp: { x: 260, y: 30 },
    ro: { x: 500, y: 30 },
    softener: { x: 740, y: 30 },
    water_storage: { x: 980, y: 30 },
    cooling_tower: { x: 980, y: 270 },
    stp: { x: 740, y: 270 },
    etp: { x: 500, y: 270 },
  },
  sink: { x: 400, y: 330 },
} as const satisfies MimicLayout<NodeKeyOf<"water_train">>;

/** One layout per preset — a missing preset or node key is a compile error here. */
export const MIMIC_LAYOUTS: { readonly [P in MimicPreset]: MimicLayout<NodeKeyOf<P>> } = {
  water_train: WATER_TRAIN_LAYOUT,
};

/**
 * The synthetic view `useSiteLiveReadings` reads: the widget's assigned assets, each once, in
 * node order. An unassigned node holds no asset and so is never tracked; no widget entry is no
 * view (the hook then tracks nothing and clamps nothing).
 */
export function mimicViewFor(
  widget: MimicWidgetNodesDto | undefined,
  asOf: string,
): GeneratedSiteViewDto | undefined {
  if (widget === undefined) {
    return undefined;
  }
  const seen = new Set<string>();
  const assets: GeneratedSiteAssetDto[] = [];
  for (const node of widget.nodes) {
    if (node.asset !== null && !seen.has(node.asset.id)) {
      seen.add(node.asset.id);
      assets.push(node.asset);
    }
  }
  return {
    locationId: widget.widgetId,
    asOf,
    domains: [{ code: "mimic", label: "Plant mimic", assets }],
  };
}

/**
 * A node's status (plan D5). `lastSeenMs` is `useSiteLiveReadings`' clamped last-seen instant,
 * never the DTO's `freshness` — a socket reading must be able to turn a stale node live.
 */
export function mimicNodeStatus(
  node: Pick<MimicNodeDto, "asset" | "activeAlarms">,
  lastSeenMs: number | null,
  nowMs: number,
): MimicNodeStatus {
  if (node.asset === null) {
    return "unassigned";
  }
  if (node.activeAlarms > 0) {
    return "alarm";
  }
  return assetStatus(lastSeenMs, nowMs);
}

/** The rows a node shows: the server's first `MIMIC_HEADLINE_POINTS`, never re-sorted. */
export function mimicNodePoints(asset: GeneratedSiteAssetDto): readonly GeneratedSitePointDto[] {
  return asset.points.slice(0, MIMIC_HEADLINE_POINTS);
}

/** The `+N` badge: how many members carry the role beyond the one shown; `null` for none. */
export function mimicBadge(memberCount: number): string | null {
  return memberCount > 1 ? `+${memberCount - 1}` : null;
}

/** Status → the box outline, ADR 0078 role classes only. */
export const MIMIC_STATUS_STROKE: Readonly<Record<MimicNodeStatus, string>> = {
  live: "stroke-accent",
  alarm: "stroke-critical",
  stale: "stroke-warning",
  none: "stroke-line-strong",
  unassigned: "stroke-line",
};

export const MIMIC_STATUS_LABEL: Readonly<Record<MimicNodeStatus, string>> = {
  live: "Live",
  alarm: "Alarm",
  stale: "Stale",
  none: "No data",
  unassigned: "Not assigned",
};

/**
 * An SVG path `d` between two node boxes (top-left corners), in flow direction. Same row: edge
 * to edge at mid-height. Across rows: out of the bottom (or top) centre, along the gap between
 * the rows, into the other box's top (or bottom) centre — two pipes out of one box share the
 * first leg, which reads as a branch.
 */
export function pipePath(from: MimicPoint, to: MimicPoint): string {
  const { w, h } = MIMIC_NODE_SIZE;
  if (from.y === to.y) {
    const y = from.y + h / 2;
    return to.x > from.x ? `M${from.x + w} ${y} H${to.x}` : `M${from.x} ${y} H${to.x + w}`;
  }
  const down = to.y > from.y;
  const y0 = down ? from.y + h : from.y;
  const y1 = down ? to.y : to.y + h;
  return `M${from.x + w / 2} ${y0} V${(y0 + y1) / 2} H${to.x + w / 2} V${y1}`;
}

/** The sink pipe: out of the node's side facing the sink, level with its mid-height. */
export function sinkPath(from: MimicPoint, sink: MimicPoint): string {
  const { w, h } = MIMIC_NODE_SIZE;
  const y = from.y + h / 2;
  return sink.x < from.x ? `M${from.x} ${y} H${sink.x}` : `M${from.x + w} ${y} H${sink.x}`;
}
