import { STOCK_ASSET_TEMPLATE_CATALOG } from "./stock-catalog";
import { assert, requireStockEntry } from "./stock-catalog.spec";

/**
 * `E5.2` Task 1 — **the deferral ledger, and the catalog's own entry list**,
 * lifted out of `stock-catalog.spec.ts` before that file crossed the AGENTS.md
 * §4.5 1000-line cap.
 *
 * The cut is by *kind*, not only by size. `stock-catalog.spec.ts` holds the
 * mechanism's claims — `checkEntry`, run over every catalog entry and over the
 * inline fixtures that prove those checks can fail. This file holds the one
 * claim that is about **what the pack chose not to author**: the tag lists name
 * derived codes this catalog deliberately does not ship, and a deferred code is
 * only a decision if something asserts it stayed deferred.
 *
 * **Why it had to move now rather than later.** `E5.1` §13 item 12 measured
 * `stock-catalog.spec.ts` at 978 lines and pre-authorised the split for the
 * pack that next crossed the cap. `E5.2` adds two `PACK_SOURCE_DOC` prefixes,
 * six `STOCK_ENTRY_CODES` and six `DEFERRED_DERIVED_CODES` lists with their
 * reason comments — roughly sixty lines, all of them on the deferral side. The
 * pre-commit guard reads the whole file, so the split is a precondition of the
 * pack and not a tidy-up after it.
 *
 * **The import direction is one-way and must stay that way.** This file imports
 * `assert` and `requireStockEntry` from `./stock-catalog.spec` and the catalog
 * itself from `./stock-catalog`; nothing in `stock-catalog.spec.ts` imports
 * anything from here. The three per-class transcription specs take
 * `DEFERRED_DERIVED_CODES` and `deferralReason` from this file.
 *
 * `stock-catalog-deferrals.test.ts` is the **name-sibling** wrapper —
 * `tests/repo-invariants.test.ts` pairs a spec with its wrapper by name, and a
 * spec run from a differently-named wrapper still executes but is absent from
 * coverage, which is the half the import cannot fix.
 */

/**
 * The six electrical classes of `docs/electrical-derived-taglist-v1.md`, then
 * the six water plant classes of `docs/e5.1-derived-taglist-v1.md` in ADR
 * 0040's ruled authoring order (STP, ETP, cooling tower, WTP, RO, softener) —
 * the order `water.ts` lists them in and the order `GET /stock` returns them —
 * then the six mechanical/utility machine classes of
 * `docs/e5.2-derived-taglist-v1.md` in **document order** (ADR 0053 decision 1),
 * which is the order `mechanical.ts` lists them in.
 *
 * **Two prefixes, one pack, one index.** `hvac-chiller` and `hvac-ahu` sit
 * between `mechanical-compressor` and `mechanical-boiler` because the tag list
 * puts §4 and §6 there, and ADR 0053 decision 2 files a chiller and an AHU
 * under the domain whose keys they already reuse. The list below is the
 * document's order, not the prefix's — do not "tidy" the two `hvac-` codes to
 * the end.
 *
 * **All eighteen are shipped since `E5.2` Task 11**, and the order claim below
 * is therefore full equality: the catalog's codes must equal this list exactly,
 * in this order. It was staged as a prefix comparison for the six commits pass
 * C took to author the mechanical entries one at a time — the `F2.12` / `E5.1`
 * bound-staging pattern applied to a list — and the boiler's commit deleted the
 * slice and the anti-vacuity floor together, because full equality against an
 * eighteen-element literal cannot go vacuous.
 */
const STOCK_ENTRY_CODES = [
  "electrical-feeder",
  "electrical-transformer",
  "electrical-dg-set",
  "electrical-ups",
  "electrical-solar-pv",
  "electrical-apfc",
  "water-stp",
  "water-etp",
  "water-cooling-tower",
  "water-wtp",
  "water-ro",
  "water-softener",
  "mechanical-pump",
  "mechanical-vfd",
  "mechanical-compressor",
  "hvac-chiller",
  "hvac-ahu",
  "mechanical-boiler",
] as const;
export type StockEntryCode = (typeof STOCK_ENTRY_CODES)[number];

