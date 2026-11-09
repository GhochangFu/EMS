import { cleanup, render, screen } from "@testing-library/react";
import { expect } from "vitest";

import type { GeneratedSiteAssetDto, MimicNodeAlarmDto, MimicNodeDto, PointKeyStateMapDto } from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { layoutGeometry, presetGeometry, type MimicGeometry } from "../../lib/mimic-geometry";
import { LAYOUT } from "../../lib/mimic-geometry.spec";
import {
  BREAKER_LAYOUT,
  CRITICAL,
  STATE_MAPS,
  asset,
  fanOutNode,
  readingsOf,
  singleNode,
  statePoint,
} from "./mimic-scene.breakers.spec";
import { MimicScene } from "./mimic-scene";

/**
 * `F4.344` (ADR 0120 decisions 2 and 6; plan T1.4) — the scene animates each roled unit's glyph,
 * or the breaker switch drawn in its place, by its state; only when asked (`motion`), never a
 * passive unit, a fan-out member's switch, the alert icon, the pump or the sink. One exported
 * claim per `it()` in the `.test.tsx` wrapper (ADR 0014).
 */

const NOW = Date.parse("2026-11-09T10:00:00.000Z");

const TANK: GeneratedSiteAssetDto = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  code: "WTR-TNK-09",
  name: "Tank",
  assetRtuName: null,
  assetLocationName: null,
  domain: "water",
  latestTelemetryAt: null,
  freshness: "none",
  points: [{ pointKey: "flow", name: "Flow", unit: "m3/h", headlineRank: 1, latest: null }],
};

function tankNode(over: Partial<MimicNodeDto> = {}): MimicNodeDto {
  return {
    key: "tank_a",
    label: "Tank A",
    roleCode: "water_intake",
    asset: TANK,
    memberCount: 1,
    activeAlarms: 0,
    topAlarm: null,
    statePoints: [],
    members: [],
    ...over,
  };
}

function alarm(tone: MimicNodeAlarmDto["tone"]): MimicNodeAlarmDto {
  return { severity: tone, tone, label: tone, message: "High level", raisedAt: "2026-11-09T09:59:00.000Z" };
}

/** Readings whose every asset was last seen `agoMs` ago (`null`: never). */
function seen(agoMs: number | null): SiteLiveReadings {
  return {
    nowMs: NOW,
    pointLatest: () => (agoMs === null ? null : { value: 12, time: "t", atMs: NOW - agoMs }),
    assetLastSeenMs: () => (agoMs === null ? null : NOW - agoMs),
  };
}

function draw(
  geometry: MimicGeometry,
  nodes: readonly MimicNodeDto[],
  readings: SiteLiveReadings,
  opts: { motion?: boolean; stateMaps?: readonly PointKeyStateMapDto[] } = { motion: true },
): void {
  render(
    <MimicScene
      title="Plant"
      geometry={geometry}
      nodes={nodes}
      readings={readings}
      stateMaps={opts.stateMaps}
      motion={opts.motion}
    />,
  );
}

function unitEl(key: string): HTMLElement {
  const el = screen.getAllByTestId("mimic-node").find((n) => n.getAttribute("data-node-key") === key);
  expect(el, `no mimic-node ${key}`).toBeDefined();
  return el as HTMLElement;
}

/** The unit's one motion, or `null` when it is still; a unit never carries two. */
function motionOf(key: string): string | null {
  const moving = unitEl(key).querySelectorAll("[data-motion]");
  expect(moving.length, `${key} motions`).toBeLessThanOrEqual(1);
  return moving[0]?.getAttribute("data-motion") ?? null;
}

const LAYOUT_GEO = (): MimicGeometry => layoutGeometry(LAYOUT);
const BOARD = (): MimicGeometry => layoutGeometry(BREAKER_LAYOUT);

