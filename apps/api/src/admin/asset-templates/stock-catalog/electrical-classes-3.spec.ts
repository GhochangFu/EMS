import { CALC_DIALECT_V2, CALC_DIALECT_V3, MAX_FORMULA_WINDOWS, parseFormula } from "@bms/shared";

import { STOCK_ASSET_TEMPLATE_CATALOG } from "./stock-catalog";
import { alarmsOf, assert, FEEDER_CODE, requireStockEntry } from "./stock-catalog.spec";
import { calcParameterKeys0074, sustainabilityClaims, type SustainabilityRow } from "./stock-transcription.spec";

/**
 * `E4.1c` — the feeder / incomer class (`electrical-feeder`) against
 * `docs/electrical-derived-taglist-v1.md` §1 and against ADR 0070 decision 8,
 * **and the `E4.1c` rows of the other four electrical classes** (transformer,
 * DG set, solar PV, APFC — the `E41C_ELECTRICAL_CLASSES` table at the end):
 * their count, key-order and tier claims stay in `electrical-classes.spec.ts`
 * (961 lines) and `electrical-classes-2.spec.ts`, and the formula pins live
 * here because the first of those files has no room under the §4.5 cap.
 *
 * **A third electrical class-spec file, and the reason is the §4.5 cap, twice
 * over.** The block below lived in `stock-catalog.spec.ts` from `F2.13`, and
 * that file stood at 999 lines when `E4.1c` arrived with six `bms-calc-v3`
 * derived rows to pin (plan design decision 17). `electrical-classes.spec.ts`
 * (952) and `electrical-classes-2.spec.ts` hold the other five electrical
 * classes; the cut is by line budget only, the `electrical-classes-2` rule —
 * the three could be concatenated with no edit.
 *
 * **Two kinds of claim, kept apart.** `runFeederTagListBlock` is the `F2.13`
 * block moved whole — every assertion in it is a claim about tag list §1 (the
 * 33 rows, the 17 C / 16 X split, no M row, `kwh_today` measured, the eleven
 * alarm rows, `overload` on `current_a`) or about `F2.8`'s three `v2` rows.
 * The exported `assert*` functions after it are `E4.1c`'s: one per claim, so
 * the wrapper runs one `it()` per claim and a later block cannot hide behind
 * an earlier `assert` that throws first.
 *
 * The generic claims (pair-absence, alarm bindings, the vocabularies, the
 * `meta.tier` iff rule, derived-point well-formedness — including that every
 * `v2`/`v3` formula parses under its dialect and names only declared keys)
 * are `checkEntry`'s in `stock-catalog.spec.ts` and are not restated.
 */
