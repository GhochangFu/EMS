import { MIMIC_FANOUT_MAX } from "@bms/shared/contracts";
import {
  deriveBreakerState,
  type BreakerState,
  type Energy,
  type EnergyGraph,
  type GeneratedSiteAssetDto,
  type GeneratedSitePointDto,
  type MimicNodeAlarmDto,
  type MimicNodeDto,
  type PointKeyStateMapDto,
  type SwitchState,
} from "@bms/shared";

import type { SiteLiveReadings } from "../hooks/use-site-live-readings";
import {
  MIMIC_STATUS_LABEL,
  MIMIC_STATUS_STROKE,
  mimicAlarmTone,
  mimicNodeStatus,
  type MimicAlarmTone,
} from "./mimic";
import type { MimicGeometry } from "./mimic-geometry";
import { isStale } from "./schematic-telemetry";

/**
 * `F3.74` Task 3.1 (ADR 0088 decisions 4–6, plan D6, D12) — the pure half of the breaker drawing.
 *
 * The API answers state points and maps, never a state; the state is derived here, once per
 * member, by `deriveBreakerState` over the socket overlay (`readings.pointLatest`, which is seeded
 * from the read and replaced by a live reading). Staleness is the member asset's clamped last-seen
 * instant, the same one the node status reads.
 */

/** One member of a node, as the drawing reads it: the node's own asset, or one fan-out member. */
export type MimicMember = {
  readonly asset: GeneratedSiteAssetDto;
  readonly statePoints: readonly GeneratedSitePointDto[];
  readonly activeAlarms: number;
  readonly topAlarm: MimicNodeAlarmDto | null;
};

/** A member with its derived switch state. */
export type MimicBreakerMember = MimicMember & { readonly state: BreakerState };

/**
 * A node's members, in the response's (asset-code) order: a fan-out node's `members`; otherwise
 * its one asset; `[]` when the node is absent or resolved no asset.
 */
export function membersOf(node: MimicNodeDto | undefined): readonly MimicMember[] {
  if (node === undefined) {
    return [];
  }
  if (node.members.length > 0) {
    return node.members;
  }
  return node.asset === null
    ? []
    : [{ asset: node.asset, statePoints: node.statePoints, activeAlarms: node.activeAlarms, topAlarm: node.topAlarm }];
}

/**
 * Every member's breaker state. A member is `offline` when its asset is stale (staleness first,
 * so a stale CLOSED reads OFFLINE); otherwise its state points are read through the overlay.
 */
export function switchStatesOf(
  node: MimicNodeDto | undefined,
  readings: SiteLiveReadings,
  maps: readonly PointKeyStateMapDto[],
  nowMs: number,
): readonly MimicBreakerMember[] {
  return membersOf(node).map((member) => {
    const stale = isStale(readings.assetLastSeenMs(member.asset), nowMs);
    const points = member.statePoints.map((point) => ({
      pointKey: point.pointKey,
      latest: readings.pointLatest(member.asset.id, point),
    }));
    return { ...member, state: deriveBreakerState({ stale, points }, maps) };
  });
}

/** A `BreakerState` as the walk sees it: stale is not knowable, so `offline` is `unknown`. */
export function toSwitchState(state: BreakerState): SwitchState {
  return state === "offline" ? "unknown" : state;
}

/**
 * The `energiseGraph` / `worstDownstreamSwitch` input from either arm's geometry: every unit with
 * its `switching` and `fanOut` flags, the pipes, and the units marked `isSource` (a preset's
 * `sources`, a layout's `is_source` units — `presetGeometry` / `layoutGeometry` set the flag).
 */
export function graphOf(geometry: MimicGeometry): EnergyGraph {
  return {
    nodes: geometry.units.map((u) => ({ key: u.key, switching: u.switching, fanOut: u.fanOut })),
    pipes: geometry.pipes.map((p) => ({ from: p.from, to: p.to })),
    sources: geometry.units.filter((u) => u.isSource).map((u) => u.key),
  };
}

/** How a breaker (or a passive bus framed by one) looks: a state, or the worst alarm's tone. */
export type BreakerLook = "offline" | "tripped" | "open" | MimicAlarmTone | "closed" | "unknown";

