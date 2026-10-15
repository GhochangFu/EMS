import { render, screen, within } from "@testing-library/react";
import { expect } from "vitest";

import type {
  GeneratedSiteAssetDto,
  MimicLayoutGeometryDto,
  MimicLayoutNodeDto,
  MimicNodeDto,
  PointKeyStateMapDto,
} from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { layoutGeometry } from "../../lib/mimic-geometry";
import { MimicScene } from "./mimic-scene";
import { BREAKER_LAYOUT, STATE_MAPS } from "./mimic-scene.breakers.spec";

/**
 * `F3.80` / ADR 0101 d10, d11 — a valve unit in `MimicScene`, on `BREAKER_LAYOUT` (the `F3.74`
 * breaker fixture) plus a switching `valve` (role `isolation-valve`, `isSwitching: true`) fed from
 * `src`, which feeds a passive `tank`. Its `valve_open` point maps 1 → OPEN `flowing` and 0 → SHUT
 * `shut`: `flowing` draws the closed blade and passes energy, `shut` the open blade and stops it.
 *
 * Assertions live here; `mimic-scene.valves.test.tsx` is the vitest entry point (ADR 0014). The
 * readings are a stub keyed on `assetId|pointKey`, as in `mimic-scene.breakers.spec.tsx`.
 */

const NOW = Date.parse("2026-10-15T10:00:00.000Z");

/** The seeded `valve_open` map (`point-key-states-seed.ts`) beside the breaker rows. */
const FLOW_STATE_MAPS: readonly PointKeyStateMapDto[] = [
  ...STATE_MAPS,
  {
    pointKey: "valve_open",
    states: [
      { value: 0, label: "SHUT", tone: "shut" },
      { value: 1, label: "OPEN", tone: "flowing" },
    ],
  },
];

const ISO_V1: GeneratedSiteAssetDto = {
  id: "00000000-0000-4000-8000-000000000300",
  code: "ND-FL-ISO-V1",
  name: "ND-FL-ISO-V1",
  domain: "water",
  latestTelemetryAt: null,
  freshness: "live",
  points: [],
};

function layoutNode(key: string, x: number, y: number, extra: Partial<MimicLayoutNodeDto>): MimicLayoutNodeDto {
  return { key, kind: "unit", symbol: "unit", label: key, roleCode: null, tone: null, x, y, w: 20, h: 25, z: 0, fanOut: false, isSource: false, isSwitching: false, ...extra };
}

/** `BREAKER_LAYOUT` plus the switching `valve` drawn with `symbol`, and the `tank` after it. */
function valveLayout(symbol: MimicLayoutNodeDto["symbol"]): MimicLayoutGeometryDto {
  return {
    ...BREAKER_LAYOUT,
    nodes: [
      ...BREAKER_LAYOUT.nodes,
      layoutNode("valve", 50, 30, { symbol, roleCode: "isolation-valve", isSwitching: true }),
      layoutNode("tank", 75, 30, { symbol: "tank" }),
    ],
    pipes: [...BREAKER_LAYOUT.pipes, { fromKey: "src", toKey: "valve" }, { fromKey: "valve", toKey: "tank" }],
  };
}

/** The valve node as the resolver answers it: one asset, one `valve_open` state point. */
function valveNode(value: number): MimicNodeDto {
  return {
    key: "valve",
    label: "valve",
    roleCode: "isolation-valve",
    asset: ISO_V1,
    memberCount: 1,
    activeAlarms: 0,
    topAlarm: null,
    statePoints: [{ pointKey: "valve_open", name: "valve_open", unit: "", headlineRank: 10, latest: { value, time: "t" } }],
    members: [],
  };
}

function readingsOf(value: number): SiteLiveReadings {
  return {
    nowMs: NOW,
    pointLatest: (id, point) =>
      id === ISO_V1.id && point.pointKey === "valve_open" ? { value, time: "t", atMs: NOW - 1_000 } : null,
    assetLastSeenMs: () => NOW - 1_000,
  };
}

