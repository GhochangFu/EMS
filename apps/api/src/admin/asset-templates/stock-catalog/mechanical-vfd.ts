import { CORE, EXTENDED, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The mechanical pack's variable-frequency-drive class — `E5.2`, ADR 0053
 * decisions 1-9, ADR 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2.
 *
 * **SOURCE.** `docs/e5.2-derived-taglist-v1.md` §2 — *"Motor + VFD —
 * variable-frequency drive on any driven load"*. PROVISIONAL: derived from
 * published practice, not client-confirmed. The section's own basis line is the
 * **register block a drive exposes on a fieldbus** — the ABB group 01 pattern,
 * which Danfoss, Schneider and Siemens all carry under other numbers — so the
 * fifteen rows below are what a Modbus or a BACnet gateway on a drive actually
 * reads, and not a wish list.
 *
 * **15 POINTS — 7 core + 8 extended + 0 manual + 0 DERIVED.** §2's 15 table rows
 * in the document's own order (`sortOrder` 0-14) and nothing appended.
 *
 * **THE CHEAP OPPOSITE SHAPE, AND IT IS THE POINT OF THIS ENTRY.** No code here
 * is reused, no code here is promoted, there is no `M` row and there is no
 * formula — the only entry in the pack that is none of those things. The pump
 * before it exercises every mechanism at once; this one exercises the claim that
 * a section with a *Derived:* line owes the vocabulary nothing when none of its
 * ratios is expressible. The water pack's softener held the same position.
 *
 * **THE `vfd_` PREFIX IS A DECISION, NOT UNTIDINESS** (ADR 0053 decision 9). The
 * drive is **its own asset on its own template**, attached to the pump, fan,
 * blower or compressor it drives by the asset group at its location — a
 * parent-child train is a v2 shape behind `F2.10`. So `vfd_power_kw`,
 * `vfd_kwh_total` and `vfd_run_hours_h` are deliberately NOT the motor's `kw`,
 * `kwh_total` and `run_hours_h`, even though those three codes are already
 * vocabulary and reusing them would have saved three seed rows:
 *
 *  - The prefix says **which device reported the number**. A drive's own energy
 *    counter and a separately metered motor's disagree by the drive's losses,
 *    and an operator comparing the two needs to know which is which.
 *  - The two counters count different things. A drive that is powered, enabled
 *    and holding zero speed accumulates a different hour count from the machine
 *    it drives, and `mechanical-pump` declares `run_hours_h` for the machine.
 *
 * `motor_temp_c` is the one row that carries no prefix, and for the same reason
 * read the other way: it is the **motor's** thermal model or PTC, read back
 * through the drive, so it belongs to the driven machine and not to the panel.
 *
 * **`vfd_fault_code` IS TIER C AND NO ALARM BINDS IT.** §2 marks it `C` because
 * a fault flag with no code beside it sends an engineer to the panel to read the
 * display before anybody can act. It is declared as a `code` row with an empty
 * catalogue unit, and `drive_fault` below binds the `0/1` `vfd_fault` flag and
 * carries the vendor code **in its own text** — ADR 0053 decision 5's rule that
 * a vendor fault list is named and never enumerated. An enum per OEM is a v2
 * shape, and a wrong enum is worse than none. The chiller's equivalent row is
 * `X`, because a chiller controller's own alarm text is usually on the panel;
 * the two tiers are the document's and are not to be normalised into one.
 *
 * **THREE DERIVED CODES ARE DEFERRED AND NAMED, never placeholdered** (ADR 0053
 * decision 6; ADR 0051 Amendment 6 decision 8 — a code with no `bms-calc-v1`
 * formula is not vocabulary). All three fall in the **asset-attribute** class:
 * the drive reports frequency, current, torque and power, and it does not report
 * its nameplate. `stock-catalog-deferrals.spec.ts` holds the list and asserts
 * this entry declares none of them:
 *
 *  - `motor_load_pct` — output current ÷ **rated** current. The rated current is
 *    on the motor's nameplate, which is an asset attribute and not a point.
 *  - `energy_saving_vs_dol_kwh` — an affinity-law estimate against a
 *    direct-on-line baseline the drive never had. An attribute **and** a model.
 *  - `speed_pct` — output frequency ÷ **rated** frequency. **Do not hardcode a
 *    division by fifty.** A base frequency of 50 or 60 Hz is a nameplate value,
 *    a drive can be configured above it, and a formula carrying one site's mains
 *    frequency would ship a wrong number to every organization on the other.
 *    `vfd_speed_ref_pct` already carries the COMMANDED speed as a percentage, so
 *    the code would also be a second name for a meaning the table declares.
 *
 * **NO `content.kpis`** (ADR 0053 decision 6, the structural reason `water.ts`
 * and `mechanical.ts` record). Nothing is expressible here, so there is nothing
 * for a KPI to be — and a `content.kpis` entry could not be bound by an alarm in
 * any case.
 *
 * **ALARMS — 7, from §2's six bullets.** *"DC bus over/under-voltage (supply
 * quality)"* splits into two rows binding `vfd_dc_bus_v` at opposite bands: a
 * high bus is a high supply or a regenerating load with nowhere to put the
 * energy, a low bus is a supply dip or a lost input phase, and the two actions
 * are opposite. Same shape as the pump's two `current_a` rows and the feeder's
 * two `voltage_vry` rows. Every row is **pair-absent** — no `thresholdValue`, no
 * `operator` (ADR 0019 Amendment 2, and B7: limit values are set per site at
 * commissioning, and a drive's trip bands are parameters in the drive itself) —
 * and every row carries a populated ADR 0019 §3 `philosophy`, which ADR 0053
 * decision 5 requires of this pack.
 *
 * **`philosophy.skill` is `electrical` ON SIX OF THE SEVEN.** A drive is a panel
 * device and its faults are answered at the panel. The exception is
 * `speed_reference_not_followed`, which is **`mechanical`**: the drive is doing
 * exactly what it was told and the load will not turn, so the fault is on the
 * driven machine — a seized bearing, a jammed impeller, a closed damper on a
 * fan. Sending that one to the electrical trade sends it to the one panel where
 * nothing is wrong. **This entry has no process-chemistry row**: all four of the
 * pack's no-skill rows are the boiler's, and the entry spec passes an empty
 * list, which is a claim rather than a gap because `assertSkillAssignment`
 * requires the map and the list to partition the seven.
 *
 * **MAINTENANCE — 3 plans, PROVISIONAL** (plan §12 ruling 5), derived from ABB
 * and Danfoss drive-manual service schedules, because the tag list has no
 * maintenance section. **None is `safetyCritical`** — ADR 0053 decision 8 names
 * exactly three in the pack and none of them is here — and **none is
 * `condition_based`**, which is authoring rather than omission: a drive's tasks
 * are calendar work, and there is no measured row here whose rise is a work
 * order. `heatsink_temp_high` is an alarm an operator answers now, not a plan
 * that generates a task later. The three are the fewest of any entry in the
 * pack, and that matches a device whose service life is mostly a fan, a
 * capacitor bank and a parameter set.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the site's
 * telemetry wiring — here, the fieldbus register the integrator mapped — which
 * the tag list does not know and the catalog must not guess. An imported draft
 * cannot be instantiated until an operator fills the patterns in.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `mechanical-vfd` **v1** (2026-09-03, `E5.2`): authored from
 *    `e5.2-derived-taglist-v1.md` §2, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const MECHANICAL_VFD: StockAssetTemplateEntry = {
  code: "mechanical-vfd",
  name: "Variable-frequency drive",
  assetType: "vfd",
  domain: "mechanical",
  description:
    "Variable-frequency drive on any driven load — the register block a drive exposes on a " +
    "fieldbus: run, ready and fault status with the vendor fault code, output frequency, speed " +
    "reference, current, voltage, DC bus, torque, power and energy, heatsink and motor " +
    "temperature, and drive run hours. The drive is its own asset and is attached to the pump, " +
    "fan, blower or compressor it drives by the asset group. Authored from " +
    "docs/e5.2-derived-taglist-v1.md §2 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required and X optional; alarm rows carry a meaning and " +
    "no limit, because a drive's trip bands are parameters set in the drive at commissioning. No " +
    "derived point is authored here: every ratio the section names divides by a nameplate value " +
    "the drive does not report.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "drive_fault",
        pointKey: "vfd_fault",
        severity: "critical",
        category: "operations",
        message:
          "Drive fault active — the drive has tripped and the driven machine has stopped. The " +
          "vendor's own fault code is on vfd_fault_code and in the drive's display; it is carried " +
          "in this text rather than enumerated, because a fault list belongs to one OEM.",
        philosophy: {
          cause:
            "Anything the drive protects itself or the motor against — an overcurrent or a short, " +
            "an earth fault, a DC bus excursion, an overtemperature in the drive or the motor, a " +
            "lost input phase, or an encoder or communications loss. The fault code says which.",
          impact:
            "The driven machine has stopped and will not restart until the fault is cleared. " +
            "Whatever duty it was carrying is on its standby if there is one, and on nothing if " +
            "there is not.",
          action:
            "Read the fault code and the drive's own fault log before resetting — the log holds " +
            "the readings at the moment of the trip, and a reset without a cause is the same trip " +
            "again as soon as the machine loads up. A repeated reset also wears the drive.",
          skill: "electrical",
        },
      },
      {
        code: "overcurrent",
        pointKey: "vfd_output_current_a",
        severity: "warning",
        category: "operations",
        message:
          "Drive output current above the band for this motor with the machine running. The band " +
          "is set per site at commissioning, from the motor's nameplate and the duty.",
        philosophy: {
          cause:
            "A mechanical overload on the driven machine, an acceleration ramp too short for the " +
            "inertia, a motor fault such as a shorted turn, or a cable or terminal problem " +
            "between the drive and the motor.",
          impact:
            "The drive is working above the band it was set for and will trip on its own " +
            "protection if the current keeps rising. The motor runs hotter than it is rated for " +
            "in the meantime, and its insulation ages faster.",
          action:
            "Look at the driven machine first — a rising current at a steady speed is a " +
            "mechanical change, not an electrical one. Then check the ramp times and the motor " +
            "and cable insulation.",
          skill: "electrical",
        },
      },
      {
        code: "dc_bus_overvoltage",
        pointKey: "vfd_dc_bus_v",
        severity: "warning",
        category: "operations",
        message:
          "DC bus voltage high. The band is set per site at commissioning, from the drive's own " +
          "rating and the supply.",
        philosophy: {
          cause:
            "A supply voltage above the drive's rating, or a regenerating load — a machine being " +
            "driven by its own inertia or by the process during a deceleration — pushing energy " +
            "back into the bus faster than a brake resistor or a regenerative front end can take " +
            "it away.",
          impact:
            "The drive trips on its own bus protection when the band is exceeded, stopping the " +
            "machine. Sustained high bus voltage also ages the capacitor bank, which is the " +
            "component that decides a drive's service life.",
          action:
            "Check the incoming supply voltage first. If the supply is normal, lengthen the " +
            "deceleration ramp or check the brake resistor and its contactor — a regenerating " +
            "load with no path for the energy is the usual cause.",
          skill: "electrical",
        },
      },
      {
        code: "dc_bus_undervoltage",
        pointKey: "vfd_dc_bus_v",
        severity: "warning",
        category: "operations",
        message:
          "DC bus voltage low. The band is set per site at commissioning, and this is the " +
          "opposite half of the row above: the two bands have opposite causes and opposite " +
          "actions, which is why they are two alarms and not one.",
        philosophy: {
          cause:
            "A supply dip or a brown-out, a lost input phase, a loose incoming terminal, a failing " +
            "pre-charge circuit, or an upstream protective device on its way to opening.",
          impact:
            "The drive trips and the machine stops, usually at the moment the site can least " +
            "afford it, because a supply dip takes several drives at once. A repeated dip that " +
            "does not quite trip stresses the rectifier and the bus capacitors instead.",
          action:
            "Treat it as a supply-quality question rather than a drive question: check the " +
            "incoming phases and terminals, and correlate the time against the site's other " +
            "drives and the incomer. A single drive dipping alone is its own supply path.",
          skill: "electrical",
        },
      },
      {
        code: "heatsink_temp_high",
        pointKey: "vfd_heatsink_temp_c",
        severity: "warning",
        category: "operations",
        message:
          "Drive heatsink temperature high. The band is set per site at commissioning, from the " +
          "drive's rating and the panel's design ambient.",
        philosophy: {
          cause:
            "Panel cooling that has stopped working — a blocked filter, a failed panel or drive " +
            "cooling fan, a door left open in a dusty room — a high room ambient, or a heatsink " +
            "loaded with dust so that the fins no longer move heat.",
          impact:
            "The drive derates itself to protect its own semiconductors, so the machine loses " +
            "speed or torque before anything trips, and it trips if the temperature keeps rising. " +
            "Heat is also what ages the capacitor bank; a drive run warm for years fails early " +
            "for reasons nobody connects to the panel.",
          action:
            "Change or clean the panel filter and prove both the panel fan and the drive's own " +
            "fan are turning, then check the room ambient and the panel's ventilation path. This " +
            "is the alarm the cooling-fan and heatsink-clean plan on this template exists to " +
            "prevent.",
          skill: "electrical",
        },
      },
      {
        code: "motor_temp_high",
        pointKey: "motor_temp_c",
        severity: "warning",
        category: "operations",
        message:
          "Motor temperature high — the drive's own thermal model, or a PTC or thermistor in the " +
          "windings read back through the drive. The band is set per site at commissioning.",
        philosophy: {
          cause:
            "A sustained overload, running at a low speed on a self-ventilated motor whose own " +
            "fan no longer moves enough air, a blocked motor cooling path, a high ambient, or " +
            "frequent starts and stops.",
          impact:
            "Insulation life halves for each step of sustained overheating, so this row is about " +
            "the motor's remaining years rather than about today's production. The drive will " +
            "trip on the motor's protection before the winding fails, if the model or the PTC is " +
            "configured.",
          action:
            "Check the load and the motor's cooling path, and at low speed check whether the " +
            "motor needs forced ventilation for the duty it is being asked for. Confirm the " +
            "drive's thermal model matches the motor's actual nameplate.",
          skill: "electrical",
        },
      },
      {
        code: "speed_reference_not_followed",
        pointKey: "vfd_output_freq_hz",
        severity: "warning",
        category: "operations",
        message:
          "Output frequency below the speed reference while the drive is at its torque limit — " +
          "the drive is being asked for a speed and the load will not turn. vfd_speed_ref_pct is " +
          "the reference this is compared against; the permitted gap and the time it may persist " +
          "are site values.",
        philosophy: {
          cause:
            "Mechanical binding on the driven machine — a seizing bearing, a jammed or fouled " +
            "impeller or rotor, a damper or valve closed against the machine, a coupling failure, " +
            "or a load that has simply grown beyond what the drive was sized for.",
          impact:
            "The drive holds at its torque limit rather than tripping, so the machine keeps " +
            "running at the wrong speed and the process quietly under-delivers. Whatever is " +
            "binding continues to wear, and the eventual failure is a mechanical one.",
          action:
            "Look at the DRIVEN machine, not at the panel: the drive is doing what it was told. " +
            "Stop the set and turn it by hand if the duty allows, check the valve or damper " +
            "line-up, and inspect the coupling and the bearings before raising the torque limit.",
          skill: "mechanical",
        },
      },
    ],
    maintenance: [
      {
        title: "Drive cooling fan and heatsink clean",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 45,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Clean the heatsink fins and the panel filter, and prove both the drive's own fan and " +
          "the panel fan turn freely and quietly. Heat is what decides a drive's service life, " +
          "and a dust-loaded heatsink raises vfd_heatsink_temp_c long before the drive derates " +
          "or trips, so this round is what keeps that alarm quiet.",
      },
      {
        title: "Power-terminal torque check and DC-bus capacitor inspection",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 120,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "With the drive isolated and the DC bus proved discharged, re-torque the incoming and " +
          "motor terminals to the manual's figure and inspect the DC-bus capacitors for bulging, " +
          "venting or leakage. A loose power terminal is the usual cause of a heating joint and " +
          "of a nuisance dc_bus_undervoltage; an aged capacitor bank is what ends a drive's life, " +
          "and a drive that has stood unpowered for a long period needs re-forming before it is " +
          "energised.",
      },
      {
        title: "Parameter backup and fault-log review",
        category: "inspection_round",
        generationMode: "calendar",
        intervalDays: 180,
        estimatedMinutes: 30,
        priority: "low",
        safetyCritical: false,
        triggerSummary:
          "Upload the drive's parameter set to the panel or the maintenance store and read the " +
          "fault log since the last round. The backup is what turns a drive replacement from a " +
          "commissioning exercise into a swap; the log holds the readings at the moment of every " +
          "trip and is the only record of the faults that cleared themselves.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "vfd_status", label: "Drive run status", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "vfd_ready", label: "Drive ready / enabled", unit: null, required: false, sortOrder: 1, meta: EXTENDED },
    { ...MEASURED, pointKey: "vfd_fault", label: "Drive fault active", unit: null, required: true, sortOrder: 2, meta: CORE },
    // Tier C, and NO alarm binds it: drive_fault binds the 0/1 flag above and
    // carries the vendor code in its text. An enum per OEM is a v2 shape.
    { ...MEASURED, pointKey: "vfd_fault_code", label: "Active fault code", unit: null, required: true, sortOrder: 3, meta: CORE },
    { ...MEASURED, pointKey: "vfd_output_freq_hz", label: "Output frequency", unit: "Hz", required: true, sortOrder: 4, meta: CORE },
    { ...MEASURED, pointKey: "vfd_speed_ref_pct", label: "Speed reference / setpoint", unit: "%", required: true, sortOrder: 5, meta: CORE },
    { ...MEASURED, pointKey: "vfd_output_current_a", label: "Motor current", unit: "A", required: true, sortOrder: 6, meta: CORE },
    { ...MEASURED, pointKey: "vfd_output_voltage_v", label: "Output voltage", unit: "V", required: false, sortOrder: 7, meta: EXTENDED },
    // The two dc_bus alarms bind this one row at opposite bands.
    { ...MEASURED, pointKey: "vfd_dc_bus_v", label: "DC bus voltage", unit: "V", required: false, sortOrder: 8, meta: EXTENDED },
    { ...MEASURED, pointKey: "vfd_torque_pct", label: "Motor torque", unit: "%", required: false, sortOrder: 9, meta: EXTENDED },
    // The drive's OWN power, energy and hour counters — deliberately not the
    // motor's kw / kwh_total / run_hours_h. ADR 0053 decision 9: the prefix says
    // which device reported the number, and the two counters count differently.
    { ...MEASURED, pointKey: "vfd_power_kw", label: "Output power", unit: "kW", required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "vfd_kwh_total", label: "Cumulative energy", unit: "kWh", required: false, sortOrder: 11, meta: EXTENDED },
    { ...MEASURED, pointKey: "vfd_heatsink_temp_c", label: "Drive / heatsink temperature", unit: "°C", required: false, sortOrder: 12, meta: EXTENDED },
    // The one unprefixed row: the MOTOR's thermal model or PTC, read back
    // through the drive, so it belongs to the driven machine.
    { ...MEASURED, pointKey: "motor_temp_c", label: "Motor thermal model or PTC", unit: "°C", required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "vfd_run_hours_h", label: "Drive run hours", unit: "h", required: true, sortOrder: 14, meta: CORE },
  ],
};
