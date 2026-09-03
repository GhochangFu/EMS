import { DEFERRED_DERIVED_CODES, deferralReason } from "./stock-catalog-deferrals.spec";
import { alarmsOf, assert, kpisOf, maintenanceOf, requireStockEntry } from "./stock-catalog.spec";

/**
 * `F2.12` pass C, second half — the solar PV (§5) and APFC (§6) blocks.
 *
 * **A second file purely because of the §4.5 1000-line cap.** The four blocks
 * before these took `electrical-classes.spec.ts` to 959 lines, and two more
 * would have put it near 1200. There is no second *kind* of claim here: this
 * file and its sibling hold exactly the same thing — one block per tag-list
 * section, each assertion a claim about `docs/electrical-derived-taglist-v1.md`
 * rather than about the code — and the cut is at §5 only because that is where
 * the line budget ran out. If the two ever need to be read as one, they can be
 * concatenated with no edit.
 *
 * The generic claims (pair-absence, alarm bindings, the severity and category
 * vocabularies, the `meta.tier` iff rule, derived-point well-formedness, the
 * KPI two-way cross-check, the maintenance vocabularies, key-set equality with
 * the DTO) are **not** restated here either — `checkEntry` in
 * `stock-catalog.spec.ts` runs them over every entry the moment a class joins
 * the pack index.
 *
 * Both runners are called from the one `stock-catalog.test.ts` wrapper, so the
 * catalog still has a single Vitest entry point.
 */

const SOLAR_PV_CODE = "electrical-solar-pv";

/**
 * Tag list §5's 26 table rows **less `grid_export_kw`** (see the block below),
 * in the document's own order, then the one authored derived code — 26 keys,
 * `sortOrder` is the index.
 *
 * §5's table interleaves the tiers as §§3 and 4 do: `inv_event_code` (X) is
 * row 3, ahead of four C rows, and the six `ac_voltage_*` / `ac_current_*` X
 * rows sit between `ac_frequency_hz` (C) and `energy_total_kwh` (C).
 * Transcribed top to bottom from §5 and not from plan §5.4's tier grouping.
 */
const SOLAR_PV_POINT_KEYS: readonly string[] = [
  "inv_status",
  "inv_fault",
  "inv_event_code",
  "dc_voltage_v",
  "dc_current_a",
  "dc_power_kw",
  "ac_power_kw",
  "ac_kva",
  "ac_pf",
  "ac_frequency_hz",
  "ac_voltage_vry",
  "ac_voltage_vyb",
  "ac_voltage_vbr",
  "ac_current_ir",
  "ac_current_iy",
  "ac_current_ib",
  "energy_total_kwh",
  "energy_today_kwh",
  "cabinet_temp_c",
  "irradiance_wm2",
  "module_temp_c",
  "ambient_temp_c",
  "string_current_a",
  "insulation_resistance_kohm",
  "soiling_loss_pct",
  "inverter_efficiency_pct",
];

/**
 * §5's **seven** alarm bullets become seven rows by a route worth writing down,
 * because the arithmetic is not 1:1 in either direction: two bullets are
 * deferred (*PR low vs expected*, *string current deviation high* — each needs
 * a code the grammar cannot express), the *"grid voltage / frequency out of
 * band"* bullet splits into two, and `inverter_efficiency_low` is authored on
 * its own merits over the one §5 derived code that IS expressible.
 * 7 − 2 + 1 + 1 = 7.
 */
const SOLAR_PV_ALARM_CODES: readonly string[] = [
  "inverter_fault",
  "zero_output_with_irradiance",
  "inverter_efficiency_low",
  "cabinet_temp_high",
  "insulation_resistance_low",
  "grid_frequency_out_of_band",
  "grid_voltage_out_of_band",
];

/**
 * `electrical-solar-pv` against `docs/electrical-derived-taglist-v1.md` §5
 * (plan §5.4).
 */