/** Draws `valveLayout(symbol)` with the valve reporting `valve_open` = `value`, fresh. */
function renderValve(symbol: MimicLayoutNodeDto["symbol"], value: number): void {
  render(
    <MimicScene
      title="Flow"
      geometry={layoutGeometry(valveLayout(symbol))}
      nodes={[valveNode(value)]}
      readings={readingsOf(value)}
      stateMaps={FLOW_STATE_MAPS}
    />,
  );
}

function unitEl(key: string): HTMLElement {
  const el = screen.getAllByTestId("mimic-node").find((n) => n.getAttribute("data-node-key") === key);
  expect(el, `no mimic-node ${key}`).toBeDefined();
  return el as HTMLElement;
}

function pipeEl(from: string, to: string): HTMLElement {
  const el = screen
    .getAllByTestId("mimic-pipe")
    .find((p) => p.getAttribute("data-pipe-from") === from && p.getAttribute("data-pipe-to") === to);
  expect(el, `no mimic-pipe ${from}->${to}`).toBeDefined();
  return el as HTMLElement;
}

/** The blade path of a unit's one switch (the second path; the first is the terminals). */
function bladeOf(key: string): string | null {
  const sw = within(unitEl(key)).getByTestId("mimic-breaker-switch");
  return sw.querySelectorAll("path")[1]?.getAttribute("d") ?? null;
}

function pillText(el: HTMLElement): string {
  return within(el).getByTestId("mimic-breaker-pill").textContent ?? "";
}

/**
 * `valve_open` 0 draws SHUT: the state `shut`, the `open` frame, the swung blade, and the pipe after
 * the valve de-energised while the pipe into it stays energised.
 */
function expectAShutValve(): void {
  const unit = unitEl("valve");
  expect(unit.getAttribute("data-breaker-state")).toBe("shut");
  expect(unit.getAttribute("data-frame")).toBe("open");
  expect(pillText(unit)).toBe("SHUT");
  expect(bladeOf("valve")).toBe("M12 17 5.5 8.5");
  expect(pipeEl("src", "valve").getAttribute("data-energy")).toBe("energised");
  expect(pipeEl("valve", "tank").getAttribute("data-energy")).toBe("de-energised");
}

/** `valve_open` 1 draws OPEN: the closed blade, the `closed` frame, the pipe after the valve energised. */
function expectAFlowingValve(): void {
  const unit = unitEl("valve");
  expect(unit.getAttribute("data-breaker-state")).toBe("flowing");
  expect(unit.getAttribute("data-frame")).toBe("closed");
  expect(pillText(unit)).toBe("OPEN");
  expect(bladeOf("valve")).toBe("M12 7v10");
  expect(pipeEl("valve", "tank").getAttribute("data-energy")).toBe("energised");
}

/** V1 — a unit drawn with the `breaker` symbol reporting `valve_open` 0 draws SHUT. */
export function aShutBreakerSymbolValveDrawsShut(): void {
  renderValve("breaker", 0);
  expectAShutValve();
}

/** V2 — the same unit reporting `valve_open` 1 draws OPEN. */
export function aFlowingBreakerSymbolValveDrawsOpen(): void {
  renderValve("breaker", 1);
  expectAFlowingValve();
}

/**
 * V4 — a unit drawn with the `valve` symbol, which switches only by its `isSwitching` flag
 * (`layoutGeometry`'s d4 rule), reporting `valve_open` 0 draws SHUT.
 */
export function aShutValveSymbolUnitDrawsShut(): void {
  renderValve("valve", 0);
  expectAShutValve();
}

/** V5 — the same `valve`-symbol unit reporting `valve_open` 1 draws OPEN. */
export function aFlowingValveSymbolUnitDrawsOpen(): void {
  renderValve("valve", 1);
  expectAFlowingValve();
}

/** V3 — the accessible name says the valve is shut (the switch itself is `aria-hidden`). */
export function aShutValvesStateIsInTheAccessibleName(): void {
  renderValve("breaker", 0);
  expect(screen.getByRole("img").getAttribute("aria-label") ?? "").toContain("valve ND-FL-ISO-V1: shut");
}
