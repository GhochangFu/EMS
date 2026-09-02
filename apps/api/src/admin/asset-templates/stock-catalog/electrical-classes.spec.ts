import {
  alarmsOf,
  assert,
  DEFERRED_DERIVED_CODES,
  deferralReason,
  kpisOf,
  maintenanceOf,
  requireStockEntry,
} from "./stock-catalog.spec";

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

/**
 * Every per-class block. Called by `stock-catalog.test.ts` beside
 * `runStockAssetTemplateCatalogTests` — one wrapper, two runners.
 */
export function runElectricalClassEntryTests(): void {
  checkTransformer();
}
