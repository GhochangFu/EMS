import { render, screen, within } from "@testing-library/react";
import { expect } from "vitest";

import type { GeneratedSiteAssetDto, GeneratedSitePointDto, MimicNodeDto } from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { presetGeometry } from "../../lib/mimic-geometry";
import { MimicScene } from "./mimic-scene";
import { STATE_MAPS } from "./mimic-scene.breakers.spec";

/**
 * `F4.322` (owner rulings 2026-11-07) — the fan-out member rows' sizes, the middle cut and the
 * code's clip, drawn by `MimicScene` on the `lv_single_line` preset. Split from
 * `mimic-scene.breakers.spec.tsx`, which is at the 1000-line cap (AGENTS.md §4.5); the fixtures
 * are the same shape, cut down to what these cases read.
 */

const NOW = Date.parse("2026-11-07T10:00:00.000Z");

function assetId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function asset(n: number, code: string): GeneratedSiteAssetDto {
  return {
    id: assetId(n),
    code,
    name: code,
    assetRtuName: null,
    assetLocationName: null,
    domain: "electrical",
    latestTelemetryAt: null,
    freshness: "live",
    points: [],
  };
}

function statePoint(pointKey: string, dtoValue: number): GeneratedSitePointDto {
  return { pointKey, name: pointKey, unit: "", headlineRank: 10, latest: { value: dtoValue, time: "t" } };
}

type Member = { readonly asset: GeneratedSiteAssetDto; readonly statePoints?: readonly GeneratedSitePointDto[] };

/** A fan-out node as the resolver answers it: `asset` is the first member's. */
function fanOutNode(key: string, roleCode: string, members: readonly Member[]): MimicNodeDto {
  const first = members[0];
  return {
    key,
    label: key,
    roleCode,
    asset: first?.asset ?? null,
    memberCount: members.length,
    activeAlarms: 0,
    topAlarm: null,
    statePoints: [...(first?.statePoints ?? [])],
    members: members.map((m) => ({ asset: m.asset, activeAlarms: 0, topAlarm: null, statePoints: [...(m.statePoints ?? [])] })),
  };
}

function readingsOf(values: Readonly<Record<string, number>>): SiteLiveReadings {
  return {
    nowMs: NOW,
    pointLatest: (id, point) => {
      const value = values[`${id}|${point.pointKey}`];
      return value === undefined ? null : { value, time: "t", atMs: NOW - 1_000 };
    },
    assetLastSeenMs: () => NOW - 1_000,
  };
}

const SLD = () => presetGeometry("lv_single_line");

function renderBreakers(geometry: ReturnType<typeof SLD>, nodes: readonly MimicNodeDto[], readings: SiteLiveReadings) {
  return render(<MimicScene title="SLD" geometry={geometry} nodes={nodes} readings={readings} stateMaps={STATE_MAPS} />);
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

/** `F4.322` — PHE-shaped members: long codes that differ only in the tail. */
const PHE_PUMPS = [asset(40, "PHE-PUMP-M-000000004"), asset(41, "PHE-PUMP-M-000000005")];

function codeText(row: HTMLElement): Element {
  const el = row.querySelector('[data-testid="mimic-member-code"]');
  expect(el, "no member code text").not.toBeNull();
  return el as Element;
}

/**
 * `F4.322` R1 — two members draw roomy rows: code 12 cut in the middle (the train number shows),
 * state text 10, a 24-tall row; the row's title keeps the full code. Mutation: draw the dense
 * sizes whatever `place.size` says => red.
 */
export function twoMembersDrawRoomyRowsWithTheTrainNumber(): void {
  const values = Object.fromEntries(PHE_PUMPS.map((a) => [`${a.id}|breaker_main`, 1]));
  renderBreakers(
    SLD(),
    [fanOutNode("load_feeders", "load-feeder-breaker", PHE_PUMPS.map((a) => ({ asset: a, statePoints: [statePoint("breaker_main", 1)] })))],
    readingsOf(values),
  );
  const rows = rowsOf("load_feeders");
  expect(rows.map((r) => codeText(r).textContent)).toEqual(["PHE-PUMP…00000004", "PHE-PUMP…00000005"]);
  expect(rows.map((r) => r.querySelector("title")?.textContent)).toEqual([
    "PHE-PUMP-M-000000004: CLOSED",
    "PHE-PUMP-M-000000005: CLOSED",
  ]);
  const first = rows[0] as HTMLElement;
  expect(codeText(first).getAttribute("font-size")).toBe("12");
  expect(within(first).getByTestId("mimic-breaker-pill").getAttribute("font-size")).toBe("10");
  expect(first.querySelector("rect")?.getAttribute("height")).toBe("23");
  expect(rows.map((r) => r.getAttribute("transform"))).toEqual(["translate(0 136)", "translate(0 160)"]);
  // The switch sits from the right, at 200 - 4 - 43.4 - 3 - 14 = 135.6 (was 0.58 w - 5 = 111), size 14.
  const sw = /^translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)$/.exec(
    within(first).getByTestId("mimic-breaker-switch").getAttribute("transform") ?? "",
  );
  expect(sw, "switch transform").not.toBeNull();
  expect(Number(sw?.[1])).toBeCloseTo(135.6, 6);
  expect(Number(sw?.[2])).toBe(4.5);
  expect(Number(sw?.[3])).toBeCloseTo(14 / 24, 6);
}