/**
 * The tag list's "Derived:" codes that this row does **not** author, **per
 * entry** — ADR 0051 Amendment 6 decision 8: a code with no `bms-calc-v1`
 * formula is not vocabulary. Listed so the failure message names them and the
 * next author reads WHY rather than deleting the assertion.
 *
 * **A `Record` and not one flat list, and that is load-bearing.** `load_pct`
 * is deferred on the feeder, the transformer and the DG set — each needs the
 * asset's rating — and is a **measured core point on the UPS**, which reports
 * it directly (RFC 1628 `upsOutputPercentLoad`). A catalog-wide "no entry
 * declares a deferred code" check would therefore fail on a correct entry.
 * Each list is checked against its own entry and no other.
 *
 * **64 records across 59 distinct codes** since `E5.2` Task 5. The three halves
 * are 32 records over 30 codes (electrical — `load_pct` three times), 15 over 14
 * (water — `hydraulic_load_pct` on the STP and the ETP) and 17 over 17
 * (mechanical/HVAC — no code is deferred twice inside the pack). 30 + 14 + 17 is
 * 61, not 59, and the two-code difference is the whole reason this is a
 * `Record`:
 *
 *  - **`specific_energy_kwh_kl` is deferred on `electrical-feeder` AND on
 *    `water-ro`** — the same code for the same shape of reason on two packs —
 *    **and is AUTHORED as a derived point on `mechanical-pump`**, which declares
 *    both `kw` and `flow_klh`. One code, one meaning (*energy per kilolitre
 *    moved*), three entries. **The two deferral records stay**: they are claims
 *    about the feeder and the RO, and neither becomes authorable because a pump
 *    can compute it. This is the `load_pct` shape — deferred on three electrical
 *    classes and a measured core point on the UPS — and it is why a catalog-wide
 *    "no entry declares a deferred code" check would fail on correct entries.
 *  - **`availability_pct` is deferred on `electrical-dg-set` AND on
 *    `mechanical-pump`** — both need hours-in-state over a window, which the
 *    grammar has no state for. ADR 0053's Consequences name it as open for the
 *    N4 form; the pump's list does not become the DG set's when it lands.
 *
 * A per-entry sum and a distinct count are both right; they count different
 * things, and neither is derivable from the other.
 */
