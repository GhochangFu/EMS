import { render, screen, within } from "@testing-library/react";
import { expect } from "vitest";

import type {
  GeneratedSiteAssetDto,
  GeneratedSitePointDto,
  MimicLayoutGeometryDto,
  MimicLayoutNodeDto,
  MimicNodeAlarmDto,
  MimicNodeDto,
  PointKeyStateMapDto,
} from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { layoutGeometry, presetGeometry, type MimicGeometry } from "../../lib/mimic-geometry";
import { MimicScene } from "./mimic-scene";

/**
 * `F3.74` Task 3.1 (ADR 0088 decisions 4–5, plan D6) — the breaker drawing in `MimicScene`: the
 * per-member switch state from `deriveBreakerState` over the socket overlay, the switch glyph
 * and pill, the fan-out member rows, the frame precedence, the passive-bus frame and compact mode.
 *
 * The readings are a stub keyed on `assetId|pointKey`: a value there is what the socket overlay
 * answers, and it differs from the DTO's `latest` wherever a claim needs to tell the two apart.
 * `mimic-widget-live.spec.tsx` LV-B holds the same through the real `useSiteLiveReadings`.
 */

const NOW = Date.parse("2026-10-02T10:00:00.000Z");

/** The seeded map (plan D1): `breaker_main` 0 OPEN, 1 CLOSED; `breaker_trip` 1 TRIPPED. */
export const STATE_MAPS: readonly PointKeyStateMapDto[] = [
  {
    pointKey: "breaker_main",
    states: [
      { value: 0, label: "OPEN", tone: "open" },
      { value: 1, label: "CLOSED", tone: "closed" },
    ],
  },
  { pointKey: "breaker_trip", states: [{ value: 1, label: "TRIPPED", tone: "tripped" }] },
];

function assetId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** A member asset with one headline point (`current_a`), so a value row would draw if allowed. */
function asset(n: number, code: string): GeneratedSiteAssetDto {
  return {
    id: assetId(n),
    code,
    name: code,
    domain: "electrical",
    latestTelemetryAt: null,
    freshness: "live",
    points: [{ pointKey: "current_a", name: "Current", unit: "A", headlineRank: 1, latest: { value: 40, time: "t" } }],
  };
}

/** A state point whose DTO `latest` is `dtoValue` — the socket stub may answer otherwise. */
function statePoint(pointKey: string, dtoValue: number): GeneratedSitePointDto {
  return { pointKey, name: pointKey, unit: "", headlineRank: 10, latest: { value: dtoValue, time: "t" } };
}

const CRITICAL: MimicNodeAlarmDto = {
  severity: "critical",
  tone: "critical",
  label: "Critical",
  message: "Breaker overcurrent",
  raisedAt: "2026-10-02T09:59:00.000Z",
};

type Member = {
  readonly asset: GeneratedSiteAssetDto;
  readonly statePoints?: readonly GeneratedSitePointDto[];
  readonly activeAlarms?: number;
  readonly topAlarm?: MimicNodeAlarmDto | null;
};

function memberDto(m: Member): MimicNodeDto["members"][number] {
  return {
    asset: m.asset,
    activeAlarms: m.activeAlarms ?? 0,
    topAlarm: m.topAlarm ?? null,
    statePoints: [...(m.statePoints ?? [])],
  };
}

/** A non-fan-out node: one asset, its own state points and alarm, `members` empty. */
function singleNode(key: string, roleCode: string, m: Member): MimicNodeDto {
  return {
    key,
    label: key,
    roleCode,
    asset: m.asset,
    memberCount: 1,
    activeAlarms: m.activeAlarms ?? 0,
    topAlarm: m.topAlarm ?? null,
    statePoints: [...(m.statePoints ?? [])],
    members: [],
  };
}

/** A fan-out node as the resolver answers it (plan D4): `asset` is the first member's. */
function fanOutNode(key: string, roleCode: string, members: readonly Member[], memberCount = members.length): MimicNodeDto {
  const first = members[0];
  return {
    key,
    label: key,
    roleCode,
    asset: first?.asset ?? null,
    memberCount,
    activeAlarms: members.reduce((n, m) => n + (m.activeAlarms ?? 0), 0),
    topAlarm: members.find((m) => m.topAlarm)?.topAlarm ?? null,
    statePoints: [...(first?.statePoints ?? [])],
    members: members.map(memberDto),
  };
}

/** The socket overlay stub: `values` by `assetId|pointKey`; an asset in `stale` was last seen a minute ago. */
function readingsOf(values: Readonly<Record<string, number>>, stale: ReadonlySet<string> = new Set()): SiteLiveReadings {
  return {
    nowMs: NOW,
    pointLatest: (id, point) => {
      const value = values[`${id}|${point.pointKey}`];
      return value === undefined ? null : { value, time: "t", atMs: NOW - 1_000 };
    },
    assetLastSeenMs: (a) => (stale.has(a.id) ? NOW - 60_000 : NOW - 1_000),
  };
}