/** SM1 — a live unit breathes; unassigned, no asset, never seen (none) and stale stay still. */
export function aLiveUnitBreathesAndTheQuietStatesStayStill(): void {
  draw(LAYOUT_GEO(), [tankNode()], seen(1_000));
  expect(unitEl("tank_a").getAttribute("data-status")).toBe("live");
  expect(motionOf("tank_a")).toBe("breathe");
  cleanup();

  draw(LAYOUT_GEO(), [], seen(1_000));
  expect(unitEl("tank_a").getAttribute("data-status")).toBe("unassigned");
  expect(motionOf("tank_a")).toBeNull();
  cleanup();

  draw(LAYOUT_GEO(), [tankNode({ asset: null })], seen(1_000));
  expect(unitEl("tank_a").getAttribute("data-status")).toBe("no-asset");
  expect(motionOf("tank_a")).toBeNull();
  cleanup();

  draw(LAYOUT_GEO(), [tankNode()], seen(null));
  expect(unitEl("tank_a").getAttribute("data-status")).toBe("none");
  expect(motionOf("tank_a")).toBeNull();
  cleanup();

  draw(LAYOUT_GEO(), [tankNode()], seen(60_000));
  expect(unitEl("tank_a").getAttribute("data-status")).toBe("stale");
  expect(motionOf("tank_a")).toBeNull();
}

/** SM2 — an alarm pulses; fast only for the `critical` tone; no top alarm and `ok` pulse at the normal rate. */
export function anAlarmPulsesFastOnlyWhenCritical(): void {
  const cases: [MimicNodeAlarmDto | null, string][] = [
    [alarm("warning"), "pulse"],
    [alarm("critical"), "pulse-fast"],
    [null, "pulse"],
    [alarm("ok"), "pulse"],
  ];
  for (const [topAlarm, expected] of cases) {
    draw(LAYOUT_GEO(), [tankNode({ activeAlarms: 1, topAlarm })], seen(1_000));
    expect(unitEl("tank_a").getAttribute("data-status")).toBe("alarm");
    expect(motionOf("tank_a"), topAlarm?.tone ?? "no top alarm").toBe(expected);
    cleanup();
  }
}

const Q = asset(7, "CR-Q7");

function singleBreaker(points: ReturnType<typeof statePoint>[], topAlarm: MimicNodeAlarmDto | null = null): MimicNodeDto[] {
  return [singleNode("single", "main-breaker", { asset: Q, statePoints: points, activeAlarms: topAlarm ? 1 : 0, topAlarm })];
}

/** The motion on the single unit's switch contact (a non-`unknown` switch draws no glyph). */
function contactMotion(state: string): string | null {
  const sw = unitEl("single").querySelector(`[data-testid=mimic-breaker-switch][data-breaker-state=${state}]`);
  expect(sw, `switch ${state}`).not.toBeNull();
  return sw?.querySelector("[data-motion]")?.getAttribute("data-motion") ?? null;
}

/**
 * SM3 — a single tripped breaker's contact blinks (over a critical alarm too) and no glyph is
 * drawn; a closed contact breathes; a stale (`offline`) contact with a critical alarm pulses fast,
 * never blinks; an `unknown` state draws the plain glyph, which carries the status motion.
 */
export function aTrippedSingleBreakerBlinksItsContact(): void {
  const trip = [statePoint("breaker_trip", 1)];
  const tripRead = readingsOf({ [`${Q.id}|breaker_trip`]: 1 });
  const maps = { motion: true, stateMaps: STATE_MAPS };

  draw(BOARD(), singleBreaker(trip), tripRead, maps);
  expect(contactMotion("tripped")).toBe("blink");
  expect(unitEl("single").querySelector("[data-testid=mimic-glyph]")).toBeNull();
  cleanup();

  draw(BOARD(), singleBreaker(trip, CRITICAL), tripRead, maps);
  expect(contactMotion("tripped")).toBe("blink");
  cleanup();

  draw(BOARD(), singleBreaker([statePoint("breaker_main", 1)]), readingsOf({ [`${Q.id}|breaker_main`]: 1 }), maps);
  expect(contactMotion("closed")).toBe("breathe");
  cleanup();

  draw(
    BOARD(),
    singleBreaker([statePoint("breaker_main", 1)], CRITICAL),
    readingsOf({ [`${Q.id}|breaker_main`]: 1 }, new Set([Q.id])),
    maps,
  );
  expect(contactMotion("offline")).toBe("pulse-fast");
  cleanup();

  draw(BOARD(), singleBreaker([statePoint("breaker_main", 7)]), readingsOf({ [`${Q.id}|breaker_main`]: 7 }), maps);
  const unknown = unitEl("single").querySelector("[data-testid=mimic-breaker-switch][data-breaker-state=unknown]");
  expect(unknown).not.toBeNull();
  expect(unknown?.querySelector("[data-testid=mimic-glyph] [data-motion]")?.getAttribute("data-motion")).toBe("breathe");
}