/**
 * The frame precedence (ADR 0088 decision 5): offline → tripped → open → the worst alarm's tone →
 * closed. A state with no knowable position (`unknown`) takes the alarm tone too, else its own.
 * The flow tones (`F3.80`, ADR 0101 d10) map onto the breaker looks, so `BreakerLook` gains no key:
 * `shut` draws as `open`, `flowing` as `closed`.
 */
export function breakerLook(state: BreakerState, alarmTone: MimicAlarmTone | null): BreakerLook {
  if (state === "offline" || state === "tripped") {
    return state;
  }
  if (state === "open" || state === "shut") {
    return "open";
  }
  return alarmTone ?? (state === "flowing" ? "closed" : state);
}

/**
 * Look → classes, ADR 0078 role tokens only, as full literals so Tailwind emits each. `frame` is
 * the unit's (or member row's) outline, `ink` the switch contact and the pill. Offline is faint and
 * dashed and OPEN is a muted solid — two different looks (ADR 0027 decision 5).
 */
export const BREAKER_LOOK_CLASSES: Readonly<
  Record<BreakerLook, { readonly frame: string; readonly ink: string; readonly pill: string; readonly dashed: boolean }>
> = {
  offline: { frame: "stroke-ink-faint", ink: "stroke-ink-faint", pill: "fill-ink-faint", dashed: true },
  tripped: { frame: "stroke-critical", ink: "stroke-critical", pill: "fill-critical-ink", dashed: false },
  open: { frame: "stroke-ink-muted", ink: "stroke-ink-muted", pill: "fill-ink-muted", dashed: false },
  critical: { frame: "stroke-critical", ink: "stroke-ok", pill: "fill-ok-ink", dashed: false },
  warning: { frame: "stroke-warning", ink: "stroke-ok", pill: "fill-ok-ink", dashed: false },
  info: { frame: "stroke-info", ink: "stroke-ok", pill: "fill-ok-ink", dashed: false },
  neutral: { frame: "stroke-line-strong", ink: "stroke-ok", pill: "fill-ok-ink", dashed: false },
  closed: { frame: "stroke-ok", ink: "stroke-ok", pill: "fill-ok-ink", dashed: false },
  unknown: { frame: "stroke-line-strong", ink: "stroke-ink-muted", pill: "fill-ink-muted", dashed: false },
};

/**
 * A pipe's energy → its stroke (OQ5 rev 2, plan D6), ADR 0078 role tokens only: energised `ok`
 * (the fixed state green, `F4.310` / ADR 0110; it was `accent`), de-energised the plain pipe grey,
 * unknown the hint ink and dashed — never the state green. The same class
 * colours the pipe's `F3.32b` freshness dash on a graph with sources.
 */
export const ENERGY_PIPE_CLASSES: Readonly<Record<Energy, { readonly stroke: string; readonly dashed: boolean }>> = {
  energised: { stroke: "stroke-ok", dashed: false },
  "de-energised": { stroke: "stroke-line-strong", dashed: false },
  unknown: { stroke: "stroke-ink-hint", dashed: true },
};

/**
 * The pill's text per state. A flowing valve or damper reads OPEN (the plant word for a passing
 * valve) and a shut one SHUT (`F3.80`, ADR 0101 d10); the breaker pills are `F3.74`'s.
 */
export const BREAKER_PILL: Readonly<Record<BreakerState, string>> = {
  closed: "CLOSED",
  open: "OPEN",
  tripped: "TRIPPED",
  offline: "OFFLINE",
  unknown: "—",
  flowing: "OPEN",
  shut: "SHUT",
};

/** The member band of a fan-out unit, in unit-slot units: below the frame, to the slot's foot. */
export const FANOUT_BAND = { top: 136, rowH: 12, perColumn: 8 } as const;

/**
 * `F4.322` — the sizes of one member row, in unit-slot units: its height, the code's font size on
 * a wide (`w >= 150`) and a narrow row, the code's character cap on each, the state/pill font size,
 * the switch size and the text baseline.
 */
export type FanOutRowSize = {
  readonly rowH: number;
  readonly baseline: number;
  readonly codeWide: number;
  readonly codeNarrow: number;
  readonly charsWide: number;
  readonly charsNarrow: number;
  readonly text: number;
  readonly switchSize: number;
};

