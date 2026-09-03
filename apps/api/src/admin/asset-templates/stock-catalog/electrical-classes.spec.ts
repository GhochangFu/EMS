import { DEFERRED_DERIVED_CODES, deferralReason } from "./stock-catalog-deferrals.spec";
import { alarmsOf, assert, kpisOf, maintenanceOf, requireStockEntry } from "./stock-catalog.spec";

/**
 * `F2.12` pass C — one block per electrical class, each assertion a claim about
 * `docs/electrical-derived-taglist-v1.md` rather than about the code. If the
 * tag list changes, these change with it, in the same PR.
 *
 * **A sibling file rather than more of `stock-catalog.spec.ts`.** That file was
 * at 820 lines against the §4.5 1000-line cap before this row, and five
 * per-class blocks add several hundred. The cut is by *kind* and not only by
 * size, which is why it is a clean one: `stock-catalog.spec.ts` holds the
 * mechanism's claims — `checkEntry`, run over every catalog entry and over the
 * inline fixtures, plus the fixtures that prove those checks can fail — and
 * this file holds the transcription claims, one block per tag-list section.
 * Both run from the one `stock-catalog.test.ts` wrapper, so the catalog still
 * has a single Vitest entry point.
 *
 * **The generic claims are deliberately NOT restated here.** Pair-absence, the
 * alarm binding, the severity and category vocabularies parsed out of `0030`
 * and `0029`, the `meta.tier` iff rule, derived-point well-formedness, the KPI
 * two-way `pointKeys` ↔ `{ref}` cross-check, the three maintenance
 * vocabularies and key-set equality with the DTO projection all run over every
 * entry from `checkEntry` the moment a class joins the pack index. What is here
 * is only what the tag list asserts and no schema can: the counts, the table
 * order, the rows a class does **not** declare, and the specific bindings the
 * plan reasoned about.
 */

const TRANSFORMER_CODE = "electrical-transformer";

/**
 * Tag list §2's 31 table rows minus the two this entry does not declare
 * (`lv_load_pct`, `dga_lab_result` — see the block below), in the table's own
 * order, then the one authored derived code. `sortOrder` is the index.
 */
const TRANSFORMER_POINT_KEYS: readonly string[] = [
  "top_oil_temp_c",
  "winding_temp_c",
  "winding_temp_r_c",
  "winding_temp_y_c",
  "winding_temp_b_c",
  "ambient_temp_c",
  "oil_level_pct",
  "oil_level_low",
  "buchholz_alarm",
  "buchholz_trip",
  "prv_operated",
  "oti_alarm",
  "oti_trip",
  "wti_alarm",
  "wti_trip",
  "tap_position",
  "oltc_in_progress",
  "oltc_operation_count",
  "cooling_fan_status",
  "cooling_pump_status",
  "dga_h2_ppm",
  "dga_c2h2_ppm",
  "dga_ch4_ppm",
  "dga_co_ppm",
  "oil_moisture_ppm",
  "oil_bdv_kv",
  "oil_moisture_lab_ppm",
  "silica_gel_state",
  "insulation_resistance_mohm",
  "oil_rise_over_ambient_c",
];

/**
 * §2's **eleven** alarm bullets — counted on the document; plan §5.1 says
 * twelve, and its own count of 15 rows is nonetheless right. Three alarm/trip
 * pairs split into six rows, `cooling fan/pump failure` into two, `DGA H₂ or
 * C₂H₂ rising` into two, plus five singles, less the deferred `overload`.
 */
const TRANSFORMER_ALARM_CODES: readonly string[] = [
  "oti_alarm",
  "oti_trip",
  "wti_alarm",
  "wti_trip",
  "buchholz_alarm",
  "buchholz_trip",
  "oil_level_low",
  "prv_operated",
  "cooling_failure",
  "cooling_pump_failure",
  "dga_h2_rising",
  "dga_c2h2_present",
  "oil_moisture_high",
  "oltc_operations_abnormal",
  "oil_bdv_low",
];

/** The four `M` rows of §2 this entry declares — `dga_lab_result` is the fifth. */
const TRANSFORMER_MANUAL_KEYS: readonly string[] = [
  "oil_bdv_kv",
  "oil_moisture_lab_ppm",
  "silica_gel_state",
  "insulation_resistance_mohm",
];

/**
 * `electrical-transformer` against `docs/electrical-derived-taglist-v1.md` §2
 * (plan §5.1). The hardest entry in the row and the first authored: four
 * tiers, the only `manual` rows, the only code the vocabulary excludes, and
 * the only class that cannot express its own headline number.
 */
