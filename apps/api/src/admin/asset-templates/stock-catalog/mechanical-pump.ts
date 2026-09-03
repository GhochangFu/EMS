import { CORE, derived, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The mechanical pack's pump-set class — `E5.2`, ADR 0053 decisions 1-8,
 * ADR 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2.
 *
 * **SOURCE.** `docs/e5.2-derived-taglist-v1.md` §1 — *"Pump set — centrifugal,
 * with motor (raw/treated water, CHW/CW, boiler feed)"*. PROVISIONAL: derived
 * from published practice, not client-confirmed. §1 calls itself **the base
 * class**: every other pack that has "a pump" — the WTP intake, the RO high-
 * pressure pump, the cooling tower's circulation pump, a CHW primary — is this
 * table plus the process points already listed in that pack. Nothing here forks
 * those entries and they do not fork this one; a site that wants the pump as its
 * own asset imports this template beside them.
 *
 * **20 POINTS — 6 core + 11 extended + 1 manual + 2 DERIVED.** §1's 18 table
 * rows in the document's own order (`sortOrder` 0-17), then the two authored
 * derived codes (18-19). This is the **first** entry of the pack, and unlike
 * `E5.1`'s first entry it exercises the derived machinery at once.
 *
 * **SEVEN OF THE EIGHTEEN ROWS ARE REUSED CODES, REFERENCED AND NEVER
 * REDECLARED** (ADR 0053 decision 3). A pump set is a motor with a hydraulic end
 * on it, so most of its electrical half is already vocabulary:
 *
 *  - `current_a`, `kw`, `kwh_total` — the motor's electrical rows, from
 *    `ELECTRICAL_POINT_KEYS` / `ELECTRICAL_CLASS_POINT_KEYS`.
 *  - `run_hours_h`, `start_count` — the two cumulative counters the DG set
 *    already declares, and `start_count` is what `short_cycling` binds.
 *  - `winding_temp_c` — the motor RTD.
 *  - `insulation_resistance_mohm` — the megger reading, the entry's one `M` row.
 *
 * Units in `bms.point_keys` are **write-once** (`seedPointKeyCatalog` inserts
 * with `COALESCE`), so a second declaration could not correct one anyway, and a
 * duplicate object key in `UNIT_BY_KEY` is something TypeScript refuses. Each
 * code stays in the array that already holds it; the pump names it.
 *
 * **THE TWO FORMULAS** (plan §5.0), promoted into the vocabulary because a
 * derived point's `pointKey` passes `assertPointKeysActive` like any other:
 *
 *  - `head_m` = `({discharge_pressure_bar} - {suction_pressure_bar}) * 10.2` —
 *    the developed head, in metres of water. `10.2` is **the document's own
 *    constant** (metres of water column per bar), written in §1's *Derived:*
 *    line; it is physics and not a site value, so B7 has nothing to say about
 *    it. **It reads an `X`-tier input**: `suction_pressure_bar` is optional, and
 *    that is legal — the reference check requires a key to be DECLARED, not
 *    required (ADR 0036 decision 7) — so a pump with no suction gauge simply
 *    gets no head value. Do not "fix" it by promoting the input to `C`.
 *  - `specific_energy_kwh_kl` = `{kw} / {flow_klh}` — kW ÷ KL/hr is kWh/KL, the
 *    energy it costs to move a kilolitre. **Both inputs are `X`**, for the same
 *    reason and with the same consequence.
 *
 * **`specific_energy_kwh_kl` IS ONE CODE, THREE ENTRIES, ONE AUTHORING.** It is
 * **deferred** on `electrical-feeder` (which would need a KL throughput from
 * another asset) and on `water-ro` (whose §2 declares the HP pump's current, not
 * its kW), and it is **authored here**, because §1 declares both `kw` and
 * `flow_klh`. One meaning — *energy per kilolitre moved* — so one code (ADR 0051
 * Amendment 6 decision 5). The two deferral records stay: neither the feeder nor
 * the RO becomes able to compute it because a pump can. This is exactly the
 * `load_pct` shape — deferred on three electrical classes and a measured core
 * point on the UPS — and it is why `DEFERRED_DERIVED_CODES` is a per-entry
 * `Record` rather than one flat list. The code is filed under `mechanical` in
 * `MECHANICAL_CLASS_POINT_KEYS`; a filing domain is not an exclusivity
 * (decision 3).
 *
 * **DIVISION BY ZERO IS HANDLED AND MUST NOT BE GUARDED.** `evaluate.ts` returns
 * `non_finite` for a node whose result fails `Number.isFinite`, so specific
 * energy at zero flow — a pump running against a closed valve, or a flow meter
 * reading zero — produces **no value for that reading**. No `clamp`, no
 * `max(…, 0.001)`: a fabricated denominator turns "no data" into a plausible
 * number, which is worse than a gap. **Neither formula overrides
 * `maxInputAgeSeconds`**: both inputs of both come from the same starter panel
 * and instrument set at the same scan rate, well inside the 300 s default, and
 * `E5.1`'s one override existed for a site weather station. The entry spec
 * asserts `null` on both, so a helpful override is a test failure with a reason.
 *
 * **FOUR DERIVED CODES ARE DEFERRED AND NAMED, never placeholdered** (ADR 0053
 * decision 6; ADR 0051 Amendment 6 decision 8 — a code with no `bms-calc-v1`
 * formula is not vocabulary). `stock-catalog-deferrals.spec.ts` holds the list
 * and asserts this entry declares none of them:
 *
 *  - **A time window the grammar has no state for** — `duty_hours_pct` (run
 *    hours over elapsed hours), `starts_per_hour`, and `availability_pct`, the
 *    N4 quantity ADR 0053's Consequences already name as open and which is also
 *    deferred on `electrical-dg-set`.
 *  - **A standard's lookup, a class NEW in this pack** — `vibration_band`. ISO
 *    20816's zones A-D are a table indexed by machine group, power and mounting;
 *    `bms-calc-v1` has arithmetic, parentheses and five functions, and no lookup
 *    at all. The zone boundary is therefore a site value on the rule, and
 *    `vibration_high` below names the standard as the BASIS and carries no zone.
 *
 * **NO `content.kpis`** (ADR 0053 decision 6, the same structural reason
 * `water.ts` and `mechanical.ts` record). Both expressible ratios §1 names are
 * declared codes, so both are points; the four the grammar cannot express are
 * deferred. There is nothing left for a KPI to be — and a `content.kpis` entry
 * could not be bound by an alarm in any case.
 *
 * **ALARMS — 10, from §1's eight bullets.** *"current high (overload / blocked)
 * or low (dry run / broken coupling)"* splits into two rows binding `current_a`
 * at opposite bands — the feeder's `voltage_vry` shape, and here the two bands
 * are answered by two different trades. *"Bearing temperature high"* splits into
 * two because the entry declares a drive-end and a non-drive-end bearing and the
 * responder has to know which end is hot. Every row is **pair-absent** — no
 * `thresholdValue`, no `operator` (ADR 0019 Amendment 2, and B7: limit values
 * are set per site at commissioning) — and every row carries a populated ADR
 * 0019 §3 `philosophy`, which ADR 0053 decision 5 requires of this pack.
 *
 * **`philosophy.skill` is set on all ten**, because every one of them is
 * answered by one of migration `0034`'s five seeded trades. `current_high` is
 * **`electrical`** (an overload trip and a motor's current band are the
 * electrical trade's) and `short_cycling` is **`controls`** (switch hysteresis,
 * a level band, a controller's start logic); the other eight are `mechanical` —
 * a hydraulic end, a bearing, a seal, a coupling and a service interval. **This
 * entry has no process-chemistry row**: all four of the pack's no-skill rows are
 * the boiler's, and the entry spec passes an empty list, which is a claim rather
 * than a gap because `assertSkillAssignment` requires the map and the list to
 * partition the ten.
 *
 * **`short_cycling` BINDS THE CUMULATIVE COUNTER `start_count`.**
 * `starts_per_hour` is deferred, so the alarm binds the counter and says so in
 * its own text: the **rate** is the rule's to evaluate (`E2.4`) and the counter
 * is the parameter it evaluates over. Same precedent as `E5.1`'s
 * `throughput_anomaly`, and the reason the deferral is not a hole.
 *
 * **MAINTENANCE — 4 plans, PROVISIONAL** (plan §12 ruling 5), derived from ISO
 * 20816 / ANSI-HI 9.6.4 and OEM centrifugal-pump practice, because the tag list
 * has no maintenance section. **None is `safetyCritical`**: ADR 0053 decision 8
 * names exactly three in the pack — the compressor's relief-valve test, the
 * AHU's fire-trip interlock test and the boiler's low-water cut-off and
 * safety-valve test — and a bearing round is not a life-safety barrier. The
 * first plan is `condition_based` in `condition` mode and names the three points
 * whose rise is its trigger; its `intervalDays` is the calendar backstop
 * `templateMaintenancePlanSchema` requires, not the intended trigger.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the site's
 * telemetry wiring, which the tag list does not know and the catalog must not
 * guess, so an imported draft cannot be instantiated until an operator fills the
 * patterns in. `insulation_resistance_mohm`, the one `M` row, keeps `null`
 * forever by design — a megger reading is taken with the motor isolated and
 * written on a sheet — so it always lands in `skippedPoints` and never gets an
 * `asset_points` row until `F1.8` manual entry gives it somewhere to write.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `mechanical-pump` **v1** (2026-09-03, `E5.2`): authored from
 *    `e5.2-derived-taglist-v1.md` §1, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const MECHANICAL_PUMP: StockAssetTemplateEntry = {
  code: "mechanical-pump",
  name: "Pump set (centrifugal, with motor)",
  assetType: "pump",
  domain: "mechanical",
  description:
    "Centrifugal pump set and its motor — suction and discharge, delivered flow, bearings, seal " +
    "and the motor's electrical rows. The base class every other pack's pump is: a WTP intake, " +
    "an RO high-pressure pump or a cooling-tower circulation pump is this table plus that " +
    "plant's process points. Authored from docs/e5.2-derived-taglist-v1.md §1 (PROVISIONAL — " +
    "derived from published practice, not client-confirmed). Tier C points are required, X " +
    "optional, M entered by hand; alarm rows carry a meaning and no limit, because the bands are " +
    "set per site at commissioning. Two derived points — developed head and specific energy per " +
    "kilolitre — are computed from the measured rows and need no extra instrument.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "pump_trip",
        pointKey: "pump_trip",
        severity: "critical",
        category: "operations",
        message:
          "Pump tripped — overload, dry-run protection or a drive fault. The duty this pump was " +
          "carrying has stopped.",
        philosophy: {
          cause:
            "A motor overload or thermal trip, dry-run protection acting on a lost suction, a " +
            "VFD fault, or a mechanical seizure in the bearing or the hydraulic end.",
          impact:
            "The duty stops. Whatever the pump was feeding — a treatment stage, a chilled-water " +
            "loop, a boiler's feedwater — is running on its standby pump if it has one and on " +
            "nothing if it does not.",
          action:
            "Start the standby set if there is one, then read the trip source at the starter or " +
            "the drive before resetting: an overload reset without a cause is the same trip " +
            "again in minutes.",
          skill: "mechanical",
        },
      },
      {
        code: "current_high",
        pointKey: "current_a",
        severity: "warning",
        category: "operations",
        message:
          "Motor current above the band with the pump running — the machine is working harder " +
          "than its duty point. The band is set per site at commissioning.",
        philosophy: {
          cause:
            "An overload from running out on the curve, a blocked or fouled impeller, a clogged " +
            "suction strainer, a rising specific gravity, or a bearing beginning to drag.",
          impact:
            "The motor runs hotter than it is rated for and its insulation ages faster. Left " +
            "alone the row ends as an overload trip, and the winding is what pays for it.",
          action:
            "Compare the current with the nameplate and with the discharge pressure and flow " +
            "together — a high current with low pressure is a hydraulic problem, a high current " +
            "with normal pressure is a mechanical drag. Check the strainer and the valve line-up.",
          skill: "electrical",
        },
      },
      {
        code: "current_low",
        pointKey: "current_a",
        severity: "warning",
        category: "operations",
        message:
          "Motor current below the band with the pump running — the machine is doing less work " +
          "than it should be. The band is set per site at commissioning.",
        philosophy: {
          cause:
            "A dry run or a lost prime, a broken coupling or shaft, a closed suction valve, or " +
            "an impeller that has come loose from the shaft.",
          impact:
            "The pump turns and moves nothing. A dry-running mechanical seal fails within " +
            "minutes, and the failure is silent — nothing trips, and the process downstream " +
            "starves while the run status still reads healthy.",
          action:
            "Stop the set, prove the suction valve is open and the suction has liquid, then " +
            "inspect the coupling and the impeller before restarting.",
          skill: "mechanical",
        },
      },
      {
        code: "discharge_pressure_low",
        pointKey: "discharge_pressure_bar",
        severity: "critical",
        category: "operations",
        message:
          "Discharge pressure low with the pump running — no flow, an air lock or a lost prime. " +
          "The pressure is set per site at commissioning.",
        philosophy: {
          cause:
            "A lost prime or an air lock in the casing, a starved or closed suction, a worn " +
            "impeller or wear ring, cavitation, or a burst line downstream taking the head away.",
          impact:
            "The duty is not being delivered even though the machine reads as running, so " +
            "nothing downstream is protected by the pump's own status. Running dry or in " +
            "cavitation also destroys the seal and the impeller while it does so.",
          action:
            "Prove the suction side first — level, valve line-up and strainer — then vent the " +
            "casing and re-prime. If pressure recovers and falls again, look for the leak or the " +
            "wear that is taking the head.",
          skill: "mechanical",
        },
      },
      {
        code: "de_bearing_temp_high",
        pointKey: "de_bearing_temp_c",
        severity: "warning",
        category: "operations",
        message:
          "Drive-end bearing temperature high. The band is set per site at commissioning, from " +
          "the bearing's own rating and the plant-room ambient.",
        philosophy: {
          cause:
            "Lubrication that is short, stale, over-filled or the wrong grade; misalignment or " +
            "pipe strain loading the bearing; a bearing beginning to fail; or excess axial thrust " +
            "from running off the duty point.",
          impact:
            "Bearing temperature is the LEAD indicator on a pump set — it moves days before the " +
            "vibration does and weeks before a seizure. The drive-end bearing carries the " +
            "coupling load, so a failure here takes the shaft and the seal with it.",
          action:
            "Check the lubrication and its schedule first, then the alignment and the pipe " +
            "supports. Trend it against vibration_mms rather than treating one reading as an " +
            "event.",
          skill: "mechanical",
        },
      },
      {
        code: "nde_bearing_temp_high",
        pointKey: "nde_bearing_temp_c",
        severity: "warning",
        category: "operations",
        message:
          "Non-drive-end bearing temperature high — the same failure at the other end of the " +
          "shaft. The band is set per site at commissioning.",
        philosophy: {
          cause:
            "The same causes as the drive end — lubrication, misalignment, a failing bearing — " +
            "and, at this end particularly, the thrust bearing taking a load that the hydraulic " +
            "balance should be carrying.",
          impact:
            "The same progression to seizure. The two ends are separate rows and not one alarm " +
            "because which bearing is hot tells the responder which cause to look at and which " +
            "end to open.",
          action:
            "Confirm at the bearing itself with a hand-held reading, check the lubrication and " +
            "the alignment, and look at the balance holes or the balance line if the thrust end " +
            "alone is running warm.",
          skill: "mechanical",
        },
      },
      {
        code: "vibration_high",
        pointKey: "vibration_mms",
        severity: "warning",
        category: "operations",
        message:
          "Overall vibration velocity above the zone boundary set for this machine class. The " +
          "boundary is a site value, taken from the ISO 20816 zone table for the machine's " +
          "group, power and mounting.",
        philosophy: {
          cause:
            "Imbalance, misalignment, a bent shaft, a worn or damaged bearing, cavitation, or a " +
            "loose or resonant baseplate and foundation.",
          impact:
            "Vibration is what the ISO 20816 zones are written about, and it converts one " +
            "mechanical fault into several: the bearing, the seal and the coupling all wear " +
            "faster while the machine keeps running and keeps meeting its duty.",
          action:
            "Take a spectrum rather than an overall reading — the frequency says which of the " +
            "causes it is — and check alignment and the foundation before rebalancing. " +
            "vibration_band is deliberately not a point: the zone boundary is a table lookup per " +
            "machine group and mounting, which belongs on the rule and not in a formula.",
          skill: "mechanical",
        },
      },
      {
        code: "seal_leak",
        pointKey: "seal_leak_state",
        severity: "warning",
        category: "operations",
        message: "Mechanical seal or gland leak detected at the pump.",
        philosophy: {
          cause:
            "A seal face worn, cracked or run dry; an elastomer attacked by the pumped fluid; " +
            "shaft deflection from misalignment; or a gland packing simply due for adjustment " +
            "or replacement.",
          impact:
            "Product reaches the plinth and the bund. On a treated-water or a chemical duty that " +
            "is a housekeeping and a safety question as well as a loss, and a seal that is " +
            "leaking is a seal that will fail outright.",
          action:
            "Contain the leak, identify whether it is the seal or the gland, and check alignment " +
            "and the flush or quench arrangement before fitting a replacement — a second seal " +
            "fitted to the same misalignment fails the same way.",
          skill: "mechanical",
        },
      },
      {
        code: "service_due",
        pointKey: "run_hours_h",
        severity: "info",
        category: "operations",
        message:
          "Cumulative run hours past the service interval for this set. The interval is set per " +
          "site from the OEM schedule and the duty.",
        philosophy: {
          cause:
            "The pump has simply run its hours. This is a scheduled-work row and not a fault " +
            "row, which is why it is filed as info.",
          impact:
            "Lubrication, coupling elements and wear rings are consumables on a running hour " +
            "basis. Service deferred long enough stops being maintenance and becomes the bearing " +
            "and vibration alarms above.",
          action:
            "Raise the service against the maintenance plans on this template and reset the " +
            "site's interval reference once the work is signed off.",
          skill: "mechanical",
        },
      },
      {
        code: "short_cycling",
        pointKey: "start_count",
        severity: "warning",
        category: "operations",
        message:
          "Starts accumulating faster than the set is rated for. The alarm binds the cumulative " +
          "counter start_count; the per-hour RATE is the rule's to evaluate, because " +
          "starts_per_hour is a time window and the calc grammar has no state. The permitted " +
          "rate is a site value, from the motor's own starts-per-hour rating.",
        philosophy: {
          cause:
            "A level or pressure switch with too little hysteresis, a passing check valve " +
            "letting the column run back, an undersized receiver or tank, or a controller whose " +
            "start and stop set points have been narrowed.",
          impact:
            "Every start is an inrush the motor is only rated for so many of per hour. Short " +
            "cycling overheats the winding, wears the contactor and the coupling, and shortens " +
            "the bearing life — while every individual start looks entirely normal.",
          action:
            "Widen the hysteresis or the dead band, prove the check valve holds, and confirm the " +
            "tank or receiver volume against the duty before changing the motor.",
          skill: "controls",
        },
      },
    ],
    maintenance: [
      {
        title: "Bearing inspection on vibration or bearing-temperature rise",
        category: "condition_based",
        generationMode: "condition",
        intervalDays: 30,
        estimatedMinutes: 60,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Inspect the bearings when vibration_mms rises toward the site's ISO 20816 zone " +
          "boundary, or when de_bearing_temp_c or nde_bearing_temp_c trends above its band. The " +
          "plan is condition_based and generated in condition mode for that reason; its " +
          "intervalDays is the calendar backstop templateMaintenancePlanSchema requires, not the " +
          "intended trigger. Bearing temperature moves first, vibration second, so a rise in " +
          "either is the work order.",
      },
      {
        title: "Bearing lubrication round",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 30,
        estimatedMinutes: 30,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Grease or top up both bearings to the OEM quantity and grade, and record it. " +
          "Over-greasing raises de_bearing_temp_c exactly as under-greasing does, so the " +
          "quantity is part of the round and not a matter of judgement at the nipple.",
      },
      {
        title: "Mechanical seal, gland and coupling inspection",
        category: "inspection_round",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 60,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Inspect the seal or gland for weep, check the flush or quench line is clear, and " +
          "check the coupling elements and the alignment. seal_leak_state reports the leak once " +
          "it has started; this round is what finds the misalignment that causes it.",
      },
      {
        title: "Motor insulation resistance test",
        category: "predictive",
        generationMode: "calendar",
        intervalDays: 180,
        estimatedMinutes: 60,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Megger the motor with the set isolated and record the reading against " +
          "insulation_resistance_mohm, the entry's one M row. That row carries a null " +
          "sourceDataKeyPattern forever — the value is written by hand, never mapped — so this " +
          "plan is the only thing that produces it, and a falling trend is the warning a winding " +
          "failure gives before it gives any other.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "pump_status", label: "Run status", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "pump_mode", label: "Auto / manual / off selector", unit: null, required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "pump_trip", label: "Trip / fault (overload, dry-run, VFD fault)", unit: null, required: true, sortOrder: 2, meta: CORE },
    // Reused ● — the motor's electrical rows and its two cumulative counters.
    // Referenced, never redeclared: units are seeded write-once.
    { ...MEASURED, pointKey: "current_a", label: "Motor current", unit: "A", required: true, sortOrder: 3, meta: CORE },
    // X-tier and referenced by specific_energy_kwh_kl — legal, and deliberate.
    { ...MEASURED, pointKey: "kw", label: "Motor input power", unit: "kW", required: false, sortOrder: 4, meta: EXTENDED },
    { ...MEASURED, pointKey: "kwh_total", label: "Cumulative energy", unit: "kWh", required: false, sortOrder: 5, meta: EXTENDED },
    // X-tier and referenced by head_m — the second legal optional input.
    { ...MEASURED, pointKey: "suction_pressure_bar", label: "Suction pressure", unit: "bar", required: false, sortOrder: 6, meta: EXTENDED },
    { ...MEASURED, pointKey: "discharge_pressure_bar", label: "Discharge pressure", unit: "bar", required: true, sortOrder: 7, meta: CORE },
    { ...MEASURED, pointKey: "flow_klh", label: "Delivered flow", unit: "KL/hr", required: false, sortOrder: 8, meta: EXTENDED },
    { ...MEASURED, pointKey: "run_hours_h", label: "Cumulative run hours", unit: "h", required: true, sortOrder: 9, meta: CORE },
    // The counter short_cycling binds — starts_per_hour is deferred, and the
    // rate is the rule's to evaluate over this row.
    { ...MEASURED, pointKey: "start_count", label: "Cumulative starts", unit: null, required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "de_bearing_temp_c", label: "Drive-end bearing temperature", unit: "°C", required: false, sortOrder: 11, meta: EXTENDED },
    { ...MEASURED, pointKey: "nde_bearing_temp_c", label: "Non-drive-end bearing temperature", unit: "°C", required: false, sortOrder: 12, meta: EXTENDED },
    { ...MEASURED, pointKey: "winding_temp_c", label: "Motor winding temperature (RTD)", unit: "°C", required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "vibration_mms", label: "Overall vibration velocity, RMS", unit: "mm/s", required: false, sortOrder: 14, meta: EXTENDED },
    { ...MEASURED, pointKey: "seal_leak_state", label: "Mechanical seal / gland leak detect", unit: null, required: false, sortOrder: 15, meta: EXTENDED },
    { ...MEASURED, pointKey: "dry_run_state", label: "Dry-run protection active", unit: null, required: false, sortOrder: 16, meta: EXTENDED },
    // The one M row — a megger reading taken with the set isolated, entered by
    // hand, never mapped. Null pattern forever, so always in skippedPoints.
    { ...MEASURED, pointKey: "insulation_resistance_mohm", label: "Megger IR value", unit: "MΩ", required: false, sortOrder: 17, meta: MANUAL },
    // Derived, appended after the table rows. No meta.tier: the C/X/M column
    // says what the plant has FITTED, and a computed point is fitted by nobody.
    // 10.2 is the document's own metres-of-water-per-bar constant.
    {
      ...derived("({discharge_pressure_bar} - {suction_pressure_bar}) * 10.2"),
      pointKey: "head_m",
      label: "Developed head",
      unit: "m",
      required: false,
      sortOrder: 18,
    },
    // Deferred on electrical-feeder and water-ro, authored here — one code, one
    // meaning, three entries. See the module docblock.
    {
      ...derived("{kw} / {flow_klh}"),
      pointKey: "specific_energy_kwh_kl",
      label: "Specific energy",
      unit: "kWh/KL",
      required: false,
      sortOrder: 19,
    },
  ],
};