export function runFeederTagListBlock(): void {
  const codes = STOCK_ASSET_TEMPLATE_CATALOG.map((entry) => entry.code);

  // ---- the feeder class, against its tag list -----------------------------

  const feeder = STOCK_ASSET_TEMPLATE_CATALOG.find((entry) => entry.code === FEEDER_CODE);
  assert(
    feeder !== undefined,
    `the catalog must ship "${FEEDER_CODE}" (plan §5) — found only: ${codes.join(", ") || "(nothing)"}`,
  );
  if (!feeder) return;

  // The tag list's 33 rows — 17 C and 16 X — plus `F2.8`'s three derived rows
  // and `E4.1c`'s six, in order (`sortOrder` 0…41). The measured half is a
  // transcription claim about `docs/electrical-derived-taglist-v1.md` §1; the
  // derived half is not in that document at all and is not counted against it.
  // `optional` is measured-only for the same reason: a derived row is optional
  // too, and folding the two together would let a lost tag-list row hide
  // behind a new formula.
  assert(feeder.points.length === 42, `tag list §1's 33 rows + F2.8's 3 derived + E4.1c's 6; the entry declares ${feeder.points.length}`);
  const required = feeder.points.filter((point) => point.required);
  const optional = feeder.points.filter((point) => point.kind === "measured" && !point.required);
  assert(required.length === 17, `17 rows are tier C (required); got ${required.length}`);
  assert(optional.length === 16, `16 measured rows are tier X (optional); got ${optional.length}`);
  feeder.points.forEach((point, index) => {
    assert(
      point.sortOrder === index,
      `points must be in the tag list's own order — ${point.pointKey} has sortOrder ${point.sortOrder} at index ${index}`,
    );
  });
  const feederKeys = new Set(feeder.points.map((point) => point.pointKey));
  assert(feederKeys.size === 42, "no point key may repeat");

  // **The first three derived rows are `F2.8`'s, not the tag list's** — ruling 1
  // of that row's gate (PUE lives on the site's incomer and nowhere else), and
  // ADR 0055 decision 6's worked example made concrete: two aggregates and the
  // ratio of the two derived siblings decision 7 admits. The order is the
  // ratio's own reading order, so a later append cannot put `pue` above the
  // inputs it divides. `E4.1c`'s six follow them; their claims are the
  // `assert*` functions below, one `it()` each.
  const derived = feeder.points.filter((point) => point.kind === "derived");
  const f28 = derived.slice(0, 3);
  assert(
    f28.map((point) => point.pointKey).join(",") === "site_kw,it_kw,pue",
    `F2.8 ruling 1 authors site_kw, it_kw and pue on the incomer, in that order, first; got ` +
      `${derived.map((point) => point.pointKey).join(", ") || "(none)"}`,
  );
  assert(
    f28.every((point) => point.formulaDialect === CALC_DIALECT_V2),
    `every F2.8 derived row is "${CALC_DIALECT_V2}" — two of them aggregate over a scope, which ` +
      `only v2 can express; got ${f28.map((point) => String(point.formulaDialect)).join(", ")}`,
  );

  // The tier marking is `checkEntry`'s from F2.12 Task 3 on — the iff rule
  // there subsumes the C/X pair this block used to assert, and says more (it
  // also constrains `manual` rows and derived points, which the old rule could
  // not express). What stays feeder-specific is §1's own claim: no M row.
  const manual = feeder.points.filter((point) => point.meta?.tier === "manual");
  assert(
    manual.length === 0,
    `tag list §1 has no M column — ${FEEDER_CODE} marks ${manual.map((p) => p.pointKey).join(", ")} manual`,
  );

  // kwh_today is C/D and authored MEASURED (plan §5): no bms-calc-v1 formula
  // can express energy-today, and a placeholder is the guessing ADR 0019 refuses.
  const kwhToday = feeder.points.find((point) => point.pointKey === "kwh_today");
  assert(
    kwhToday !== undefined && kwhToday.required && kwhToday.kind === "measured",
    "kwh_today (tier C/D) must be required and measured",
  );

  // The feeder's "no derived point, no kpis" guard moved to
  // `stock-catalog-deferrals.spec.ts` with the ledger it cites — it is a
  // deferral claim, and `DEFERRAL_REASON` is the text it fails with.

  // Eleven philosophy rows. Pair-absence, the binding, the message, the
  // severity and the category are `checkEntry`'s from F2.12 Task 3 on — every
  // one of them is a property of a STOCK catalog, not of this class. The count
  // is §1's own claim and stays here.
  const alarms = alarmsOf(feeder);
  assert(alarms.length === 11, `plan §5 authors 11 alarm rows; the entry carries ${alarms.length}`);

  // The overload row binds current_a, not the deferred load_pct (ruled 2026-09-02).
  const overload = alarms.find((alarm) => alarm.code === "overload");
  assert(
    overload !== undefined && overload.pointKey === "current_a",
    `the overload alarm must bind current_a (load_pct is deferred); got ${String(overload?.pointKey)}`,
  );
}

// ---- E4.1c — the six bms-calc-v3 sustainability rows (ADR 0070 decision 8) --
//
// Plan `docs/plans/e4.1c-stock-sustainability-points-and-tariff-absorption.md`
// §3.7. One exported function per claim; `electrical-classes-3.test.ts` runs
// one `it()` per function, so a red claim names itself rather than hiding
// behind an earlier `assert` in the same block.

const feederEntry = () => {
  const feeder = STOCK_ASSET_TEMPLATE_CATALOG.find((entry) => entry.code === FEEDER_CODE);
  if (!feeder) throw new Error(`the catalog must ship "${FEEDER_CODE}"`);
  return feeder;
};

const derivedOf = () => feederEntry().points.filter((point) => point.kind === "derived");

/** `E4.1c`'s six, never an empty slice: a claim over zero rows is vacuous. */
const sixOf = () => {
  const six = derivedOf().slice(3);
  assert(six.length === 6, `E4.1c authors six derived rows after F2.8's three; found ${six.length}`);
  return six;
};

