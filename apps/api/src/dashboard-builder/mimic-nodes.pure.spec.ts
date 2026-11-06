import { expect } from "vitest";

import { MIMIC_PRESETS, mimicPresetSchema } from "@bms/shared";

import { presetRoledNodes } from "./mimic-nodes.pure";

/**
 * `F4.319` (ADR 0113 decision 2) — a preset node's listed points reach the resolver. Before this
 * row `presetRoledNodes` gave every preset node `pointKeys: []`, so a preset could not name its
 * points; the listed arm downstream (`listedPairs`, statement (3)) already serves a layout unit.
 */

/** A pump-station node passes its list on, in the preset's order. */
export function aPumpStationNodePassesItsPointKeysOn(): void {
  const byKey = new Map(presetRoledNodes("pump_station_overview").map((node) => [node.key, node]));
  expect(byKey.get("main_pump")?.pointKeys).toEqual(["breaker_main"]);
  expect(byKey.get("rtu")?.pointKeys).toEqual(["battery_charge_pct", "network_strength", "controller_power_status"]);
  expect(byKey.get("rtu")?.fanOut).toBe(true);
  // The passive source and delivery resolve to no asset and are absent (F3.74 OQ8).
  expect([...byKey.keys()]).toEqual(["main_pump", "dosing", "meter", "rtu"]);
}

/** A node that lists nothing — every node of the eight earlier presets — still gives `[]`. */
export function aNodeThatListsNothingGivesAnEmptyList(): void {
  let seen = 0;
  for (const preset of mimicPresetSchema.options) {
    for (const node of presetRoledNodes(preset)) {
      const def = MIMIC_PRESETS[preset].nodes.find((row) => row.key === node.key);
      const listed = def !== undefined && "pointKeys" in def ? def.pointKeys : [];
      if (listed.length === 0) seen += 1;
      expect(node.pointKeys, `${preset}.${node.key}`).toEqual(listed);
    }
  }
  expect(seen).toBeGreaterThan(40);
}