function layoutNode(key: string, x: number, y: number, extra: Partial<MimicLayoutNodeDto>): MimicLayoutNodeDto {
  return { key, kind: "unit", symbol: "unit", label: key, roleCode: null, tone: null, x, y, w: 20, h: 25, z: 0, fanOut: false, isSource: false, ...extra };
}

/**
 * A drawn layout (not a preset): a source `src` feeds a passive bus `bus`, which feeds the fan-out
 * breaker `feeders`; `src` also feeds the single breaker `single`, which feeds the roled
 * `switchboard` `board` (not switching), which feeds the passive `tail`.
 */
export const BREAKER_LAYOUT: MimicLayoutGeometryDto = {
  name: "Board room",
  canvasW: 100,
  canvasH: 60,
  nodes: [
    layoutNode("src", 0, 0, { symbol: "transformer", isSource: true }),
    layoutNode("bus", 25, 0, { symbol: "switchboard" }),
    layoutNode("feeders", 50, 0, { symbol: "breaker", roleCode: "load-feeder-breaker", fanOut: true }),
    layoutNode("single", 75, 0, { symbol: "breaker", roleCode: "main-breaker" }),
    layoutNode("board", 0, 30, { symbol: "switchboard", roleCode: "ups" }),
    layoutNode("tail", 25, 30, { symbol: "pump" }),
  ],
  pipes: [
    { fromKey: "src", toKey: "bus" },
    { fromKey: "bus", toKey: "feeders" },
    { fromKey: "src", toKey: "single" },
    { fromKey: "single", toKey: "board" },
    { fromKey: "board", toKey: "tail" },
  ],
  orgSymbols: [],
};

const SLD = (): MimicGeometry => presetGeometry("lv_single_line");
const BOARD = (): MimicGeometry => layoutGeometry(BREAKER_LAYOUT);

function renderBreakers(
  geometry: MimicGeometry,
  nodes: readonly MimicNodeDto[],
  readings: SiteLiveReadings,
  compact = false,
) {
  return render(
    <MimicScene title="SLD" geometry={geometry} nodes={nodes} readings={readings} stateMaps={STATE_MAPS} compact={compact} />,
  );
}

function unitEl(key: string): HTMLElement {
  const el = screen.getAllByTestId("mimic-node").find((n) => n.getAttribute("data-node-key") === key);
  expect(el, `no mimic-node ${key}`).toBeDefined();
  return el as HTMLElement;
}

function rowsOf(key: string): HTMLElement[] {
  return within(unitEl(key)).queryAllByTestId("mimic-breaker-member");
}

function onlyRow(key: string): HTMLElement {
  const rows = rowsOf(key);
  expect(rows, `${key} rows`).toHaveLength(1);
  return rows[0] as HTMLElement;
}

function pillText(el: HTMLElement): string {
  return within(el).getByTestId("mimic-breaker-pill").textContent ?? "";
}

const Q1 = asset(1, "CR-Q1");

/** One `main_breaker` member reporting the given state points, fresh. */
function mainBreaker(points: readonly GeneratedSitePointDto[]): MimicNodeDto {
  return fanOutNode("main_breaker", "main-breaker", [{ asset: Q1, statePoints: points }]);
}

/** S1a — `breaker_main` 1 → CLOSED. */
export function breakerMainOneIsClosed(): void {
  renderBreakers(SLD(), [mainBreaker([statePoint("breaker_main", 1)])], readingsOf({ [`${Q1.id}|breaker_main`]: 1 }));
  const row = onlyRow("main_breaker");
  expect(row.getAttribute("data-breaker-state")).toBe("closed");
  expect(pillText(row)).toBe("CLOSED");
}

/** S1b — `breaker_main` 0 → OPEN. */
export function breakerMainZeroIsOpen(): void {
  renderBreakers(SLD(), [mainBreaker([statePoint("breaker_main", 0)])], readingsOf({ [`${Q1.id}|breaker_main`]: 0 }));
  const row = onlyRow("main_breaker");
  expect(row.getAttribute("data-breaker-state")).toBe("open");
  expect(pillText(row)).toBe("OPEN");
}

/**
 * S1c — `breaker_trip` 1 → TRIPPED, with `breaker_main` 1 (CLOSED) beside it: the tripped tone
 * outranks the closed one whatever the point order (mutation: swap the tone order → red).
 */
export function breakerTripOneIsTripped(): void {
  const points = [statePoint("breaker_main", 1), statePoint("breaker_trip", 1)];
  renderBreakers(
    SLD(),
    [mainBreaker(points)],
    readingsOf({ [`${Q1.id}|breaker_main`]: 1, [`${Q1.id}|breaker_trip`]: 1 }),
  );
  const row = onlyRow("main_breaker");
  expect(row.getAttribute("data-breaker-state")).toBe("tripped");
  expect(pillText(row)).toBe("TRIPPED");
}