/** SM4 — a fan-out unit with any tripped member blinks its unit glyph; its member rows stay still. */
export function aFanOutUnitBlinksWhenAnyMemberTrips(): void {
  const m1 = asset(11, "CR-F1");
  const m2 = asset(12, "CR-F2");
  const members = (trip2: boolean) => [
    { asset: m1, statePoints: [statePoint("breaker_main", 1)] },
    { asset: m2, statePoints: [statePoint(trip2 ? "breaker_trip" : "breaker_main", 1)] },
  ];
  const read = (trip2: boolean) =>
    readingsOf({ [`${m1.id}|breaker_main`]: 1, [`${m2.id}|${trip2 ? "breaker_trip" : "breaker_main"}`]: 1 });
  const maps = { motion: true, stateMaps: STATE_MAPS };

  draw(BOARD(), [fanOutNode("feeders", "load-feeder-breaker", members(true))], read(true), maps);
  const glyph = unitEl("feeders").querySelector(":scope > [data-testid=mimic-glyph]");
  expect(glyph?.querySelector("[data-motion]")?.getAttribute("data-motion")).toBe("blink");
  expect(unitEl("feeders").querySelectorAll("[data-testid=mimic-breaker-member]").length).toBe(2);
  expect(document.querySelectorAll("[data-testid=mimic-breaker-member] [data-motion]")).toHaveLength(0);
  cleanup();

  draw(BOARD(), [fanOutNode("feeders", "load-feeder-breaker", members(false))], read(false), maps);
  expect(motionOf("feeders")).toBe("breathe");
}

/** SM5 — without `motion` (the editor and preview default) nothing moves, whatever the state. */
export function withoutTheMotionPropNothingMoves(): void {
  const off = { motion: undefined, stateMaps: STATE_MAPS };
  draw(LAYOUT_GEO(), [tankNode({ activeAlarms: 1, topAlarm: alarm("critical") })], seen(1_000), off);
  expect(screen.getAllByTestId("mimic-glyph").length).toBeGreaterThan(0);
  expect(document.querySelectorAll("[data-motion]")).toHaveLength(0);
  cleanup();

  draw(BOARD(), singleBreaker([statePoint("breaker_trip", 1)]), readingsOf({ [`${Q.id}|breaker_trip`]: 1 }), off);
  expect(unitEl("single").querySelector("[data-breaker-state=tripped]")).not.toBeNull();
  expect(document.querySelectorAll("[data-motion]")).toHaveLength(0);
}

/**
 * SM6 — on `water_train` a live intake breathes and an alarmed WTP pulses with its callout drawn,
 * while the pump, the sink, the callout and (on the layout) a passive unit carry no motion.
 */
export function onlyTheUnitGlyphMoves(): void {
  const intake: MimicNodeDto = { ...tankNode(), key: "water_intake", roleCode: "water_intake" };
  const wtp: MimicNodeDto = {
    ...tankNode(),
    key: "wtp",
    roleCode: "wtp",
    asset: { ...TANK, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "WTP-01" },
    activeAlarms: 1,
    topAlarm: alarm("warning"),
  };
  draw(presetGeometry("water_train"), [intake, wtp], seen(1_000));
  expect(motionOf("water_intake")).toBe("breathe");
  expect(motionOf("wtp")).toBe("pulse");
  expect(screen.getAllByTestId("mimic-pump").length).toBeGreaterThan(0);
  expect(screen.getByTestId("mimic-sink")).toBeDefined();
  expect(screen.getAllByTestId("mimic-alarm-callout").length).toBeGreaterThan(0);
  expect(
    document.querySelectorAll(
      "[data-testid=mimic-pump] [data-motion], [data-testid=mimic-sink] [data-motion], [data-testid=mimic-alarm-callout] [data-motion]",
    ),
  ).toHaveLength(0);
  cleanup();

  draw(LAYOUT_GEO(), [tankNode()], seen(1_000));
  expect(motionOf("tank_a")).toBe("breathe");
  expect(unitEl("pump_b").getAttribute("data-status")).toBe("passive");
  expect(document.querySelectorAll("[data-status=passive] [data-motion]")).toHaveLength(0);
}
