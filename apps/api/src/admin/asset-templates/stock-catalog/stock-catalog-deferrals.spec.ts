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
 * the order `water.ts` lists them in and the order `GET /stock` returns them.
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
 * **47 entries across 43 distinct codes** since `E5.1`. The electrical half is
 * 32 entries over 30 codes (`load_pct` three times); the water half is 15 over
 * 14 (`hydraulic_load_pct` on the STP and the ETP). 30 + 14 is 44, not 43,
 * because **`specific_energy_kwh_kl` is deferred on the electrical feeder AND
 * the RO skid** — the same code for the same reason on two packs, which is the
 * per-entry `Record`'s whole point. A per-entry sum and a distinct count are
 * both right; they count different things.
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
  "F1.8 gives a manual row somewhere to write to.";

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
  const codes = STOCK_ASSET_TEMPLATE_CATALOG.map((entry) => entry.code);
  assert(
    codes.join(",") === STOCK_ENTRY_CODES.join(","),
    "the catalog's codes must equal STOCK_ENTRY_CODES in order — the pack indexes are spread " +
      "into stock-catalog.ts in the order ADR 0040 ruling 2 (and, from E5.2, ADR 0053 decision " +
      "1) sets, and that order reaches the client unchanged.\n  expected " +
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