/** S1d — a non-fan-out `breaker` unit draws one switch and one pill on the unit itself, no member rows. */
export function aSingleBreakerUnitCarriesItsOwnState(): void {
  const single = asset(2, "CR-Q2");
  renderBreakers(
    BOARD(),
    [singleNode("single", "main-breaker", { asset: single, statePoints: [statePoint("breaker_main", 0)] })],
    readingsOf({ [`${single.id}|breaker_main`]: 0 }),
  );
  const unit = unitEl("single");
  expect(unit.getAttribute("data-breaker-state")).toBe("open");
  expect(within(unit).getAllByTestId("mimic-breaker-switch")).toHaveLength(1);
  expect(pillText(unit)).toBe("OPEN");
  expect(rowsOf("single")).toHaveLength(0);
}

/**
 * S2 — the DTO says 1; the socket overlay flips 1 → 0 and the pill follows without a refetch
 * (mutation: read the DTO value instead of `pointLatest` → red).
 */
export function aSocketReadingFlipsThePill(): void {
  const nodes = [mainBreaker([statePoint("breaker_main", 1)])];
  const { rerender } = renderBreakers(SLD(), nodes, readingsOf({ [`${Q1.id}|breaker_main`]: 1 }));
  expect(pillText(onlyRow("main_breaker"))).toBe("CLOSED");
  rerender(
    <MimicScene
      title="SLD"
      geometry={SLD()}
      nodes={nodes}
      readings={readingsOf({ [`${Q1.id}|breaker_main`]: 0 })}
      stateMaps={STATE_MAPS}
    />,
  );
  const row = onlyRow("main_breaker");
  expect(row.getAttribute("data-breaker-state")).toBe("open");
  expect(pillText(row)).toBe("OPEN");
}

/**
 * S3 — a stale member reporting `breaker_main` 1 reads OFFLINE in the offline (faint, dashed)
 * look, never CLOSED (mutation: judge the value before staleness → red).
 */
export function aStaleMemberIsOfflineNeverClosed(): void {
  renderBreakers(
    SLD(),
    [mainBreaker([statePoint("breaker_main", 1)])],
    readingsOf({ [`${Q1.id}|breaker_main`]: 1 }, new Set([Q1.id])),
  );
  const row = onlyRow("main_breaker");
  expect(row.getAttribute("data-breaker-state")).toBe("offline");
  expect(row.getAttribute("data-frame")).toBe("offline");
  expect(pillText(row)).toBe("OFFLINE");
  expect(within(row).getByTestId("mimic-breaker-switch").getAttribute("class") ?? "").toContain("stroke-ink-faint");
  expect(row.textContent ?? "").not.toContain("CLOSED");
}

const FEEDERS = [asset(6, "CR-Q6"), asset(7, "CR-Q7"), asset(8, "CR-Q8")];

/**
 * S4 — a fan-out unit with three members draws three rows in the response's (code) order and no
 * value rows (mutation: draw the first member only → red).
 */
export function aFanOutUnitDrawsOneRowPerMember(): void {
  const values = Object.fromEntries(FEEDERS.map((a) => [`${a.id}|breaker_main`, 1]));
  renderBreakers(
    SLD(),
    [fanOutNode("load_feeders", "load-feeder-breaker", FEEDERS.map((a) => ({ asset: a, statePoints: [statePoint("breaker_main", 1)] })))],
    readingsOf(values),
  );
  const rows = rowsOf("load_feeders");
  expect(rows.map((r) => r.getAttribute("data-asset-code"))).toEqual(["CR-Q6", "CR-Q7", "CR-Q8"]);
  expect(rows.map((r) => pillText(r))).toEqual(["CLOSED", "CLOSED", "CLOSED"]);
  expect(within(unitEl("load_feeders")).queryAllByTestId("mimic-point")).toHaveLength(0);
}

/**
 * S5 — seventeen members: the resolver answers sixteen (`MIMIC_FANOUT_MAX`) and `memberCount` 17,
 * so the unit draws sixteen rows and "+1 more" — counted from `memberCount`, not from the list.
 */
export function seventeenMembersDrawSixteenAndOneMore(): void {
  const members = Array.from({ length: 16 }, (_, i) => ({ asset: asset(100 + i, `CR-F${String(i + 1).padStart(2, "0")}`) }));
  renderBreakers(SLD(), [fanOutNode("load_feeders", "load-feeder-breaker", members, 17)], readingsOf({}));
  expect(rowsOf("load_feeders")).toHaveLength(16);
  expect(within(unitEl("load_feeders")).getByTestId("mimic-fanout-more").textContent).toBe("+1 more");
}

