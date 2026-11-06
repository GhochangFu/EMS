import { MIMIC_LAYOUT_NODE_KEY } from "./contracts/mimic-layouts";
import { mimicPresetSchema } from "./contracts/mimic-config";
import { MIMIC_PRESETS, type MimicPresetDef } from "./mimic-presets";

/**
 * `F3.32` / ADR 0079 decision 2 — the preset definitions; `F3.32d` / ADR 0082 decision 3 — the
 * six domain presets beside `water_train`.
 *
 * Assertions live here; `mimic-presets.test.ts` is the Vitest entry point (ADR 0014). One claim
 * per exported function, so a mutation reddens the `it` that owns it. Every loop reads the
 * presets widened to `MimicPresetDef`, so the optional `sink` is read through its guard.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function presets(): [string, MimicPresetDef][] {
  return Object.entries(MIMIC_PRESETS);
}

/**
 * The preset map and the preset enum are one vocabulary. `satisfies Record<MimicPreset, …>`
 * catches a missing key at compile time; only this catches an extra one.
 */
export function presetKeysEqualTheEnumBothWays(): void {
  const keys = Object.keys(MIMIC_PRESETS).sort();
  const declared = [...mimicPresetSchema.options].sort();
  assert(
    JSON.stringify(keys) === JSON.stringify(declared),
    `MIMIC_PRESETS keys must equal mimicPresetSchema.options — got ${JSON.stringify(keys)}, ` +
      `declared ${JSON.stringify(declared)}`,
  );
}

/** `water_train` draws eight nodes, and no key is used twice. */
export function waterTrainHasEightUniqueNodes(): void {
  const keys = MIMIC_PRESETS.water_train.nodes.map((node) => node.key);
  assert(keys.length === 8, `water_train has 8 nodes, got ${keys.length}`);
  assert(
    new Set(keys).size === keys.length,
    `water_train node keys must be unique, got ${JSON.stringify(keys)}`,
  );
}

/** No preset uses a node key twice. */
export function everyPresetsNodeKeysAreUnique(): void {
  for (const [preset, def] of presets()) {
    const keys = def.nodes.map((node) => node.key);
    assert(new Set(keys).size === keys.length, `${preset}: node keys must be unique, got ${JSON.stringify(keys)}`);
  }
}

/**
 * Every node key is a stored layout's node key too: "Start from" copies the keys verbatim, so a
 * hyphen or a capital would be a 400 on the first save (ADR 0082 decision 5).
 */
export function everyNodeKeyIsALayoutNodeKey(): void {
  for (const [preset, def] of presets()) {
    for (const node of def.nodes) {
      assert(MIMIC_LAYOUT_NODE_KEY.test(node.key), `${preset}: node key "${node.key}" is not a layout node key`);
    }
  }
}

/** Every pipe end names a node of the same preset. */
export function everyPipeEndNamesANode(): void {
  for (const [preset, def] of presets()) {
    const keys = new Set(def.nodes.map((node) => node.key));
    for (const pipe of def.pipes) {
      assert(keys.has(pipe.from), `${preset}: pipe from "${pipe.from}" names no node`);
      assert(keys.has(pipe.to), `${preset}: pipe to "${pipe.to}" names no node`);
    }
  }
}

/** A sink, where a preset has one, follows a node of that preset. */
export function aSinkNamesANode(): void {
  for (const [preset, def] of presets()) {
    if (def.sink !== undefined) {
      const keys = new Set(def.nodes.map((node) => node.key));
      assert(keys.has(def.sink.from), `${preset}: sink from "${def.sink.from}" names no node`);
    }
  }
}

/** Only `water_train` has a sink (ADR 0082 decision 3: the sink is optional). */
export function onlyWaterTrainHasASink(): void {
  const withSink = presets()
    .filter(([, def]) => def.sink !== undefined)
    .map(([preset]) => preset);
  assert(
    JSON.stringify(withSink) === JSON.stringify(["water_train"]),
    `only water_train has a sink, got ${JSON.stringify(withSink)}`,
  );
}