function checkSolarPv(): void {
  const entry = requireStockEntry(SOLAR_PV_CODE);

  assert(
    entry.assetType === "solar_pv",
    `${SOLAR_PV_CODE}.assetType must be "solar_pv" (plan §12 ruling 3, and the repository's ` +
      `feeder / ro_skid / test_rig convention) — got "${entry.assetType}"`,
  );
  assert(
    entry.domain === "electrical",
    `${SOLAR_PV_CODE}.domain must be "electrical" — assertAssetDomain checks it against ` +
      `bms.asset_domains at import time; got "${entry.domain}"`,
  );
  assert(
    entry.stockVersion === 1,
    `${SOLAR_PV_CODE} is a first release — stockVersion 1, got ${String(entry.stockVersion)}`,
  );

  // ---- 26 points, 9 core + 15 extended + 1 manual + 1 derived ------------

  assert(
    entry.points.length === 26,
    `tag list §5 has 26 rows; one is not declared (grid_export_kw) and one derived code is ` +
      `authored, so the entry declares 26 points — got ${entry.points.length}`,
  );

  const tierCount = (tier: string): number =>
    entry.points.filter((point) => point.meta?.tier === tier).length;
  const derivedPoints = entry.points.filter((point) => point.kind === "derived");
  assert(
    tierCount("core") === 9,
    `§5 marks 8 rows tier C plus energy_today_kwh at C/D, which is authored MEASURED and core — ` +
      `9 core rows. The entry marks ${tierCount("core")}`,
  );
  assert(
    tierCount("extended") === 15,
    `§5 marks 15 rows tier X; the entry marks ${tierCount("extended")} extended`,
  );
  assert(
    tierCount("manual") === 1,
    `§5's one M row is soiling_loss_pct; the entry marks ${tierCount("manual")} manual`,
  );
  assert(
    derivedPoints.length === 1,
    `§5's seven derived codes reduce to one bms-calc-v1 can express ` +
      `(inverter_efficiency_pct); the entry authors ${derivedPoints.length}: ` +
      `${derivedPoints.map((point) => point.pointKey).join(", ")}`,
  );

  entry.points.forEach((point, index) => {
    assert(
      point.sortOrder === index,
      `${SOLAR_PV_CODE} points must be in the tag list's own order — ${point.pointKey} has ` +
        `sortOrder ${point.sortOrder} at index ${index}`,
    );
  });

  const declaredKeys = entry.points.map((point) => point.pointKey);
  assert(
    declaredKeys.join(",") === SOLAR_PV_POINT_KEYS.join(","),
    `${SOLAR_PV_CODE} declares the wrong keys or the wrong order. §5's table INTERLEAVES the ` +
      `tiers, so plan §5.4's core-then-extended grouping is not the order. Expected §5's table ` +
      `order:\n  ${SOLAR_PV_POINT_KEYS.join(", ")}\nGot:\n  ${declaredKeys.join(", ")}`,
  );

  const keySet = new Set(declaredKeys);
  assert(keySet.size === 26, `${SOLAR_PV_CODE}: no point key may repeat`);

  // ---- the one §5 row that is deliberately NOT declared -------------------

  assert(
    !keySet.has("grid_export_kw"),
    `${SOLAR_PV_CODE} declares grid_export_kw. §5 marks it in-table D and says in the row itself ` +
      'that it is measured "at the point of connection (§1 meter)" — a DIFFERENT asset, and ' +
      "bms-calc-v1 has no way to name a cross-asset value (plan §2). Net export on a site is the " +
      "incomer's or the export meter's own feeder/incomer template, beside this one. Do not " +
      '"complete" §5\'s table from the document.',
  );

  for (const code of DEFERRED_DERIVED_CODES[SOLAR_PV_CODE]) {
    assert(
      !keySet.has(code),
      `${SOLAR_PV_CODE} declares "${code}", one of §5's deferred derived codes. ` +
        `${deferralReason(SOLAR_PV_CODE)}`,
    );
  }

  // ---- the one authored formula, exactly as written ----------------------

  const efficiency = entry.points.find((point) => point.pointKey === "inverter_efficiency_pct");
  assert(
    efficiency?.formula === "{ac_power_kw} / {dc_power_kw} * 100",
    'inverter_efficiency_pct\'s formula must be exactly "{ac_power_kw} / {dc_power_kw} * 100" — ' +
      `got "${String(efficiency?.formula)}". It is UNDEFINED at night, when dc_power_kw is zero: ` +
      "evaluate.ts returns non_finite and the engine skips the reading, which is correct. Do not " +
      "add a clamp or a max(…, 0.001) guard — a fabricated denominator turns an inverter that is " +
      'asleep into an efficiency figure of 0 %, which reads as a fault. A "simplification" of a ' +
      "shipped formula is a silent behaviour change on every organization that imported it.",
  );
  assert(
    efficiency?.maxInputAgeSeconds === null,
    `inverter_efficiency_pct must take the default input age (null), got ` +
      `${String(efficiency?.maxInputAgeSeconds)} — the inverter publishes both DC and AC power on ` +
      "one SunSpec poll, unlike the transformer's slow site ambient sensor",
  );
  assert(
    efficiency !== undefined && efficiency.meta === undefined,
    "inverter_efficiency_pct must carry no meta.tier — the C/X/M column says what the plant has " +
      "FITTED, and a computed point is fitted by nobody",
  );

  // ---- the one manual row -------------------------------------------------

  const manualKeys = entry.points
    .filter((point) => point.meta?.tier === "manual")
    .map((point) => point.pointKey);
  assert(
    manualKeys.join(",") === "soiling_loss_pct",
    "§5's one M row is soiling_loss_pct — a soiling figure comes from a wash test or a soiling " +
      `station and reaches the platform through F1.8 / F1.9, never through a data key. Got: ` +
      `${manualKeys.join(", ") || "(none)"}`,
  );

  // ---- 7 alarms, every one a philosophy row -------------------------------

  const alarms = alarmsOf(entry);
  assert(
    alarms.length === 7,
    `§5's seven bullets become 7 rows, but not 1:1 — two are deferred (PR low vs expected, string ` +
      `current deviation high), the grid voltage/frequency bullet splits into two, and ` +
      `inverter_efficiency_low is authored over the one expressible derived code. ` +
      `7 − 2 + 1 + 1 = 7; the entry carries ${alarms.length}`,
  );
  assert(
    alarms.map((alarm) => alarm.code).join(",") === SOLAR_PV_ALARM_CODES.join(","),
    `${SOLAR_PV_CODE} alarm codes must be §5's, in order:\n  ${SOLAR_PV_ALARM_CODES.join(", ")}\n` +
      `Got:\n  ${alarms.map((alarm) => alarm.code).join(", ")}`,
  );

  const bindingOf = (code: string): string | undefined =>
    alarms.find((alarm) => alarm.code === code)?.pointKey;
  assert(
    bindingOf("inverter_efficiency_low") === "inverter_efficiency_pct",
    `the inverter_efficiency_low alarm must bind inverter_efficiency_pct; got ` +
      `${String(bindingOf("inverter_efficiency_low"))}. Binding a DERIVED point is legal — ` +
      "assertContentRefsResolve requires the key to be declared, not measured — and this is the " +
      "nearest expressible meaning to §5's two deferred alarm bullets. It is authored on its own " +
      "merits and is NOT a substitute for either: PR low needs installed kWp and string deviation " +
      "needs the whole string set, and neither is silently renamed into this row.",
  );
  for (const deferredCode of ["pr_low", "string_current_deviation_high"]) {
    assert(
      alarms.every((alarm) => alarm.code !== deferredCode),
      `${SOLAR_PV_CODE} carries a "${deferredCode}" alarm and cannot: performance_ratio_pct needs ` +
        "the installed kWp (an asset attribute) and string_current_deviation_pct needs the whole " +
        "set of string currents where §5 declares ONE string_current_a key. Both are deferred and " +
        "named. The two maintenance plans below are the practice that covers them until an " +
        "attribute model exists.",
    );
  }

  // ---- 1 KPI --------------------------------------------------------------

  const kpis = kpisOf(entry);
  assert(kpis.length === 1, `plan §5.4 authors 1 KPI; the entry carries ${kpis.length}`);
  assert(
    kpis[0]?.code === "module_temp_rise_c",
    `the one KPI must be module_temp_rise_c; got "${String(kpis[0]?.code)}"`,
  );
  assert(
    kpis[0]?.expression === "{module_temp_c} - {ambient_temp_c}",
    `module_temp_rise_c's expression must be exactly "{module_temp_c} - {ambient_temp_c}"; got ` +
      `"${String(kpis[0]?.expression)}"`,
  );

  // ---- 4 maintenance plans ------------------------------------------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.4 authors 4 maintenance plans; the entry carries ${plans.length}`);
  assert(
    plans.filter((plan) => plan.safetyCritical === true).length === 0,
    `no §5 plan is safetyCritical — array work is done with the inverter isolated, and none of ` +
      "these tasks removes a protection the asset provides the way the UPS discharge and bypass " +
      `transfer tests do. Got ${plans.filter((plan) => plan.safetyCritical === true).length}`,
  );

  for (const plan of plans) {
    assert(
      typeof plan.intervalDays === "number" && plan.intervalDays >= 1 && plan.intervalDays <= 730,
      `${SOLAR_PV_CODE} maintenance "${plan.title}" has intervalDays ${String(plan.intervalDays)} ` +
        "— templateMaintenancePlanSchema caps it at 730, so a 3- or 5-year task cannot be " +
        "authored here at all and must not be rounded into range",
    );
  }

  // ---- provenance ---------------------------------------------------------

  const description = entry.description ?? "";
  for (const needle of ["electrical-derived-taglist-v1.md", "§5", "PROVISIONAL"]) {
    assert(
      description.includes(needle),
      `${SOLAR_PV_CODE}.description must contain "${needle}" — the stamp plus the citation is the ` +
        "provenance (ADR 0052 decision 6), the section is what makes the citation checkable, and " +
        "PROVISIONAL is plan §12 ruling 1: this content is derived from published practice and is " +
        `not client-confirmed. Got: "${description}"`,
    );
  }
}