/** The nine derived codes, in `sortOrder` order: `F2.8`'s three, then `E4.1c`'s six. */
export const FEEDER_DERIVED_CODES = [
  "site_kw",
  "it_kw",
  "pue",
  "energy_cost_per_h",
  "co2_kg_per_h",
  "energy_cost_today",
  "co2_kg_today",
  "energy_saving_vs_baseline_pct",
  "demand_vs_contract_pct",
] as const;

/**
 * The six formulas, EXACTLY as plan §3.7 writes them — pinned literally, the
 * DG spec's rule: a "simplification" of a shipped formula is a silent
 * behaviour change on every organization that imported it. `energy_cost_*`
 * carry the empty-string unit (Q8): the money is in the organization's
 * currency, which is the tenant's (`bms.organizations.currency`), not the
 * code's. `kwh_today` stays MEASURED (Q3): the today-quantities read
 * `delta({kwh_total}, today)` themselves, never the meter's register.
 */
export const E41C_FEEDER_FORMULAS: ReadonlyArray<readonly [pointKey: string, formula: string, unit: string]> = [
  ["energy_cost_per_h", "{kw} * $energy_tariff_per_kwh", ""],
  ["co2_kg_per_h", "{kw} * $grid_carbon_factor_kgco2_per_kwh", "kg/h"],
  ["energy_cost_today", "delta({kwh_total}, today) * $energy_tariff_per_kwh", ""],
  ["co2_kg_today", "delta({kwh_total}, today) * $grid_carbon_factor_kgco2_per_kwh", "kg"],
  [
    "energy_saving_vs_baseline_pct",
    "(1 - delta({kwh_total}, today) / ($energy_baseline_kwh_per_day * hours(today) / 24)) * 100",
    "%",
  ],
  ["demand_vs_contract_pct", "{max_demand_kva} / $contract_demand_kva * 100", "%"],
];


export function assertNineDerivedRowsInOrder(): void {
  const codes = derivedOf().map((point) => point.pointKey);
  assert(
    codes.join(",") === FEEDER_DERIVED_CODES.join(","),
    `${FEEDER_CODE} must author exactly nine derived rows in sortOrder order — F2.8's three, then ` +
      `E4.1c's six (plan §3.7) — got ${codes.join(", ") || "(none)"}`,
  );
}

export function assertSortOrder36To41(): void {
  const six = sixOf();
  const orders = six.map((point) => point.sortOrder);
  assert(
    orders.join(",") === "36,37,38,39,40,41",
    `E4.1c's six rows are appended after the entry's last point at sortOrder 36–41; got ${orders.join(",")}`,
  );
}

export function assertDialectsV2ThenV3(): void {
  const dialects = derivedOf().map((point) => String(point.formulaDialect));
  const expected = [CALC_DIALECT_V2, CALC_DIALECT_V2, CALC_DIALECT_V2, ...Array<string>(6).fill(CALC_DIALECT_V3)];
  assert(
    dialects.join(",") === expected.join(","),
    `formulaDialect is per point (plan fact 7): F2.8's three stay "${CALC_DIALECT_V2}", E4.1c's six are ` +
      `"${CALC_DIALECT_V3}" — got ${dialects.join(", ")}`,
  );
}

const formulaOf = (pointKey: string): string | undefined =>
  feederEntry().points.find((point) => point.pointKey === pointKey)?.formula ?? undefined;

const unitOf = (pointKey: string): string | null | undefined =>
  feederEntry().points.find((point) => point.pointKey === pointKey)?.unit;

/** One function per formula, so the wrapper can name the row that went red. */
export function assertFormulaPinned(pointKey: string): void {
  const row = E41C_FEEDER_FORMULAS.find(([code]) => code === pointKey);
  if (!row) throw new Error(`${pointKey} is not one of E41C_FEEDER_FORMULAS`);
  const [, formula] = row;
  assert(
    formulaOf(pointKey) === formula,
    `${pointKey}'s formula must be exactly "${formula}" — got "${String(formulaOf(pointKey))}". Plan §3.7 ` +
      "is the text; a shipped formula is asserted literally because a rewrite is a silent behaviour " +
      "change on every organization that imported it.",
  );
}