/** S5b — a fan-out unit whose every member is drawn shows no "+N more". */
export function aFullyDrawnFanOutShowsNoMore(): void {
  renderBreakers(
    SLD(),
    [fanOutNode("load_feeders", "load-feeder-breaker", FEEDERS.map((a) => ({ asset: a })))],
    readingsOf({}),
  );
  expect(rowsOf("load_feeders")).toHaveLength(3);
  expect(within(unitEl("load_feeders")).queryByTestId("mimic-fanout-more")).toBeNull();
}

function frameClass(unit: HTMLElement): string {
  return unit.querySelector("rect")?.getAttribute("class") ?? "";
}

/**
 * S6a — a CLOSED breaker with a critical alarm frames critical, and its alarm stays drawn: the
 * callout and the Alarm status.
 */
export function aClosedBreakerWithACriticalAlarmFramesCritical(): void {
  const single = asset(2, "CR-Q2");
  renderBreakers(
    BOARD(),
    [singleNode("single", "main-breaker", { asset: single, statePoints: [statePoint("breaker_main", 1)], activeAlarms: 1, topAlarm: CRITICAL })],
    readingsOf({ [`${single.id}|breaker_main`]: 1 }),
  );
  const unit = unitEl("single");
  expect(unit.getAttribute("data-breaker-state")).toBe("closed");
  expect(unit.getAttribute("data-frame")).toBe("critical");
  expect(frameClass(unit)).toContain("stroke-critical");
  expect(within(unit).getByTestId("mimic-alarm-callout").getAttribute("data-tone")).toBe("critical");
  expect(within(unit).getByTestId("mimic-node-status").textContent).toBe("Alarm");
}

/**
 * S6b — an OPEN breaker with a critical alarm frames OPEN (state wins, ADR 0088 decision 5), and
 * its alarm stays drawn (mutation: the alarm wins → red).
 */
export function anOpenBreakerWithACriticalAlarmFramesOpen(): void {
  const single = asset(2, "CR-Q2");
  renderBreakers(
    BOARD(),
    [singleNode("single", "main-breaker", { asset: single, statePoints: [statePoint("breaker_main", 0)], activeAlarms: 1, topAlarm: CRITICAL })],
    readingsOf({ [`${single.id}|breaker_main`]: 0 }),
  );
  const unit = unitEl("single");
  expect(unit.getAttribute("data-frame")).toBe("open");
  expect(frameClass(unit)).not.toContain("stroke-critical");
  expect(within(unit).getByTestId("mimic-alarm-callout").getAttribute("data-tone")).toBe("critical");
  expect(within(unit).getByTestId("mimic-node-status").textContent).toBe("Alarm");
}

/** The S7 drawing: a transformer with a value row and an alarm, and one main breaker member. */
function compactNodes(): MimicNodeDto[] {
  const tx = asset(9, "TX-1");
  return [
    singleNode("transformer", "transformer", { asset: tx, activeAlarms: 1, topAlarm: CRITICAL }),
    mainBreaker([statePoint("breaker_main", 1)]),
  ];
}

/** S7a — not compact: the value row and the callout draw (the positive side of S7b). */
export function notCompactDrawsValuesAndCallouts(): void {
  renderBreakers(SLD(), compactNodes(), readingsOf({ [`${Q1.id}|breaker_main`]: 1 }));
  expect(screen.queryAllByTestId("mimic-point").length).toBeGreaterThan(0);
  expect(screen.queryAllByTestId("mimic-alarm-callout").length).toBeGreaterThan(0);
}

/** S7b — `compact` hides the value rows and the callouts, and keeps the labels, switches and pills. */
export function compactHidesValuesAndCalloutsKeepsSwitches(): void {
  renderBreakers(SLD(), compactNodes(), readingsOf({ [`${Q1.id}|breaker_main`]: 1 }), true);
  expect(screen.queryAllByTestId("mimic-point")).toHaveLength(0);
  expect(screen.queryAllByTestId("mimic-alarm-callout")).toHaveLength(0);
  const row = onlyRow("main_breaker");
  expect(within(row).getByTestId("mimic-breaker-switch")).toBeInTheDocument();
  expect(pillText(row)).toBe("CLOSED");
  expect(within(unitEl("transformer")).getByText("Transformer")).toBeInTheDocument();
}

const UPS_IN = asset(2, "CR-Q2");
const MAINS = asset(10, "CR-Q10");
const MAINS_OPEN = asset(11, "CR-Q11");

/**
 * S8 — `main_bus` (passive) has `ups_input` and `mains_feeders` directly downstream; one mains
 * member is open, so the bus frames open (mutation: ignore downstream → red).
 */