/**
 * `F4.322` (owner rulings 2026-11-07) — the two row sizes. `dense` is the `F3.74` row, eight to a
 * column. A unit that draws at most `FANOUT_ROOMY_MAX` members draws `roomy` rows instead: twice
 * as tall, so four of them fill the same band and no unit or slot moves, with code 12 and state 10
 * (were 9 and 7.5). The roomy code cap keeps the code clear of the switch and the pill on a 200-wide
 * PHE slot (17 characters at 12 is about 126 units).
 */
export const FANOUT_ROW_SIZES = {
  dense: { rowH: FANOUT_BAND.rowH, baseline: 8.5, codeWide: 9, codeNarrow: 8, charsWide: 18, charsNarrow: 9, text: 7.5, switchSize: 10 },
  roomy: { rowH: 24, baseline: 16, codeWide: 12, codeNarrow: 10, charsWide: 17, charsNarrow: 8, text: 10, switchSize: 14 },
} as const satisfies Record<string, FanOutRowSize>;

/** `F4.322` — a unit drawing at most this many members draws `roomy` rows (4 × 24 = the band). */
export const FANOUT_ROOMY_MAX = 4;

/** `F4.322` — the widest state/pill word the row keeps room for ("TRIPPED", "OFFLINE", "No data"). */
const PILL_CHARS = 7;
/** An average glyph width of the bold row text, as a share of its font size. */
const GLYPH_W = 0.62;

/**
 * `F4.322` (owner ruling 2026-11-07) — where a member row's switch sits: from the row's right
 * edge, left of the room kept for the pill, so a longer code never runs under it. It was
 * `0.58 w`, which a roomy code would reach.
 */
export function fanOutSwitchX(w: number, size: FanOutRowSize): number {
  return w - 4 - size.text * GLYPH_W * PILL_CHARS - 3 - size.switchSize;
}

/**
 * `F4.322` review finding — the width the member code is clipped to, from the row's left edge: 2
 * short of the switch, or of the pill's room on a row with no switch. `GLYPH_W` is an estimate,
 * and the app loads no web font, so a wider fallback font (DejaVu Sans Bold is about 0.73 em)
 * would run the code under the switch; the clip keeps it out whatever the font.
 */
export function fanOutCodeClipW(w: number, size: FanOutRowSize, hasSwitch: boolean): number {
  return hasSwitch ? fanOutSwitchX(w, size) - 2 : w - 4 - size.text * GLYPH_W * PILL_CHARS - 2;
}

/** One drawn member row's place: its column's left edge and width, its top, and its sizes. */
export type FanOutRow = { readonly x: number; readonly y: number; readonly w: number; readonly size: FanOutRowSize };

/**
 * Where each drawn member sits (OQ6): one column up to `perColumn`, two columns up to
 * `MIMIC_FANOUT_MAX`; `more` is how many members the unit stands for beyond those drawn —
 * counted from `memberCount`, the true count, since the resolver answers at most the cap. Up to
 * `FANOUT_ROOMY_MAX` drawn members the rows are `roomy` (`F4.322`), else `dense`.
 */
export function fanOutRows(
  drawn: number,
  memberCount: number,
  slotW: number,
): { readonly rows: readonly FanOutRow[]; readonly more: number } {
  const shown = Math.min(drawn, MIMIC_FANOUT_MAX);
  const columns = shown > FANOUT_BAND.perColumn ? 2 : 1;
  const w = slotW / columns;
  const size: FanOutRowSize = shown <= FANOUT_ROOMY_MAX ? FANOUT_ROW_SIZES.roomy : FANOUT_ROW_SIZES.dense;
  const rows = Array.from({ length: shown }, (_, i) => ({
    x: Math.floor(i / FANOUT_BAND.perColumn) * w,
    y: FANOUT_BAND.top + (i % FANOUT_BAND.perColumn) * size.rowH,
    w,
    size,
  }));
  return { rows, more: Math.max(0, memberCount - shown) };
}

/**
 * One member row of a fan-out unit, decided here so the component only draws: `state` is `null`
 * for a member of a unit that does not switch, or a member with no state point — the row then
 * shows the member's status, no switch and no pill.
 */
export type FanOutMemberRow = {
  readonly id: string;
  readonly code: string;
  readonly state: BreakerState | null;
  /** The `data-frame` value: a `BreakerLook`, or the member's status for a non-switching unit. */
  readonly frame: string;
  readonly frameClass: string;
  readonly dashed: boolean;
  readonly look: BreakerLook | null;
  readonly text: string;
  readonly textClass: string;
};