function checkTransformer(): void {
  const entry = requireStockEntry(TRANSFORMER_CODE);

  assert(
    entry.assetType === "transformer",
    `${TRANSFORMER_CODE}.assetType must be "transformer" (plan §12 ruling 3, and the repository's ` +
      `feeder / ro_skid / test_rig convention) — got "${entry.assetType}"`,
  );
  assert(
    entry.domain === "electrical",
    `${TRANSFORMER_CODE}.domain must be "electrical" — assertAssetDomain checks it against ` +
      `bms.asset_domains at import time; got "${entry.domain}"`,
  );
  assert(
    entry.stockVersion === 1,
    `${TRANSFORMER_CODE} is a first release — stockVersion 1, got ${String(entry.stockVersion)}`,
  );

  // ---- 30 points, 9 core + 16 extended + 4 manual + 1 derived -------------

  assert(
    entry.points.length === 30,
    `tag list §2 has 31 rows; two are not declared (lv_load_pct, dga_lab_result) and one derived ` +
      `code is authored, so the entry declares 30 points — got ${entry.points.length}`,
  );

  const tierCount = (tier: string): number =>
    entry.points.filter((point) => point.meta?.tier === tier).length;
  const derivedPoints = entry.points.filter((point) => point.kind === "derived");
  assert(
    tierCount("core") === 9,
    `§2 marks 9 rows tier C; the entry marks ${tierCount("core")} core`,
  );
  assert(
    tierCount("extended") === 16,
    `§2 marks 16 rows tier X; the entry marks ${tierCount("extended")} extended`,
  );
  assert(
    tierCount("manual") === 4,
    `§2 marks 5 rows tier M and dga_lab_result is excluded, so 4 are declared manual; the entry ` +
      `marks ${tierCount("manual")}`,
  );
  assert(
    derivedPoints.length === 1,
    `§2 has exactly one expressible derived code (oil_rise_over_ambient_c); the entry authors ` +
      `${derivedPoints.length}: ${derivedPoints.map((point) => point.pointKey).join(", ")}`,
  );

  entry.points.forEach((point, index) => {
    assert(
      point.sortOrder === index,
      `${TRANSFORMER_CODE} points must be in the tag list's own order — ${point.pointKey} has ` +
        `sortOrder ${point.sortOrder} at index ${index}`,
    );
  });

  const declaredKeys = entry.points.map((point) => point.pointKey);
  assert(
    declaredKeys.join(",") === TRANSFORMER_POINT_KEYS.join(","),
    `${TRANSFORMER_CODE} declares the wrong keys or the wrong order. Expected §2's table order:\n` +
      `  ${TRANSFORMER_POINT_KEYS.join(", ")}\nGot:\n  ${declaredKeys.join(", ")}`,
  );

  const keySet = new Set(declaredKeys);
  assert(keySet.size === 30, `${TRANSFORMER_CODE}: no point key may repeat`);

  // ---- the two §2 rows that are deliberately NOT declared -----------------

  assert(
    !keySet.has("dga_lab_result"),
    `${TRANSFORMER_CODE} declares dga_lab_result. ADR 0051 Amendment 6 decision 7 EXCLUDED it ` +
      "from the vocabulary: its unit is text, and telemetry.point_values.value is a finite " +
      "double, so there is nothing for a lab summary string to be stored as. It is in no " +
      "*_POINT_KEYS array, so declaring it fails assertPointKeysActive at import and 0058's " +
      "foreign key at insert — on a customer's site, not here. It stays a lab record for F1.13 " +
      'or a maintenance note. Do not "complete" §2\'s table from the document.',
  );
  assert(
    !keySet.has("lv_load_pct"),
    `${TRANSFORMER_CODE} declares lv_load_pct. §2 marks it derived, and the LV-side load is ` +
      "measured by a §1 meter on ANOTHER asset — the transformer's LV feeder. bms-calc-v1 has no " +
      "way to name a cross-asset value (plan §2), and a transformer asset is §1 on its LV feeder " +
      "PLUS §2, which is where the loading figures live.",
  );

  // Its own deferral list, and only its own — `load_pct` is deferred here and
  // is a measured core point on the UPS. The catalog-wide loop in
  // `stock-catalog.spec.ts` makes the same check for every shipped entry; this
  // one states it as §2's claim, so the transformer block fails on its own
  // terms and names §2's six codes rather than a generic list.
  for (const code of DEFERRED_DERIVED_CODES[TRANSFORMER_CODE]) {
    assert(
      !keySet.has(code),
      `${TRANSFORMER_CODE} declares "${code}", one of §2's deferred derived codes. ` +
        `${deferralReason(TRANSFORMER_CODE)}`,
    );
  }

  // ---- the one authored formula, exactly as written ----------------------

  const oilRise = entry.points.find((point) => point.pointKey === "oil_rise_over_ambient_c");
  assert(
    oilRise !== undefined,
    `${TRANSFORMER_CODE} must author oil_rise_over_ambient_c — it is the one §2 derived code ` +
      "bms-calc-v1 can express, and ADR 0051 Amendment 6 decision 8 promoted it for that reason",
  );
  assert(
    oilRise?.kind === "derived",
    `oil_rise_over_ambient_c must be kind "derived", got "${String(oilRise?.kind)}"`,
  );
  assert(
    oilRise?.formula === "{top_oil_temp_c} - {ambient_temp_c}",
    "oil_rise_over_ambient_c's formula must be exactly \"{top_oil_temp_c} - {ambient_temp_c}\" — " +
      `got "${String(oilRise?.formula)}". A "simplification" of a shipped formula is a silent ` +
      "behaviour change on every organization that imported it, so it is asserted literally.",
  );
  assert(
    oilRise?.maxInputAgeSeconds === 3600,
    "oil_rise_over_ambient_c must carry maxInputAgeSeconds: 3600 (plan §4.2), got " +
      `${String(oilRise?.maxInputAgeSeconds)} — ambient_temp_c on a transformer is a slow-updating ` +
      "site sensor, and at DEFAULT_MAX_INPUT_AGE_SECONDS (300) the formula silently never fires, " +
      'which reads as "the feature is broken" and is the harder failure to diagnose',
  );
  assert(
    oilRise !== undefined && oilRise.meta === undefined,
    "oil_rise_over_ambient_c must carry no meta.tier — the C/X/M column says what the plant has " +
      "FITTED, and a computed point is fitted by nobody",
  );

  // ---- the four manual rows, the first `meta.tier: "manual"` anywhere -----

  const manualKeys = entry.points
    .filter((point) => point.meta?.tier === "manual")
    .map((point) => point.pointKey);
  assert(
    manualKeys.join(",") === TRANSFORMER_MANUAL_KEYS.join(","),
    `§2's declared M rows are ${TRANSFORMER_MANUAL_KEYS.join(", ")} — the lab and by-hand ` +
      `records that reach the platform through F1.8 / F1.9, never through a data key. Got: ` +
      `${manualKeys.join(", ") || "(none)"}`,
  );

  // ---- 15 alarms, every one a philosophy row -----------------------------

  const alarms = alarmsOf(entry);
  assert(
    alarms.length === 15,
    `§2's eleven bullets become 15 rows — three alarm/trip pairs split into six, cooling into ` +
      `two, DGA into two, five singles, less the deferred overload; ` +
      `the entry carries ${alarms.length}`,
  );
  assert(
    alarms.map((alarm) => alarm.code).join(",") === TRANSFORMER_ALARM_CODES.join(","),
    `${TRANSFORMER_CODE} alarm codes must be §2's, in order:\n  ` +
      `${TRANSFORMER_ALARM_CODES.join(", ")}\nGot:\n  ${alarms.map((alarm) => alarm.code).join(", ")}`,
  );

  const bindingOf = (code: string): string | undefined =>
    alarms.find((alarm) => alarm.code === code)?.pointKey;
  for (const [code, pointKey] of [
    ["cooling_failure", "cooling_fan_status"],
    ["dga_c2h2_present", "dga_c2h2_ppm"],
    ["oil_bdv_low", "oil_bdv_kv"],
  ] as const) {
    assert(
      bindingOf(code) === pointKey,
      `the ${code} alarm must bind ${pointKey}; got ${String(bindingOf(code))}. An alarm may only ` +
        "reference a key the same template declares (assertContentRefsResolve), and these three " +
        "are the bindings the plan reasoned about: the cooling row is the one §2 writes as " +
        '"cooling fan/pump failure WITH temperature rising" and binds the fan status the site ' +
        "pairs with top_oil_temp_c; oil_bdv_low binds an M row, which is legal because the check " +
        "requires the key to be declared, not required.",
    );
  }

  assert(
    alarms.every((alarm) => alarm.code !== "overload"),
    `${TRANSFORMER_CODE} carries an overload alarm, and it cannot: tag list §2 has NO current, ` +
      "kVA or kW row at all, so this class cannot express its own headline number — neither " +
      "page-9's Load 72% nor an overload condition — and unlike the feeder there is no current_a " +
      "to fall back on (the 2026-09-02 ruling 6). The asymmetry is in the source, not in the " +
      "code: §3 and §5 embed their own metering rows (gen_*, ac_*) and §2 does not, because a " +
      "transformer asset is §1 on its LV feeder PLUS §2. That is a v2 redline candidate for the " +
      "tag list. Do not add a row here to close it — add the LV feeder template beside the asset.",
  );

  // ---- 2 KPIs -------------------------------------------------------------

  const kpis = kpisOf(entry);
  assert(kpis.length === 2, `plan §5.1 authors 2 KPIs; the entry carries ${kpis.length}`);
  assert(
    kpis.map((kpi) => kpi.code).join(",") === "winding_to_oil_gradient_c,monitored_gas_sum_ppm",
    "the two KPIs must be winding_to_oil_gradient_c and monitored_gas_sum_ppm, in that order; got " +
      `${kpis.map((kpi) => kpi.code).join(", ") || "(none)"}`,
  );
  const gasSum = kpis.find((kpi) => kpi.code === "monitored_gas_sum_ppm");
  assert(
    typeof gasSum?.name === "string" && gasSum.name.includes("four of six"),
    'monitored_gas_sum_ppm\'s name must carry "four of six" — IEEE C57.104\'s total dissolved ' +
      "combustible gas is SIX gases and §2 monitors four (there is no C2H4 and no C2H6 row), so " +
      "a figure that looks like TDCG and is not is worse than no figure. The qualification is in " +
      `the name because that is what an operator reads. Got: "${String(gasSum?.name)}"`,
  );

  // ---- 5 maintenance plans ------------------------------------------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 5, `plan §5.1 authors 5 maintenance plans; the entry carries ${plans.length}`);

  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 1,
    `exactly one §2 plan is safetyCritical — the protection device function test; got ` +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}`,
  );
  const protectionTest = safetyCritical[0];
  assert(
    typeof protectionTest?.title === "string" && protectionTest.title.includes("Protection device"),
    "the one safetyCritical plan must be the protection device function test — proving the " +
      "Buchholz, PRV, OTI and WTI contacts operate is the task the eight protection alarms above " +
      `depend on. Got: "${String(protectionTest?.title)}"`,
  );
  assert(
    protectionTest?.category === "safety_critical",
    `the protection device function test must be category "safety_critical"; got ` +
      `"${String(protectionTest?.category)}"`,
  );

  for (const plan of plans) {
    assert(
      typeof plan.intervalDays === "number" && plan.intervalDays >= 1 && plan.intervalDays <= 730,
      `${TRANSFORMER_CODE} maintenance "${plan.title}" has intervalDays ` +
        `${String(plan.intervalDays)} — templateMaintenancePlanSchema caps it at 730, so a 3- or ` +
        "5-year task cannot be authored here at all and must not be rounded into range",
    );
  }

  // ---- provenance ---------------------------------------------------------
  //
  // `checkEntry` already requires the file name on every entry (ADR 0052
  // decision 6). §2 and the PROVISIONAL marking are this entry's own: plan §12
  // ruling 1 ships the maintenance plans and the KPI codes marked exactly as
  // the tag list marks itself, and the marking belongs where a reader of the
  // imported draft sees it, not only in the module docblock.
  const description = entry.description ?? "";
  for (const needle of ["electrical-derived-taglist-v1.md", "§2", "PROVISIONAL"]) {
    assert(
      description.includes(needle),
      `${TRANSFORMER_CODE}.description must contain "${needle}" — the stamp plus the citation is ` +
        "the provenance (ADR 0052 decision 6), the section is what makes the citation checkable, " +
        "and PROVISIONAL is plan §12 ruling 1: this content is derived from published practice " +
        `and is not client-confirmed. Got: "${description}"`,
    );
  }
}

const DG_SET_CODE = "electrical-dg-set";

/**
 * Tag list §3's **36 table rows, in the document's own order**, then the two
 * authored derived codes — 38 keys, `sortOrder` is the index.
 *
 * **Transcribed from the document top to bottom, not from plan §5.2's
 * core-then-extended grouping**, because §3's table interleaves the tiers:
 * `dg_alarm_code` (X) is row 6, ahead of `mains_available` (C); `oil_temp_c`
 * and `exhaust_temp_c` (X) sit between `coolant_temp_c` and `fuel_level_pct`
 * (both C). Reading the plan's grouping as an order would reorder 11 rows and
 * every one of them would still pass a count check.
 */
const DG_SET_POINT_KEYS: readonly string[] = [
  "dg_status",
  "dg_mode",
  "dg_on_load",
  "dg_alarm",
  "dg_shutdown",
  "dg_alarm_code",
  "mains_available",
  "engine_speed_rpm",
  "oil_pressure_bar",
  "coolant_temp_c",
  "oil_temp_c",
  "exhaust_temp_c",
  "fuel_level_pct",
  "bulk_fuel_level_pct",
  "fuel_rate_lph",
  "fuel_totalizer_l",
  "battery_v",
  "charger_alternator_v",
  "coolant_level_low",
  "run_hours_h",
  "start_count",
  "failed_start_count",
  "gen_voltage_vry",
  "gen_voltage_vyb",
  "gen_voltage_vbr",
  "gen_current_ir",
  "gen_current_iy",
  "gen_current_ib",
  "gen_frequency_hz",
  "gen_kw",
  "gen_kva",
  "gen_pf",
  "gen_kwh_total",
  "service_due_h",
  "emergency_stop_state",
  "canopy_temp_c",
  "specific_fuel_l_kwh",
  "unplanned_run_flag",
];

/**
 * §3's **thirteen** alarm bullets, one row each. §3 is the only section whose
 * bullets map 1:1 onto rows: nothing splits, nothing is deferred, and the
 * `overload` bullet survives here — unlike the transformer — because §3 embeds
 * its own `gen_kw` metering row.
 */
const DG_SET_ALARM_CODES: readonly string[] = [
  "shutdown",
  "fail_to_start",
  "oil_pressure_low",
  "coolant_temp_high",
  "overspeed",
  "fuel_level_low",
  "battery_voltage_low",
  "charger_fault",
  "overload",
  "frequency_out_of_band",
  "unplanned_run",
  "service_due",
  "emergency_stop",
];

/**
 * `electrical-dg-set` against `docs/electrical-derived-taglist-v1.md` §3
 * (plan §5.2). The largest entry in the row — 36 table rows — and the only one
 * that authors two derived codes.
 */
function checkDgSet(): void {
  const entry = requireStockEntry(DG_SET_CODE);

  assert(
    entry.assetType === "dg_set",
    `${DG_SET_CODE}.assetType must be "dg_set" (plan §12 ruling 3, and the repository's ` +
      `feeder / ro_skid / test_rig convention) — got "${entry.assetType}"`,
  );
  assert(
    entry.domain === "electrical",
    `${DG_SET_CODE}.domain must be "electrical" — assertAssetDomain checks it against ` +
      `bms.asset_domains at import time; got "${entry.domain}"`,
  );
  assert(
    entry.stockVersion === 1,
    `${DG_SET_CODE} is a first release — stockVersion 1, got ${String(entry.stockVersion)}`,
  );

  // ---- 38 points, 21 core + 15 extended + 0 manual + 2 derived ------------

  assert(
    entry.points.length === 38,
    `tag list §3 has 36 rows, all of them declared, plus the two derived codes bms-calc-v1 can ` +
      `express — 38 points. Got ${entry.points.length}`,
  );

  const tierCount = (tier: string): number =>
    entry.points.filter((point) => point.meta?.tier === tier).length;
  const derivedPoints = entry.points.filter((point) => point.kind === "derived");
  assert(tierCount("core") === 21, `§3 marks 21 rows tier C; the entry marks ${tierCount("core")} core`);
  assert(
    tierCount("extended") === 15,
    `§3 marks 15 rows tier X; the entry marks ${tierCount("extended")} extended`,
  );
  assert(
    tierCount("manual") === 0,
    `§3 has no M column entries at all — every row is instrumented by the controller. The entry ` +
      `marks ${tierCount("manual")} manual`,
  );
  assert(
    derivedPoints.length === 2,
    `§3's seven derived codes reduce to two bms-calc-v1 can express (specific_fuel_l_kwh, ` +
      `unplanned_run_flag); the entry authors ${derivedPoints.length}: ` +
      `${derivedPoints.map((point) => point.pointKey).join(", ")}`,
  );

  entry.points.forEach((point, index) => {
    assert(
      point.sortOrder === index,
      `${DG_SET_CODE} points must be in the tag list's own order — ${point.pointKey} has ` +
        `sortOrder ${point.sortOrder} at index ${index}`,
    );
  });

  const declaredKeys = entry.points.map((point) => point.pointKey);
  assert(
    declaredKeys.join(",") === DG_SET_POINT_KEYS.join(","),
    `${DG_SET_CODE} declares the wrong keys or the wrong order. §3's table INTERLEAVES the tiers, ` +
      `so plan §5.2's core-then-extended grouping is not the order. Expected §3's table order:\n` +
      `  ${DG_SET_POINT_KEYS.join(", ")}\nGot:\n  ${declaredKeys.join(", ")}`,
  );

  const keySet = new Set(declaredKeys);
  assert(keySet.size === 38, `${DG_SET_CODE}: no point key may repeat`);

  for (const code of DEFERRED_DERIVED_CODES[DG_SET_CODE]) {
    assert(
      !keySet.has(code),
      `${DG_SET_CODE} declares "${code}", one of §3's deferred derived codes. ` +
        `${deferralReason(DG_SET_CODE)}`,
    );
  }

  // ---- the two authored formulas, exactly as written ----------------------

  const formulaOf = (pointKey: string): string | undefined =>
    entry.points.find((point) => point.pointKey === pointKey)?.formula ?? undefined;
  for (const [pointKey, formula] of [
    ["specific_fuel_l_kwh", "{fuel_rate_lph} / {gen_kw}"],
    ["unplanned_run_flag", "{dg_status} * {mains_available}"],
  ] as const) {
    assert(
      formulaOf(pointKey) === formula,
      `${pointKey}'s formula must be exactly "${formula}" — got "${String(formulaOf(pointKey))}". A ` +
        '"simplification" of a shipped formula is a silent behaviour change on every organization ' +
        "that imported it, so it is asserted literally. specific_fuel_l_kwh is UNDEFINED at zero " +
        "output (the set running unloaded): evaluate.ts returns non_finite and skips the reading, " +
        "which is correct — a clamp or a max(…, 0.001) guard would turn no data into a plausible " +
        "number. unplanned_run_flag is a boolean AND written as a product of two 0/1 codes, which " +
        "is the only way this grammar has of writing one.",
    );
  }
  for (const point of derivedPoints) {
    assert(
      point.maxInputAgeSeconds === null,
      `${point.pointKey} must take the default input age (null), got ` +
        `${String(point.maxInputAgeSeconds)} — both §3 formulas read points the AMF controller ` +
        "publishes on one scan, unlike the transformer's site ambient sensor",
    );
    assert(
      point.meta === undefined,
      `${point.pointKey} must carry no meta.tier — the C/X/M column says what the plant has ` +
        "FITTED, and a computed point is fitted by nobody",
    );
  }

  // ---- 13 alarms, every one a philosophy row ------------------------------

  const alarms = alarmsOf(entry);
  assert(
    alarms.length === 13,
    `§3 carries thirteen alarm bullets and every one of them becomes a row — nothing splits and ` +
      `nothing is deferred; the entry carries ${alarms.length}`,
  );
  assert(
    alarms.map((alarm) => alarm.code).join(",") === DG_SET_ALARM_CODES.join(","),
    `${DG_SET_CODE} alarm codes must be §3's, in order:\n  ${DG_SET_ALARM_CODES.join(", ")}\nGot:\n` +
      `  ${alarms.map((alarm) => alarm.code).join(", ")}`,
  );

  const bindingOf = (code: string): string | undefined =>
    alarms.find((alarm) => alarm.code === code)?.pointKey;
  assert(
    bindingOf("overload") === "gen_kw",
    `the overload alarm must bind gen_kw, not load_pct; got ${String(bindingOf("overload"))}. This ` +
      "is the same ruling the feeder took on 2026-09-02 for the same reason: load_pct = kW ÷ " +
      "rating, the rating is an asset attribute bms-calc-v1 cannot read, and load_pct is therefore " +
      "on §3's deferred list. Unlike the transformer, §3 does embed a metering row to bind.",
  );
  assert(
    bindingOf("unplanned_run") === "unplanned_run_flag",
    `the unplanned_run alarm must bind unplanned_run_flag; got ` +
      `${String(bindingOf("unplanned_run"))}. This binding is WHY unplanned_run_flag is a point and ` +
      "not a KPI: an alarm binds a pointKey, so without the derived point §3's " +
      '"DG running with mains available" bullet has no parameter to bind to at all.',
  );

  // ---- 1 KPI --------------------------------------------------------------

  const kpis = kpisOf(entry);
  assert(kpis.length === 1, `plan §5.2 authors 1 KPI; the entry carries ${kpis.length}`);
  assert(
    kpis[0]?.code === "failed_start_ratio_pct",
    `the one KPI must be failed_start_ratio_pct; got "${String(kpis[0]?.code)}"`,
  );
  assert(
    !alarms.some((alarm) => alarm.pointKey === "start_count"),
    `${DG_SET_CODE} binds an alarm to start_count. failed_start_count and start_count are both ` +
      "LIFETIME counters, so failed_start_ratio_pct is a lifetime ratio and not a rate — which is " +
      "exactly why it is a KPI and never an alarm. The fail_to_start alarm binds " +
      "failed_start_count, whose rise is the event; the ratio is a trend an operator reads.",
  );

  // ---- 5 maintenance plans ------------------------------------------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 5, `plan §5.2 authors 5 maintenance plans; the entry carries ${plans.length}`);
  assert(
    plans.filter((plan) => plan.safetyCritical === true).length === 0,
    `no §3 plan is safetyCritical — a DG service is routine engine work, not a task that puts the ` +
      "load at risk the way the UPS discharge and bypass transfer tests do. Got " +
      `${plans.filter((plan) => plan.safetyCritical === true).length}`,
  );

  const engineService = plans.find((plan) => plan.category === "runtime_based");
  assert(
    engineService !== undefined && engineService.generationMode === "runtime",
    `${DG_SET_CODE} must carry exactly one runtime_based plan generated in "runtime" mode — the ` +
      "engine service, due every 250 run hours (run_hours_h) OR six months, whichever comes " +
      "first. Got category/mode " +
      `${String(engineService?.category)}/${String(engineService?.generationMode)}. Its intervalDays ` +
      "is the calendar backstop templateMaintenancePlanSchema requires; a runtime plan still needs " +
      "one, and dropping it to \"calendar\" loses the OEM interval this class is scheduled on.",
  );

  for (const plan of plans) {
    assert(
      typeof plan.intervalDays === "number" && plan.intervalDays >= 1 && plan.intervalDays <= 730,
      `${DG_SET_CODE} maintenance "${plan.title}" has intervalDays ${String(plan.intervalDays)} — ` +
        "templateMaintenancePlanSchema caps it at 730, so a 3- or 5-year task cannot be authored " +
        "here at all and must not be rounded into range",
    );
  }

  // ---- provenance ---------------------------------------------------------

  const description = entry.description ?? "";
  for (const needle of ["electrical-derived-taglist-v1.md", "§3", "PROVISIONAL"]) {
    assert(
      description.includes(needle),
      `${DG_SET_CODE}.description must contain "${needle}" — the stamp plus the citation is the ` +
        "provenance (ADR 0052 decision 6), the section is what makes the citation checkable, and " +
        "PROVISIONAL is plan §12 ruling 1: this content is derived from published practice and is " +
        `not client-confirmed. Got: "${description}"`,
    );
  }
}

