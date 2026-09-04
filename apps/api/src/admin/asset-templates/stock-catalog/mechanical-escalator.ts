import { CORE, derived, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The facility pack's escalator class — `E5.3` PR 2, ADR 0054 decisions 1-9,
 * ADR 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2. **The entry that closes
 * the pack**, and the ninth of nine.
 *
 * **SOURCE.** `docs/e5.3-derived-taglist-v1.md` §8b — *"Escalator / travelator
 * (moving walk)"*. PROVISIONAL: derived from published practice, not
 * client-confirmed.
 *
 * **THE CITATION AND THE PREFIX DISAGREE HERE TOO.** The code is
 * `mechanical-escalator`, so the domain is `mechanical` (ADR 0054 decision 2 —
 * the prefix says the domain, and an escalator's motor, energy and vibration
 * codes already live there), while `PACK_SOURCE_DOC` maps that prefix to
 * `e5.2-derived-taglist-v1.md`. `E5.3` Task 11's `ENTRY_SOURCE_DOC` names this
 * code and `mechanical-lift` and is consulted first.
 * `facility-classes-4.spec.ts` proves the mechanism on the lift; it is one
 * mechanism and one entry holds it, so this module is not a second copy of that
 * proof.
 *
 * **41 POINTS — 5 core + 31 extended + 3 manual + 2 DERIVED.** §8b prints
 * **one flat table of forty rows** — it has no sub-blocks, unlike §8a's eight —
 * and thirty-nine of them are measured here in the document's own order
 * (`sortOrder` 0-38). The fortieth POINT OF THIS ENTRY — the handout lists it
 * thirteenth, and the two numbers are different questions —
 * `handrail_speed_dev_pct`, is the section's
 * one `X/D` row and is authored **derived**, so it leaves the measured sequence
 * and is appended at 39 with `kwh_per_run_hour` at 40. Every row after the
 * document's thirteenth therefore sits one index lower than its position on the
 * handout: `sortOrder` is what the stock viewer lists points by, and a gap or a
 * repeat would reorder a screen nobody would think to check.
 *
 * **THE SOURCE TIERS ARE §8a's, and the C set is smaller.** The same four
 * installations report an escalator as report a lift — an OEM portal, a
 * controller gateway, a set of dry contacts, a retrofit sensor kit — and only
 * five rows survive the dry-contact case: running state, mode, fault, the
 * emergency stop and the gateway link. Everything a maintainer actually wants —
 * the speeds, the chain and guard switches, the temperatures, the counters —
 * needs a gateway or the OEM's own feed, which is why thirty-one rows are `X`.
 *
 * **THE BMS OBSERVES ONLY** (ADR 0054 decision 11; §8's own fence). No start,
 * no stop, no direction reversal and no energy-save command is modelled. A
 * template carries no command surface today, and an escalator is the one
 * machine in this pack where a remote start would put somebody on a moving
 * step without warning.
 *
 * **`handrail_speed_dev_pct` IS DERIVED, AND THE FORMULA IS SIGNED** (plan §12
 * ruling 3). It is the one `X/D` row here, and unlike the lift's
 * `entrapment_state` it is genuinely computable from rows this entry declares:
 *
 * ```
 * (min({handrail_speed_l_ms}, {handrail_speed_r_ms}) - {step_speed_ms}) / {step_speed_ms} * 100
 * ```
 *
 * `min` and not `max`, and **no `abs`**. A handrail running BEHIND the step is
 * the hazard: a passenger's hand travels slower than their feet, their body is
 * pulled backwards, and that is the entrapment case the standards band. A
 * handrail running fast is a nuisance by comparison. `abs()` would score the
 * two the same and throw away the direction, and `max()` would report the
 * healthier of the two handrails on a machine with one worn drive — so the
 * value is signed, negative means slipping, and the alarm reads the sign. The
 * band itself is a site value set at commissioning and this template ships
 * none. The escalator's second promotion, **`kwh_per_run_hour`** =
 * `{kwh_total} / {run_hours_h}`, is a lifetime ratio over cumulative counters
 * (`E5.2`'s `load_factor_pct` shape); its unit is `kWh/h` rather than `kW`
 * (plan §12 ruling 7) because the two are dimensionally the same and only
 * `kWh/h` says the quantity is an average over the machine's life rather than a
 * present demand.
 *
 * **DIVISION BY ZERO IS HANDLED AND MUST NOT BE GUARDED.** `step_speed_ms`
 * reads zero on a stopped escalator and `run_hours_h` reads zero on a freshly
 * reset controller; `bms-calc-v1` returns `non_finite` and the point simply has
 * **no value**, which is the correct outcome. A `clamp` would ship a fabricated
 * handrail deviation for a machine that is not moving. Both formulas reference
 * `X`-tier inputs, which is legal and deliberate — a site with no speed sensors
 * gets no deviation — and neither carries a `maxInputAgeSeconds` override; the
 * pack's only two are the IAQ node's, whose outdoor reference is a slow *"site
 * or API"* input.
 *
 * **THIRTEEN CODES ARE REUSED — REFERENCED HERE, REDECLARED NOWHERE** (ADR
 * 0054 decision 3), the most of any entry in the pack and ten of them the
 * lift's. `controller_comms_ok` is §3's, declared on `facility-access-door` in
 * PR 1 — the dependency that made PR 2 a branch cut from `main` rather than a
 * stacked one. `brake_state`, `brake_temp_c`, `passenger_count`,
 * `annual_inspection_due` and `brake_test_result` are §8a's, declared on the
 * lift one commit ago. `motor_current_a`, `motor_temp_c`, `kw`, `kwh_total`,
 * `run_hours_h`, `start_count` and `vibration_mms` were seeded by `E5.2` and
 * earlier. Each carries the unit the vocabulary already holds, because a
 * template `unit` is an **override** and `UNIT_BY_KEY`'s seed is
 * `COALESCE(existing, excluded)` — a wrong one here could not be corrected by a
 * later seed. **The labels differ from the lift's on purpose**: `brake_state`
 * on a lift is the machine brake that holds a car, and on an escalator it is
 * the operational brake that stops a descent, so each entry spells the row the
 * way its own section does.
 *
 * **`vibration_mms` IS THE PUMP's CODE AND NOT THE LIFT's.** §8a measures ride
 * quality in milli-g on three axes (`vibration_x_mg`, `_y_`, `_z_`) because a
 * passenger inside a car feels acceleration; §8b measures machine vibration in
 * `mm/s` RMS because there is no car and the quantity is bearing and chain
 * condition — the same thing a pump measures, and the same code.
 *
 * **VENDOR FAULT CODES ARE CARRIED IN THE ALARM TEXT, NEVER ENUMERATED.**
 * `esc_fault_code` and `safety_device_tripped` are `code`/`enum` rows with
 * empty units, and the alarms bind the flags beside them — `esc_fault` and
 * `safety_circuit_ok`. **That is the trap this entry carries:**
 * `safety_device_tripped` is spelled the same as an alarm code and as a point
 * code, and the alarm binds `safety_circuit_ok`. Binding the enum would
 * typecheck, would pass `checkEntry`, and would ship a rule that fires on a
 * device identifier rather than on an open chain.
 *
 * **SIX DERIVED CODES ARE DEFERRED AND NAMED, TWO ARE PROMOTED** (plan §5.0,
 * §12 ruling 2). §8b's *Derived:* line names eight:
 *
 *  - **Promoted** — `handrail_speed_dev_pct` and `kwh_per_run_hour`, above.
 *  - **Four time windows** the grammar has no clock or memory for —
 *    `availability_pct` and `mtbf_h` (both deferred on the lift as well, for
 *    the same reason), `starts_per_day` (the DG set's code a third time, over
 *    the cumulative `start_count` this entry declares) and
 *    `safety_trips_per_month`.
 *  - **One whose denominator the document never fixes** —
 *    `standby_ratio_pct`. Standby over run time, or standby over run plus
 *    standby? The two answers differ by the whole idle band, and a definition
 *    picked under the right name is worse than a deferral. `esc_status` carries
 *    the energy-save state and `standby_hours_h` counts it, so a site that
 *    fixes the definition has both inputs.
 *  - **One commissioning baseline** — `motor_current_baseline_dev_pct` is a
 *    deviation from a current recorded when the machine was new, an attribute
 *    nothing here declares. `motor_current_a` is declared and the trend is the
 *    site's.
 *
 * **NO `content.kpis`** (ADR 0054 decision 6).
 *
 * **FIFTEEN ALARMS FROM THIRTEEN BULLETS** — *e-stop / safety device tripped*
 * and *motor / gearbox temperature high* are each one bullet over two distinct
 * declared points and each splits, because an emergency stop somebody pressed
 * and a safety chain a device opened have different responders, and a hot motor
 * winding is electrical while hot gear oil is mechanical. Every row is
 * **pair-absent**: no `thresholdValue`, no `operator` (ADR 0019 Amendment 2,
 * ADR 0054 decision 5, B7), with a populated `philosophy` instead.
 *
 * **NO SAFETY ROW CARRIES A NUMBER.** The standards that govern an escalator
 * fix what the safety devices ARE and fix the handrail band as a tolerance
 * around *that* machine's own step speed. A travelator, a three-metre rise in a
 * shop and a long metro rise are one class here and are commissioned to
 * different values, and the brake's stopping distance is set against the rated
 * speed and the loaded direction. The standard designations themselves are kept
 * out of the three rows `facility-classes-5.spec.ts` names, for the plain
 * reason that they contain digits and the rule is a rule about the row; they
 * live in that file's regime constant, which is printed only when a row fails.
 *
 * **ONE ALARM CARRIES NO `skill`** — `emergency_stop_pressed` (plan §12 ruling
 * 4; with the lift's `fire_recall_active` it is the second of PR 2's two and
 * the pack's sixteenth). A pressed emergency stop is a person: a passenger who
 * saw something, a shop assistant with a trolley wedged at the comb plate, a
 * child playing with the button at the newel. Nothing is broken, no engineer is
 * dispatched by the press itself, and if there is damage the rows that report
 * it — `safety_device_tripped`, `missing_step` — do carry `mechanical`. That is
 * the distinction the fire panel set and not an exception to it: a trade
 * answers the machine's own infrastructure, and none of migration `0034`'s five
 * trades answers the event the machine reports.
 *
 * **MAINTENANCE — 5 plans, PROVISIONAL** (ADR 0054 decision 8), derived from
 * EN 115 / IS 4591 practice, the state Lift Act licensing regime and OEM
 * service schedules, because the tag list has no maintenance section. **Three
 * are `safetyCritical`**: the comb-plate, skirt and handrail-inlet switch
 * check, the step-chain tension and elongation measurement, and the
 * safety-circuit and brake stopping-distance test — the switches that stop the
 * machine when something is caught, the chain whose failure drops the steps,
 * and the brake that has to hold a loaded descent. **The annual statutory
 * inspection is `compliance` and NOT `safetyCritical`**, which is the boiler's
 * IBR shape and is plan §12 ruling 6's explicit split: decision 8 names the
 * *lift's* inspection critical, because a lift is a suspended car over a shaft
 * and its licence is what makes it legal to carry a passenger, and names the
 * escalator's three physical checks instead. **None is `condition_based`**, and
 * the absence is deliberate: an escalator runs one duty cycle, starting in the
 * morning and stopping at night, so `start_count` and `run_hours_h` move at the
 * same rate on a busy machine and a quiet one in the same building. There is no
 * wear counter here of the lift door operator's kind.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the
 * site's telemetry wiring — an OEM API field, a controller register, a relay
 * contact or a retrofit sensor's topic — which the tag list does not know and
 * the catalog must not guess.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `mechanical-escalator` **v1** (2026-09-04, `E5.3`): authored from
 *    `e5.3-derived-taglist-v1.md` §8b, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const MECHANICAL_ESCALATOR: StockAssetTemplateEntry = {
  code: "mechanical-escalator",
  name: "Escalator / travelator",
  assetType: "escalator",
  domain: "mechanical",
  description:
    "One escalator or travelator, as an OEM portal, a controller gateway, a set of dry contacts " +
    "or a retrofit sensor kit presents it: running state, direction and mode, the fault and its " +
    "vendor code, the emergency stop and the safety chain with the device that opened it, step " +
    "and handrail speeds with the deviation between them, the drive motor, gearbox and brakes, " +
    "the chain, step and guard switches, the truss and machine space, the energy, run-hour, " +
    "start and standby counters, and the statutory inspection date, chain-stretch measurement " +
    "and brake test result entered by hand. THE BMS OBSERVES ONLY — no start, no stop, no " +
    "direction reversal and no energy-save command is modelled. Authored from " +
    "docs/e5.3-derived-taglist-v1.md §8b (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are what dry contacts alone give and are required, X needs " +
    "an OEM feed, a controller gateway or a retrofit sensor and is optional, and the three M " +
    "rows are entered by hand; alarm rows carry a meaning and no limit, because the handrail " +
    "band, the stopping distance and the vibration band are all set against this machine's own " +
    "rated speed at commissioning.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "esc_out_of_service",
        pointKey: "esc_status",
        severity: "critical",
        category: "operations",
        message:
          "Escalator stopped outside energy-save standby. A machine in standby is waiting for a " +
          "passenger; a machine that is simply stopped is out of service.",
        philosophy: {
          cause:
            "A latched fault, a safety device that opened and was never reset, an emergency stop " +
            "left pressed, inspection mode left engaged, or a supply the machine has lost.",
          impact:
            "A stopped escalator is a staircase with the wrong tread geometry, and people use it " +
            "as one anyway. In a metro concourse or a mall atrium it also reverses the flow " +
            "everyone expects, which is where the crowding starts.",
          action:
            "Read esc_mode and esc_fault beside this row: a machine in inspection mode is " +
            "somebody working on it, and a machine in fault is not. Check esc_emergency_stop and " +
            "safety_circuit_ok before calling anyone — a pressed stop button is reset on site. " +
            "Barrier the entry and the exit before the machine is left standing.",
          skill: "mechanical",
        },
      },
      {
        code: "esc_fault",
        pointKey: "esc_fault",
        severity: "critical",
        category: "operations",
        message:
          "Controller fault active. The vendor's own fault code is in esc_fault_code and is " +
          "carried in words rather than enumerated here — a stock template cannot hold several " +
          "manufacturers' fault dictionaries.",
        philosophy: {
          cause:
            "Anything the controller decides it cannot continue with: a drive trip, a speed or " +
            "encoder fault, a brake monitoring failure, a chain or step monitor, a supply " +
            "disturbance, or a communication failure inside the machine.",
          impact:
            "The machine stops, usually with a controlled brake application, and stays stopped. " +
            "Passengers on the steps at the moment of the stop are the exposure, and a crowded " +
            "escalator stopping under load is how people fall forward into each other.",
          action:
            "Confirm nobody is hurt and clear the machine before diagnosing anything. Then read " +
            "esc_fault_code at the controller or in the OEM portal and give that code to the " +
            "service contractor: the code is the diagnosis and this flag is only the " +
            "notification.",
          skill: "mechanical",
        },
      },
      {
        code: "emergency_stop_pressed",
        pointKey: "esc_emergency_stop",
        severity: "warning",
        category: "safety",
        message:
          "Emergency stop pressed. Somebody at the machine decided it had to stop, and the " +
          "machine did exactly what it was asked to do.",
        philosophy: {
          cause:
            "A passenger who saw something, a shop assistant with a trolley or a suitcase wedged " +
            "at the comb plate, a cleaner clearing a spill, or a child playing with the button " +
            "at the newel. The machine does not distinguish between them and neither does this " +
            "row.",
          impact:
            "The escalator stops under whatever load it was carrying. Nothing is broken by the " +
            "press itself, but the reason for it may be — and until somebody looks, an unattended " +
            "stopped machine is also an obstacle in a walking route.",
          action:
            "Send somebody to look before touching the reset. Check the comb plates, the skirts " +
            "and the steps for whatever caused the press, read safety_circuit_ok and " +
            "safety_device_tripped to see whether a device also opened, and only then release " +
            "the button and restart from the key switch. A reset from a control room, without " +
            "eyes on the machine, restarts it under the person who pressed it.",
        },
      },
      {
        code: "safety_device_tripped",
        pointKey: "safety_circuit_ok",
        severity: "critical",
        category: "safety",
        message:
          "Safety chain open. The device that opened it is named in safety_device_tripped and is " +
          "carried in words here, never enumerated: the chain is what this row binds, and which " +
          "link opened is what the enum beside it says.",
        philosophy: {
          cause:
            "A comb plate struck, a skirt panel deflected against a trapped object, a handrail " +
            "inlet guard operated, a step chain slack or broken, a drive chain monitor, a " +
            "handrail break, or a speed or reversal monitor. Every one of them is a guard doing " +
            "its job.",
          impact:
            "The machine stops and cannot restart until the device is found, cleared and reset " +
            "by hand. A tripped guard almost always means something was caught: a shoe, a shoe " +
            "lace, a trolley wheel, a coat, a finger. The stop is the good outcome.",
          action:
            "Treat this as a person until proved otherwise. Attend, look for what is trapped, and " +
            "do not reset until the machine is clear — a reset with an object still in the comb " +
            "plate destroys the comb and can take the step band with it. Read " +
            "safety_device_tripped for the device, clear it, reset at the machine and record the " +
            "cause; a device that trips repeatedly is a machine to take out of service.",
          skill: "mechanical",
        },
      },
      {
        code: "missing_step",
        pointKey: "missing_step_state",
        severity: "critical",
        category: "safety",
        message:
          "Missing or broken step detected. The step band has a gap in it, and the monitor that " +
          "found the gap has stopped the machine.",
        philosophy: {
          cause:
            "A broken step axle or roller, a step that has dropped out of the band, a chain " +
            "failure that has let a step sag, or the sinking of a step under load that the " +
            "monitor reads as an absence.",
          impact:
            "This is the escalator failure that injures people. A gap in the step band is a hole " +
            "a passenger falls into at walking speed with a moving handrail pulling them " +
            "forward, and the steps behind it keep arriving.",
          action:
            "The machine must stay stopped. Barrier both ends, do not attempt a reset, and call " +
            "the service contractor as an emergency: a missing step is not something a site " +
            "team clears. Inspect the whole band and the chain before the machine runs again, " +
            "because the step that is gone was held by the parts that are still there.",
          skill: "mechanical",
        },
      },
      {
        code: "handrail_speed_deviation_high",
        pointKey: "handrail_speed_dev_pct",
        severity: "critical",
        category: "safety",
        message:
          "Handrail slipping behind the step band — the entrapment case. The value is signed and " +
          "computed from the slower of the two handrails, so a negative reading is the direction " +
          "that matters. Inert unless step_speed_ms and both handrail speeds are mapped: all " +
          "three are optional, and a stopped machine reads step speed as zero, so an unfitted " +
          "site looks like a healthy one.",
        philosophy: {
          cause:
            "A worn or glazed handrail drive, a slack or stretched handrail, a contaminated " +
            "friction wheel, a failing tension roller, or a handrail that has taken up dirt and " +
            "grease from the newel.",
          impact:
            "A passenger's hand travels slower than their feet. On a rise, that pulls the body " +
            "backwards and the arm behind, which is how people fall on escalators — and children " +
            "and older passengers, who hold on hardest, are the ones it takes.",
          action:
            "Read handrail_speed_l_ms and handrail_speed_r_ms against step_speed_ms to see which " +
            "side is slipping, then have the handrail drive, the friction wheel and the tension " +
            "checked and the handrail cleaned. Treat a persistent deviation as a reason to take " +
            "the machine out of service rather than as a job for the next visit.",
          skill: "mechanical",
        },
      },
      {
        code: "motor_temp_high",
        pointKey: "motor_temp_c",
        severity: "warning",
        category: "operations",
        message:
          "Drive motor winding temperature above the band recorded for this machine. The band is " +
          "the motor's insulation class against the truss's own ambient, which is a site value.",
        philosophy: {
          cause:
            "A machine space with no ventilation on a hot day, a motor working against a " +
            "dragging brake or a stiff chain, a supply imbalance or a lost phase, a blocked " +
            "cooling path, or simply a machine running fully loaded for longer than it was " +
            "sized for.",
          impact:
            "Winding insulation ages by temperature and does not recover. A motor run hot for a " +
            "season is a motor that fails in the season after, and an escalator motor sits inside " +
            "a truss where nobody notices the heat.",
          action:
            "Read motor_current_a and machine_space_temp_c beside this row: a hot motor at normal " +
            "current is a ventilation problem and a hot motor at high current is a mechanical " +
            "one. Check the supply and the machine space airflow first, then the brake for drag " +
            "and the chains for tension.",
          skill: "electrical",
        },
      },
      {
        code: "gearbox_temp_high",
        pointKey: "gearbox_temp_c",
        severity: "warning",
        category: "operations",
        message:
          "Reduction gear oil temperature above the band. Gear oil temperature is a bearing and " +
          "lubrication reading before it is a heat reading.",
        philosophy: {
          cause:
            "Oil low, degraded or the wrong grade, a worn worm or bearing, a misaligned coupling, " +
            "a machine space with no ventilation, or a machine carrying more load than the " +
            "gearbox was selected for.",
          impact:
            "Hot oil thins, the film between the gear faces goes, and the wear that follows is " +
            "the wear that ends in a gearbox change — the longest and most expensive stoppage an " +
            "escalator has, because the truss usually has to be opened.",
          action:
            "Read gearbox_oil_level_low first: a low level is the cheapest cause and the easiest " +
            "to fix. Then check the oil condition and grade against the service schedule, the " +
            "machine space ventilation, and the drive chain tension. Rising temperature with a " +
            "correct oil level and a clean machine space is a bearing.",
          skill: "mechanical",
        },
      },
      {
        code: "gearbox_oil_low",
        pointKey: "gearbox_oil_level_low",
        severity: "warning",
        category: "operations",
        message: "Gearbox oil level low. The float or probe in the reduction gear has dropped.",
        philosophy: {
          cause:
            "A seal leaking at the output shaft, a breather passing oil, a drain plug weeping, " +
            "or simply consumption nobody has topped up since the last service.",
          impact:
            "A gearbox running low does not fail today; it fails after the gear faces have run " +
            "without their oil film long enough to wear. The leak is also a slip hazard wherever " +
            "the oil is reaching, which on an escalator is the truss floor or the pit.",
          action:
            "Find the leak before topping up, or the level will be low again by the next round. " +
            "Check the output seal, the breather and the plugs, top up with the grade the OEM " +
            "specifies, and read gearbox_temp_c to see whether the machine has already been " +
            "running hot.",
          skill: "mechanical",
        },
      },
      {
        code: "brake_fault",
        pointKey: "aux_brake_tripped",
        severity: "critical",
        category: "safety",
        message:
          "Auxiliary or safety brake tripped. This is the second brake, and it operates when the " +
          "operational brake has not held.",
        philosophy: {
          cause:
            "An overspeed on the descending direction, an unintended reversal on the rise, a " +
            "broken drive chain, or a step band that has run away from the machine brake. The " +
            "auxiliary brake grips the main drive shaft directly.",
          impact:
            "The machine has already had a failure the operational brake did not catch, and " +
            "passengers have felt it. An escalator running away downwards under a crowd is the " +
            "worst outcome this machine has, and this device is the barrier against it.",
          action:
            "Do not reset and do not run the machine. Barrier both ends and call the service " +
            "contractor as an emergency: the auxiliary brake tripping means the drive chain, the " +
            "operational brake or the machine itself needs proving before anyone stands on it " +
            "again. Read brake_state and brake_temp_c for the state of the first brake.",
          skill: "mechanical",
        },
      },
      {
        code: "lubrication_fault",
        pointKey: "lubrication_fault",
        severity: "warning",
        category: "operations",
        message:
          "Automatic lubricator low or faulted. The step and drive chains are lubricated by a " +
          "pump on a timer, and the pump is reporting that it cannot.",
        philosophy: {
          cause:
            "The lubricant reservoir empty, a blocked or split feed line, a brush or nozzle worn " +
            "away from the chain, or a pump or its timer failed.",
          impact:
            "Chain wear stops being gradual. A dry step chain stretches, and step chain " +
            "elongation is what the six-monthly measurement exists to catch — an unlubricated " +
            "chain reaches the replacement figure years early, and a chain failure drops steps.",
          action:
            "Refill the reservoir and prove the pump delivers to both chains, checking the lines, " +
            "the brushes and the nozzle positions. Read step_chain_tension_ok and " +
            "step_chain_elongation_pct to see what the dry period has already cost, and bring the " +
            "next chain measurement forward if the fault has been standing.",
          skill: "mechanical",
        },
      },
      {
        code: "truss_water",
        pointKey: "truss_water_state",
        severity: "warning",
        category: "safety",
        message:
          "Water in the pit or the truss. The lower landing pit is the low point of the whole " +
          "machine and everything in the truss drains into it.",
        philosophy: {
          cause:
            "Rain driven into an external or semi-external machine, a washdown at the landing, a " +
            "leaking service in the ceiling above, a blocked pit drain, or ground water in a " +
            "basement landing.",
          impact:
            "The truss holds the drive, the controller, the chains and the wiring. Standing water " +
            "rusts the step chain and the truss steel from below where nobody looks, and reaches " +
            "the controller enclosure and the earth path before it reaches anything visible.",
          action:
            "Pump out and find where the water came from — a pit that fills again is the real " +
            "fault. Clear the drain, check the controller enclosure and the wiring for ingress, " +
            "and inspect the chain and truss steel for corrosion before returning the machine to " +
            "service.",
          skill: "civil",
        },
      },
      {
        code: "vibration_high",
        pointKey: "vibration_mms",
        severity: "warning",
        category: "operations",
        message:
          "Drive machine vibration velocity above the band recorded for this machine when it was " +
          "new. Vibration on an escalator is chain, bearing and alignment condition.",
        philosophy: {
          cause:
            "A stretched or dry step chain, a worn step roller, a drive chain slack, a failing " +
            "gearbox or motor bearing, a misaligned coupling, or a loose fixing between the " +
            "machine and the truss.",
          impact:
            "Passengers feel it as a rumble long before anything trips, and a machine that " +
            "vibrates is wearing itself faster than the service interval assumes. It is also the " +
            "earliest warning of the chain and bearing failures that stop the machine outright.",
          action:
            "Compare against the value recorded at commissioning rather than against another " +
            "machine — trusses differ. Check the chain tension and lubrication first, then the " +
            "step rollers, the drive chain, the bearings and the machine fixings, and read " +
            "gearbox_temp_c for a bearing that is heating as well as shaking.",
          skill: "mechanical",
        },
      },
      {
        code: "controller_comms_loss",
        pointKey: "controller_comms_ok",
        severity: "critical",
        category: "operations",
        message:
          "Gateway to escalator controller link down. Every other row on this template is now " +
          "stale, and a stale row looks exactly like a healthy one.",
        philosophy: {
          cause:
            "The gateway down or rebooting, a serial or network cable disturbed in the truss, a " +
            "controller power cycle, an address or protocol change after a service visit, or an " +
            "OEM feed that has stopped delivering.",
          impact:
            "The building is blind to this machine. A safety device could open, a step could go " +
            "missing and a handrail could slip, and the monitoring would keep showing the last " +
            "healthy values it received. This is the silent failure of the whole template.",
          action:
            "Restore the link before treating any other reading on this machine as current. " +
            "Check the gateway, the physical run inside the truss, and whether a service visit " +
            "changed the controller's address. Until it is back, inspect the escalator visually " +
            "on the walking round.",
          skill: "controls",
        },
      },
      {
        code: "statutory_inspection_overdue",
        pointKey: "annual_inspection_due",
        severity: "warning",
        category: "safety",
        message:
          "Statutory inspection date passed. The date is a manual row: somebody types it in when " +
          "the certificate is issued, and no reading on this template can correct it.",
        philosophy: {
          cause:
            "The inspection not booked, an inspector who has not attended, a certificate issued " +
            "and never recorded, or a date nobody has updated since the machine was handed over.",
          impact:
            "An escalator running past its inspection is running without a current licence under " +
            "the state's Lift Act. That is an operating and an insurance exposure before it is a " +
            "technical one, and no telemetry on this template would ever reveal it.",
          action:
            "Book the inspection with the licensed inspector, and update annual_inspection_due " +
            "the day the certificate is issued. Treat a date nobody has updated as an overdue " +
            "inspection until somebody produces the certificate.",
          skill: "mechanical",
        },
      },
    ],
    maintenance: [
      {
        title: "Comb-plate, skirt and handrail-inlet safety-switch check",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 30,
        estimatedMinutes: 60,
        priority: "critical",
        safetyCritical: true,
        triggerSummary:
          "Prove each guard switch stops the machine: strike the comb plates at both landings, " +
          "deflect the skirt panels along both sides, and operate the handrail inlet guards, " +
          "checking comb_plate_state, skirt_switch_state and handrail_inlet_state as each is " +
          "tested. Inspect the comb teeth for damage and the skirt clearance and lubrication " +
          "while the panels are being worked. These are the devices that stop the machine when " +
          "a shoe, a lace or a finger is caught, and they are the only barriers on this machine " +
          "that are tested rather than monitored.",
      },
      {
        title: "Step-chain tension and elongation measurement",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 120,
        priority: "critical",
        safetyCritical: true,
        triggerSummary:
          "Measure step chain elongation against the OEM's replacement figure for this machine " +
          "and record it against step_chain_elongation_pct, the M row this entry declares for " +
          "it, and check chain tension, the tension carriage travel and the step rollers. A " +
          "stretched chain sags, a sagging chain lets a step drop, and step_chain_tension_ok " +
          "reports a switch that has already operated rather than the margin remaining.",
      },
      {
        title: "Safety-circuit and brake stopping-distance test",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 180,
        priority: "critical",
        safetyCritical: true,
        triggerSummary:
          "Walk the whole safety circuit device by device, proving each opens the chain and " +
          "stops the machine, then measure the operational brake's stopping distance in the " +
          "descending direction against this machine's rated speed and record the result against " +
          "brake_test_result. Prove the auxiliary brake and the drive chain monitor as part of " +
          "the same visit. The brake is what holds a loaded descent, and aux_brake_tripped " +
          "reports the second barrier operating rather than the first one's margin.",
      },
      {
        title: "Annual statutory inspection",
        category: "compliance",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 240,
        priority: "high",
        safetyCritical: false,
        complianceRef: "State Lift Act licence",
        triggerSummary:
          "Book the licensed inspector, present the machine and its records for the statutory " +
          "examination, and update annual_inspection_due the day the certificate is issued. The " +
          "licence is what makes the escalator legal to run, it is renewed state by state, and " +
          "statutory_inspection_overdue fires off the date this task sets. Categorised " +
          "compliance rather than safety_critical: the physical barriers are tested by the three " +
          "tasks above, and this one is the paperwork that records that they were.",
      },
      {
        title: "Drive lubrication and gearbox oil service",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 90,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Refill and prove the automatic lubricator to both chains, checking the lines, brushes " +
          "and nozzle positions, and service the gearbox oil to the grade and interval the OEM " +
          "specifies. Clear whatever gearbox_oil_level_low and lubrication_fault are reporting " +
          "and confirm both rows are clean before leaving. A dry step chain stretches years " +
          "early, which is why this round sits between the six-monthly chain measurements " +
          "rather than beside the annual inspection.",
      },
    ],
  },
  points: [
    // ---- Service, mode and fault. §8b prints one flat table with no
    // sub-blocks; these comments are a reading aid and not the document's own
    // headings. The five C rows are what a dry-contact interface alone gives.
    { ...MEASURED, pointKey: "esc_status", label: "Running / stopped / standby (slow)", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "esc_direction", label: "Up / down (travelator: forward / reverse)", unit: null, required: false, sortOrder: 1, meta: EXTENDED },
    { ...MEASURED, pointKey: "esc_mode", label: "Normal / inspection / energy-save / out of service", unit: null, required: true, sortOrder: 2, meta: CORE },
    { ...MEASURED, pointKey: "esc_fault", label: "Fault active", unit: null, required: true, sortOrder: 3, meta: CORE },
    // The vendor's fault dictionary is carried in the alarm text, never enumerated.
    { ...MEASURED, pointKey: "esc_fault_code", label: "Active fault code", unit: null, required: false, sortOrder: 4, meta: EXTENDED },
    // ---- The safety chain, and the enum that says which link opened it. The
    // alarms bind the flags — esc_emergency_stop and safety_circuit_ok — and
    // name the enum in their text.
    { ...MEASURED, pointKey: "esc_emergency_stop", label: "E-stop pressed", unit: null, required: true, sortOrder: 5, meta: CORE },
    { ...MEASURED, pointKey: "safety_circuit_ok", label: "Safety chain closed (comb plates, skirt, handrail inlet, step chain, broken step)", unit: null, required: false, sortOrder: 6, meta: EXTENDED },
    { ...MEASURED, pointKey: "safety_device_tripped", label: "Which safety device opened the chain", unit: null, required: false, sortOrder: 7, meta: EXTENDED },
    // Referenced: §3's code, declared on facility-access-door in PR 1.
    { ...MEASURED, pointKey: "controller_comms_ok", label: "Gateway ↔ escalator controller link healthy", unit: null, required: true, sortOrder: 8, meta: CORE },
    // ---- Speeds — the three inputs handrail_speed_dev_pct is computed from.
    { ...MEASURED, pointKey: "step_speed_ms", label: "Step / pallet speed", unit: "m/s", required: false, sortOrder: 9, meta: EXTENDED },
    { ...MEASURED, pointKey: "handrail_speed_l_ms", label: "Left handrail speed", unit: "m/s", required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "handrail_speed_r_ms", label: "Right handrail speed", unit: "m/s", required: false, sortOrder: 11, meta: EXTENDED },
    // The document's next row is handrail_speed_dev_pct (X/D). It is authored
    // DERIVED and appended at sortOrder 39, so every row below sits one index
    // lower than its position on the handout.
    // ---- Drive, gearbox and brakes. motor_current_a and motor_temp_c are
    // E5.2's codes; brake_state and brake_temp_c are §8a's, and the labels are
    // this machine's rather than the lift's.
    { ...MEASURED, pointKey: "motor_current_a", label: "Drive motor current", unit: "A", required: false, sortOrder: 12, meta: EXTENDED },
    { ...MEASURED, pointKey: "motor_temp_c", label: "Drive motor winding temperature", unit: "°C", required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "gearbox_temp_c", label: "Reduction gear oil temperature", unit: "°C", required: false, sortOrder: 14, meta: EXTENDED },
    { ...MEASURED, pointKey: "gearbox_oil_level_low", label: "Gearbox oil level low", unit: null, required: false, sortOrder: 15, meta: EXTENDED },
    { ...MEASURED, pointKey: "brake_state", label: "Operational brake applied", unit: null, required: false, sortOrder: 16, meta: EXTENDED },
    { ...MEASURED, pointKey: "brake_temp_c", label: "Brake temperature", unit: "°C", required: false, sortOrder: 17, meta: EXTENDED },
    { ...MEASURED, pointKey: "aux_brake_tripped", label: "Auxiliary / safety brake tripped", unit: null, required: false, sortOrder: 18, meta: EXTENDED },
    // ---- Chains, steps and the guard switches. Every one of these is a device
    // that opens the safety chain, and the three monthly-tested ones are the
    // comb plate, the skirt and the handrail inlet.
    { ...MEASURED, pointKey: "step_chain_tension_ok", label: "Step chain tension switch", unit: null, required: false, sortOrder: 19, meta: EXTENDED },
    { ...MEASURED, pointKey: "drive_chain_ok", label: "Main drive chain monitor", unit: null, required: false, sortOrder: 20, meta: EXTENDED },
    { ...MEASURED, pointKey: "missing_step_state", label: "Missing / broken step detected", unit: null, required: false, sortOrder: 21, meta: EXTENDED },
    { ...MEASURED, pointKey: "comb_plate_state", label: "Comb plate impact switch (upper / lower)", unit: null, required: false, sortOrder: 22, meta: EXTENDED },
    { ...MEASURED, pointKey: "skirt_switch_state", label: "Skirt deflection switch", unit: null, required: false, sortOrder: 23, meta: EXTENDED },
    { ...MEASURED, pointKey: "handrail_inlet_state", label: "Handrail inlet guard switch", unit: null, required: false, sortOrder: 24, meta: EXTENDED },
    { ...MEASURED, pointKey: "passenger_sensor_state", label: "Entry sensor (auto-start / energy-save)", unit: null, required: false, sortOrder: 25, meta: EXTENDED },
    // Referenced: §8a's code, counted here from the entry sensor rather than
    // from a load-weighing estimate.
    { ...MEASURED, pointKey: "passenger_count", label: "Passengers (entry sensor count, interval)", unit: null, required: false, sortOrder: 26, meta: EXTENDED },
    // ---- Truss and machine space. vibration_mms is the pump's code and not
    // the lift's three milli-g axes: there is no car here, and the quantity is
    // bearing and chain condition.
    { ...MEASURED, pointKey: "machine_space_temp_c", label: "Truss / machine space temperature", unit: "°C", required: false, sortOrder: 27, meta: EXTENDED },
    { ...MEASURED, pointKey: "truss_water_state", label: "Water in pit / truss", unit: null, required: false, sortOrder: 28, meta: EXTENDED },
    { ...MEASURED, pointKey: "lubrication_fault", label: "Auto-lubricator low / fault", unit: null, required: false, sortOrder: 29, meta: EXTENDED },
    { ...MEASURED, pointKey: "vibration_mms", label: "Drive machine vibration velocity", unit: "mm/s", required: false, sortOrder: 30, meta: EXTENDED },
    // ---- Energy and usage counters, all referenced codes.
    { ...MEASURED, pointKey: "kw", label: "Input power", unit: "kW", required: false, sortOrder: 31, meta: EXTENDED },
    { ...MEASURED, pointKey: "kwh_total", label: "Energy, cumulative", unit: "kWh", required: false, sortOrder: 32, meta: EXTENDED },
    { ...MEASURED, pointKey: "run_hours_h", label: "Run hours", unit: "h", required: false, sortOrder: 33, meta: EXTENDED },
    { ...MEASURED, pointKey: "start_count", label: "Starts (auto-start units), cumulative", unit: null, required: false, sortOrder: 34, meta: EXTENDED },
    { ...MEASURED, pointKey: "standby_hours_h", label: "Hours in energy-save standby", unit: "h", required: false, sortOrder: 35, meta: EXTENDED },
    // ---- Manual / statutory — three M rows, always optional and always in
    // skippedPoints: a signature on a certificate or a fitter's gauge reading,
    // never telemetry.
    { ...MEASURED, pointKey: "annual_inspection_due", label: "Statutory inspection due date", unit: null, required: false, sortOrder: 36, meta: MANUAL },
    { ...MEASURED, pointKey: "step_chain_elongation_pct", label: "Chain stretch measurement", unit: "%", required: false, sortOrder: 37, meta: MANUAL },
    { ...MEASURED, pointKey: "brake_test_result", label: "Brake stopping-distance test result", unit: null, required: false, sortOrder: 38, meta: MANUAL },
    // ---- The two promoted derived codes. The deviation is SIGNED and takes
    // the SLOWER handrail: a negative value is a handrail running behind the
    // step, which is the entrapment direction, and abs() would throw that away.
    // Both divide by a value that reads zero on a stopped or freshly reset
    // machine: division by zero is non_finite and yields NO value, which is
    // correct and must not be guarded.
    {
      ...derived(
        "(min({handrail_speed_l_ms}, {handrail_speed_r_ms}) - {step_speed_ms}) / {step_speed_ms} * 100",
      ),
      pointKey: "handrail_speed_dev_pct",
      label: "Handrail vs step speed deviation",
      unit: "%",
      required: false,
      sortOrder: 39,
    },
    {
      ...derived("{kwh_total} / {run_hours_h}"),
      pointKey: "kwh_per_run_hour",
      label: "Energy per run hour",
      unit: "kWh/h",
      required: false,
      sortOrder: 40,
    },
  ],
};
