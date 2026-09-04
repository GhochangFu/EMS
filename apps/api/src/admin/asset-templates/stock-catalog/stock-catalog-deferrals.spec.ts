import { STOCK_ASSET_TEMPLATE_CATALOG } from "./stock-catalog";
import { assert, ENTRY_SOURCE_DOC, requireStockEntry } from "./stock-catalog.spec";

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
 * then the facility/smart-building classes of
 * `docs/e5.3-derived-taglist-v1.md`, also in document order (ADR 0054
 * decision 1) — the orders `mechanical.ts` and `facility.ts` list them in.
 *
 * **Two prefixes, one pack, one index.** `hvac-chiller` and `hvac-ahu` sit
 * between `mechanical-compressor` and `mechanical-boiler` because the tag list
 * puts §4 and §6 there, and ADR 0053 decision 2 files a chiller and an AHU
 * under the domain whose keys they already reuse. The list below is the
 * document's order, not the prefix's — do not "tidy" the two `hvac-` codes to
 * the end.
 *
 * **THREE prefixes in the facility pack, and the same rule.**
 * `environment-iaq-node` is §6 of the `E5.3` document and sits between
 * `facility-parking-level` and `facility-bas-gateway` for that reason alone
 * (ADR 0054 decision 2 files an indoor-air-quality node under `environment`,
 * whose vocabulary already holds its temperature and humidity keys). PR 2
 * appends `mechanical-lift` (§8a) and `mechanical-escalator` (§8b) at the end —
 * again in document order, not prefix order, and **a third prefix in one pack**:
 * `PACK_SOURCE_DOC` cannot express it, so `ENTRY_SOURCE_DOC` points those two
 * codes at the `E5.3` document per entry (ADR 0054 decision 2).
 *
 * **STAGED AT `E5.3` Task 3, RESTORED AT TASK 10, AND STAGED ONCE MORE AT TASK
 * 11.** Each pack declares its codes here one commit before the first of them
 * is authored — the six mechanical codes at `E5.2` Task 5, the seven facility
 * codes at `E5.3` Task 3, and the two vertical-transport codes at Task 11,
 * where the override map forces it: a key that is not a declared entry is
 * refused. Meanwhile the order claim compares the catalog against the HEAD of
 * this list, because full equality would be red for every commit pass C takes
 * to author the entries one at a time, and a bound that is red by construction
 * teaches the next author to ignore a red test — the `F2.12` / `E5.1`
 * bound-staging pattern applied to a list. **Task 14 (the escalator) deleted
 * the slice and the floor of 25 together**, and the claim is `join === join`
 * against all twenty-seven from there on.
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
  // The facility/smart-building pack — `E5.3`, §§1-7 of the document in order.
  // Not one of the seven ships yet; Tasks 4-10 author them one per commit,
  // against the lists below, and the order claim is staged until Task 10.
  "facility-lighting-zone",
  "facility-fire-panel",
  "facility-access-door",
  "facility-occupancy-zone",
  "facility-parking-level",
  "environment-iaq-node",
  "facility-bas-gateway",
  // The vertical-transport half of the same pack — `E5.3` PR 2, §§8a and 8b of
  // the same document. Declared here at Task 11, one commit before Task 13
  // authors the lift, because `ENTRY_SOURCE_DOC` may only carry a code this
  // list names: the override and the codes it overrides land together or the
  // override checks nothing. Task 13 authored the lift and Task 14 the
  // escalator, and the order claim is full equality again from Task 14.
  "mechanical-lift",
  "mechanical-escalator",
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
 * **106 records across 97 distinct codes** since `E5.3` Task 11. The five parts
 * are 32 records over 30 codes (electrical — `load_pct` three times), 15 over 14
 * (water — `hydraulic_load_pct` on the STP and the ETP), 17 over 17
 * (mechanical/HVAC — no code is deferred twice inside the pack), 25 over 25
 * (facility/smart-building — no code deferred twice, and none of the 25 is
 * deferred by any earlier pack either) and **17 over 15** (vertical transport —
 * `availability_pct` and `mtbf_h` on both the lift and the escalator, for the
 * same reason on each). 30 + 14 + 17 + 25 + 15 is 101, not 97, and the four-record
 * difference over three codes is the whole reason this is a `Record`:
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
 *  - **`availability_pct` is deferred on FOUR entries** — `electrical-dg-set`,
 *    `mechanical-pump` and, since `E5.3` PR 2, `mechanical-lift` and
 *    `mechanical-escalator`. All four need hours-in-state over a window, which
 *    the grammar has no state for. ADR 0053's Consequences name it as open for
 *    the N4 form; the pump's list does not become the DG set's when it lands.
 *  - **`starts_per_day` is deferred on `electrical-dg-set` AND on
 *    `mechanical-escalator`** — a per-day count over a cumulative counter on
 *    both. It is why the pack's ledger grows by 17 records but only **13**
 *    distinct codes: measure the distinct total, never add the part's own count
 *    to the previous total.
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
  // The facility/smart-building pack — E5.3, docs/e5.3-derived-taglist-v1.md.
  // Twenty-five records over twenty-five codes in PR 1; the four PR 1 promotes
  // are listed with their formulas in facility.ts. Each list is its section's
  // "Derived:" prose line minus what that entry authors, and across the whole
  // pack 8 + 40 = 48 distinct codes over 51 mentions is the reconciliation that
  // proves no named code was dropped (PR 1: 4 + 25 = 29 over 30).
  //
  // Not one of the seven entries is shipped yet, so the loop below does not
  // reach any of these lists. They are declared now, in the commit that
  // declares the pack, so that the day an entry lands it lands against a check
  // that already names what it may not author (E5.2 Task 5's shape).
  //
  // §1 — two time windows and three attributes. Nothing is promoted here.
  "facility-lighting-zone": [
    // minutes per day is a window; the lit_while_unoccupied alarm binds the
    // state and says so.
    "lit_while_unoccupied_min_day",
    // hours per day of manual override — a window.
    "override_hours_day",
    // installed load per square metre needs the ZONE AREA, an attribute.
    "lighting_w_per_m2",
    // needs the full-output baseline the zone would draw without daylight
    // harvesting — an attribute, and a commissioning one.
    "daylight_saving_pct",
    // faulty luminaires over the LUMINAIRE COUNT; lamp_fault_count is declared
    // and the count it divides by is not.
    "lamp_availability_pct",
  ],
  // §2 — the pack's NEW deferral class, two time windows and an attribute.
  "facility-fire-panel": [
    // THE NEW CLASS (see DEFERRAL_REASON): a product of five declared binaries
    // that PARSES, and is refused all the same. A health flag over states is
    // content.health's job (ADR 0050's surface), and each of the five inputs
    // already raises its own alarm — a roll-up would restate five decisions as
    // one number with no way back to which input moved it.
    "fire_system_healthy",
    // hours isolated per month — a window.
    "isolation_hours_month",
    // starts per hour; the jockey_pump_cycling alarm binds the run status and
    // says the rate is the rule's.
    "jockey_starts_per_hour",
    // "running outside a test" needs the TEST SCHEDULE, a site attribute; the
    // fire_pump_running_unplanned alarm carries the meaning instead.
    "fire_pump_run_unplanned",
  ],
  // §3 — two time windows and the roll-up class again.
  "facility-access-door": [
    // minutes held open per day — a window.
    "door_open_minutes_day",
    // per-hour rate over interval counters whose REPORTING INTERVAL the
    // catalog does not know — a window with an unknown denominator.
    "traffic_per_hour",
    // the fire_system_healthy class, second instance: a roll-up over the
    // controller's own state points.
    "access_system_healthy",
  ],
  // §4 — a window, an attribute, and another asset's energy.
  "facility-occupancy-zone": [
    // hours-in-state over a day — a window.
    "occupied_hours_day",
    // needs the DESK or ROOM count, an attribute; occupancy_capacity is the
    // egress capacity and is a different denominator.
    "space_utilization_pct",
    // the HVAC zone's energy while this zone is empty — another asset's meter,
    // which bms-calc-v1 cannot name.
    "conditioning_while_empty_kwh",
  ],
  // §5 — four time windows, and the only entry whose deferrals are all one
  // class. occupancy_pct is NOT here: the level declares bays_occupied and
  // bays_total and authors it, with a different formula from §4's.
  "facility-parking-level": [
    // vehicles per day.
    "turnover_per_day",
    // average dwell needs entry-to-exit pairing, which is state over a window.
    "avg_dwell_min",
    // fan run hours per day.
    "fan_hours_day",
    // the fraction of fan hours CO demand drove — two windows, not one.
    "co_driven_fan_pct",
  ],
  // §6 — two methods the document only names, and a window. The two the node
  // DOES author are the ASHRAE 62.1 pair, the pack's only maxInputAgeSeconds
  // overrides.
  "environment-iaq-node": [
    // ISHRAE banding: a table indexed by pollutant and concentration range,
    // and the document names the method without fixing the bands.
    "iaq_index",
    // adequacy against a ventilation rate the document does not define — a
    // method, and the rate is per occupancy category.
    "ventilation_adequacy_pct",
    // hours outside the band per day — a window, and the band is the site's.
    "hours_out_of_band_day",
  ],
  // §7 — the roll-up class a third time, and two time windows.
  "facility-bas-gateway": [
    // ADR 0054 decision 6 rules it to the F3.x estate surface rather than to a
    // template point: a per-gateway quality number is computed over the points
    // BEHIND the gateway, which is the estate's view and not this asset's.
    "data_quality_pct",
    // reachable time over elapsed time — hours-in-state.
    "uptime_pct",
    // a mean over a window; last_seen_age_s is the instantaneous point the
    // stale_data alarm binds.
    "mean_latency_s",
  ],
  // §8a — the pack's longest list, eleven: seven time windows, another system's
  // clock, a method, a rate whose two counters do not divide, and
  // levelling_drift_mm, which is a COMMISSIONING BASELINE trend and its own
  // class (§13 item 5's ruling). The two the lift
  // DOES author are the lifetime counter ratios (the E5.2 load_factor_pct
  // shape), which need no window because both inputs are cumulative.
  "mechanical-lift": [
    // hours in service over hours elapsed — hours-in-state, and the third
    // record of this code (electrical-dg-set, mechanical-pump, here).
    "availability_pct",
    // mean time between failures: a window, and it needs the failure history
    // rather than the current fault flag.
    "mtbf_h",
    // entrapments per month — a window over an event.
    "entrapments_per_month",
    // door cycles per day; door_cycle_count is a CUMULATIVE counter, and per-day
    // is the window the grammar has no state for.
    "door_cycles_per_day",
    // trips per day, the same shape over trip_count.
    "trips_per_day",
    // the peak-hour wait needs a distribution over a window, not a value.
    "peak_hour_wait_s",
    // out-of-service hours per month — hours-in-state again, over lift_in_service.
    "out_of_service_hours_month",
    // mean time to repair lives in the WORK ORDER system (E3.1), which
    // bms-calc-v1 cannot name — the "another asset" class, one system out.
    "mttr_h",
    // ISO 18738 ride-quality banding: a method the document names and does not
    // fix. vibration_z_mg is declared and the ride_quality_worsening alarm binds
    // it against a band set at commissioning.
    "ride_quality_index",
    // levelling drift is a TREND against a commissioning baseline — E5.1's
    // approach_trend class — not an instantaneous difference; the baseline is a
    // site attribute and the trend is a window.
    "levelling_drift_mm",
    // faults per 1000 trips divides an INTERVAL counter by a CUMULATIVE one.
    // The two counters do not share a denominator, so the quotient is not a
    // rate however well it parses.
    "fault_rate_per_1000_trips",
  ],
  // §8b — four windows, a method the document leaves open, and a commissioning
  // baseline. availability_pct and mtbf_h are deferred on BOTH vertical-transport
  // entries for the same reason, and starts_per_day is the DG set's code a SECOND
  // time: a per-entry Record is what lets one code be deferred once per entry, and
  // the most any code reaches here is FOUR (availability_pct).
  "mechanical-escalator": [
    // hours running over hours elapsed — hours-in-state.
    "availability_pct",
    // the failure history again, not the current fault flag.
    "mtbf_h",
    // starts per day over the cumulative start_count — the same window the DG
    // set defers this exact code for.
    "starts_per_day",
    // safety-circuit trips per month — a window over an event.
    "safety_trips_per_month",
    // THE DENOMINATOR IS UNDEFINED: the document does not fix whether standby is
    // measured over run time or over run + standby, and the two answers differ by
    // the whole idle band. A definition picked under the right name is worse than
    // a deferral — esc_status carries the energy-save state and says so.
    "standby_ratio_pct",
    // deviation from a COMMISSIONING baseline current, an attribute nothing
    // declares; motor_current_a is declared and the trend is the site's.
    "motor_current_baseline_dev_pct",
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
  "anecdote. E5.3's facility/smart-building pack adds ONE more class and no other, the eighth " +
  "overall and the fifth numbered here: (5) A SUBSYSTEM STATE ROLL-UP, which is the first class " +
  "whose formula PARSES and is refused anyway — fire_system_healthy is a product of five " +
  "declared binaries, access_system_healthy the same over the controller's, and data_quality_pct " +
  "a completeness fraction over the points behind a gateway; all three are ADR 0050's " +
  "content.health surface rather than a template point (ADR 0054 decision 6 routes the third to " +
  "the F3.x estate view), and each of their inputs already raises its own alarm, so the roll-up " +
  "would restate several decisions as one number with no way back to which input moved it — " +
  "every other class here is deferred because it CANNOT be written, and this one because it " +
  "should not be.";

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
  // **STAGED FOR THE THIRD TIME AT `E5.3` TASK 11, AND RESTORED TO FULL
  // EQUALITY HERE AT TASK 14 — the third deletion, and the last this pack
  // needs.** The claim ran against the HEAD of this list for the six commits
  // pass C took to author the mechanical entries and for the seven that authored
  // the facility ones; `E5.2` Task 11 and `E5.3` Task 10 each restored full
  // equality and deleted the floor with the slice. Task 11 declared
  // `mechanical-lift` and `mechanical-escalator` two commits before either was
  // authored — an `ENTRY_SOURCE_DOC` override must name a DECLARED entry in the
  // commit that adds it, which is the check below this one — so the head
  // comparison and a floor of 25 came back for exactly two commits. **The
  // escalator is the second of them, so both are gone** and the comparison below
  // is `join === join` against the whole twenty-seven-element literal.
  //
  // **NO ANTI-VACUITY FLOOR IS NEEDED WHILE THE CLAIM IS FULL EQUALITY, and that
  // is the whole point of taking the staging back out.** `slice(0, codes.length)`
  // followed the catalog, so at `codes.length === 0` it was the empty list and
  // the comparison was `"" === ""` — a pack index dropped from the spread in
  // `stock-catalog.ts` would have PASSED while the product shipped nothing, and
  // the floor of 25 was what refused that. Against the full literal an empty,
  // truncated or REORDERED catalog cannot compare equal to twenty-seven codes,
  // so the claim carries its own floor and a second one would be decoration.
  // The head comparison could not say this: it passed on any prefix, and a
  // twenty-six-entry catalog missing only the escalator was its green case.
  //
  // A staged claim is a claim with a deletion date, and this one has now been
  // staged and deleted three times without the deletion ever being forgotten,
  // because each staging comment names the task that removes it.
  const codes = STOCK_ASSET_TEMPLATE_CATALOG.map((entry) => entry.code);
  assert(
    codes.join(",") === STOCK_ENTRY_CODES.join(","),
    "the catalog's codes must equal STOCK_ENTRY_CODES exactly, in order — the pack indexes are " +
      "spread into stock-catalog.ts in the order ADR 0040 ruling 2 (and, from E5.2, ADR 0053 " +
      "decision 1; from E5.3, ADR 0054 decision 1) sets, and that order reaches the client " +
      "unchanged: GET /admin/asset-templates/stock returns the array unsorted and the stock " +
      "viewer renders it as it arrives, so the order IS what a global administrator reads. This " +
      "is FULL equality and not a head comparison, restored at E5.3 Task 14 now that both " +
      "vertical-transport entries ship: a catalog that is short an entry, carries one twice or " +
      "lists a pack out of document order fails here and nowhere else.\n  expected " +
      `${STOCK_ENTRY_CODES.join(", ")}\n  got      ${codes.join(", ")}`,
  );

  // ---- every citation override names an entry the catalog declares --------
  //
  // The reverse direction of `E5.3` Task 11's per-entry override, and the one
  // that fails in silence. `ENTRY_SOURCE_DOC` points a CODE at the document its
  // domain prefix does not carry; a key that no entry answers to checks nothing,
  // forever — a misspelt "mechanical-elevator" would leave the real
  // `mechanical-lift` on the prefix default, checked against `E5.2`'s handout,
  // and green. The claim lives here because this file owns the entry list, and
  // the map lives in `stock-catalog.spec.ts` because `checkEntry` reads it.
  //
  // Against `STOCK_ENTRY_CODES` and NOT against the shipped catalog, deliberately:
  // an override is declared in the same commit as its code and one or two commits
  // before the entry itself, and this check must be green in that window.
  for (const code of Object.keys(ENTRY_SOURCE_DOC)) {
    assert(
      (STOCK_ENTRY_CODES as readonly string[]).includes(code),
      `${code} carries an ENTRY_SOURCE_DOC override but is not a declared stock entry — ` +
        "an override keyed on a code nobody ships checks nothing, forever. Either the code is " +
        "misspelt (and the entry it was meant for is silently back on its prefix default, cited " +
        `against the wrong document) or the override outlived its entry. Declared: ${STOCK_ENTRY_CODES.join(", ")}.`,
    );
  }

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