export function aPassiveBusFramesAsItsWorstDownstreamSwitch(): void {
  renderBreakers(
    SLD(),
    [
      fanOutNode("ups_input", "ups-input-breaker", [{ asset: UPS_IN, statePoints: [statePoint("breaker_main", 1)] }]),
      fanOutNode("mains_feeders", "mains-feeder-breaker", [
        { asset: MAINS, statePoints: [statePoint("breaker_main", 1)] },
        { asset: MAINS_OPEN, statePoints: [statePoint("breaker_main", 0)] },
      ]),
    ],
    readingsOf({
      [`${UPS_IN.id}|breaker_main`]: 1,
      [`${MAINS.id}|breaker_main`]: 1,
      [`${MAINS_OPEN.id}|breaker_main`]: 0,
    }),
  );
  const bus = unitEl("main_bus");
  expect(bus.getAttribute("data-status")).toBe("passive");
  expect(bus.getAttribute("data-frame")).toBe("open");
  expect(within(bus).queryByTestId("mimic-breaker-switch")).toBeNull();
}

/** S8b — the same bus with every downstream member closed frames closed. */
export function aPassiveBusOverClosedSwitchesFramesClosed(): void {
  renderBreakers(
    SLD(),
    [
      fanOutNode("ups_input", "ups-input-breaker", [{ asset: UPS_IN, statePoints: [statePoint("breaker_main", 1)] }]),
      fanOutNode("mains_feeders", "mains-feeder-breaker", [{ asset: MAINS, statePoints: [statePoint("breaker_main", 1)] }]),
    ],
    readingsOf({ [`${UPS_IN.id}|breaker_main`]: 1, [`${MAINS.id}|breaker_main`]: 1 }),
  );
  expect(unitEl("main_bus").getAttribute("data-frame")).toBe("closed");
}

/** S9 — a passive unit with no switching unit directly downstream stays plain `passive`. */
export function aPassiveUnitWithNoDownstreamSwitchStaysPassive(): void {
  renderBreakers(BOARD(), [], readingsOf({}));
  const tail = unitEl("tail");
  expect(tail.getAttribute("data-status")).toBe("passive");
  expect(tail.hasAttribute("data-frame")).toBe(false);
  expect(frameClass(tail)).toContain("stroke-line");
  // The adjacent positive: `bus` has the fan-out breaker below it, so it does take a frame.
  expect(unitEl("bus").hasAttribute("data-frame")).toBe(true);
}

/**
 * S10 — a roled `switchboard` unit (not a switching symbol) with state points draws no switch and
 * no pill (mutation: switch on `statePoints.length > 0` → red).
 */
export function aNonSwitchingUnitWithStatePointsDrawsNoSwitch(): void {
  const board = asset(20, "CR-UPS-1");
  renderBreakers(
    BOARD(),
    [singleNode("board", "ups", { asset: board, statePoints: [statePoint("breaker_main", 1)] })],
    readingsOf({ [`${board.id}|breaker_main`]: 1 }),
  );
  const unit = unitEl("board");
  expect(within(unit).queryByTestId("mimic-breaker-switch")).toBeNull();
  expect(within(unit).queryByTestId("mimic-breaker-pill")).toBeNull();
  expect(unit.hasAttribute("data-breaker-state")).toBe(false);
  // The adjacent positive: its value row still draws.
  expect(within(unit).getAllByTestId("mimic-point")).toHaveLength(1);
}

/** S11 — a drawn layout's fan-out `breaker` unit draws its member rows, as the preset does (arm parity). */
export function aLayoutFanOutBreakerDrawsMemberRows(): void {
  const values = { [`${FEEDERS[0]?.id}|breaker_main`]: 1, [`${FEEDERS[1]?.id}|breaker_main`]: 0, [`${FEEDERS[2]?.id}|breaker_main`]: 1 };
  renderBreakers(
    BOARD(),
    [fanOutNode("feeders", "load-feeder-breaker", FEEDERS.map((a) => ({ asset: a, statePoints: [statePoint("breaker_main", 1)] })))],
    readingsOf(values),
  );
  const rows = rowsOf("feeders");
  expect(rows.map((r) => [r.getAttribute("data-asset-code"), r.getAttribute("data-breaker-state")])).toEqual([
    ["CR-Q6", "closed"],
    ["CR-Q7", "open"],
    ["CR-Q8", "closed"],
  ]);
  expect(unitEl("bus").getAttribute("data-frame")).toBe("open");
}

/** The S6c/S6d drawing: one `main_breaker` fan-out member at `value`, with a critical alarm. */
function alarmedMember(value: number): void {
  renderBreakers(
    SLD(),
    [fanOutNode("main_breaker", "main-breaker", [{ asset: Q1, statePoints: [statePoint("breaker_main", value)], activeAlarms: 1, topAlarm: CRITICAL }])],
    readingsOf({ [`${Q1.id}|breaker_main`]: value }),
  );
}

/** S6c — a CLOSED fan-out member with a critical alarm frames its row critical (the preset path). */
export function aClosedFanOutMemberWithACriticalAlarmFramesCritical(): void {
  alarmedMember(1);
  const row = onlyRow("main_breaker");
  expect(row.getAttribute("data-breaker-state")).toBe("closed");
  expect(row.getAttribute("data-frame")).toBe("critical");
  expect(unitEl("main_breaker").getAttribute("data-status")).toBe("alarm");
}