const UPS_CODE = "electrical-ups";

/**
 * Tag list §4's **29 table rows, in the document's own order**, then the two
 * authored derived codes — 31 keys, `sortOrder` is the index. §4's table
 * interleaves the tiers too: `ups_alarm_code` (X) is row 3, ahead of
 * `on_battery` (C), and the six `X` metering rows sit between C rows.
 * Transcribed top to bottom from §4 and not from plan §5.3's tier grouping.
 */
const UPS_POINT_KEYS: readonly string[] = [
  "ups_status",
  "ups_alarm",
  "ups_alarm_code",
  "on_battery",
  "on_bypass",
  "input_voltage_v",
  "input_frequency_hz",
  "output_voltage_v",
  "output_freq_hz",
  "output_current_a",
  "output_kw",
  "output_kva",
  "load_pct",
  "battery_v",
  "battery_current_a",
  "battery_temp_c",
  "battery_charge_pct",
  "backup_min",
  "battery_time_on_s",
  "battery_replace_flag",
  "battery_last_test",
  "health_pct",
  "rectifier_ok",
  "inverter_ok",
  "fan_ok",
  "ambient_temp_c",
  "cell_voltage_min_v",
  "cell_voltage_max_v",
  "impedance_test_result",
  "load_headroom_pct",
  "cell_voltage_spread_v",
];