export function assertUnitsPerPlan(): void {
  const wrong = E41C_FEEDER_FORMULAS.filter(([pointKey, , unit]) => unitOf(pointKey) !== unit);
  assert(
    wrong.length === 0,
    `E4.1c units (plan §3.7, Q8: money is ""): ` +
      wrong.map(([pointKey, , unit]) => `${pointKey} expected "${unit}" got ${String(unitOf(pointKey))}`).join("; "),
  );
}

export function assertScheduledAt60(): void {
  const six = sixOf();
  const off = six.filter((point) => point.calcTrigger !== "scheduled" || point.calcIntervalSeconds !== 60);
  assert(
    off.length === 0,
    `every E4.1c row is calcTrigger "scheduled" at calcIntervalSeconds 60 (plan design decision 7) — ` +
      `got ${off.map((point) => `${point.pointKey}: ${String(point.calcTrigger)}/${String(point.calcIntervalSeconds)}`).join(", ")}`,
  );
}

export function assertMinCoverageRatioNull(): void {
  const six = sixOf();
  const off = six.filter((point) => point.minCoverageRatio !== null);
  assert(
    off.length === 0,
    `every E4.1c row leaves minCoverageRatio at derived()'s null (inert — no @scope aggregate, ADR 0055 decision 11) — ` +
      `got ${off.map((point) => `${point.pointKey}: ${String(point.minCoverageRatio)}`).join(", ")}`,
  );
}

export function assertMaxInputAgeDefault(): void {
  const six = sixOf();
  const off = six.filter((point) => point.maxInputAgeSeconds !== null);
  assert(
    off.length === 0,
    `every E4.1c row takes the default input age (null) — got ` +
      `${off.map((point) => `${point.pointKey}: ${String(point.maxInputAgeSeconds)}`).join(", ")}`,
  );
}

export function assertNotRequiredNoMeta(): void {
  const six = sixOf();
  const off = six.filter((point) => point.required !== false || point.meta !== undefined);
  assert(
    off.length === 0,
    `every E4.1c row is required: false with no meta — meta.tier says what the plant has FITTED and ` +
      `nothing fits a computed point — got ${off.map((point) => point.pointKey).join(", ")}`,
  );
}

/**
 * Every `$key` is one of the twelve `0074` codes, and every formula parses
 * under `v3` inside `MAX_FORMULA_WINDOWS` — read from the ENTRY's six rows,
 * never from this file's table, so a misspelt key in the module goes red HERE
 * on its own claim (naming the key), not only through the pinned text. The
 * plan's (a′) invariant test (U12) holds the same claim over the whole
 * catalog.
 */
export function assertParamRefsAreVocabulary(): void {
  const bad: string[] = [];
  for (const { pointKey, formula } of sixOf()) {
    const parsed = parseFormula(formula ?? "", { dialect: CALC_DIALECT_V3 });
    if (!parsed.ok) {
      bad.push(`${pointKey} does not parse under ${CALC_DIALECT_V3}: ${parsed.errors.map((e) => e.code).join(", ")}`);
      continue;
    }
    if (parsed.paramRefs.length === 0) bad.push(`${pointKey} reads no $key — every E4.1c feeder row reads one`);
    for (const key of parsed.paramRefs) {
      if (!calcParameterKeys0074().has(key)) bad.push(`${pointKey} reads $${key}, not a 0074 parameter key`);
    }
    if (parsed.windowReads.length > MAX_FORMULA_WINDOWS) {
      bad.push(`${pointKey} has ${parsed.windowReads.length} window reads, above MAX_FORMULA_WINDOWS`);
    }
  }
  assert(bad.length === 0, bad.join("; "));
}

/** The positive control for the claim above: an unknown `$key` IS reported. */
export function assertParamRefsControl(): void {
  const parsed = parseFormula("{kw} * $not_a_key", { dialect: CALC_DIALECT_V3 });
  assert(
    parsed.ok && parsed.paramRefs.length === 1 && !calcParameterKeys0074().has(parsed.paramRefs[0]!),
    "the control: a formula reading $not_a_key must parse under v3 and its key must be outside the twelve",
  );
}

export function assertKwhTodayStillMeasured(): void {
  const kwhToday = feederEntry().points.find((point) => point.pointKey === "kwh_today");
  assert(
    kwhToday !== undefined && kwhToday.required && kwhToday.kind === "measured",
    "kwh_today stays required and MEASURED (plan Q3): E4.1c's today-quantities read delta({kwh_total}, " +
      "today) themselves; a derived kwh_today would be a second answer to the meter's register",
  );
}

