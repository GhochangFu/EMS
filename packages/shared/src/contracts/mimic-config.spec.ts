import { mimicConfigSchema, mimicPresetSchema } from "./mimic-config";

/**
 * `F3.32c` / ADR 0081 — the `mimic` widget config, both arms (plan D1, D2).
 *
 * Assertions live here; `mimic-config.test.ts` is the Vitest entry point (ADR 0014). One claim
 * per exported function, so a mutation reddens the `it` that owns it.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const LAYOUT_ID = "44444444-4444-4444-8444-444444444444";

function issuesOf(result: { success: boolean; error?: { issues: unknown } }): string {
  return JSON.stringify(result.success ? null : result.error?.issues);
}

/** The v1 preset arm still parses — a stored widget never needs migrating. */
export function mimicConfigParsesThePresetArm(): void {
  const result = mimicConfigSchema.safeParse({ source: "preset", preset: "water_train" });
  assert(result.success, `the preset arm must parse, got ${issuesOf(result)}`);
}

/** The layout arm parses with a uuid `layoutId`. */
export function mimicConfigParsesTheLayoutArm(): void {
  const result = mimicConfigSchema.safeParse({ source: "layout", layoutId: LAYOUT_ID });
  assert(result.success, `the layout arm must parse, got ${issuesOf(result)}`);
}

/** A layout arm without `layoutId` names no drawing. */
export function mimicConfigRefusesALayoutArmWithoutLayoutId(): void {
  const result = mimicConfigSchema.safeParse({ source: "layout" });
  assert(!result.success, "a layout arm without layoutId must be refused");
}

/** `layoutId` is a uuid, not a slug or a name. */
export function mimicConfigRefusesANonUuidLayoutId(): void {
  const result = mimicConfigSchema.safeParse({ source: "layout", layoutId: "water-train" });
  assert(!result.success, "a layout arm whose layoutId is not a uuid must be refused");
}

/**
 * The discriminant decides the arm: `source: "preset"` with a `layoutId` and no `preset` is the
 * preset arm missing its preset, not a layout. No `preset` in the fixture — a plain `z.object`
 * strips the unknown `layoutId`, so a fixture carrying `preset` too would parse.
 */
export function mimicConfigRefusesAPresetSourceCarryingALayoutId(): void {
  const result = mimicConfigSchema.safeParse({ source: "preset", layoutId: LAYOUT_ID });
  assert(!result.success, "source preset with a layoutId and no preset must be refused");
}

/** The preset vocabulary is unchanged by the move: `water_train` alone. */
export function mimicPresetVocabularyIsWaterTrainAlone(): void {
  assert(
    JSON.stringify(mimicPresetSchema.options) === JSON.stringify(["water_train"]),
    `the preset vocabulary is water_train alone, got ${JSON.stringify(mimicPresetSchema.options)}`,
  );
}