const APFC_CODE = "electrical-apfc";

/**
 * Tag list §6's 14 table rows, in the document's own order — the whole class,
 * with nothing undeclared and nothing derived. `sortOrder` is the index.
 *
 * §6's table interleaves the tiers too, and by only one row: `target_pf` (X) is
 * row 3, ahead of `actual_pf` and `steps_on_count` (both C). Plan §5.5 lists
 * them grouped core-then-extended, which describes the tiers and not the order.
 */
const APFC_POINT_KEYS: readonly string[] = [
  "apfc_status",
  "apfc_alarm",
  "target_pf",
  "actual_pf",
  "steps_on_count",
  "step_state",
  "kvar_connected",
  "kvar_required",
  "bus_voltage_v",
  "thd_v_pct",
  "panel_temp_c",
  "step_operation_count",
  "capacitor_current_a",
  "step_fault_state",
];

/**
 * §6's **six** alarm bullets, one row each — the second section after §3 whose
 * bullets map 1:1 onto rows.
 *
 * **The order is plan §5.5's and not §6's bullet order**, and the difference is
 * deliberate: §6 lists *PF below target · step fault · panel temperature high ·
 * THD high · over-compensation · switching rate high*, and the plan moves
 * `over_compensation` up beside `pf_below_target` so the two rows that bind
 * `actual_pf` sit together. The transformer entry took the same liberty with
 * §2's bullets. A bullet list is prose and carries no `sortOrder`; a table row
 * does, which is why point order is asserted against the document and alarm
 * order against the plan.
 */