export function assertStockVersion3(): void {
  const version = feederEntry().stockVersion;
  assert(
    version === 3,
    `electrical-feeder is stockVersion 3 (ruling 10: v2 → v3 for E4.1c's six rows; an importing tenant ` +
      `takes them by re-import, never by mutation) — got ${String(version)}`,
  );
}

// ---- E4.1c — the other four electrical classes' bms-calc-v3 rows ---------
//
// Plan §3.7. The count, key-order and tier claims of each class stay in
// `electrical-classes.spec.ts` / `electrical-classes-2.spec.ts` (both near the
// §4.5 cap); the E4.1c rows are pinned HERE through `sustainabilityClaims`,
// one `it()` per claim in the wrapper. `load_pct` on the DG set is the UPS's
// measured code re-used derived — one code, one meaning (kW ÷ rated kW).

const TRANSFORMER_E41C: readonly SustainabilityRow[] = [
  ["tap_changes_per_day", "delta({oltc_operation_count}, 24h)", ""],
];

/**
 * DG set — `availability_pct_24h` is the fault-sense form (`1 - avg` of the
 * `dg_shutdown` 0/1 state, Q11); `fuel_hours_remaining_h` refuses `non_finite`
 * on a stopped engine (`fuel_rate_lph` 0), counted; `starts_per_day` means a
 * rolling `24h` (Q10).
 */
const DG_SET_E41C: readonly SustainabilityRow[] = [
  ["load_pct", "{gen_kw} / $rated_kw * 100", "%"],
  ["fuel_hours_remaining_h", "{fuel_level_pct} / 100 * $tank_capacity_l / {fuel_rate_lph}", "h"],
  ["downtime_h_24h", "sum({dg_shutdown}, 24h)", "h"],
  ["availability_pct_24h", "(1 - avg({dg_shutdown}, 24h)) * 100", "%"],
  ["starts_per_day", "delta({start_count}, 24h)", ""],
];

/**
 * Solar PV — `performance_ratio_pct`'s denominator is `kWp × kWh/m²`: `sum` of
 * `W/m²` over hours `/ 1000` is `kWh/m²` (plan §3.7). `capacity_utilization_pct`
 * is instantaneous and keeps the ADR's name; `specific_yield_kwh_kwp_day` is a
 * rolling `24h` (Q10); `co2_avoided_kg_today` supersedes `co2_avoided_kg`.
 */
const SOLAR_PV_E41C: readonly SustainabilityRow[] = [
  ["co2_avoided_kg_today", "delta({energy_total_kwh}, today) * $grid_carbon_factor_kgco2_per_kwh", "kg"],
  ["performance_ratio_pct", "delta({energy_total_kwh}, today) / ($installed_kwp * sum({irradiance_wm2}, today) / 1000) * 100", "%"],
  ["specific_yield_kwh_kwp_day", "delta({energy_total_kwh}, 24h) / $installed_kwp", "kWh/kWp/day"],
  ["capacity_utilization_pct", "{ac_power_kw} / $installed_kwp * 100", "%"],
];

/** APFC — the "only class with no derived point at all" claim ends here. */
const APFC_E41C: readonly SustainabilityRow[] = [
  ["steps_per_day", "delta({step_operation_count}, 24h)", ""],
];

/** Every E4.1c class beside the feeder: `[code, rows, firstSortOrder, expectedVersion]`. */
export const E41C_ELECTRICAL_CLASSES: ReadonlyArray<readonly [string, readonly SustainabilityRow[], number, number]> = [
  ["electrical-transformer", TRANSFORMER_E41C, 30, 2],
  ["electrical-dg-set", DG_SET_E41C, 38, 2],
  ["electrical-solar-pv", SOLAR_PV_E41C, 26, 2],
  ["electrical-apfc", APFC_E41C, 14, 2],
];

export function e41cElectricalClaims(): ReadonlyArray<readonly [name: string, run: () => void]> {
  return E41C_ELECTRICAL_CLASSES.flatMap(([code, rows, first, version]) =>
    sustainabilityClaims(code, requireStockEntry(code), rows, first, version),
  );
}