/** S6d — an OPEN fan-out member with a critical alarm frames its row open; the unit stays in alarm. */
export function anOpenFanOutMemberWithACriticalAlarmFramesOpen(): void {
  alarmedMember(0);
  const row = onlyRow("main_breaker");
  expect(row.getAttribute("data-frame")).toBe("open");
  expect(unitEl("main_breaker").getAttribute("data-status")).toBe("alarm");
}

const HT = asset(30, "HT-1");

/** An `electrical_distribution` answer: `ht_panel` (a `breaker` glyph) resolved, no state points. */
function htPanelOnly(): MimicNodeDto[] {
  return [singleNode("ht_panel", "ht-panel", { asset: HT })];
}

/**
 * S12a — regression: `electrical_distribution`'s `ht_panel` draws the `breaker` glyph but carries
 * no state point, so it draws exactly as before — its glyph, the live frame, no switch and no pill
 * (mutation: drop the state-point gate → red).
 */
export function aBreakerGlyphWithNoStatePointsDrawsAsBefore(): void {
  renderBreakers(presetGeometry("electrical_distribution"), htPanelOnly(), readingsOf({}));
  const unit = unitEl("ht_panel");
  expect(unit.hasAttribute("data-breaker-state")).toBe(false);
  expect(within(unit).queryByTestId("mimic-breaker-pill")).toBeNull();
  expect(within(unit).queryByTestId("mimic-breaker-switch")).toBeNull();
  expect(within(unit).getByTestId("mimic-glyph").getAttribute("data-glyph")).toBe("breaker");
  expect(frameClass(unit)).toContain("stroke-accent");
}

/** S12b — the same unit gone stale reads Stale as before, never OFFLINE. */
export function aStaleBreakerGlyphWithNoStatePointsIsNotOffline(): void {
  renderBreakers(presetGeometry("electrical_distribution"), htPanelOnly(), readingsOf({}, new Set([HT.id])));
  const unit = unitEl("ht_panel");
  expect(unit.getAttribute("data-status")).toBe("stale");
  expect(unit.textContent ?? "").not.toContain("OFFLINE");
  expect(frameClass(unit)).toContain("stroke-warning");
}

/*
 * `F3.74` Task 3.2 (OQ5 rev 2, plan D6) — energy is a colour beside the `F3.32b` freshness dash.
 * On a graph with sources every pipe carries `data-energy` and the energy's stroke class, and the
 * dash (still driven by upstream freshness) takes the same class; an unsourced graph is unchanged.
 */

/** The `lv_single_line` roled units and their roles; the breakers are the five `fanOut` breaker nodes. */
const SLD_UNITS: readonly (readonly [key: string, role: string, breaker: boolean])[] = [
  ["incoming", "incoming-supply", false],
  ["transformer", "transformer", false],
  ["main_breaker", "main-breaker", true],
  ["ups_input", "ups-input-breaker", true],
  ["ups", "ups", false],
  ["ups_output", "ups-output-breaker", true],
  ["load_feeders", "load-feeder-breaker", true],
  ["pdu", "pdu", false],
  ["mains_feeders", "mains-feeder-breaker", true],
  ["hvac", "crac", false],
  ["lighting", "utilities", false],
];

/** One asset per roled `lv_single_line` unit, by key. */
const SLD_ASSETS = new Map(SLD_UNITS.map(([key], i) => [key, asset(200 + i, `SLD-${key}`)] as const));

function sldAsset(key: string): GeneratedSiteAssetDto {
  const a = SLD_ASSETS.get(key);
  expect(a, `no SLD asset ${key}`).toBeDefined();
  return a as GeneratedSiteAssetDto;
}

/**
 * Every roled `lv_single_line` unit assigned and fresh, each breaker CLOSED except `main_breaker`,
 * which reads `mainValue`; `stale` lists unit keys whose asset is stale.
 */
function renderSld(mainValue: number, stale: readonly string[] = []): void {
  const values: Record<string, number> = {};
  const nodes = SLD_UNITS.map(([key, role, breaker]) => {
    const a = sldAsset(key);
    if (!breaker) {
      return singleNode(key, role, { asset: a });
    }
    const value = key === "main_breaker" ? mainValue : 1;
    values[`${a.id}|breaker_main`] = value;
    return fanOutNode(key, role, [{ asset: a, statePoints: [statePoint("breaker_main", value)] }]);
  });
  renderBreakers(SLD(), nodes, readingsOf(values, new Set(stale.map((k) => sldAsset(k).id))));
}

function pipeEl(from: string, to: string): HTMLElement {
  const el = screen
    .getAllByTestId("mimic-pipe")
    .find((p) => p.getAttribute("data-pipe-from") === from && p.getAttribute("data-pipe-to") === to);
  expect(el, `no mimic-pipe ${from}->${to}`).toBeDefined();
  return el as HTMLElement;
}