export const DEFERRED_DERIVED_CODES: Readonly<Record<StockEntryCode, readonly string[]>> = {
  // §1 — rating, contract demand, tariff band, production/KL, Σ of feeders.
  "electrical-feeder": [
    "load_pct",
    "demand_vs_contract_pct",
    "pf_penalty_flag",
    "kwh_per_unit_output",
    "specific_energy_kwh_kl",
    "losses_pct",
  ],
  // §2 — another asset's LV meter, the rating, and three models the grammar
  // has no functions for (IEC 60076-7, C57.91 ageing, a Duval-triangle lookup).
  "electrical-transformer": [
    "lv_load_pct",
    "load_pct",
    "hot_spot_estimate_c",
    "loss_of_life_pct_day",
    "duval_triangle_zone",
    "tap_changes_per_day",
  ],
  // §3 — the rating, the tank capacity (`fuel_level_pct` is a percentage), and
  // three that need a time window the grammar has no state for.
  "electrical-dg-set": [
    "load_pct",
    "fuel_hours_remaining_h",
    "starts_per_day",
    "availability_pct",
    "underload_hours",
  ],
  // §4 — the site minimum, an attribute, and two per-window counts.
  "electrical-ups": [
    "runtime_margin_min",
    "battery_events_per_month",
    "battery_age_months",
    "charge_cycle_count",
  ],
  // §5 — the point of connection is another asset's §1 meter; the rest need
  // installed kWp, the whole string set, the site load or an emission factor.
  "electrical-solar-pv": [
    "grid_export_kw",
    "performance_ratio_pct",
    "specific_yield_kwh_kwp_day",
    "capacity_utilization_pct",
    "string_current_deviation_pct",
    "self_consumption_pct",
    "co2_avoided_kg",
  ],
  // §6 — rated kVAr per step, a time window, `tan`/`acos`, and the tariff band.
  "electrical-apfc": ["pf_correction_kvar", "steps_per_day", "capacitor_health_pct", "pf_penalty_hours"],
  // The water pack — E5.1, docs/e5.1-derived-taglist-v1.md. Fifteen records
  // over fourteen codes; the seven the pack DOES author are in water.ts.
  //
  // §5 — a reuse meter §5 does not list; INFLUENT BOD and the aeration tank
  // volume; blower kWh where §5 declares motor current; the design capacity.
  "water-stp": ["reuse_pct", "fm_ratio", "specific_aeration_kwh_kl", "hydraulic_load_pct"],
  // §6 — the design capacity; the reagent strength; INFLUENT COD where §6
  // carries the outlet only; a recycle meter §6 does not list.
  "water-etp": ["hydraulic_load_pct", "neutralization_chem_gkl", "cod_removal_pct", "recycle_pct"],
  // §4 — an empirical evaporation factor that is unit-system- and
  // site-specific, and the tag list gives none.
  "water-cooling-tower": ["evaporation_loss_klh"],
  // §1 — the hypochlorite solution strength, a site attribute.
  "water-wtp": ["specific_chlorine_gkl"],
  // §2 — the HP pump's kW (§2 declares current), and a temperature correction
  // that is an exponential the grammar has no function for.
  "water-ro": ["specific_energy_kwh_kl", "normalized_permeate_flow"],
  // §3 — a restatement of a declared measured point; a time window; and the one
  // whose input can never receive a value at all (see DEFERRAL_REASON).
  "water-softener": ["throughput_since_regen_kl", "regen_frequency_per_day", "salt_efficiency_kg_kl"],
  // The mechanical/utility pack — E5.2, docs/e5.2-derived-taglist-v1.md.
  // Seventeen records over seventeen codes; the thirteen the pack DOES author
  // are listed with their formulas in mechanical.ts. Each list is its section's
  // "Derived:" prose line minus what that entry authors, and 13 + 17 = 30 is the
  // reconciliation that proves no named code was dropped.
  //
  // §1 — three time windows and a standard's lookup. `specific_energy_kwh_kl`
  // is NOT here: the pump declares kw and flow_klh and authors it.
  "mechanical-pump": [
    // run hours over ELAPSED hours — the grammar has no state.
    "duty_hours_pct",
    // per-hour rate; the short_cycling alarm binds start_count and says so.
    "starts_per_hour",
    // hours-in-state over a window; already deferred on electrical-dg-set.
    "availability_pct",
    // ISO 20816 zones A-D are per machine group and mounting — a lookup table.
    "vibration_band",
  ],
  // §2 — three asset attributes, one of them with a model behind it. The drive
  // reports frequency, current and torque; it does not report its nameplate.
  "mechanical-vfd": [
    // output current / RATED current.
    "motor_load_pct",
    // the affinity-law estimate needs a direct-on-line baseline the drive
    // never had — an attribute AND a model.
    "energy_saving_vs_dol_kwh",
    // output frequency / RATED frequency (50 or 60 Hz is a nameplate value, not
    // a constant to hardcode); vfd_speed_ref_pct already carries the COMMANDED
    // speed as a percentage, so this would also be a second code for it.
    "speed_pct",
  ],
  // §3 — a time window, and a test rather than a formula.
  "mechanical-compressor": [
    // load/unload transitions per hour.
    "unload_cycles_per_hour",
    // a no-demand pressure-decay test needs a window in which nothing draws
    // air — a METHOD the document names, not an expression over live points.
    "air_leak_estimate_pct",
  ],
  // §4 — a trend and an attribute. The five the chiller DOES author are the N4
  // form's KPIs (cooling_load_tr, kw_per_tr, cop, and the two delta-Ts).
  "hvac-chiller": [
    // a trend is a time window by definition.
    "approach_trend",
    // cooling load / RATED TR.
    "part_load_pct",
  ],
  // §6 — an attribute, a time window, and a meter §6 does not list.
  "hvac-ahu": [
    // the clean and dirty pressure-drop band is per filter class — an attribute.
    "filter_life_pct",
    // kWh per day is a window.
    "fan_energy_kwh_day",
    // needs CHW flow AT THE COIL, and §6 declares none; the AHU has the two
    // water temperatures and no flow, so the coil duty is not expressible.
    "cooling_delivered_kw",
  ],
  // §7 — a method with a loss model, the second data-model deferral in the
  // catalog, and a second code for a meaning already declared (plan §12 ruling
  // 3, which promoted excess_air_pct and deferred this one).
  "mechanical-boiler": [
    // IS 13979 / BS 845 indirect efficiency needs the fuel analysis (C, H,
    // moisture) — attributes — and a loss model the grammar cannot express.
    "efficiency_indirect_pct",
    // by TDS balance it PARSES over two declared measured points, and
    // blowdown_tds_ppm is an M row whose pattern is null forever — see
    // DEFERRAL_REASON, the salt_efficiency_kg_kl class, second instance.
    "blowdown_pct",
    // the reciprocal of the authored steam_to_fuel_ratio, times 1000 — the
    // throughput_since_regen_kl class, a second code for declared information.
    "specific_fuel_kg_ton_steam",
  ],
};