/** Every roled node names a non-empty code; a `null` role is a passive node (F3.74 OQ8). */
export function everyRoleCodeIsNonEmpty(): void {
  for (const [preset, def] of presets()) {
    for (const node of def.nodes) {
      assert(
        node.roleCode === null || node.roleCode.trim().length > 0,
        `${preset}: node "${node.key}" has an empty roleCode`,
      );
    }
  }
}

/** Every role code is lowercase, as `bms.asset_roles` spells every code. */
export function everyRoleCodeIsLowercase(): void {
  for (const [preset, def] of presets()) {
    for (const node of def.nodes) {
      assert(
        node.roleCode === null || node.roleCode === node.roleCode.toLowerCase(),
        `${preset}: node "${node.key}" roleCode "${node.roleCode}" must be lowercase`,
      );
    }
  }
}

/** A preset with no pipes is valid: `environment_monitoring` draws four monitors, unjoined. */
export function environmentMonitoringHasNoPipes(): void {
  const count = MIMIC_PRESETS.environment_monitoring.pipes.length;
  assert(count === 0, `environment_monitoring has no pipes, got ${count}`);
}

/** The node count of every preset, in enum order (plan §3). */
export function presetNodeCountsAreThePlanTable(): void {
  const counts = mimicPresetSchema.options.map((preset) => MIMIC_PRESETS[preset].nodes.length);
  assert(
    JSON.stringify(counts) === JSON.stringify([8, 7, 5, 6, 4, 4, 5, 13, 6, 5, 4]),
    `node counts in enum order must be [8,7,5,6,4,4,5,13,6,5,4], got ${JSON.stringify(counts)}`,
  );
}

/** `F3.74` plan D5 — `lv_single_line`'s `sources` name nodes of the preset, and name `incoming` alone. */
export function lvSingleLineSourcesAreNodeKeys(): void {
  const def: MimicPresetDef = MIMIC_PRESETS.lv_single_line;
  const keys = new Set(def.nodes.map((node) => node.key));
  const sources = def.sources ?? [];
  assert(sources.length > 0, "lv_single_line names at least one source");
  for (const source of sources) {
    assert(keys.has(source), `lv_single_line: source "${source}" names no node`);
  }
  assert(
    JSON.stringify(sources) === JSON.stringify(["incoming"]),
    `lv_single_line's sources are ["incoming"], got ${JSON.stringify(sources)}`,
  );
}

/** `F3.74` plan D5 — the two bus nodes are passive (`roleCode: null`) and nothing else is. */
export function lvSingleLineBusesArePassive(): void {
  const passive = MIMIC_PRESETS.lv_single_line.nodes
    .filter((node) => node.roleCode === null)
    .map((node) => node.key);
  assert(
    JSON.stringify(passive) === JSON.stringify(["main_bus", "load_bus"]),
    `only main_bus and load_bus are passive, got ${JSON.stringify(passive)}`,
  );
}

/** `F4.319` — a node's topology as ADR 0113 decision 1's tables state it: key, role, points. */
type NodeRow = readonly [key: string, roleCode: string | null, pointKeys: readonly string[]];

const nodeRows = (def: MimicPresetDef): NodeRow[] =>
  def.nodes.map((node) => [node.key, node.roleCode, node.pointKeys ?? []] as const);

/**
 * ADR 0113 decision 1 — the three pump-station presets, literal from the ADR's tables, so the
 * preset cannot drift from the record by editing one side.
 */