/** The flow dash drawn over the pipe `from` → `to` (its sibling in the pipe's group), or `null`. */
function flowOn(from: string, to: string): HTMLElement | null {
  return pipeEl(from, to).parentElement?.querySelector<HTMLElement>('[data-testid="mimic-flow"]') ?? null;
}

function cls(el: Element | null): string {
  return el?.getAttribute("class") ?? "";
}

/** The `lv_single_line` pipes downstream of `main_breaker` — every pipe but the first two. */
const AFTER_MAIN: readonly (readonly [string, string])[] = [
  ["main_breaker", "main_bus"],
  ["main_bus", "ups_input"],
  ["ups_input", "ups"],
  ["ups", "ups_output"],
  ["ups_output", "load_bus"],
  ["load_bus", "load_feeders"],
  ["load_feeders", "pdu"],
  ["main_bus", "mains_feeders"],
  ["mains_feeders", "hvac"],
  ["mains_feeders", "lighting"],
];

/** The pipes of AFTER_MAIN whose `from` is a roled (so possibly fresh, flowing) unit. */
const AFTER_MAIN_FROM_ROLED = AFTER_MAIN.filter(([from]) => from !== "main_bus" && from !== "load_bus");

/**
 * E1a — every breaker closed, every asset fresh: every pipe is energised and drawn in accent, with
 * no dash array.
 */
export function allClosedEveryPipeIsEnergisedAccent(): void {
  renderSld(1);
  const pipes = screen.getAllByTestId("mimic-pipe");
  expect(pipes).toHaveLength(12);
  for (const pipe of pipes) {
    expect(pipe.getAttribute("data-energy"), pipe.getAttribute("data-pipe-from") ?? "").toBe("energised");
    expect(cls(pipe)).toContain("stroke-accent");
    expect(pipe.hasAttribute("stroke-dasharray")).toBe(false);
  }
}

/**
 * E1b — the same drawing: a flow dash over every pipe out of a fresh roled unit (the passive buses
 * draw none, as today), each in accent.
 */
export function allClosedEveryFreshPipeAnimatesInAccent(): void {
  renderSld(1);
  const flows = screen.getAllByTestId("mimic-flow");
  expect(flows).toHaveLength(9);
  for (const flow of flows) {
    expect(cls(flow), flow.getAttribute("data-flow-from") ?? "").toContain("stroke-accent");
  }
  expect(flowOn("main_bus", "ups_input")).toBeNull();
}

/**
 * E2a — the main breaker OPEN, every asset fresh: the pipes upstream stay energised accent; every
 * pipe after it is de-energised in `stroke-line-strong`, never accent (mutation: colour the pipe
 * from `flows()` — freshness — → red).
 */
export function anOpenMainBreakerDeEnergisesThePipesAfterIt(): void {
  renderSld(0);
  for (const [from, to] of [["incoming", "transformer"], ["transformer", "main_breaker"]] as const) {
    expect(pipeEl(from, to).getAttribute("data-energy")).toBe("energised");
    expect(cls(pipeEl(from, to))).toContain("stroke-accent");
  }
  for (const [from, to] of AFTER_MAIN) {
    const pipe = pipeEl(from, to);
    expect(pipe.getAttribute("data-energy"), `${from}->${to}`).toBe("de-energised");
    expect(cls(pipe), `${from}->${to}`).toContain("stroke-line-strong");
    expect(cls(pipe), `${from}->${to}`).not.toContain("stroke-accent");
  }
}

/**
 * E2b — the same drawing: the freshness dash still animates over the de-energised pipes out of
 * fresh units, in `stroke-line-strong` and never accent; the incoming pipe's dash stays accent
 * (mutation: leave the dash's class at accent → red).
 */
export function anOpenMainBreakerDashesInGreyAfterIt(): void {
  renderSld(0);
  expect(cls(flowOn("incoming", "transformer"))).toContain("stroke-accent");
  const dashes = AFTER_MAIN_FROM_ROLED.map(([from, to]) => flowOn(from, to));
  expect(dashes.filter((d) => d !== null)).toHaveLength(AFTER_MAIN_FROM_ROLED.length);
  for (const dash of dashes) {
    expect(cls(dash)).toContain("stroke-line-strong");
    expect(cls(dash)).not.toContain("stroke-accent");
  }
}

/**
 * E3a — a stale main breaker: every pipe after it is `unknown`, drawn in `stroke-ink-hint` with a
 * dash array and never accent; the energised pipe before it has no dash array (mutation: map
 * unknown to accent → red).
 */
export function aStaleMainBreakerMakesThePipesAfterItUnknown(): void {
  renderSld(1, ["main_breaker"]);
  expect(pipeEl("transformer", "main_breaker").getAttribute("data-energy")).toBe("energised");
  expect(pipeEl("transformer", "main_breaker").hasAttribute("stroke-dasharray")).toBe(false);
  for (const [from, to] of AFTER_MAIN) {
    const pipe = pipeEl(from, to);
    expect(pipe.getAttribute("data-energy"), `${from}->${to}`).toBe("unknown");
    expect(cls(pipe), `${from}->${to}`).toContain("stroke-ink-hint");
    expect(cls(pipe), `${from}->${to}`).not.toContain("stroke-accent");
    expect(pipe.hasAttribute("stroke-dasharray"), `${from}->${to}`).toBe(true);
  }
}