const DEFERRAL_REASON =
  "ADR 0051 Amendment 6 decision 8: a code with no formula is not vocabulary. Every deferred " +
  "code needs an asset or site attribute (rating, contract demand, tariff band, installed kWp, " +
  "tank capacity, rated kVAr per step), a value on another asset that bms-calc-v1 cannot name " +
  "(a Σ of feeders, an LV meter, the point of connection, the site load), a time window the " +
  "grammar has no state for (per-day, per-month, hours-in-state), or a model it has no " +
  "functions for (IEC 60076-7, C57.91, a Duval triangle). They are deferred and NAMED, never " +
  "authored with a placeholder formula (ADR 0036; F2.9 records the fork) — plan §2 carries the " +
  "reason for each one. E5.1's water pack adds TWO deferral classes the electrical pack had no " +
  "case of. (1) A REAGENT STRENGTH, which is a site attribute: specific_chlorine_gkl and " +
  "neutralization_chem_gkl both divide by litres per hour of a SOLUTION, and grams of chemical " +
  "per KL needs what the litres contain — the formula looks trivially expressible until you ask " +
  "that. (2) A LAB-ONLY INPUT WHOSE POINT COULD NEVER RECEIVE A VALUE: salt_efficiency_kg_kl " +
  "parses over two declared measured points, and one of them is an M row — sourceDataKeyPattern " +
  "is null forever, planAsset puts it in skippedPoints, so it never gets an asset_points row, " +
  "never gets a reading, and the formula never has an input. That is the only deferral in the " +
  "catalog whose reason is the DATA MODEL rather than the grammar, and it is the distinction " +
  "from oil_rise_over_ambient_c, whose X-tier input can be wired. It becomes authorable the day " +
  "F1.8 gives a manual row somewhere to write to. E5.2's mechanical/HVAC pack adds TWO more " +
  "classes, numbered on from those. (3) A STANDARD'S LOOKUP: vibration_band is ISO 20816's zones " +
  "A-D, and the zone boundaries are per machine group, power and mounting — an attribute TABLE, " +
  "and bms-calc-v1 has arithmetic and five functions with no lookup of any kind. (4) A METHOD THE " +
  "DOCUMENT ONLY NAMES: air_leak_estimate_pct is a no-demand pressure-decay TEST needing a window " +
  "in which nothing draws air, and efficiency_indirect_pct is the IS 13979 / BS 845 loss model " +
  "over a fuel analysis. Both are procedures whose inputs are not points; a formula authored for " +
  "either would compute a different quantity under the right name, which is worse than a named " +
  "deferral. E5.2 also adds the SECOND instance of the data-model class above: blowdown_pct " +
  "parses by TDS balance over feedwater_tds_ppm and blowdown_tds_ppm, and the second is an M row " +
  "whose sourceDataKeyPattern is null forever, so that formula never has an input either — same " +
  "reason as salt_efficiency_kg_kl, same remedy, and the pattern is now a class rather than an " +
  "anecdote.";

/** The shared reason plus the class's own list, so the failure names both. */
export const deferralReason = (code: StockEntryCode): string =>
  `${DEFERRAL_REASON} Deferred for ${code}: ${DEFERRED_DERIVED_CODES[code].join(", ")}.`;

/**
 * The feeder is the one entry whose deferral guard is a claim about the WHOLE
 * entry rather than about a list of codes: §1 authors no derived point at all
 * and no `content.kpis`. Restated here rather than imported, because
 * `stock-catalog.spec.ts` keeps its own `FEEDER_CODE` for the transcription
 * half of the feeder block that did not move — and typing it against
 * `StockEntryCode` makes a typo a compile error rather than a guard that runs
 * over an entry the catalog does not ship.
 */
