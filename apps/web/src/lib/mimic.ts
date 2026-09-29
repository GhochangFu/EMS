import { MIMIC_HEADLINE_POINTS } from "@bms/shared/contracts";
import type {
  GeneratedSiteAssetDto,
  GeneratedSitePointDto,
  GeneratedSiteViewDto,
  MIMIC_PRESETS,
  MimicNodeDto,
  MimicPanelTone as SharedMimicPanelTone,
  MimicPreset,
  MimicSymbol,
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
 * `F3.32d` / ADR 0082 decision 3 adds six domain presets. Their coordinates follow one slot rule
 * (`MIMIC_SLOT_GRID`, `slotAt`, `slotViewBox`); `water_train` keeps its literal table.
 *
 * **The live overlay is F3.68's, unchanged** (plan D2). `mimicViewFor` hands the assigned assets
 * to `useSiteLiveReadings` as a synthetic `GeneratedSiteViewDto`, so the clamp-once rule, the
 * one tick and the shared `isStale` gate are reused rather than restated. Each mimic widget opens
 * its own socket alongside the dashboard's — `useSiteLiveReadings` is reused per widget, not the
 * one connection.
 */

/** A node's status. Precedence, highest first: `unassigned`, `alarm`, then freshness (plan D5). */
export type MimicNodeStatus = "unassigned" | "alarm" | AssetStatus;

/**
 * Every node's slot, in viewBox units (`F3.32b`, ADR 0079 Amendment 2). Top to bottom: the
 * status frame round the label and the illustrated symbol (`MIMIC_FRAME_H`), up to three value
 * rows, and the alarm callout's slot. Nothing a node draws hangs below `h`, so the overlap
 * check on the slot also covers the callout, and a pipe leaving the bottom centre never runs
 * through one.
 */
export const MIMIC_NODE_SIZE = { w: 200, h: 250 } as const;

/** The status frame's height inside the slot. */
export const MIMIC_FRAME_H = 130;

/** The symbol's centre height inside the slot — where a same-row pipe and the sink pipe run. */
export const MIMIC_PIPE_Y = 86;

/** The alarm callout's box inside the slot. */
export const MIMIC_CALLOUT = { y: 200, h: 48 } as const;

/** A position in viewBox units — a node's top-left corner, or a sink's arrow tip. */
export type MimicPoint = { readonly x: number; readonly y: number };

type NodeKeyOf<P extends MimicPreset> = (typeof MIMIC_PRESETS)[P]["nodes"][number]["key"];

type MimicLayout<K extends string> = {
  readonly viewBox: string;
  readonly nodes: { readonly [key in K]: MimicPoint };
  /**
   * Where the sink pipe ends; the sink symbol and label are drawn just past it. Optional, as
   * the preset's `sink` is (ADR 0082 decision 3): only `water_train` has one.
   */
  readonly sink?: MimicPoint;
  /** Pipes that carry a drawn pump at their midpoint — decoration, not a node (ruling 1). */
  readonly pumps: readonly { readonly from: K; readonly to: K }[];
};

/**
 * The slot rule every preset but `water_train` is placed by (`F3.32d`, ADR 0082, plan D3): column
 * `c` at `x0 + colPitch·c`, row `r` at `y0 + rowPitch·r`. It is `water_train`'s own pitch — its
 * top row and its tower sit on it — so the seven drawings share one rhythm.
 */
export const MIMIC_SLOT_GRID = { x0: 40, y0: 44, colPitch: 245, rowPitch: 366 } as const;

/** Room right of the last column and below the last row: `water_train`'s 1260 × 680 margins. */
const SLOT_MARGIN = { right: 40, bottom: 20 } as const;

/** The top-left corner of the slot at column `col`, row `row`. */
export function slotAt(col: number, row: number): MimicPoint {
  return {
    x: MIMIC_SLOT_GRID.x0 + MIMIC_SLOT_GRID.colPitch * col,
    y: MIMIC_SLOT_GRID.y0 + MIMIC_SLOT_GRID.rowPitch * row,
  };
}

/** The viewBox round `cols` × `rows` slots; `slotViewBox(5, 2)` is `water_train`'s "0 0 1260 680". */
export function slotViewBox(cols: number, rows: number): string {
  const last = slotAt(cols - 1, rows - 1);
  const width = last.x + MIMIC_NODE_SIZE.w + SLOT_MARGIN.right;
  const height = last.y + MIMIC_NODE_SIZE.h + SLOT_MARGIN.bottom;
  return `0 0 ${width} ${height}`;
}

/**
 * `water_train` — the treatment chain across the top, left to right; storage feeds the cooling
 * tower straight down and the STP → ETP chain back along the bottom row, ending in the
 * Discharge sink (owner ruling 1: a drawn sink, not a node). The rows are 116 apart so the
 * storage → STP leg runs in the gap between the panels, clear of both.
 *
 * Literal, not `slotAt`: its bottom row is shifted off the slot grid (STP 765, ETP 510) to leave
 * room for the sink, and the `F3.32b` drawing is pinned pixel for pixel in `mimic-geometry.spec.ts`.
 */
const WATER_TRAIN_LAYOUT = {
  viewBox: "0 0 1260 680",
  nodes: {
    water_intake: { x: 40, y: 44 },
    wtp: { x: 285, y: 44 },
    ro: { x: 530, y: 44 },
    softener: { x: 775, y: 44 },
    water_storage: { x: 1020, y: 44 },
    cooling_tower: { x: 1020, y: 410 },
    stp: { x: 765, y: 410 },
    etp: { x: 510, y: 410 },
  },
  sink: { x: 450, y: 410 + MIMIC_PIPE_Y },
  pumps: [{ from: "water_intake", to: "wtp" }],
} as const satisfies MimicLayout<NodeKeyOf<"water_train">>;

/**
 * The six domain presets (ADR 0082 decision 3, plan §3), placed by `slotAt`. None has a sink or
 * a drawn pump. Every same-row pipe joins adjacent columns and every cross-row pipe runs its
 * horizontal leg in the gap between the rows, so no pipe crosses a third unit (`mimic.spec.ts`
 * M15).
 */
const ELECTRICAL_DISTRIBUTION_LAYOUT = {
  viewBox: slotViewBox(5, 2),
  nodes: {
    incoming: slotAt(0, 0),
    ht_panel: slotAt(1, 0),
    transformer: slotAt(2, 0),
    lt_panel: slotAt(3, 0),
    mcc: slotAt(4, 0),
    dg_set: slotAt(2, 1),
    ups: slotAt(4, 1),
  },
  pumps: [],
} as const satisfies MimicLayout<NodeKeyOf<"electrical_distribution">>;

const HVAC_CHILLER_PLANT_LAYOUT = {
  viewBox: slotViewBox(5, 1),
  nodes: {
    cooling_tower: slotAt(0, 0),
    chiller: slotAt(1, 0),
    primary_pumps: slotAt(2, 0),
    secondary_pumps: slotAt(3, 0),
    ahu_fcu: slotAt(4, 0),
  },
  pumps: [],
} as const satisfies MimicLayout<NodeKeyOf<"hvac_chiller_plant">>;

const IT_POWER_COOLING_LAYOUT = {
  viewBox: slotViewBox(4, 2),
  nodes: {
    utility_feed: slotAt(0, 0),
    ups: slotAt(1, 0),
    battery: slotAt(1, 1),
    pdu: slotAt(2, 0),
    it_racks: slotAt(3, 0),
    crac: slotAt(3, 1),
  },
  pumps: [],
} as const satisfies MimicLayout<NodeKeyOf<"it_power_cooling">>;

const COMPRESSED_AIR_LAYOUT = {
  viewBox: slotViewBox(4, 1),
  nodes: {
    compressor: slotAt(0, 0),
    dryer: slotAt(1, 0),
    receiver: slotAt(2, 0),
    header: slotAt(3, 0),
  },
  pumps: [],
} as const satisfies MimicLayout<NodeKeyOf<"compressed_air">>;

const ENVIRONMENT_MONITORING_LAYOUT = {
  viewBox: slotViewBox(4, 1),
  nodes: {
    ambient: slotAt(0, 0),
    indoor_air: slotAt(1, 0),
    stack: slotAt(2, 0),
    effluent: slotAt(3, 0),
  },
  pumps: [],
} as const satisfies MimicLayout<NodeKeyOf<"environment_monitoring">>;

const FACILITY_SERVICES_LAYOUT = {
  viewBox: slotViewBox(4, 2),
  nodes: {
    main_meter: slotAt(1, 0),
    lighting: slotAt(0, 1),
    lifts: slotAt(1, 1),
    fire_pumps: slotAt(2, 1),
    utilities: slotAt(3, 1),
  },
  pumps: [],
} as const satisfies MimicLayout<NodeKeyOf<"facility_services">>;

/** One layout per preset — a missing preset or node key is a compile error here. */
export const MIMIC_LAYOUTS: { readonly [P in MimicPreset]: MimicLayout<NodeKeyOf<P>> } = {
  water_train: WATER_TRAIN_LAYOUT,
  electrical_distribution: ELECTRICAL_DISTRIBUTION_LAYOUT,
  hvac_chiller_plant: HVAC_CHILLER_PLANT_LAYOUT,
  it_power_cooling: IT_POWER_COOLING_LAYOUT,
  compressed_air: COMPRESSED_AIR_LAYOUT,
  environment_monitoring: ENVIRONMENT_MONITORING_LAYOUT,
  facility_services: FACILITY_SERVICES_LAYOUT,
};

/**
 * A panel's tint — ADR 0078 roles only, and never `warning` or `critical`, which mean status.
 * Declared once, as `mimicPanelToneSchema` in the shared contract (`F3.32c`, plan D12).
 */
export type MimicPanelTone = SharedMimicPanelTone;

/** A tinted panel: one train of the plant, holding its nodes (Amendment 2 item 2). */
export type MimicPanel<K extends string = string> = {
  readonly key: string;
  readonly label: string;
  readonly tone: MimicPanelTone;
  readonly nodes: readonly K[];
};

/**
 * The panels per preset, in drawing order. Each preset node belongs to exactly one panel (the
 * partition case in `mimic.spec.ts`); the widget still draws a node no panel names, after the
 * panels, so a gap here loses a frame, never a box.
 */
export const MIMIC_PANELS: { readonly [P in MimicPreset]: readonly MimicPanel<NodeKeyOf<P>>[] } = {
  water_train: [
    {
      key: "treatment",
      label: "Water treatment",
      tone: "info",
      nodes: ["water_intake", "wtp", "ro", "softener", "water_storage"],
    },
    { key: "utilities", label: "Utilities", tone: "neutral", nodes: ["cooling_tower"] },
    { key: "wastewater", label: "Wastewater", tone: "accent", nodes: ["stp", "etp"] },
  ],
  electrical_distribution: [
    { key: "supply", label: "Supply", tone: "info", nodes: ["incoming", "ht_panel", "transformer"] },
    { key: "distribution", label: "Distribution", tone: "neutral", nodes: ["lt_panel", "mcc"] },
    { key: "standby", label: "Standby", tone: "accent", nodes: ["dg_set", "ups"] },
  ],
  hvac_chiller_plant: [
    { key: "plant", label: "Chiller plant", tone: "info", nodes: ["cooling_tower", "chiller", "primary_pumps"] },
    { key: "distribution", label: "Distribution", tone: "neutral", nodes: ["secondary_pumps", "ahu_fcu"] },
  ],
  it_power_cooling: [
    { key: "power", label: "Power", tone: "info", nodes: ["utility_feed", "ups", "battery", "pdu"] },
    { key: "white_space", label: "White space", tone: "accent", nodes: ["it_racks", "crac"] },
  ],
  compressed_air: [
    {
      key: "compressed_air",
      label: "Compressed air",
      tone: "info",
      nodes: ["compressor", "dryer", "receiver", "header"],
    },
  ],
  environment_monitoring: [
    { key: "air", label: "Air", tone: "info", nodes: ["ambient", "indoor_air", "stack"] },
    { key: "water", label: "Water", tone: "accent", nodes: ["effluent"] },
  ],
  facility_services: [
    { key: "metering", label: "Metering", tone: "info", nodes: ["main_meter"] },
    { key: "services", label: "Services", tone: "neutral", nodes: ["lighting", "lifts", "fire_pumps", "utilities"] },
  ],
};

/** Panel tone → frame, title and symbol classes. */
export const MIMIC_PANEL_CLASSES: Readonly<
  Record<MimicPanelTone, { readonly frame: string; readonly title: string; readonly glyph: string }>
> = {
  info: { frame: "fill-info-wash stroke-info-line", title: "fill-info-ink", glyph: "stroke-info" },
  neutral: { frame: "fill-well stroke-line", title: "fill-ink-muted", glyph: "stroke-ink-muted" },
  accent: { frame: "fill-accent/5 stroke-accent/20", title: "fill-ok-ink", glyph: "stroke-accent" },
};

/**
 * `F3.32e` / ADR 0084 decision 6 — a `fill`-style library glyph (`mdi:*`) draws with no stroke
 * and the matching fill class of the same role, so colour stays with the role token (ADR 0078)
 * across both draw styles. Literal strings, not a template, so Tailwind's class scanner emits
 * every one of them; an unmapped stroke class falls back to `fill-ink-muted`.
 */
export const MIMIC_GLYPH_FILL_CLASS: Readonly<Record<string, string>> = {
  "stroke-info": "fill-info",
  "stroke-ink-muted": "fill-ink-muted",
  "stroke-accent": "fill-accent",
  "stroke-ink-faint": "fill-ink-faint",
  "stroke-ink": "fill-ink",
  "stroke-line-strong": "fill-line-strong",
};

/** Room round a panel's nodes: the side and bottom padding, and the title band above them. */
const PANEL_PAD = 16;
const PANEL_TITLE = 34;

/** Width of the sink's drawn symbol and label, left or right of the sink pipe's tip. */
export const MIMIC_SINK_W = 70;

/**
 * A panel's frame, in viewBox units: the bounding box of its nodes' slots, padded, with a title
 * band on top. The panel that holds the sink's upstream node also holds the sink symbol.
 */
export function mimicPanelBox(
  nodes: readonly MimicPoint[],
  sink: MimicPoint | null,
): { x: number; y: number; w: number; h: number } | null {
  if (nodes.length === 0) {
    return null;
  }
  const { w, h } = MIMIC_NODE_SIZE;
  let x0 = Math.min(...nodes.map((p) => p.x));
  let x1 = Math.max(...nodes.map((p) => p.x + w));
  const y0 = Math.min(...nodes.map((p) => p.y));
  const y1 = Math.max(...nodes.map((p) => p.y + h));
  if (sink !== null) {
    x0 = Math.min(x0, sink.x - MIMIC_SINK_W);
    x1 = Math.max(x1, sink.x + MIMIC_SINK_W);
  }
  return {
    x: x0 - PANEL_PAD,
    y: y0 - PANEL_TITLE,
    w: x1 - x0 + 2 * PANEL_PAD,
    h: y1 - y0 + PANEL_TITLE + PANEL_PAD / 2,
  };
}

/**
 * The illustrated symbols `mimic-glyphs.tsx` draws: every unit symbol of the closed shared set
 * (`mimicSymbolSchema`, `F3.32c` plan D12; since `F3.32e` also every library key, ADR 0084), plus
 * the callout's `alert`. A core symbol added to the contract without a path is a compile error
 * in `mimic-glyphs.tsx`; a library key draws its vendored shapes.
 */
export type MimicGlyphKind = MimicSymbol | "alert";

/** Node key → its symbol. Typed like `MIMIC_LAYOUTS`: a missing node key is a compile error. */
export const MIMIC_NODE_GLYPHS: {
  readonly [P in MimicPreset]: { readonly [key in NodeKeyOf<P>]: MimicSymbol };
} = {
  water_train: {
    water_intake: "tank",
    wtp: "clarifier",
    ro: "membrane",
    softener: "vessel",
    water_storage: "tank",
    cooling_tower: "tower",
    stp: "aeration",
    etp: "dosing",
  },
  electrical_distribution: {
    incoming: "meter",
    ht_panel: "breaker",
    transformer: "transformer",
    lt_panel: "switchboard",
    mcc: "motor",
    dg_set: "generator",
    ups: "ups",
  },
  hvac_chiller_plant: {
    cooling_tower: "tower",
    chiller: "chiller",
    primary_pumps: "pump",
    secondary_pumps: "pump",
    ahu_fcu: "ahu",
  },
  it_power_cooling: {
    utility_feed: "switchboard",
    ups: "ups",
    battery: "battery",
    pdu: "breaker",
    it_racks: "rack",
    crac: "ahu",
  },
  compressed_air: {
    compressor: "compressor",
    dryer: "filter",
    receiver: "tank",
    header: "valve",
  },
  environment_monitoring: {
    ambient: "sensor",
    indoor_air: "sensor",
    stack: "tower",
    effluent: "discharge",
  },
  facility_services: {
    main_meter: "meter",
    lighting: "lamp",
    lifts: "lift",
    fire_pumps: "pump",
    utilities: "unit",
  },
};

/**
 * A tank's live fill level: the first of the node's points whose key or name says `level` AND
 * whose unit is `%` (`clearwell_level_pct`) — `oil_level_low` is a flag with unit `""`, not a
 * level. Only the server's headline points reach the web, so a level point outside them is not
 * seen and the tank draws plain.
 */
export function mimicLevelPoint(asset: GeneratedSiteAssetDto): GeneratedSitePointDto | null {
  return (
    asset.points.find((p) => p.unit === "%" && /level/i.test(`${p.pointKey} ${p.name ?? ""}`)) ?? null
  );
}

/** A level reading as a fill fraction, clamped to 0–1; `null` for no reading or a non-number. */
export function mimicLevelFraction(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(100, Math.max(0, value)) / 100;
}

/** The callout's colour. */
export type MimicAlarmTone = "critical" | "warning" | "info" | "neutral";

/**
 * The severity's vocabulary tone (`topAlarm.tone`, read from `bms.alarm_severities` by the
 * server, ADR 0032 decision 9) → the callout's colour. The severity CODE plays no part, so a
 * level added by an `INSERT` draws in its declared tone. A tone the callout has no colour for
 * (`offline`, `ok`, or anything a newer server sends) draws neutral, never blank (the `F4.43`
 * lesson in `vocabulary.ts`).
 */
export function mimicAlarmTone(tone: string): MimicAlarmTone {
  return tone === "critical" || tone === "warning" || tone === "info" ? tone : "neutral";
}

export const MIMIC_ALARM_CLASSES: Readonly<
  Record<MimicAlarmTone, { readonly box: string; readonly ink: string; readonly icon: string }>
> = {
  critical: { box: "fill-critical-wash stroke-critical-line", ink: "fill-critical-ink", icon: "stroke-critical" },
  warning: { box: "fill-warning-wash stroke-warning-line", ink: "fill-warning-ink", icon: "stroke-warning" },
  info: { box: "fill-info-wash stroke-info-line", ink: "fill-info-ink", icon: "stroke-info" },
  neutral: { box: "fill-well stroke-line-strong", ink: "fill-ink-muted", icon: "stroke-ink-muted" },
};

/** The most characters a callout line shows, the ellipsis included (the box is 200 units wide). */
export const MIMIC_CALLOUT_CHARS = 20;

/**
 * A callout line cut to `max` characters with an ellipsis. Counts code points, not UTF-16 units,
 * so a cut never splits a surrogate pair; the full text stays in the callout's `<title>`.
 */
export function mimicCalloutText(message: string, max = MIMIC_CALLOUT_CHARS): string {
  const chars = Array.from(message);
  return chars.length <= max ? message : `${chars.slice(0, max - 1).join("")}…`;
}

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

/**
 * Whether the pipe out of a node carries the moving dash (`F3.32b`, session ruling): the
 * upstream unit's asset has fresh data. A `live` node does; an `alarm` node does when its own
 * reading is fresh (an alarm is not a stopped plant); `stale`, `none` and `unassigned` do not.
 * `lastSeenMs` is the same clamped instant `mimicNodeStatus` reads.
 */
export function mimicNodeFlows(status: MimicNodeStatus, lastSeenMs: number | null, nowMs: number): boolean {
  if (status === "live") {
    return true;
  }
  return status === "alarm" && assetStatus(lastSeenMs, nowMs) === "live";
}

/**
 * The drawing's accessible name (`F3.32b`). The SVG is one `role="img"`, so its callouts are
 * not in the accessibility tree: the name carries every unit with an open alarm — its label,
 * its severity's vocabulary label and the FULL message (a screen reader has no hover).
 */
export function mimicAriaLabel(
  title: string,
  presetLabel: string,
  alarmed: readonly { readonly unit: string; readonly severity: string; readonly message: string }[],
): string {
  const base = `${title}: ${presetLabel}`;
  if (alarmed.length === 0) {
    return base;
  }
  return `${base}. Open alarms: ${alarmed.map((a) => `${a.unit}, ${a.severity}: ${a.message}`).join("; ")}`;
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
 * An SVG path `d` between two node slots (top-left corners), in flow direction. Same row: edge
 * to edge at the symbol's centre height (`MIMIC_PIPE_Y`). Across rows: out of the bottom (or
 * top) centre, along the gap between the rows, into the other slot's top (or bottom) centre —
 * two pipes out of one slot share the first leg, which reads as a branch.
 */
export function pipePath(from: MimicPoint, to: MimicPoint): string {
  const { w, h } = MIMIC_NODE_SIZE;
  if (from.y === to.y) {
    const y = from.y + MIMIC_PIPE_Y;
    return to.x > from.x ? `M${from.x + w} ${y} H${to.x}` : `M${from.x} ${y} H${to.x + w}`;
  }
  const down = to.y > from.y;
  const y0 = down ? from.y + h : from.y;
  const y1 = down ? to.y : to.y + h;
  return `M${from.x + w / 2} ${y0} V${(y0 + y1) / 2} H${to.x + w / 2} V${y1}`;
}

/**
 * The midpoint of a same-row pipe, where a drawn pump sits; `null` across rows (no pump is
 * placed on a bent pipe).
 */
export function pipeMidpoint(from: MimicPoint, to: MimicPoint): MimicPoint | null {
  if (from.y !== to.y) {
    return null;
  }
  const { w } = MIMIC_NODE_SIZE;
  const [left, right] = from.x < to.x ? [from, to] : [to, from];
  return { x: (left.x + w + right.x) / 2, y: from.y + MIMIC_PIPE_Y };
}

/** The sink pipe: out of the node's side facing the sink, level with the symbol's centre. */
export function sinkPath(from: MimicPoint, sink: MimicPoint): string {
  const { w } = MIMIC_NODE_SIZE;
  const y = from.y + MIMIC_PIPE_Y;
  return sink.x < from.x ? `M${from.x} ${y} H${sink.x}` : `M${from.x + w} ${y} H${sink.x}`;
}