/**
 * E3b — the same drawing: no dash out of the stale breaker (the dash before it still animates);
 * the fresh units after it animate in `stroke-ink-hint`, never accent (mutation: animate in
 * accent on a fresh node regardless of energy → red).
 */
export function aStaleMainBreakerDrawsNoDashAndHintDashesAfterIt(): void {
  renderSld(1, ["main_breaker"]);
  expect(flowOn("transformer", "main_breaker")).not.toBeNull();
  expect(flowOn("main_breaker", "main_bus")).toBeNull();
  const after = AFTER_MAIN_FROM_ROLED.filter(([from]) => from !== "main_breaker").map(([from, to]) => flowOn(from, to));
  expect(after.filter((d) => d !== null)).toHaveLength(AFTER_MAIN_FROM_ROLED.length - 1);
  for (const dash of after) {
    expect(cls(dash)).toContain("stroke-ink-hint");
    expect(cls(dash)).not.toContain("stroke-accent");
  }
}

/**
 * E4 — regression: `electrical_distribution` names no source, so no pipe carries `data-energy`,
 * every pipe keeps `stroke-line-strong`, and the freshness dash out of a fresh unit is accent.
 */
export function anUnsourcedPresetDrawsAsBefore(): void {
  renderBreakers(presetGeometry("electrical_distribution"), htPanelOnly(), readingsOf({}));
  const pipes = screen.getAllByTestId("mimic-pipe");
  expect(pipes.length).toBeGreaterThan(0);
  for (const pipe of pipes) {
    expect(pipe.hasAttribute("data-energy")).toBe(false);
    expect(cls(pipe)).toContain("stroke-line-strong");
    expect(cls(pipe)).not.toContain("stroke-accent");
  }
  const flows = screen.getAllByTestId("mimic-flow");
  expect(flows.map((f) => f.getAttribute("data-flow-from"))).toEqual(["ht_panel"]);
  expect(cls(flows[0] ?? null)).toContain("stroke-accent");
}

/** The E5/E6 drawing: `single` OPEN and `board` assigned, both fresh. */
function boardNodes(): { nodes: MimicNodeDto[]; readings: SiteLiveReadings } {
  const single = asset(40, "CR-Q40");
  const board = asset(41, "CR-UPS-41");
  return {
    nodes: [
      singleNode("single", "main-breaker", { asset: single, statePoints: [statePoint("breaker_main", 0)] }),
      singleNode("board", "ups", { asset: board }),
    ],
    readings: readingsOf({ [`${single.id}|breaker_main`]: 0 }),
  };
}

/**
 * E5 — a drawn layout whose `src` unit is `isSource`, with the `single` breaker OPEN: as E2, the
 * pipe into it stays energised accent and the pipes after it are de-energised, their dashes grey
 * (mutation: build the graph from presets only → red).
 */
export function aSourcedLayoutWithAnOpenBreakerBehavesAsTheSld(): void {
  const { nodes, readings } = boardNodes();
  renderBreakers(BOARD(), nodes, readings);
  expect(pipeEl("src", "single").getAttribute("data-energy")).toBe("energised");
  expect(cls(pipeEl("src", "single"))).toContain("stroke-accent");
  for (const [from, to] of [["single", "board"], ["board", "tail"]] as const) {
    expect(pipeEl(from, to).getAttribute("data-energy"), `${from}->${to}`).toBe("de-energised");
    expect(cls(pipeEl(from, to))).not.toContain("stroke-accent");
    expect(cls(flowOn(from, to))).toContain("stroke-line-strong");
    expect(cls(flowOn(from, to))).not.toContain("stroke-accent");
  }
}

/** E6 — the same layout with no `isSource` unit: no `data-energy`, the freshness dash in accent as today. */
export function anUnsourcedLayoutDrawsAsBefore(): void {
  const { nodes, readings } = boardNodes();
  const unsourced: MimicLayoutGeometryDto = {
    ...BREAKER_LAYOUT,
    nodes: BREAKER_LAYOUT.nodes.map((n) => ({ ...n, isSource: false })),
  };
  renderBreakers(layoutGeometry(unsourced), nodes, readings);
  for (const pipe of screen.getAllByTestId("mimic-pipe")) {
    expect(pipe.hasAttribute("data-energy")).toBe(false);
    expect(cls(pipe)).toContain("stroke-line-strong");
  }
  expect(cls(flowOn("single", "board"))).toContain("stroke-accent");
  expect(cls(flowOn("board", "tail"))).toContain("stroke-accent");
}