/** The worst alarm's colour of a member, or `null` when it has none open. */
export function memberAlarmTone(member: MimicMember): MimicAlarmTone | null {
  return member.topAlarm === null ? null : mimicAlarmTone(member.topAlarm.tone);
}

/**
 * The pill's class. The alarm tone may set the frame only: an `unknown` state's "—" pill keeps
 * the unknown ink whatever `breakerLook` answered, never the CLOSED green an alarm look carries.
 * OPEN, TRIPPED and OFFLINE need no guard — `breakerLook` returns those states before the alarm.
 */
export function breakerPillClass(state: BreakerState, look: BreakerLook): string {
  return state === "unknown" ? BREAKER_LOOK_CLASSES.unknown.pill : BREAKER_LOOK_CLASSES[look].pill;
}

/** A switching member's row (one with state points): the frame precedence per member, and its pill. */
export function breakerRow(member: MimicBreakerMember): FanOutMemberRow {
  const look = breakerLook(member.state, memberAlarmTone(member));
  const cls = BREAKER_LOOK_CLASSES[look];
  return {
    id: member.asset.id,
    code: member.asset.code,
    state: member.state,
    frame: look,
    frameClass: cls.frame,
    dashed: cls.dashed,
    look,
    text: BREAKER_PILL[member.state],
    textClass: breakerPillClass(member.state, look),
  };
}

/**
 * A status member row — a member of a unit that does not switch, or a member with no state point:
 * the member's own status, as a node's status reads.
 */
export function statusRow(member: MimicMember, readings: SiteLiveReadings, nowMs: number): FanOutMemberRow {
  const status = mimicNodeStatus(member, readings.assetLastSeenMs(member.asset), nowMs);
  return {
    id: member.asset.id,
    code: member.asset.code,
    state: null,
    frame: status,
    frameClass: MIMIC_STATUS_STROKE[status],
    dashed: false,
    look: null,
    text: MIMIC_STATUS_LABEL[status],
    textClass: "fill-ink-muted",
  };
}

/**
 * What a roled unit draws of its breakers, decided once so the drawing and its accessible name
 * read the same answer. `single`: a unit that does not fan out and carries state points takes its
 * one member's switch (D6 — an `electrical_distribution` `ht_panel` draws the `breaker` glyph and
 * reports no state-mapped key, so it draws as before). `rows`: a fan-out unit's member rows, each
 * gated as a single unit is — a switching member with state points draws code · switch · pill,
 * any other member its status. The walk is not gated here: `switchStatesOf` still reads a member
 * with no state point `unknown`, so the pipes after it never look energised (ADR 0088 decision 6).
 */
export function unitBreakerDrawing(
  fanOut: boolean,
  node: MimicNodeDto | undefined,
  breakers: readonly MimicBreakerMember[] | undefined,
  readings: SiteLiveReadings,
): { readonly single: MimicBreakerMember | null; readonly rows: readonly FanOutMemberRow[] } {
  if (!fanOut) {
    const hasState = (node?.statePoints.length ?? 0) > 0;
    return { single: hasState && breakers?.length === 1 ? (breakers[0] ?? null) : null, rows: [] };
  }
  const rows =
    breakers === undefined
      ? membersOf(node).map((m) => statusRow(m, readings, readings.nowMs))
      : breakers.map((m) => (m.statePoints.length > 0 ? breakerRow(m) : statusRow(m, readings, readings.nowMs)));
  return { single: null, rows };
}

/** One drawn breaker, as the accessible name says it: "Main breaker CR-Q1: open". */
export type MimicBreakerAria = { readonly unit: string; readonly code: string; readonly state: BreakerState };

/**
 * The breaker part of the drawing's accessible name (the switch is `aria-hidden`, so a screen
 * reader hears the state here): `""` when no unit draws a state, so an unswitched drawing's name
 * is unchanged.
 */
export function mimicBreakerAriaSuffix(breakers: readonly MimicBreakerAria[]): string {
  if (breakers.length === 0) {
    return "";
  }
  return `. Breakers: ${breakers.map((b) => `${b.unit} ${b.code}: ${b.state}`).join("; ")}`;
}
