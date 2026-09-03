import { CORE, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The water pack's ion-exchange softener class — `E5.1`, ADR 0040 decision 1,
 * ADR 0052 decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/e5.1-derived-taglist-v1.md` §3 — *"Softener — ion-exchange
 * softening"*. PROVISIONAL: derived from published practice, not
 * client-confirmed.
 *
 * **9 POINTS — 4 core + 3 extended + 2 manual + 0 derived**, §3's table rows in
 * the document's own order. **The smallest entry in the pack**, and the cheap
 * opposite end that proves the catalog mechanism is not tuned to one shape: the
 * cooling tower carries 21 points and four formulas, this carries nine points
 * and none, and both go through the same `checkEntry`, the same import and the
 * same publish.
 *
 * **ALL THREE OF §3'S DERIVED CODES ARE DEFERRED**, and the three reasons are
 * three different kinds (ADR 0051 Amendment 6 decision 8 — a code with no
 * `bms-calc-v1` formula is not vocabulary, and a deferral is never a
 * placeholder):
 *
 *  - `throughput_since_regen_kl` — **§3 already carries this quantity as a
 *    MEASURED point**: `outlet_flow_totalizer_kl`, whose own description is
 *    *"Treated volume since regeneration"*. A derived restatement of a declared
 *    point adds nothing and would be a second code for one meaning, which ADR
 *    0051 Amendment 6 decision 5 refuses.
 *  - `regen_frequency_per_day` — a time window the grammar has no state for.
 *    `bms-calc-v1` evaluates one reading against its siblings; per-day, per-
 *    month and hours-in-state are all outside it.
 *  - **`salt_efficiency_kg_kl` — THE FORMULA PARSES, AND THE POINT COULD NEVER
 *    FIRE.** `{salt_consumption_kg} / {outlet_flow_totalizer_kl}` is valid
 *    `bms-calc-v1` over two declared measured points this entry carries. But
 *    `salt_consumption_kg` is an `M` row: its `sourceDataKeyPattern` is `null`
 *    forever, `planAsset` puts it in `skippedPoints`, so it **never gets an
 *    `asset_points` row**, never gets a `point_values` row, and the formula
 *    never has an input. A permanent, `0058`-foreign-keyed point key for a
 *    formula that cannot run is the decorative vocabulary ADR 0051 fact 4
 *    exists to end. **This is the only deferral in the whole catalog whose
 *    reason is the DATA MODEL rather than the grammar**, and it is the
 *    distinction from `oil_rise_over_ambient_c`, whose `X`-tier input can be
 *    wired. It becomes authorable the day `F1.8` gives a manual row somewhere
 *    to write to.
 *
 * The entry spec asserts all three absent — and asserts that **both** of
 * `salt_efficiency_kg_kl`'s inputs are nonetheless declared, because that is
 * what makes the deferral a data-model claim rather than a missing-row one.
 *
 * **NO `content.kpis` AT ALL**, structurally rather than as a deferral of
 * effort (plan §5.0): §3 names three ratios, all three are deferred, so there
 * is nothing left for a KPI to be. The water pack invents no KPI code and no
 * point key.
 *
 * **ALARMS — 4, one per §3 bullet.** Nothing splits on this entry. Every row is
 * **pair-absent** — no `thresholdValue`, no `operator` (ADR 0019 Amendment 2,
 * and B7: *limit values are set per site at commissioning*) — and every row
 * carries a populated `philosophy`, which ADR 0040 decision 4 requires.
 *
 * **`throughput_anomaly` is the clearest row in the pack about why a limit
 * cannot be authored.** The comparison it implies is against the vessel's
 * **rated exchange capacity**, which is an asset attribute — a function of
 * resin volume and the inlet hardness the vessel was sized for. It is per site
 * and set at commissioning, and it is exactly why the row carries a parameter
 * and no number. It is `info`, not `warning`: on its own it is an observation,
 * and the condition it hints at is reported an hour or a shift later by
 * `outlet_hardness_high`.
 *
 * **`philosophy.skill` is set on two rows and omitted on two** (plan §12
 * ruling 6). `bms.alarm_skills` (migration `0034`) holds `electrical`,
 * `mechanical`, `hvac`, `controls` and `civil` — and no process trade. So
 * `brine_level_low` is `civil` (a saturator tank) and `vessel_dp_high` is
 * `mechanical` (a resin bed and its distributors). **`outlet_hardness_high` and
 * `throughput_anomaly` carry none**: both are ion-exchange process judgements —
 * whether the resin is exhausted, fouled or simply under-regenerated — answered
 * by the plant operator or the resin vendor rather than by one of the five
 * trades.
 *
 * **NO CPCB CONSENT ROW.** A softener is a service-water unit; nothing on it is
 * a discharge-consent parameter, and its brine regenerant reaches the site's
 * own effluent plant, where `water-etp`'s consent rows carry that meaning.
 *
 * **TWO DECLARED ROWS CARRY NO ALARM, AND THAT IS A DECISION.**
 * `inlet_hardness_mgl` is a laboratory result that arrives after the condition
 * it describes and is carried for sizing and for `F1.8` manual entry;
 * `outlet_conductivity_uscm` is a trend rather than an excursion on a softener,
 * because ion exchange swaps hardness for sodium and barely moves total
 * dissolved solids. §3's four bullets are exactly the four rows above.
 *
 * **MAINTENANCE — 3 plans, PROVISIONAL** (plan §12 ruling 5), and the pack's
 * only entry with three rather than four: there is less to maintain, and
 * padding the list to match the others would be inventing work. Derived from
 * **ion-exchange practice**: the resin bed inspection, the brine system
 * service, and the hardness analyser or test-kit calibration. **None is
 * `safetyCritical`** — the pack's three are the ETP guard pond, the cooling
 * tower Legionella program and the WTP chlorine dosing service.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the
 * site's telemetry wiring, which the tag list does not know and the catalog
 * must not guess, so an imported draft cannot be instantiated until an operator
 * fills the patterns in. The two `M` rows keep `null` forever by design — and
 * one of them, `salt_consumption_kg`, is the reason a whole derived code is
 * deferred.
 *
 * `E5.1` pass B shipped this module as a skeleton carrying one placeholder
 * point; **pass C (this commit) replaced it with §3's full row set**, and no
 * placeholder remains in this file. This is the last of the six.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `water-softener` **v1** (2026-09-03, `E5.1`): authored from
 *    `e5.1-derived-taglist-v1.md` §3, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const WATER_SOFTENER: StockAssetTemplateEntry = {
  code: "water-softener",
  name: "Ion-exchange softener",
  assetType: "softener",
  domain: "water",
  description:
    "Ion-exchange softening vessel with its brine system and regeneration cycle. Authored from " +
    "docs/e5.1-derived-taglist-v1.md §3 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required, X optional, M entered by hand; alarm rows " +
    "carry a meaning and no limit, because the rated exchange capacity a softener is judged " +
    "against is an attribute of the vessel and is set per site at commissioning.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "outlet_hardness_high",
        pointKey: "outlet_hardness_mgl",
        severity: "critical",
        category: "operations",
        message:
          "Outlet hardness above the site limit — the resin is exhausted, or the last " +
          "regeneration failed. The limit is set per site at commissioning.",
        philosophy: {
          cause:
            "Resin exhausted before the regeneration was due, a regeneration that ran without " +
            "brine, channelling through a fouled or compacted bed, or resin lost from the vessel.",
          impact:
            "Hard water reaches whatever the softener protects — a boiler, an RO skid, a process " +
            "exchanger — where it forms scale that is expensive to remove and, on a boiler, " +
            "dangerous to leave.",
          action:
            "Take the vessel off line and regenerate it, then confirm the outlet hardness before " +
            "returning it to service. If it exhausts early again, check the brine draw, the " +
            "resin volume and the inlet hardness the vessel was sized for.",
        },
      },
      {
        code: "brine_level_low",
        pointKey: "brine_tank_level_pct",
        severity: "warning",
        category: "operations",
        message:
          "Brine tank level low — the next regeneration is at risk. The level is set per site at " +
          "commissioning.",
        philosophy: {
          cause:
            "Salt not topped up, a bridged or crusted salt bed holding the level up while the " +
            "saturator runs dry beneath it, or a leaking brine tank.",
          impact:
            "The next regeneration runs short of brine or without it, and a failed regeneration " +
            "is what the outlet hardness alarm reports one shift later. This row is the earlier, " +
            "cheaper warning of the same failure.",
          action:
            "Top up the salt, break any bridging in the tank, and confirm the saturator refills " +
            "and the brine draw works before the next regeneration is due.",
          skill: "civil",
        },
      },
      {
        code: "vessel_dp_high",
        pointKey: "vessel_dp_bar",
        severity: "warning",
        category: "operations",
        message:
          "Vessel differential pressure high — resin bed fouling or channelling. The limit is set " +
          "per site at commissioning.",
        philosophy: {
          cause:
            "Suspended solids from upstream loading the bed, iron or organic fouling of the " +
            "resin, a compacted bed, or blocked underdrain laterals.",
          impact:
            "Flow finds a path around the bed rather than through it, so contact time falls and " +
            "hardness leaks past long before the resin is genuinely exhausted.",
          action:
            "Backwash the bed and watch the wash for fines and colour, check the upstream " +
            "filtration, and inspect the underdrain if the differential pressure returns.",
          skill: "mechanical",
        },
      },
      {
        code: "throughput_anomaly",
        pointKey: "outlet_flow_totalizer_kl",
        severity: "info",
        category: "operations",
        message:
          "Treated volume since regeneration far from the vessel's rated exchange capacity. The " +
          "rated capacity is an asset attribute, so the comparison is per site and set at " +
          "commissioning — which is exactly why this row carries a parameter and no number.",
        philosophy: {
          cause:
            "Short of capacity: resin fouled, lost or under-regenerated, or an inlet hardness " +
            "above what the vessel was sized for. Past capacity: a regeneration missed, or a " +
            "totalizer that has not been reset with the cycle.",
          impact:
            "On its own this is an observation rather than a failure, which is why it is filed " +
            "info. What it reports is a vessel drifting away from its design duty, and the " +
            "outlet hardness alarm is the same story an hour or a shift later.",
          action:
            "Compare the volume against the vessel's rated capacity and the measured inlet " +
            "hardness, confirm the totalizer resets with each regeneration, and adjust the " +
            "regeneration trigger before hardness leaks past.",
        },
      },
    ],
    maintenance: [
      {
        title: "Resin bed inspection and depth check",
        category: "inspection_round",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 180,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Open the vessel, measure resin depth, take a sample for capacity and fouling, and " +
          "inspect the distributor and underdrain. vessel_dp_bar reports fouling once it is " +
          "already restricting flow; resin that has lost capacity without losing depth is " +
          "reported by nothing on this template.",
      },
      {
        title: "Brine system service — valve, injector and saturator",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 120,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Service the regeneration valve, clean the brine injector and eductor, and clear the " +
          "saturator and its float. brine_tank_level_pct reports the level and not the draw, so a " +
          "blocked injector regenerates with clean water and reports nothing until the outlet " +
          "hardness alarm fires.",
      },
      {
        title: "Hardness analyser and test-kit calibration",
        category: "calibration",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 60,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Calibrate the outlet hardness analyser against a standard and replace the test-kit " +
          "reagents at their expiry. outlet_hardness_mgl carries this entry's only critical " +
          "alarm, and inlet_hardness_mgl is entered by hand from the same kit.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "inlet_flow_klh", label: "Service inlet flow", unit: "KL/hr", required: true, sortOrder: 0, meta: CORE },
    // The measured row that makes throughput_since_regen_kl a restatement
    // rather than a formula — see the module docblock.
    { ...MEASURED, pointKey: "outlet_flow_totalizer_kl", label: "Treated volume since regeneration", unit: "KL", required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "outlet_hardness_mgl", label: "Outlet hardness (as CaCO₃)", unit: "mg/L", required: false, sortOrder: 2, meta: EXTENDED },
    { ...MEASURED, pointKey: "inlet_hardness_mgl", label: "Inlet hardness", unit: "mg/L", required: false, sortOrder: 3, meta: MANUAL },
    { ...MEASURED, pointKey: "vessel_dp_bar", label: "Vessel differential pressure", unit: "bar", required: false, sortOrder: 4, meta: EXTENDED },
    { ...MEASURED, pointKey: "regen_status", label: "Regeneration in progress", unit: null, required: true, sortOrder: 5, meta: CORE },
    { ...MEASURED, pointKey: "brine_tank_level_pct", label: "Brine tank level", unit: "%", required: true, sortOrder: 6, meta: CORE },
    // The M row that defers salt_efficiency_kg_kl: its sourceDataKeyPattern is
    // null forever, so the point never receives a value and a formula over it
    // could never fire. See the module docblock.
    { ...MEASURED, pointKey: "salt_consumption_kg", label: "Salt use per regeneration", unit: "kg", required: false, sortOrder: 7, meta: MANUAL },
    { ...MEASURED, pointKey: "outlet_conductivity_uscm", label: "Outlet conductivity", unit: "µS/cm", required: false, sortOrder: 8, meta: EXTENDED },
  ],
};