/**
 * `F4.322` R3 (review finding) — the code is clipped 2 short of the switch (133.6), or of the
 * pill's room on a row with no switch (200 - 4 - 43.4 - 2 = 150.6), whatever the font: the app
 * loads no web font, and a wider fallback would otherwise run the code under the switch. The
 * clip ids are unique. Mutation: drop the clip group => red.
 */
export function theCodeIsClippedShortOfTheSwitch(): void {
  const values = Object.fromEntries(PHE_PUMPS.map((a) => [`${a.id}|breaker_main`, 1]));
  renderBreakers(
    SLD(),
    [
      fanOutNode("load_feeders", "load-feeder-breaker", PHE_PUMPS.map((a) => ({ asset: a, statePoints: [statePoint("breaker_main", 1)] }))),
      fanOutNode("ups_input", "ups-input-breaker", [{ asset: asset(42, "PHE-MFM-000000005") }]),
    ],
    readingsOf(values),
  );
  const clipWidth = (row: HTMLElement): number => {
    const group = codeText(row).parentElement;
    const ref = /^url\(#(.+)\)$/.exec(group?.getAttribute("clip-path") ?? "")?.[1];
    expect(ref, "the member code sits in no clip group").toBeDefined();
    return Number(row.querySelector(`clipPath[id="${ref}"] rect`)?.getAttribute("width"));
  };
  const switched = rowsOf("load_feeders");
  expect(clipWidth(switched[0] as HTMLElement)).toBeCloseTo(133.6, 6);
  expect(clipWidth(onlyRow("ups_input"))).toBeCloseTo(150.6, 6);
  const ids = Array.from(document.querySelectorAll("clipPath")).map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
}

/** `F4.322` R2 — five members keep the dense `F3.74` rows: code 9, state 7.5, 12 tall. */
export function fiveMembersKeepTheDenseRows(): void {
  const members = Array.from({ length: 5 }, (_, i) => ({ asset: asset(50 + i, `CR-F${i + 1}`) }));
  renderBreakers(SLD(), [fanOutNode("load_feeders", "load-feeder-breaker", members)], readingsOf({}));
  const rows = rowsOf("load_feeders");
  expect(rows).toHaveLength(5);
  const first = rows[0] as HTMLElement;
  expect(codeText(first).getAttribute("font-size")).toBe("9");
  expect(within(first).getByTestId("mimic-member-status").getAttribute("font-size")).toBe("7.5");
  expect(first.querySelector("rect")?.getAttribute("height")).toBe("11");
  expect(rows.map((r) => r.getAttribute("transform"))[4]).toBe("translate(0 184)");
}