const APFC_ALARM_CODES: readonly string[] = [
  "pf_below_target",
  "over_compensation",
  "step_fault",
  "panel_temp_high",
  "thd_high",
  "switching_rate_high",
];

/**
 * `electrical-apfc` against `docs/electrical-derived-taglist-v1.md` §6
 * (plan §5.5). The smallest entry in the row, and deliberately checked as hard
 * as the largest: 14 points, no manual rows, no derived points, and the one KPI
 * in the catalog that carries **no `unit` key at all**.
 */
function checkApfc(): void {
  const entry = requireStockEntry(APFC_CODE);

  assert(
    entry.assetType === "apfc",
    `${APFC_CODE}.assetType must be "apfc" (plan §12 ruling 3, and the repository's ` +
      `feeder / ro_skid / test_rig convention) — got "${entry.assetType}"`,
  );
  assert(
    entry.domain === "electrical",
    `${APFC_CODE}.domain must be "electrical" — assertAssetDomain checks it against ` +
      `bms.asset_domains at import time; got "${entry.domain}"`,
  );
  assert(
    entry.stockVersion === 1,
    `${APFC_CODE} is a first release — stockVersion 1, got ${String(entry.stockVersion)}`,
  );

  // ---- 14 points, 4 core + 10 extended + 0 manual + 0 derived -------------

  assert(
    entry.points.length === 14,
    `tag list §6 has 14 rows, all of them declared, and none of its four derived codes is ` +
      `expressible — 14 points. Got ${entry.points.length}`,
  );

  const tierCount = (tier: string): number =>
    entry.points.filter((point) => point.meta?.tier === tier).length;
  assert(tierCount("core") === 4, `§6 marks 4 rows tier C; the entry marks ${tierCount("core")} core`);
  assert(
    tierCount("extended") === 10,
    `§6 marks 10 rows tier X; the entry marks ${tierCount("extended")} extended`,
  );
  assert(
    tierCount("manual") === 0,
    `§6 has no M column entries — an APFC controller instruments every row it names. The entry ` +
      `marks ${tierCount("manual")} manual`,
  );
  assert(
    entry.points.every((point) => point.kind === "measured"),
    `${APFC_CODE} authors a derived point and must not: all four of §6's derived codes are ` +
      "deferred (rated kVAr per step, a time window, tan/acos, the tariff band), so this is the " +
      "one class in the row with no formula at all. " +
      `Got: ${entry.points.filter((point) => point.kind !== "measured").map((point) => point.pointKey).join(", ")}`,
  );

  entry.points.forEach((point, index) => {
    assert(
      point.sortOrder === index,
      `${APFC_CODE} points must be in the tag list's own order — ${point.pointKey} has ` +
        `sortOrder ${point.sortOrder} at index ${index}`,
    );
  });

  const declaredKeys = entry.points.map((point) => point.pointKey);
  assert(
    declaredKeys.join(",") === APFC_POINT_KEYS.join(","),
    `${APFC_CODE} declares the wrong keys or the wrong order. §6's table puts target_pf (X) at ` +
      `row 3, ahead of two C rows, so plan §5.5's core-then-extended grouping is not the order. ` +
      `Expected §6's table order:\n  ${APFC_POINT_KEYS.join(", ")}\nGot:\n  ${declaredKeys.join(", ")}`,
  );

  const keySet = new Set(declaredKeys);
  assert(keySet.size === 14, `${APFC_CODE}: no point key may repeat`);

  for (const code of DEFERRED_DERIVED_CODES[APFC_CODE]) {
    assert(
      !keySet.has(code),
      `${APFC_CODE} declares "${code}", one of §6's deferred derived codes. ` +
        `${deferralReason(APFC_CODE)}`,
    );
  }

  // ---- 6 alarms, two of them on the same point ---------------------------

  const alarms = alarmsOf(entry);
  assert(
    alarms.length === 6,
    `§6 carries six alarm bullets and every one of them becomes a row — nothing splits and ` +
      `nothing is deferred; the entry carries ${alarms.length}`,
  );
  assert(
    alarms.map((alarm) => alarm.code).join(",") === APFC_ALARM_CODES.join(","),
    `${APFC_CODE} alarm codes must be §6's, in plan §5.5's order (over_compensation moved up ` +
      `beside pf_below_target, the row it shares a point with):\n  ${APFC_ALARM_CODES.join(", ")}\n` +
      `Got:\n  ${alarms.map((alarm) => alarm.code).join(", ")}`,
  );

  const onActualPf = alarms.filter((alarm) => alarm.pointKey === "actual_pf").map((alarm) => alarm.code);
  assert(
    onActualPf.join(",") === "pf_below_target,over_compensation",
    "exactly two §6 alarms bind actual_pf — pf_below_target (lagging, the tariff penalty) and " +
      "over_compensation (leading, which some tariffs penalise as heavily). They are two meanings " +
      "at two bands on one point, exactly as the feeder binds voltage_vry twice for under- and " +
      `over-voltage. Got: ${onActualPf.join(", ") || "(none)"}`,
  );

  // ---- 1 KPI, and the missing `unit` is the assertion --------------------

  const kpis = kpisOf(entry);
  assert(kpis.length === 1, `plan §5.5 authors 1 KPI; the entry carries ${kpis.length}`);
  const pfGap = kpis[0];
  assert(pfGap?.code === "pf_gap", `the one KPI must be pf_gap; got "${String(pfGap?.code)}"`);
  assert(
    pfGap?.expression === "{target_pf} - {actual_pf}",
    `pf_gap's expression must be exactly "{target_pf} - {actual_pf}"; got ` +
      `"${String(pfGap?.expression)}". Negative means leading.`,
  );
  assert(
    pfGap !== undefined && !Object.hasOwn(pfGap, "unit"),
    "pf_gap must carry NO unit key at all — power factor is dimensionless, templateKpiSchema's " +
      "unit is optional, and omitting it is the honest encoding rather than an oversight. The " +
      'alternatives are both worse: "" is a unit nobody can render and "pf" is not a unit. This ' +
      "is asserted because an absent optional field looks exactly like a forgotten one, and the " +
      `next author would add it. Got: ${JSON.stringify(pfGap)}`,
  );

  // ---- 3 maintenance plans ------------------------------------------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 3, `plan §5.5 authors 3 maintenance plans; the entry carries ${plans.length}`);
  assert(
    plans.filter((plan) => plan.safetyCritical === true).length === 0,
    `no §6 plan is safetyCritical — capacitor work is done with the bank isolated and discharged, ` +
      "and none of these tasks removes a protection the asset provides the way the UPS discharge " +
      `and bypass transfer tests do. Got ${plans.filter((plan) => plan.safetyCritical === true).length}`,
  );

  for (const plan of plans) {
    assert(
      typeof plan.intervalDays === "number" && plan.intervalDays >= 1 && plan.intervalDays <= 730,
      `${APFC_CODE} maintenance "${plan.title}" has intervalDays ${String(plan.intervalDays)} — ` +
        "templateMaintenancePlanSchema caps it at 730, so a 3- or 5-year task cannot be authored " +
        "here at all and must not be rounded into range",
    );
  }

  // ---- provenance ---------------------------------------------------------

  const description = entry.description ?? "";
  for (const needle of ["electrical-derived-taglist-v1.md", "§6", "PROVISIONAL"]) {
    assert(
      description.includes(needle),
      `${APFC_CODE}.description must contain "${needle}" — the stamp plus the citation is the ` +
        "provenance (ADR 0052 decision 6), the section is what makes the citation checkable, and " +
        "PROVISIONAL is plan §12 ruling 1: this content is derived from published practice and is " +
        `not client-confirmed. Got: "${description}"`,
    );
  }
}

/**
 * Every per-class block in this file. Called by `stock-catalog.test.ts` beside
 * `runStockAssetTemplateCatalogTests` and `runElectricalClassEntryTests` — one
 * wrapper, three runners.
 */
export function runElectricalClassEntryTests2(): void {
  checkSolarPv();
  checkApfc();
}