/**
 * §4's **nine** alarm bullets become **twelve** rows: *"battery replace /
 * self-test failed"* splits into two and *"rectifier / inverter / fan fault"*
 * into three — six different failures with six different responses, each
 * binding a different declared point. 9 + 1 + 2 = 12.
 *
 * **Plan §5.3's header says 11 and its own table lists these twelve codes.**
 * Its derivation sentence counted only the rectifier/inverter/fan split and
 * missed the battery one, so the header is an arithmetic slip and the table is
 * right — the same class of prose slip Task 4 found in §5.1. The row content
 * decides: `battery_replace_flag` and `battery_last_test` are two declared
 * points, and collapsing them would leave one of them bound by nothing.
 */
const UPS_ALARM_CODES: readonly string[] = [
  "on_battery",
  "low_runtime",
  "on_bypass",
  "overload",
  "battery_temp_high",
  "battery_replace",
  "battery_self_test_failed",
  "rectifier_fault",
  "inverter_fault",
  "fan_fault",
  "input_voltage_out_of_range",
  "cell_voltage_spread_high",
];

/**
 * `electrical-ups` against `docs/electrical-derived-taglist-v1.md` §4
 * (plan §5.3). The only entry in the row that ships **no** `content.kpis` key,
 * and the only one carrying a point key the source document does not name.
 */
