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

/** Every node names a role code, which is what it resolves against at read time. */
export function everyRoleCodeIsNonEmpty(): void {
  for (const [preset, def] of presets()) {
    for (const node of def.nodes) {
      assert(
        node.roleCode.trim().length > 0,
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
        node.roleCode === node.roleCode.toLowerCase(),
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
    JSON.stringify(counts) === JSON.stringify([8, 7, 5, 6, 4, 4, 5]),
    `node counts in enum order must be [8,7,5,6,4,4,5], got ${JSON.stringify(counts)}`,
  );
}