const FEEDER_CODE: StockEntryCode = "electrical-feeder";

export function runStockCatalogDeferralTests(): void {
  // ---- the catalog ships exactly these entries, in this order -------------
  //
  // **New with the split, and it is a claim about the product rather than
  // about the code.** ADR 0053 decision 1 rules the pack order (document
  // order), `GET /admin/asset-templates/stock` returns the catalog array
  // unsorted, and the stock viewer renders it in that order — so the order IS
  // what a global administrator reads. Until now only the *presence* of a
  // feeder was asserted and `STOCK_ENTRY_CODES` was consulted only to print a
  // failure message, which made it a list nothing held to the catalog: a pack
  // index appended in the wrong place, or an entry silently dropped from a
  // spread, would have passed every check in this directory.
  //
  // **FULL EQUALITY since `E5.2` Task 11**, which is where the staging ended.
  // The claim compared the catalog against the HEAD of this list for the six
  // commits pass C took to author the mechanical entries one at a time — full
  // equality would have been red throughout, which is a bound that teaches the
  // next author to ignore a red test. The boiler's commit deleted the slice and
  // the `>= 12` anti-vacuity floor together: the floor existed because
  // `slice(0, 0)` equals an empty catalog, so a pack index dropped from the
  // spread would have passed the PREFIX claim while shipping nothing. Equality
  // against an eighteen-element literal has no such hole — an empty catalog
  // fails it by definition — so the floor is not owed and would only be a second
  // number to keep true.
  const codes = STOCK_ASSET_TEMPLATE_CATALOG.map((entry) => entry.code);
  assert(
    codes.join(",") === STOCK_ENTRY_CODES.join(","),
    "the catalog's codes must equal STOCK_ENTRY_CODES exactly, in order — the pack indexes are " +
      "spread into stock-catalog.ts in the order ADR 0040 ruling 2 (and, from E5.2, ADR 0053 " +
      "decision 1) sets, and that order reaches the client unchanged: GET " +
      "/admin/asset-templates/stock returns the array unsorted and the stock viewer renders it " +
      "as it arrives, so the order IS what a global administrator reads.\n  expected " +
      `${STOCK_ENTRY_CODES.join(", ")}\n  got      ${codes.join(", ")}`,
  );

  // ---- the deferred codes, per entry and never catalog-wide ---------------
  //
  // Deliberately NOT in `checkEntry`: each entry is checked against its OWN
  // list, because `load_pct` is deferred on three classes and a measured core
  // point on the UPS. An entry pass C has not authored yet is simply not
  // reached; its list is here so the day it lands it lands against this check.
  for (const entry of STOCK_ASSET_TEMPLATE_CATALOG) {
    // The reverse direction is the one that fails silently: a mistyped key
    // ("electrical-dgset") would leave that class checked against nothing,
    // forever, and nothing else in this file would notice.
    assert(
      Object.hasOwn(DEFERRED_DERIVED_CODES, entry.code),
      `${entry.code} has no entry in DEFERRED_DERIVED_CODES, so its deferred derived codes are ` +
        `checked against nothing. Add one — an empty list is a legitimate value, with a comment ` +
        `naming the row that will fill it. Known: ${STOCK_ENTRY_CODES.join(", ")}.`,
    );
    const deferred = DEFERRED_DERIVED_CODES[entry.code as StockEntryCode] ?? [];
    const keys = new Set(entry.points.map((point) => point.pointKey));
    for (const code of deferred) {
      assert(
        !keys.has(code),
        `${entry.code} declares "${code}", one of its deferred derived codes. ` +
          `${deferralReason(entry.code as StockEntryCode)}`,
      );
    }
  }

  // ---- the feeder's own guard: no derived point, no kpis ------------------

  const feeder = requireStockEntry(FEEDER_CODE);
  const derived = feeder.points.filter((point) => point.kind === "derived");
  assert(
    derived.length === 0,
    `${FEEDER_CODE} authors ${derived.length} derived point(s): ${derived.map((p) => p.pointKey).join(", ")}. ${DEFERRAL_REASON}`,
  );
  assert(
    !Object.hasOwn(feeder.content ?? {}, "kpis"),
    `${FEEDER_CODE} carries content.kpis. ${deferralReason(FEEDER_CODE)}`,
  );
}