function checkUps(): void {
  const entry = requireStockEntry(UPS_CODE);

  assert(
    entry.assetType === "ups",
    `${UPS_CODE}.assetType must be "ups" (plan §12 ruling 3, and the repository's ` +
      `feeder / ro_skid / test_rig convention) — got "${entry.assetType}"`,
  );
  assert(
    entry.domain === "electrical",
    `${UPS_CODE}.domain must be "electrical" — assertAssetDomain checks it against ` +
      `bms.asset_domains at import time; got "${entry.domain}"`,
  );
  assert(
    entry.stockVersion === 1,
    `${UPS_CODE} is a first release — stockVersion 1, got ${String(entry.stockVersion)}`,
  );

  // ---- 31 points, 12 core + 16 extended + 1 manual + 2 derived ------------

  assert(
    entry.points.length === 31,
    `tag list §4 has 29 rows, all of them declared, plus the two derived codes bms-calc-v1 can ` +
      `express — 31 points (plan §12 ruling 2's count). Got ${entry.points.length}`,
  );

  const tierCount = (tier: string): number =>
    entry.points.filter((point) => point.meta?.tier === tier).length;
  const derivedPoints = entry.points.filter((point) => point.kind === "derived");
  assert(tierCount("core") === 12, `§4 marks 12 rows tier C; the entry marks ${tierCount("core")} core`);
  assert(
    tierCount("extended") === 16,
    `§4 marks 16 rows tier X — the sixteenth is health_pct, tier X/D, authored MEASURED because ` +
      "the vendor supplies it where it exists and no bms-calc-v1 formula reconstructs it (the " +
      `same ruling kwh_today took on the feeder). The entry marks ${tierCount("extended")} extended`,
  );
  assert(
    tierCount("manual") === 1,
    `§4's one M row is impedance_test_result; the entry marks ${tierCount("manual")} manual`,
  );
  assert(
    derivedPoints.length === 2,
    `§4's five derived codes reduce to one bms-calc-v1 can express (load_headroom_pct), plus ` +
      `cell_voltage_spread_v which plan §12 ruling 2 promoted; the entry authors ` +
      `${derivedPoints.length}: ${derivedPoints.map((point) => point.pointKey).join(", ")}`,
  );

  entry.points.forEach((point, index) => {
    assert(
      point.sortOrder === index,
      `${UPS_CODE} points must be in the tag list's own order — ${point.pointKey} has ` +
        `sortOrder ${point.sortOrder} at index ${index}`,
    );
  });

  const declaredKeys = entry.points.map((point) => point.pointKey);
  assert(
    declaredKeys.join(",") === UPS_POINT_KEYS.join(","),
    `${UPS_CODE} declares the wrong keys or the wrong order. §4's table INTERLEAVES the tiers, so ` +
      `plan §5.3's core-then-extended grouping is not the order. Expected §4's table order:\n` +
      `  ${UPS_POINT_KEYS.join(", ")}\nGot:\n  ${declaredKeys.join(", ")}`,
  );

  const keySet = new Set(declaredKeys);
  assert(keySet.size === 31, `${UPS_CODE}: no point key may repeat`);

  for (const code of DEFERRED_DERIVED_CODES[UPS_CODE]) {
    assert(
      !keySet.has(code),
      `${UPS_CODE} declares "${code}", one of §4's deferred derived codes. ` +
        `${deferralReason(UPS_CODE)}`,
    );
  }

  // `load_pct` is on the feeder's, the transformer's and the DG's deferral
  // lists and is a MEASURED CORE point here — RFC 1628 reports
  // upsOutputPercentLoad directly, so this class needs no rating attribute.
  // That asymmetry is exactly why DEFERRED_DERIVED_CODES is a per-entry Record.
  const loadPct = entry.points.find((point) => point.pointKey === "load_pct");
  assert(
    loadPct?.kind === "measured" && loadPct.required === true,
    `${UPS_CODE} must declare load_pct as a required MEASURED point — a UPS reports it directly ` +
      "(RFC 1628 upsOutputPercentLoad), unlike a feeder, a transformer or a DG set, where the " +
      `same code needs the rating attribute and is deferred. Got kind="${String(loadPct?.kind)}", ` +
      `required=${String(loadPct?.required)}`,
  );

  // ---- the two authored formulas, exactly as written ----------------------

  const formulaOf = (pointKey: string): string | undefined =>
    entry.points.find((point) => point.pointKey === pointKey)?.formula ?? undefined;
  for (const [pointKey, formula] of [
    ["load_headroom_pct", "100 - {load_pct}"],
    ["cell_voltage_spread_v", "{cell_voltage_max_v} - {cell_voltage_min_v}"],
  ] as const) {
    assert(
      formulaOf(pointKey) === formula,
      `${pointKey}'s formula must be exactly "${formula}" — got "${String(formulaOf(pointKey))}". A ` +
        '"simplification" of a shipped formula is a silent behaviour change on every organization ' +
        "that imported it, so it is asserted literally.",
    );
  }
  for (const point of derivedPoints) {
    assert(
      point.maxInputAgeSeconds === null,
      `${point.pointKey} must take the default input age (null), got ` +
        `${String(point.maxInputAgeSeconds)} — both §4 formulas read points the UPS itself ` +
        "publishes on one poll",
    );
    assert(
      point.meta === undefined,
      `${point.pointKey} must carry no meta.tier — the C/X/M column says what the plant has ` +
        "FITTED, and a computed point is fitted by nobody",
    );
  }

  // ---- the one manual row -------------------------------------------------

  const manualKeys = entry.points
    .filter((point) => point.meta?.tier === "manual")
    .map((point) => point.pointKey);
  assert(
    manualKeys.join(",") === "impedance_test_result",
    "§4's one M row is impedance_test_result — a battery impedance or conductance survey reaches " +
      `the platform through F1.8 / F1.9, never through a data key. Got: ${manualKeys.join(", ") || "(none)"}`,
  );

  // ---- 12 alarms, every one a philosophy row ------------------------------

  const alarms = alarmsOf(entry);
  assert(
    alarms.length === 12,
    `§4's nine alarm bullets become 12 rows: "battery replace / self-test failed" splits into two ` +
      `and "rectifier / inverter / fan fault" into three. Plan §5.3's header says 11 and its own ` +
      `table lists 12 — the header missed the battery split. The entry carries ${alarms.length}`,
  );
  assert(
    alarms.map((alarm) => alarm.code).join(",") === UPS_ALARM_CODES.join(","),
    `${UPS_CODE} alarm codes must be §4's, in order:\n  ${UPS_ALARM_CODES.join(", ")}\nGot:\n` +
      `  ${alarms.map((alarm) => alarm.code).join(", ")}`,
  );

  const bindingOf = (code: string): string | undefined =>
    alarms.find((alarm) => alarm.code === code)?.pointKey;
  assert(
    bindingOf("overload") === "load_pct",
    `the overload alarm must bind load_pct directly; got ${String(bindingOf("overload"))}. This is ` +
      "the one class where it can: a UPS reports its own percentage load, so unlike the feeder " +
      "(which binds current_a) and the DG (gen_kw) this entry needs no rating attribute.",
  );
  assert(
    bindingOf("cell_voltage_spread_high") === "cell_voltage_spread_v",
    `the cell_voltage_spread_high alarm must bind cell_voltage_spread_v; got ` +
      `${String(bindingOf("cell_voltage_spread_high"))}. §4's prose derived list names NO spread ` +
      "code — this is the one point key in the row the tag list did not name, promoted by the " +
      "owner at the plan gate (plan §12 ruling 2) precisely so the weak-block alarm binds a " +
      "parameter of its own. An alarm whose parameter is not a point is an alarm nobody can " +
      "rationalize. Asked rather than assumed, because a point key is seeded, foreign-keyed by " +
      "0058 and permanent.",
  );
  assert(
    bindingOf("battery_replace") === "battery_replace_flag" &&
      bindingOf("battery_self_test_failed") === "battery_last_test",
    "§4's one battery-replace bullet becomes two rows because it names two declared points with " +
      "two different responses: battery_replace_flag (order a battery) and battery_last_test " +
      `(investigate the test). Got ${String(bindingOf("battery_replace"))} and ` +
      `${String(bindingOf("battery_self_test_failed"))}`,
  );

  // ---- NO KPIs, and the key itself must be absent -------------------------

  assert(
    !Object.hasOwn(entry.content ?? {}, "kpis"),
    `${UPS_CODE} carries a content.kpis key and must not. The spread was planned as a ` +
      "battery_cell_spread_v KPI; plan §12 ruling 2 made it a POINT, and a KPI restating a " +
      "declared point is redundant. The key is asserted ABSENT rather than empty because an " +
      "empty array passes a length check while still shipping a promise of content — the same " +
      "deferral guard the feeder carries.",
  );
  assert(kpisOf(entry).length === 0, `${UPS_CODE} must carry no KPI (plan §5.3)`);

  // ---- 4 maintenance plans, two of them safetyCritical --------------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.3 authors 4 maintenance plans; the entry carries ${plans.length}`);

  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 2,
    `exactly two §4 plans are safetyCritical — the battery autonomy (discharge) test and the ` +
      `bypass transfer test, the two tasks that put the load at risk while they run. Got ` +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}`,
  );
  for (const needle of ["discharge", "Bypass transfer"]) {
    assert(
      safetyCritical.some((plan) => typeof plan.title === "string" && plan.title.includes(needle)),
      `no safetyCritical §4 plan mentions "${needle}". During the discharge test the load is on ` +
        "battery for the duration; during the bypass transfer test it is unprotected. Both are " +
        "planned work that removes the protection the asset exists to provide, which is what " +
        `safetyCritical means here. Got: ${safetyCritical.map((plan) => plan.title).join("; ")}`,
    );
  }

  for (const plan of plans) {
    assert(
      typeof plan.intervalDays === "number" && plan.intervalDays >= 1 && plan.intervalDays <= 730,
      `${UPS_CODE} maintenance "${plan.title}" has intervalDays ${String(plan.intervalDays)} — ` +
        "templateMaintenancePlanSchema caps it at 730, so a 3- or 5-year task cannot be authored " +
        "here at all and must not be rounded into range",
    );
  }

  // ---- provenance ---------------------------------------------------------

  const description = entry.description ?? "";
  for (const needle of ["electrical-derived-taglist-v1.md", "§4", "PROVISIONAL"]) {
    assert(
      description.includes(needle),
      `${UPS_CODE}.description must contain "${needle}" — the stamp plus the citation is the ` +
        "provenance (ADR 0052 decision 6), the section is what makes the citation checkable, and " +
        "PROVISIONAL is plan §12 ruling 1: this content is derived from published practice and is " +
        `not client-confirmed. Got: "${description}"`,
    );
  }
}

/**
 * Every per-class block. Called by `stock-catalog.test.ts` beside
 * `runStockAssetTemplateCatalogTests` — one wrapper, two runners.
 */
export function runElectricalClassEntryTests(): void {
  checkTransformer();
  checkDgSet();
  checkUps();
}