const ADR_0113_PRESETS: Readonly<Record<string, { nodes: NodeRow[]; pipes: [string, string][]; sources?: string[] }>> = {
  pump_station_overview: {
    nodes: [
      ["source", null, []],
      ["main_pump", "pump", ["breaker_main"]],
      ["delivery", null, []],
      ["dosing", "dosing-pump", ["chlorine_pump_on"]],
      ["meter", "meter", ["kw", "kwh_total", "pf"]],
      ["rtu", "rtu-controller", ["battery_charge_pct", "network_strength", "controller_power_status"]],
    ],
    pipes: [["source", "main_pump"], ["main_pump", "delivery"], ["dosing", "delivery"]],
  },
  pump_station_electrical: {
    nodes: [
      ["incoming", null, []],
      ["meter", "meter", ["kw", "voltage_vry", "current_ir"]],
      ["lt_bus", null, []],
      ["main_pump", "pump", ["breaker_main"]],
      ["dosing", "dosing-pump", ["chlorine_pump_on"]],
    ],
    pipes: [["incoming", "meter"], ["meter", "lt_bus"], ["lt_bus", "main_pump"], ["lt_bus", "dosing"]],
    sources: ["incoming"],
  },
  pump_station_environment: {
    nodes: [
      ["mains", null, []],
      ["rtu", "rtu-controller", ["controller_power_status"]],
      ["battery", "rtu-controller", ["battery_charge_pct"]],
      ["network", "rtu-controller", ["network_strength"]],
    ],
    pipes: [["mains", "rtu"], ["rtu", "battery"], ["rtu", "network"]],
  },
};

/** `F4.319` — each pump-station preset's nodes, roles, points, pipes and sources are the ADR's. */
export function pumpStationPresetsAreTheAdrTables(): void {
  for (const [preset, want] of Object.entries(ADR_0113_PRESETS)) {
    const def: MimicPresetDef = MIMIC_PRESETS[preset as keyof typeof MIMIC_PRESETS];
    assert(def !== undefined, `${preset} is not a preset`);
    assert(
      JSON.stringify(nodeRows(def)) === JSON.stringify(want.nodes),
      `${preset} nodes must be ${JSON.stringify(want.nodes)}, got ${JSON.stringify(nodeRows(def))}`,
    );
    const pipes = def.pipes.map((pipe) => [pipe.from, pipe.to]);
    assert(JSON.stringify(pipes) === JSON.stringify(want.pipes), `${preset} pipes are ${JSON.stringify(pipes)}`);
    assert(
      JSON.stringify(def.sources ?? null) === JSON.stringify(want.sources ?? null),
      `${preset} sources are ${JSON.stringify(def.sources ?? null)}`,
    );
  }
}

/** `F4.319` (Q2) — every equipment node of the three pump-station presets fans out. */
export function everyPumpStationEquipmentNodeFansOut(): void {
  for (const preset of Object.keys(ADR_0113_PRESETS)) {
    const def: MimicPresetDef = MIMIC_PRESETS[preset as keyof typeof MIMIC_PRESETS];
    for (const node of def.nodes) {
      if (node.roleCode !== null) {
        assert(node.fanOut === true, `${preset}.${node.key} must fan out`);
      }
    }
  }
}

/**
 * `F4.319` (ADR 0113 decision 2) — a preset node lists at most three points, never on a passive
 * node, without repeats; and the eight earlier presets list none, so they do not change.
 */
export function presetPointKeysAreAtMostThreeAndOnlyOnTheNewPresets(): void {
  for (const [preset, def] of presets()) {
    for (const node of def.nodes) {
      const keys = node.pointKeys;
      if (keys === undefined) continue;
      assert(preset in ADR_0113_PRESETS, `${preset}.${node.key}: only the pump-station presets list points`);
      assert(node.roleCode !== null, `${preset}.${node.key}: a passive node lists no points`);
      assert(keys.length >= 1 && keys.length <= 3, `${preset}.${node.key}: 1 to 3 point keys, got ${keys.length}`);
      assert(new Set(keys).size === keys.length, `${preset}.${node.key}: point keys repeat`);
      for (const key of keys) {
        assert(/^[a-z0-9_]+$/.test(key), `${preset}.${node.key}: "${key}" is not a point key code`);
      }
    }
  }
}
