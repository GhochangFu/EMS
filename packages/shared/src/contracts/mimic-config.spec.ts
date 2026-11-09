import { MIMIC_LAYOUT_ID_CASE_MESSAGE, mimicConfigSchema, mimicPresetSchema } from "./mimic-config";

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
 * An uppercase uuid is refused with the case sentence: it is stored as sent, and the resolver
 * keys layouts by the database's lowercase id. The lowercase form of the same id is the positive
 * control, so the refusal is the case alone.
 */
export function mimicConfigRefusesAnUppercaseLayoutId(): void {
  const upper = LAYOUT_ID.replace(/4/g, "A");
  const lower = mimicConfigSchema.safeParse({ source: "layout", layoutId: upper.toLowerCase() });
  assert(lower.success, `the lowercase form must parse, got ${issuesOf(lower)}`);
  const result = mimicConfigSchema.safeParse({ source: "layout", layoutId: upper });
  assert(!result.success, "a layout arm whose layoutId is uppercase must be refused");
  assert(
    issuesOf(result).includes(MIMIC_LAYOUT_ID_CASE_MESSAGE),
    `the refusal must carry the case sentence, got ${issuesOf(result)}`,
  );
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

/**
 * The preset vocabulary is the seven of ADR 0082 decision 3, `water_train` first: the dashboard
 * builder's default preset is `options[0]`, so a reorder would change what a new widget draws.
 */
export function mimicPresetVocabularyIsTheSevenDomainPresets(): void {
  const expected = [
    "water_train",
    "electrical_distribution",
    "hvac_chiller_plant",
    "it_power_cooling",
    "compressed_air",
    "environment_monitoring",
    "facility_services",
    "lv_single_line",
    // `F4.319` (ADR 0113 decision 1) — appended.
    "pump_station_overview",
    "pump_station_electrical",
    "pump_station_environment",
  ];
  assert(
    JSON.stringify(mimicPresetSchema.options) === JSON.stringify(expected),
    `the preset vocabulary is ADR 0082's seven plus F3.74's lv_single_line and F4.319's three, water_train first, got ${JSON.stringify(mimicPresetSchema.options)}`,
  );
}

/**
 * `F4.344` (ADR 0120 decision 5) — `motion` parses on both arms: `false`, `true` and absent all
 * succeed and keep their value (absent or `true` is on; only `false` is off; no migration).
 */
export function motionParsesOnBothArms(): void {
  const arms = [
    { source: "preset", preset: "water_train" },
    { source: "layout", layoutId: LAYOUT_ID },
  ] as const;
  for (const arm of arms) {
    for (const motion of [false, true, undefined]) {
      const input = motion === undefined ? { ...arm } : { ...arm, motion };
      const result = mimicConfigSchema.safeParse(input);
      assert(result.success, `${arm.source} with motion ${String(motion)} must parse, got ${issuesOf(result)}`);
      const parsed = result.success ? (result.data as { motion?: boolean }) : {};
      assert(parsed.motion === motion, `${arm.source}: motion ${String(motion)} must be kept, got ${String(parsed.motion)}`);
    }
  }
}

/** `F4.344` — `motion` is a boolean on both arms: `"off"` is refused at `["motion"]`. */
export function motionRefusesANonBoolean(): void {
  for (const arm of [{ source: "preset", preset: "water_train" }, { source: "layout", layoutId: LAYOUT_ID }]) {
    const result = mimicConfigSchema.safeParse({ ...arm, motion: "off" });
    const paths = result.success ? [] : result.error.issues.map((i) => JSON.stringify(i.path));
    assert(!result.success && paths.includes(JSON.stringify(["motion"])), `${arm.source}: motion "off" must be refused at ["motion"], got ${issuesOf(result)}`);
  }
}

/**
 * `F4.345` (ADR 0121 decision 5) — `glyphSet` parses on both arms: `"iso"`, `"core"` and absent,
 * each kept as sent (absent stays absent: ruling 3, no widget changes on deploy).
 */
export function glyphSetParsesOnBothArms(): void {
  for (const arm of [{ source: "preset", preset: "water_train" }, { source: "layout", layoutId: LAYOUT_ID }] as const) {
    for (const glyphSet of ["iso", "core", undefined] as const) {
      const input = glyphSet === undefined ? { ...arm } : { ...arm, glyphSet };
      const result = mimicConfigSchema.safeParse(input);
      assert(result.success, `${arm.source} with glyphSet ${String(glyphSet)} must parse, got ${issuesOf(result)}`);
      const parsed = result.success ? (result.data as { glyphSet?: string }) : {};
      assert(parsed.glyphSet === glyphSet, `${arm.source}: glyphSet ${String(glyphSet)} must be kept, got ${String(parsed.glyphSet)}`);
      assert(glyphSet !== undefined || !("glyphSet" in parsed), `${arm.source}: an absent glyphSet must stay absent`);
    }
  }
}

/** `F4.345` — `glyphSet` is `core` or `iso` only: `"isometric"` is refused at `["glyphSet"]` on both arms. */
export function glyphSetRefusesAnUnknownSet(): void {
  for (const arm of [{ source: "preset", preset: "water_train" }, { source: "layout", layoutId: LAYOUT_ID }]) {
    const result = mimicConfigSchema.safeParse({ ...arm, glyphSet: "isometric" });
    const paths = result.success ? [] : result.error.issues.map((i) => JSON.stringify(i.path));
    assert(!result.success && paths.includes(JSON.stringify(["glyphSet"])), `${arm.source}: glyphSet "isometric" must be refused at ["glyphSet"], got ${issuesOf(result)}`);
  }
}
