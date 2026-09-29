import { mimicPresetSchema } from "./contracts/mimic-config";
import { MIMIC_PRESETS } from "./mimic-presets";

/**
 * `F3.32` / ADR 0079 decision 2 — the preset definitions.
 *
 * Assertions live here; `mimic-presets.test.ts` is the Vitest entry point (ADR 0014). One claim
 * per exported function, so a mutation reddens the `it` that owns it.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
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

/** Every pipe end, and the sink's source, names a node of the same preset. */
export function everyPipeEndNamesANode(): void {
  for (const [preset, def] of Object.entries(MIMIC_PRESETS)) {
    const keys = new Set(def.nodes.map((node) => node.key));
    for (const pipe of def.pipes) {
      assert(keys.has(pipe.from), `${preset}: pipe from "${pipe.from}" names no node`);
      assert(keys.has(pipe.to), `${preset}: pipe to "${pipe.to}" names no node`);
    }
    assert(keys.has(def.sink.from), `${preset}: sink from "${def.sink.from}" names no node`);
  }
}

/** Every node names a role code, which is what it resolves against at read time. */
export function everyRoleCodeIsNonEmpty(): void {
  for (const [preset, def] of Object.entries(MIMIC_PRESETS)) {
    for (const node of def.nodes) {
      assert(
        node.roleCode.trim().length > 0,
        `${preset}: node "${node.key}" has an empty roleCode`,
      );
    }
  }
}
