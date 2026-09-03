import { CORE, derived, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The facility pack's lift class — `E5.3` PR 2, ADR 0054 decisions 1-9,
 * ADR 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2.
 *
 * **SOURCE.** `docs/e5.3-derived-taglist-v1.md` §8a — *"Lift — traction
 * (gearless / geared) or hydraulic"*. PROVISIONAL: derived from published
 * practice, not client-confirmed.
 *
 * **THE CITATION AND THE PREFIX DISAGREE, AND THAT IS WHY THE OVERRIDE
 * EXISTS.** This entry's code is `mechanical-lift`, so its domain is
 * `mechanical` (ADR 0054 decision 2 — the prefix says the domain, and a lift's
 * motor, energy and vibration codes already live there). But `mechanical` is
 * `E5.2`'s pack prefix and `PACK_SOURCE_DOC` maps it to
 * `e5.2-derived-taglist-v1.md`, which must keep being the source for `E5.2`'s
 * six machines. `E5.3` Task 11 added `ENTRY_SOURCE_DOC`, consulted first and
 * keyed per code, to point this entry and the escalator at the `E5.3` document.
 * `facility-classes-4.spec.ts` proves it: a copy of this entry citing `E5.2`'s
 * handout is refused **naming E5.3's**, which only the override can produce.
 *
 * **80 POINTS — 7 core + 66 extended + 5 manual + 2 DERIVED.** §8a's 78 table
 * rows in the document's own order (`sortOrder` 0-77) across its eight
 * sub-blocks, then `door_reversal_ratio_pct` (78) and `kwh_per_trip` (79). The
 * plan's §5.8 says *"six sub-blocks"* and the document has eight — service
 * state, motion, doors, drive and machine, shaft/pit/machine room, ride
 * quality, counters and usage, manual/statutory. The rows and their order are
 * what the spec asserts and both agree; the count of headers is a plan
 * correction, recorded and not silently fixed.
 *
 * **THE FOUR POINT SOURCES, AND WHICH TIER EACH YIELDS.** §8a lists the union
 * of what four different installations can report, and the tier column is
 * really a statement about which of them a site has:
 *
 *  1. **OEM cloud / API** — KONE, Otis, Schindler, TK Elevator. Fault codes,
 *     door cycles, waiting times, ride quality. Tier `X`.
 *  2. **Controller gateway** — BACnet elevator objects (`Car_Position`,
 *     `Car_Moving_Direction`, `Car_Door_Status`, `Car_Load`, `Passenger_Alarm`,
 *     `Fault_Signals`) or a Modbus BMS-Link card. Tier `X`.
 *  3. **Dry contacts only** — the Indian default on older installations: in
 *     service, mode, fault, fire recall, alarm, overload and the gateway link.
 *     **Those seven are the tier `C` rows**, and that is the whole reason the
 *     core set is seven out of seventy-eight.
 *  4. **Retrofit IoT** — a car accelerometer, a CT on the door and traction
 *     motors, a machine-room temperature sensor. Tier `X`.
 *
 * **THE BMS OBSERVES ONLY** (ADR 0054 decision 11; §8's own fence): no car
 * call, no fire recall, no maintenance-mode command is modelled. A template
 * carries no command surface today, so nothing here instructs an operator to
 * move a lift.
 *
 * **`(trac)` AND `(hyd)` ARE AN APPLICABILITY MARKER, AND THEY ARE A REDLINE
 * INSTRUCTION FOR THE CLIENT** — §8a's own words: *"drop the rows marked (hyd)
 * or (trac) that do not apply"*. Nine rows are traction-only
 * (`drive_fault_code`, `motor_temp_c`, `drive_heatsink_temp_c`, `dc_bus_v`,
 * `brake_state`, `brake_temp_c`, `rope_brake_state`, and `regen_kw` on a regen
 * drive) and three are hydraulic-only (`hydraulic_oil_temp_c`,
 * `hydraulic_oil_level_low`, `hydraulic_pressure_bar`). **All twelve are
 * authored, all twelve are tier `X`**, and the marker is dropped from the label
 * rather than shipped in it: the tier already carries the meaning — an optional
 * point a site does not map is simply skipped — and a label reading *"(hyd)"*
 * on a traction lift's screen would be noise on every asset. The applicability
 * belongs on the `F2.18` handout, where the client strikes the rows their fleet
 * does not have; it does not belong in the template, which is one class for
 * both machines.
 *
 * **`entrapment_state` IS MEASURED, NOT DERIVED** (plan §12 ruling 3), and it
 * is the one `X/D` row on this entry. §8a defines it as *"car stopped between
 * floors with load, or alarm + not at landing"* — a derivation that needs a
 * **car-load threshold**, and B7/B8 forbid shipping a number in v1. So a
 * derived authoring would have to invent the threshold or write a formula that
 * does not express the definition, and both are worse than a point a controller
 * reports directly. Measured and `extended` it is, and `checkEntry`'s
 * `meta.tier`-iff-measured rule then lets it carry the tier a derived point
 * could not.
 *
 * **SIX CODES ARE REUSED — REFERENCED HERE, REDECLARED NOWHERE** (ADR 0054
 * decision 3). `controller_comms_ok` is §3's, declared on
 * `facility-access-door` in PR 1 — the dependency that made PR 2 a branch cut
 * from `main` after PR 1 merged rather than a stacked one. `motor_current_a`,
 * `motor_temp_c`, `kw`, `kwh_total` and `run_hours_h` were seeded long before
 * this pack. Each carries the unit the vocabulary already holds, because a
 * template `unit` is an **override** and `UNIT_BY_KEY`'s seed is
 * `COALESCE(existing, excluded)` — a wrong one here could not be corrected by a
 * later seed. `run_hours_h` is `extended` here and `core` on the pump: a tier is
 * per entry, and a dry-contact lift reports no hours at all.
 *
 * **`dc_bus_v` AND `drive_fault_code` ARE NOT THE VFD's ROWS.**
 * `mechanical-vfd` declares `dc_bus_voltage_v` and `fault_code` under `E5.2`'s
 * document; §8a spells its own `dc_bus_v` and `drive_fault_code`, and the two
 * pairs are deliberately not normalised into one. A lift drive is inside the
 * lift controller and is reported by it — the site never sees it as a separate
 * VFD asset — and merging the codes would make a lift's drive fault indexable
 * against a pump's, which is a different machine with a different fault
 * dictionary. `drive_status`, `drive_heatsink_temp_c` and `regen_kw` follow the
 * same rule.
 *
 * **VENDOR FAULT CODES ARE CARRIED IN THE ALARM TEXT, NEVER ENUMERATED.**
 * `lift_fault_code` and `drive_fault_code` are `code` rows with empty units;
 * `lift_fault` binds the `0/1` flag beside them and says where to read the code.
 * A stock template cannot hold four OEMs' fault dictionaries.
 *
 * **ELEVEN DERIVED CODES ARE DEFERRED AND NAMED, TWO ARE PROMOTED** (plan §5.0,
 * §12 ruling 2). §8a's *Derived:* line names thirteen:
 *
 *  - **Promoted — `door_reversal_ratio_pct`** =
 *    `{door_reversal_count} / {door_cycle_count} * 100`, and **`kwh_per_trip`**
 *    = `{kwh_total} / {trip_count}`. Both are lifetime ratios over cumulative
 *    counters — `E5.2`'s `load_factor_pct` shape — over measured siblings this
 *    entry declares. Division by zero is `non_finite` and yields **no value**,
 *    which is correct on a lift whose counters have just been reset and must
 *    not be guarded: a `clamp` would ship a fabricated ratio.
 *  - **Seven time windows** the grammar has no clock or memory for —
 *    `availability_pct`, `mtbf_h`, `entrapments_per_month`,
 *    `door_cycles_per_day`, `trips_per_day`, `peak_hour_wait_s`,
 *    `out_of_service_hours_month`.
 *  - **One that lives in another system** — `mttr_h` needs the work orders
 *    `E3.1` owns, which `bms-calc-v1` cannot name.
 *  - **One method the document only names** — `ride_quality_index` is a banding
 *    the standard defines and the document does not fix. `vibration_z_mg` is
 *    declared and `ride_quality_worsening` binds it against a band recorded at
 *    commissioning.
 *  - **One baseline trend** — `levelling_drift_mm` is a drift against a
 *    commissioning value, `E5.1`'s `approach_trend` class, not the
 *    instantaneous `levelling_error_mm` this entry does declare.
 *  - **One rate whose counters do not share a denominator** —
 *    `fault_rate_per_1000_trips` divides an interval counter
 *    (`lift_fault_count`) by a cumulative one (`trip_count`).
 *
 * **NO `content.kpis`** (ADR 0054 decision 6).
 *
 * **SEVENTEEN ALARMS FROM SIXTEEN BULLETS** — *passenger alarm / entrapment* is
 * one bullet over two declared points and splits into two rows, because a
 * pressed alarm button and a trapped passenger are different observations with
 * different responses. Every row is **pair-absent**: no `thresholdValue`, no
 * `operator` (ADR 0019 Amendment 2, ADR 0054 decision 5, B7), with a populated
 * `philosophy` instead.
 *
 * **NO SAFETY ROW CARRIES A NUMBER.** The standards that govern a lift fix what
 * the safety devices ARE and how ride quality is measured, and fix no limit a
 * template could ship: a governor's tripping speed is set against that lift's
 * rated speed, a brake test against that machine's rated load, a ride-quality
 * band at that installation's commissioning. The one field here that carries a
 * statute is `complianceRef` on the annual inspection, and that is a
 * **citation**.
 *
 * **The no-digit rule is an ALARM rule, and the labels are not in scope.**
 * `assertNoLimitNumbers` scans an alarm's message and every `philosophy` string
 * on the four rows the spec names, and nothing else. A label is transcribed
 * verbatim from the document's Description column, so
 * `brake_fault_state` reads *"Brake monitoring fault (UCMP / A3 switch)"* — the
 * name of a switch, not a limit somebody could act on, and changing it would
 * make the row harder to find on the handout the client is redlining.
 *
 * **TWO BINDINGS ARE FIRSTS FOR THIS PACK.**
 * `door_reversal_ratio_rising` binds a **derived** point — the reason the code
 * was promoted rather than deferred, since an alarm on the raw
 * `door_reversal_count` would fire on any busy lift — and
 * `statutory_inspection_overdue` binds the **`manual`** row
 * `annual_inspection_due`, whose value arrives through `F1.8` manual entry
 * (plan §12 ruling 6: author it, do not drop it; nothing fires before `E2.4`).
 *
 * **ONE ALARM CARRIES NO `skill`** — `fire_recall_active` (plan §12 ruling 4,
 * two such rows in PR 2). A lift under Phase 1 recall is not broken and no lift
 * engineer is dispatched: the fire system has taken the lift, and the responder
 * is the site's fire function, which is not one of migration `0034`'s five
 * trades. `entrapment` and `passenger_alarm` DO carry `mechanical`, and that is
 * the distinction rather than an exception — somebody must physically release a
 * trapped passenger, and that is the lift engineer.
 *
 * **MAINTENANCE — 6 plans, PROVISIONAL** (ADR 0054 decision 8), derived from
 * EN 81-20 / EN 81-50 practice, the state Lift Act licensing regime and OEM
 * service schedules, because the tag list has no maintenance section. **Three
 * are `safetyCritical`**: the brake and UCMP test, the overspeed governor and
 * safety-gear test, and the annual statutory inspection and licence — the two
 * barriers between a lift and a free fall, and the certificate that makes it
 * legal to run. **One is `condition_based`**: the door operator is the one part
 * of a lift whose service interval is genuinely driven by use.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the
 * site's telemetry wiring — an OEM API field, a BACnet object, a relay contact
 * or a retrofit sensor's topic — which the tag list does not know and the
 * catalog must not guess.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `mechanical-lift` **v1** (2026-09-04, `E5.3`): authored from
 *    `e5.3-derived-taglist-v1.md` §8a, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const MECHANICAL_LIFT: StockAssetTemplateEntry = {
  code: "mechanical-lift",
  name: "Lift (traction or hydraulic)",
  assetType: "lift",
  domain: "mechanical",
  description:
    "One passenger lift, traction or hydraulic, as an OEM cloud API, a controller gateway, a set " +
    "of dry contacts or a retrofit sensor kit presents it: service, mode and fault state, fire " +
    "recall and rescue-device operation, the in-car alarm and entrapment, car position, speed, " +
    "load and levelling accuracy, the door cycle and reversal counters, the drive, brake, rope " +
    "and hydraulic rows, the machine room, pit and hoistway, ride quality from a car " +
    "accelerometer, the trip, distance and energy counters, and the statutory inspection date " +
    "and test results entered by hand. THE BMS OBSERVES ONLY — no car call, no fire recall and " +
    "no maintenance-mode command is modelled. Authored from " +
    "docs/e5.3-derived-taglist-v1.md §8a (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are what dry contacts alone give and are required, X needs " +
    "an OEM API, a controller gateway or a retrofit sensor and is optional, and the five M rows " +
    "are entered by hand; alarm rows carry a meaning and no limit, because every safety device " +
    "on a lift is set against that lift's own rated speed and rated load.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "lift_out_of_service",
        pointKey: "lift_in_service",
        severity: "critical",
        category: "operations",
        message:
          "Lift not available for passenger service. This is the SLA row — the one a building " +
          "manager and a service contract are both measured on.",
        philosophy: {
          cause:
            "A fault the controller has latched, a safety device open, inspection or maintenance " +
            "mode left engaged, a car parked out of service, or a supply the lift has lost.",
          impact:
            "The building's vertical circulation is reduced by one car. In a tower with a small " +
            "group, or in a building where this is the accessible lift, that is a lost floor " +
            "rather than a longer wait.",
          action:
            "Read lift_mode and lift_fault beside this row: a lift in inspection or maintenance " +
            "mode is somebody working on it, and a lift in fault is not. Raise the service " +
            "contractor with the mode and the fault code, and confirm the second car of the " +
            "group is running before treating this as one incident.",
          skill: "mechanical",
        },
      },
      {
        code: "lift_fault",
        pointKey: "lift_fault",
        severity: "critical",
        category: "operations",
        message:
          "Controller general fault. The OEM's own fault code is in lift_fault_code, and it is " +
          "carried in words rather than enumerated here — a stock template cannot hold four " +
          "vendors' fault dictionaries.",
        philosophy: {
          cause:
            "Anything the controller decides it cannot continue with: a drive trip, a door " +
            "operator failure, a safety-chain interruption, a position or encoder loss, a " +
            "communication failure inside the lift, or a supply disturbance.",
          impact:
            "The car usually stops and takes itself out of service; passengers inside it may " +
            "still be inside it, which is why entrapment_state and passenger_alarm are separate " +
            "rows and both are read first.",
          action:
            "Check the two life-safety rows before the fault itself. Then read lift_fault_code " +
            "at the controller or in the OEM portal and give that code to the service " +
            "contractor: the code is the diagnosis and this flag is only the notification.",
          skill: "mechanical",
        },
      },
      {
        code: "passenger_alarm",
        pointKey: "passenger_alarm",
        severity: "critical",
        category: "safety",
        message:
          "In-car alarm button pressed. Somebody in the car is asking for help, and this row " +
          "escalates on the life-safety path rather than the maintenance one.",
        philosophy: {
          cause:
            "A passenger has pressed the alarm. They may be trapped, unwell, frightened by a " +
            "stop, or a child playing with the button. The lift does not distinguish and neither " +
            "does this row.",
          impact:
            "Until somebody answers, a person is alone in a closed car with no way of knowing " +
            "they have been heard. That is the failure this row exists to prevent, and it is a " +
            "failure of response rather than of equipment.",
          action:
            "Answer on the intercom first — intercom_call_active says whether the call is " +
            "already open. Speak to the passenger, tell them help is coming, and keep the line " +
            "open. Then read entrapment_state and car_position_floor and dispatch the release " +
            "procedure through the contractor's rescue route.",
          skill: "mechanical",
        },
      },
      {
        code: "entrapment",
        pointKey: "entrapment_state",
        severity: "critical",
        category: "safety",
        message:
          "Passenger trapped in the car. The controller reports this state directly; the BMS " +
          "does not compute it, because the definition needs a car-load reference this template " +
          "deliberately ships no value for.",
        philosophy: {
          cause:
            "The car has stopped away from a landing with somebody inside it — a supply failure, " +
            "a safety device opening, a drive or brake fault, or a levelling failure with the " +
            "doors locked.",
          impact:
            "A person is shut in. Every other reading on this template is secondary until they " +
            "are out, and the time somebody spends trapped is the number the building will be " +
            "judged on afterwards.",
          action:
            "Follow the site's lift release procedure, which is the only authority here. Speak " +
            "to the passenger on the intercom while help travels. A manual release is done by a " +
            "trained lift engineer with the machine-room release equipment and by nobody else — " +
            "prising doors is how a rescuer falls down a shaft.",
          skill: "mechanical",
        },
      },
      {
        code: "fire_recall_active",
        pointKey: "fire_recall_state",
        severity: "warning",
        category: "safety",
        message:
          "Fire service recall active (Phase 1). The lift is under the fire system's control and " +
          "is behaving exactly as designed.",
        philosophy: {
          cause:
            "The fire alarm system has signalled recall, or the fire service switch has been " +
            "operated. The lift returns to its designated landing, opens its doors and parks.",
          impact:
            "The car is out of passenger service for as long as recall stands, and the building " +
            "is running on stairs. A lift left in recall after an event is a lift nobody has " +
            "reset, and it looks identical to one still responding to a live alarm.",
          action:
            "Read the fire panel, not the lift: this row is a consequence and facility-fire-panel " +
            "carries the cause. Nothing is done to the lift from a monitoring screen, and the " +
            "recall is cleared by the fire function at the panel and at the lift's own switch " +
            "once the building is released.",
        },
      },
      {
        code: "door_fault",
        pointKey: "door_fault_state",
        severity: "warning",
        category: "operations",
        message: "Door operator fault, or the door has failed to close.",
        philosophy: {
          cause:
            "An obstruction in the sill, a worn door operator belt or gear, a failed safety edge " +
            "or light curtain, a misaligned landing door lock, or a door motor that has lost " +
            "torque. door_motor_current_a and door_reversal_count are the two rows that usually " +
            "moved before this one did.",
          impact:
            "The lift will not depart with an open door, so a door fault takes the car out of " +
            "service as effectively as a drive fault, and it does so at the busiest floor.",
          action:
            "Clear and clean the sills first — the most common cause is debris in a track. Then " +
            "check the safety edge and light curtain, the operator belt and the landing lock " +
            "alignment. If door_reversal_ratio_pct has been rising, treat this as the endpoint " +
            "of that trend rather than a new event.",
          skill: "mechanical",
        },
      },
      {
        code: "overload_persistent",
        pointKey: "overload_state",
        severity: "warning",
        category: "operations",
        message:
          "Overload standing. The car is refusing to depart, and an overload that does not clear " +
          "is a load-weighing fault rather than a full lift.",
        philosophy: {
          cause:
            "Genuinely too many passengers or too much goods load, or a load-weighing device " +
            "that has drifted, been knocked, or lost its calibration after a rope or isolation " +
            "pad change.",
          impact:
            "A real overload clears itself in seconds when somebody steps out. One that stands " +
            "means the car will not run at all, and passengers read an out-of-service lift with " +
            "its doors open as a broken one.",
          action:
            "Check car_load_pct and car_load_kg against what is actually in the car. If the car " +
            "is empty and the state stands, the load-weighing device needs recalibration, which " +
            "is contractor work and not something to bypass.",
          skill: "mechanical",
        },
      },
      {
        code: "brake_monitoring_fault",
        pointKey: "brake_fault_state",
        severity: "critical",
        category: "safety",
        message:
          "Brake monitoring fault — the unintended-car-movement protection has reported a " +
          "problem with the machine brake or with its own monitoring switches.",
        philosophy: {
          cause:
            "A brake shoe or pad that is not lifting or not setting cleanly, a worn or " +
            "misadjusted brake, a failed micro-switch on the brake arm, or a coil that is not " +
            "releasing within the time the controller expects.",
          impact:
            "The machine brake is what holds the car at a landing and what stops it if the drive " +
            "lets go. Monitoring exists because a brake can fail in a way nothing else would " +
            "show, and a car that moves with its doors open is the event this protection is " +
            "there to prevent.",
          action:
            "Take the lift out of service and call the contractor. Brake adjustment and " +
            "monitoring-switch work is done by a lift engineer against that machine's own rated " +
            "load, and no setting for it exists that a template could carry.",
          skill: "mechanical",
        },
      },
      {
        code: "governor_tripped",
        pointKey: "governor_tripped",
        severity: "critical",
        category: "safety",
        message:
          "Overspeed governor or safety gear tripped. The last mechanical protection on the lift " +
          "has operated.",
        philosophy: {
          cause:
            "The car has travelled faster than the governor's setting, or the safety gear has " +
            "been gripped for another reason — a governor rope that has jumped its sheave, a " +
            "seized safety-gear linkage, or a genuine overspeed from a drive or brake failure.",
          impact:
            "The car is clamped to its guide rails and is not moving. Anybody inside it is " +
            "trapped, and the guide rails and safety-gear jaws have taken a load they are " +
            "designed to take once and be inspected after.",
          action:
            "Treat this as an entrapment first and read passenger_alarm and entrapment_state. " +
            "Then leave the lift alone: resetting safety gear, inspecting the rails and " +
            "re-testing the governor is contractor work, and the governor's tripping setting is " +
            "fixed against that lift's own rated speed rather than by any number shipped here.",
          skill: "mechanical",
        },
      },
      {
        code: "pit_water",
        pointKey: "pit_water_state",
        severity: "warning",
        category: "safety",
        message: "Water detected in the lift pit.",
        philosophy: {
          cause:
            "Groundwater through the pit structure, a burst or leaking service above the shaft, " +
            "rain driven down the hoistway, or a sump pump that has failed or lost its supply. " +
            "In monsoon conditions the first of these is the common one.",
          impact:
            "The pit holds the buffers, the governor tensioner, the travelling cable and the pit " +
            "switches, and none of them is designed to sit in water. A flooded pit also puts an " +
            "engineer into standing water beside live equipment.",
          action:
            "Park the car at an upper landing and take the lift out of service before anybody " +
            "enters the pit. Pump it out, then find the source: a pit that fills repeatedly is a " +
            "waterproofing or drainage defect in the structure, not a lift fault.",
          skill: "civil",
        },
      },
      {
        code: "machine_room_temp_high",
        pointKey: "machine_room_temp_c",
        severity: "warning",
        category: "operations",
        message:
          "Machine room or MRL cabinet temperature high — the Indian summer failure, and the one " +
          "that presents as an intermittent lift rather than as a hot room.",
        philosophy: {
          cause:
            "Machine-room ventilation or cooling that has failed or was never sized for the " +
            "drive's heat rejection, a blocked louvre or filter, or a roof-level room taking " +
            "afternoon sun with no extract running.",
          impact:
            "A drive derates and then trips on heatsink temperature, so the lift starts dropping " +
            "out of service in the afternoon and recovers overnight. Read against " +
            "drive_heatsink_temp_c, this row is what explains a fault pattern that otherwise " +
            "looks random.",
          action:
            "Restore the ventilation or cooling to the machine room and check the louvres, " +
            "filters and any extract fan. The room's design temperature is the lift OEM's, set " +
            "for that drive, and the site's mechanical services answer for meeting it.",
          skill: "hvac",
        },
      },
      {
        code: "hydraulic_oil_temp_high",
        pointKey: "hydraulic_oil_temp_c",
        severity: "warning",
        category: "operations",
        message:
          "Hydraulic oil temperature high. Applies to a hydraulic lift; a traction installation " +
          "does not map this row.",
        philosophy: {
          cause:
            "Heavy duty cycling on a warm day, an oil cooler that has failed or was never " +
            "fitted, a low oil level concentrating the heat, or a pump or valve passing " +
            "internally and turning pumped energy into heat.",
          impact:
            "Hot oil thins, so levelling accuracy drifts and the car creeps at a landing. The " +
            "controller will eventually inhibit starts to protect the power unit, which takes " +
            "the lift out of service until the oil cools.",
          action:
            "Check hydraulic_oil_level_low and the oil cooler if one is fitted, and reduce " +
            "demand while the unit cools. Repeated hot running with a normal duty cycle points " +
            "at a passing valve or a worn pump, which is contractor work.",
          skill: "mechanical",
        },
      },
      {
        code: "ard_activation",
        pointKey: "ard_state",
        severity: "warning",
        category: "operations",
        message:
          "Automatic rescue device active — the lift has lost its mains supply and is lowering " +
          "the car to a landing on battery.",
        philosophy: {
          cause:
            "Mains failure to the lift supply: a utility outage, a tripped breaker or an " +
            "isolator opened for work. emergency_power_mode says whether the building's DG or " +
            "EPS supply has picked the lift up.",
          impact:
            "The device is doing its job and the passengers will be released at a landing, but " +
            "it runs on a battery that is now discharged. A second failure before that battery " +
            "recovers has no rescue behind it, and the battery's condition is not a telemetry " +
            "point — ard_battery_test is the M row for it.",
          action:
            "Restore the supply and confirm the lift returns to normal service. Check why the " +
            "supply failed rather than only that it came back, and if activations are becoming " +
            "frequent, bring the ARD battery test forward.",
          skill: "electrical",
        },
      },
      {
        code: "controller_comms_loss",
        pointKey: "controller_comms_ok",
        severity: "critical",
        category: "operations",
        message:
          "Gateway to lift-controller link down. The BMS is no longer reading the lift, and " +
          "every other row on this template has gone quiet in exactly the way a healthy lift " +
          "looks.",
        philosophy: {
          cause:
            "A failed or unpowered gateway, a broken or disturbed field cable, a controller card " +
            "that has stopped answering, an OEM API credential that has expired, or work in the " +
            "machine room that left an isolator open.",
          impact:
            "This is the silent failure: with the link down there is no out-of-service alarm, no " +
            "fault, no entrapment and no passenger alarm — the monitoring has stopped monitoring " +
            "and nothing on the screen says so except this row. That is why it is critical and " +
            "not a warning.",
          action:
            "Check the gateway's power and its own health first, then the field cable and the " +
            "controller card, then the credentials if the source is an OEM API. Until the link " +
            "is back, treat the lift as unmonitored and fall back on the site's own reporting.",
          skill: "controls",
        },
      },
      {
        code: "door_reversal_ratio_rising",
        pointKey: "door_reversal_ratio_pct",
        severity: "warning",
        category: "operations",
        message:
          "Reversals per door cycle rising — the lead indicator for an obstruction or a " +
          "misaligned door, and the reason this ratio is computed rather than deferred. It binds " +
          "the DERIVED point: an alarm on the raw reversal count would fire on any busy lift.",
        philosophy: {
          cause:
            "A safety edge or light curtain that is triggering on nothing — dirt on a lens, a " +
            "misaligned beam, a worn edge — or a genuine obstruction: debris in the sill, a " +
            "damaged door panel, or a door that is closing too slowly and catching passengers.",
          impact:
            "Every reversal is a door cycle that did not complete, so the ratio rising means " +
            "longer dwells, longer waits and an operator wearing out faster than its service " +
            "interval assumes. Left alone it ends as door_fault and a car out of service.",
          action:
            "Clean the sills and the light-curtain lenses and check the safety edge alignment. " +
            "Read door_open_time_s and door_motor_current_a beside this row: a rising current " +
            "with a rising ratio is a mechanical binding rather than a sensor.",
          skill: "mechanical",
        },
      },
      {
        code: "ride_quality_worsening",
        pointKey: "vibration_z_mg",
        severity: "warning",
        category: "operations",
        message:
          "Vertical vibration above the band recorded for this installation at commissioning. " +
          "ride_quality_index is deferred — the banding is a method the tag list names and does " +
          "not fix — so the alarm binds the measured axis instead.",
        philosophy: {
          cause:
            "Guide shoes or roller guides that have worn, guide rails needing alignment or " +
            "lubrication, a rope tension imbalance, a worn sheave groove, or an isolation pad " +
            "under the machine that has aged.",
          impact:
            "Ride quality is what a passenger actually judges a lift by, and worsening vibration " +
            "is also mechanical wear reporting itself early. It is a maintenance finding rather " +
            "than a safety event, which is why it is a warning under operations.",
          action:
            "Trend this axis with vibration_x_mg and vibration_y_mg rather than reacting to one " +
            "reading, and compare against the record made when the lift was handed over. Then " +
            "inspect the guide shoes, the rail alignment and lubrication, and the rope tensions.",
          skill: "mechanical",
        },
      },
      {
        code: "statutory_inspection_overdue",
        pointKey: "annual_inspection_due",
        severity: "warning",
        category: "safety",
        message:
          "Statutory inspection date passed. This row binds the MANUAL point " +
          "annual_inspection_due, whose date is entered by hand through F1.8 and never arrives " +
          "from a data key.",
        philosophy: {
          cause:
            "The inspection has not been booked or has not been done, the certificate has not " +
            "been renewed, or it has been renewed and the date on the template was never " +
            "updated — which is the most common cause and the reason this row exists.",
          impact:
            "A lift running past its inspection is a lift running without a current licence " +
            "under the state's Lift Act. That is an operating and an insurance exposure before " +
            "it is a technical one, and no reading on this template would ever reveal it.",
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
        title: "Brake and UCMP test",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 180,
        priority: "critical",
        safetyCritical: true,
        triggerSummary:
          "Test the machine brake and the unintended-car-movement protection against this " +
          "machine's own rated load, check the brake lining, the linkage and the monitoring " +
          "switches, and record the outcome against brake_test_result — the M row this entry " +
          "declares for it. The brake is what holds the car at a landing, and brake_fault_state " +
          "reports a monitoring failure and not the brake's remaining margin.",
      },
      {
        title: "Overspeed governor and safety-gear test",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 240,
        priority: "critical",
        safetyCritical: true,
        triggerSummary:
          "Trip the overspeed governor and prove the safety gear grips and releases, inspect the " +
          "governor rope, tensioner and jaws, and check the buffers; record the outcome against " +
          "buffer_test_result. This is the barrier that is never exercised in normal service: it " +
          "either works on the day it is needed or nothing on this template would have said it " +
          "would not.",
      },
      {
        title: "Annual statutory inspection and licence",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 480,
        priority: "critical",
        safetyCritical: true,
        complianceRef: "State Lift Act licence",
        triggerSummary:
          "Book the licensed inspector, present the lift and its records for the statutory " +
          "examination, and update annual_inspection_due the day the certificate is issued. The " +
          "licence is what makes the lift legal to run, it is renewed state by state, and " +
          "statutory_inspection_overdue fires off the date this task sets.",
      },
      {
        title: "Door operator service on cycle count and reversal ratio",
        category: "condition_based",
        generationMode: "condition",
        intervalDays: 90,
        estimatedMinutes: 120,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Generated by use rather than by the calendar: door_cycle_count is the wear counter " +
          "and door_reversal_ratio_pct is the lead indicator, and a lift in a busy lobby reaches " +
          "a service interval in a fraction of the time a lift in a quiet block does. Clean the " +
          "sills and light-curtain lenses, check the safety edge, the operator belt or gear and " +
          "the landing lock alignment, and read door_motor_current_a for a door that is binding.",
      },
      {
        title: "Rope and machine inspection",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 120,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Inspect the suspension ropes or belts for broken wires, diameter reduction and " +
          "tension imbalance, check the sheave grooves, the machine, its lubrication and its " +
          "isolation pads, and record the result against rope_condition. Rope wear is gradual " +
          "and invisible to every measured row here except vibration, which is why it is an " +
          "inspection with an M row behind it.",
      },
      {
        title: "ARD battery test",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 180,
        estimatedMinutes: 45,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Prove the automatic rescue device lowers the car to a landing with the mains supply " +
          "removed, and check the battery, its charger and its terminals; record the outcome " +
          "against ard_battery_test. A flat ARD battery looks exactly like a healthy one until " +
          "the supply goes, and ard_state reports that the device ran, never that it still can.",
      },
    ],
  },
  points: [
    // ---- Service state — the seven C rows are here and in Motion, and they
    // are exactly what §8's source 3 (dry contacts only) gives a site.
    { ...MEASURED, pointKey: "lift_in_service", label: "Available for normal passenger service", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "lift_mode", label: "Normal / inspection / maintenance / fire service / emergency power / earthquake / out of service / independent / attendant", unit: null, required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "lift_fault", label: "Fault active (controller general fault)", unit: null, required: true, sortOrder: 2, meta: CORE },
    // The OEM's fault dictionary is carried in the alarm text, never enumerated.
    { ...MEASURED, pointKey: "lift_fault_code", label: "Active fault code", unit: null, required: false, sortOrder: 3, meta: EXTENDED },
    { ...MEASURED, pointKey: "lift_fault_count", label: "Faults since last reset", unit: null, required: false, sortOrder: 4, meta: EXTENDED },
    { ...MEASURED, pointKey: "fire_recall_state", label: "Fire service recall active (Phase 1)", unit: null, required: true, sortOrder: 5, meta: CORE },
    { ...MEASURED, pointKey: "fire_operation_state", label: "Firefighter in-car operation (Phase 2)", unit: null, required: false, sortOrder: 6, meta: EXTENDED },
    { ...MEASURED, pointKey: "emergency_power_mode", label: "Running on DG / EPS supply", unit: null, required: false, sortOrder: 7, meta: EXTENDED },
    { ...MEASURED, pointKey: "ard_state", label: "Automatic rescue device active (battery lowering to floor)", unit: null, required: false, sortOrder: 8, meta: EXTENDED },
    { ...MEASURED, pointKey: "passenger_alarm", label: "In-car alarm button pressed", unit: null, required: true, sortOrder: 9, meta: CORE },
    // The X/D row, authored MEASURED: deriving it needs a car-load threshold,
    // and B7/B8 forbid shipping the number that would make the formula mean
    // anything (plan §12 ruling 3).
    { ...MEASURED, pointKey: "entrapment_state", label: "Passenger trapped (car stopped between floors with load, or alarm + not at landing)", unit: null, required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "intercom_call_active", label: "In-car intercom / emergency call active", unit: null, required: false, sortOrder: 11, meta: EXTENDED },
    // REUSED — §3 declares it on facility-access-door in PR 1. This is the
    // dependency that made PR 2 a branch cut from main rather than a stacked one.
    { ...MEASURED, pointKey: "controller_comms_ok", label: "Gateway ↔ lift controller link healthy", unit: null, required: true, sortOrder: 12, meta: CORE },
    // ---- Motion
    { ...MEASURED, pointKey: "car_position_floor", label: "Current floor (landing index)", unit: null, required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "car_position_m", label: "Car position in shaft (absolute encoder)", unit: "m", required: false, sortOrder: 14, meta: EXTENDED },
    { ...MEASURED, pointKey: "car_direction", label: "Up / down / stopped", unit: null, required: false, sortOrder: 15, meta: EXTENDED },
    { ...MEASURED, pointKey: "car_moving", label: "Car in motion", unit: null, required: false, sortOrder: 16, meta: EXTENDED },
    { ...MEASURED, pointKey: "car_speed_ms", label: "Car speed", unit: "m/s", required: false, sortOrder: 17, meta: EXTENDED },
    { ...MEASURED, pointKey: "car_load_pct", label: "Car load (load-weighing device)", unit: "%", required: false, sortOrder: 18, meta: EXTENDED },
    { ...MEASURED, pointKey: "car_load_kg", label: "Car load", unit: "kg", required: false, sortOrder: 19, meta: EXTENDED },
    { ...MEASURED, pointKey: "overload_state", label: "Overload — car will not depart", unit: null, required: true, sortOrder: 20, meta: CORE },
    { ...MEASURED, pointKey: "full_load_bypass_state", label: "Full-load bypass (skipping hall calls)", unit: null, required: false, sortOrder: 21, meta: EXTENDED },
    { ...MEASURED, pointKey: "levelling_error_mm", label: "Stop accuracy vs landing sill", unit: "mm", required: false, sortOrder: 22, meta: EXTENDED },
    { ...MEASURED, pointKey: "hall_calls_pending", label: "Registered hall calls", unit: null, required: false, sortOrder: 23, meta: EXTENDED },
    { ...MEASURED, pointKey: "car_calls_pending", label: "Registered car calls", unit: null, required: false, sortOrder: 24, meta: EXTENDED },
    { ...MEASURED, pointKey: "next_stop_floor", label: "Committed next stop", unit: null, required: false, sortOrder: 25, meta: EXTENDED },
    // ---- Doors
    { ...MEASURED, pointKey: "car_door_state", label: "Closed / opening / open / closing / obstructed", unit: null, required: false, sortOrder: 26, meta: EXTENDED },
    { ...MEASURED, pointKey: "landing_door_state", label: "Landing door (front / rear) at current floor", unit: null, required: false, sortOrder: 27, meta: EXTENDED },
    { ...MEASURED, pointKey: "door_zone_state", label: "Car within door zone", unit: null, required: false, sortOrder: 28, meta: EXTENDED },
    { ...MEASURED, pointKey: "door_cycle_count", label: "Door cycles, cumulative (the wear counter)", unit: null, required: false, sortOrder: 29, meta: EXTENDED },
    { ...MEASURED, pointKey: "door_reversal_count", label: "Safety-edge / light-curtain reversals", unit: null, required: false, sortOrder: 30, meta: EXTENDED },
    { ...MEASURED, pointKey: "door_open_time_s", label: "Last door open dwell", unit: "s", required: false, sortOrder: 31, meta: EXTENDED },
    { ...MEASURED, pointKey: "door_fault_state", label: "Door operator fault / failed to close", unit: null, required: false, sortOrder: 32, meta: EXTENDED },
    { ...MEASURED, pointKey: "door_motor_current_a", label: "Door operator motor current", unit: "A", required: false, sortOrder: 33, meta: EXTENDED },
    // ---- Drive and machine. The (trac) / (hyd) applicability markers are
    // dropped from the labels: every one of these rows is tier X, so a site
    // simply does not map the ones its machine does not have, and the marker
    // belongs on the F2.18 handout the client redlines.
    { ...MEASURED, pointKey: "drive_status", label: "Traction drive / hydraulic power unit run", unit: null, required: false, sortOrder: 34, meta: EXTENDED },
    // NOT mechanical-vfd's fault_code / dc_bus_voltage_v: a lift drive lives
    // inside the lift controller and has its own fault dictionary.
    { ...MEASURED, pointKey: "drive_fault_code", label: "Drive (VVVF) fault code", unit: null, required: false, sortOrder: 35, meta: EXTENDED },
    // REUSED — seeded long before this pack, and carrying the units the
    // vocabulary already holds, because a template unit is an override.
    { ...MEASURED, pointKey: "motor_current_a", label: "Traction / pump motor current", unit: "A", required: false, sortOrder: 36, meta: EXTENDED },
    { ...MEASURED, pointKey: "motor_temp_c", label: "Motor winding temperature", unit: "°C", required: false, sortOrder: 37, meta: EXTENDED },
    { ...MEASURED, pointKey: "drive_heatsink_temp_c", label: "VVVF heatsink temperature", unit: "°C", required: false, sortOrder: 38, meta: EXTENDED },
    { ...MEASURED, pointKey: "dc_bus_v", label: "Drive DC bus voltage", unit: "V", required: false, sortOrder: 39, meta: EXTENDED },
    { ...MEASURED, pointKey: "brake_state", label: "Machine brake lifted / applied", unit: null, required: false, sortOrder: 40, meta: EXTENDED },
    { ...MEASURED, pointKey: "brake_temp_c", label: "Brake coil / drum temperature", unit: "°C", required: false, sortOrder: 41, meta: EXTENDED },
    { ...MEASURED, pointKey: "brake_fault_state", label: "Brake monitoring fault (UCMP / A3 switch)", unit: null, required: false, sortOrder: 42, meta: EXTENDED },
    { ...MEASURED, pointKey: "rope_brake_state", label: "Rope gripper / UCMP device triggered", unit: null, required: false, sortOrder: 43, meta: EXTENDED },
    { ...MEASURED, pointKey: "hydraulic_oil_temp_c", label: "Hydraulic oil temperature", unit: "°C", required: false, sortOrder: 44, meta: EXTENDED },
    { ...MEASURED, pointKey: "hydraulic_oil_level_low", label: "Oil tank level low", unit: null, required: false, sortOrder: 45, meta: EXTENDED },
    { ...MEASURED, pointKey: "hydraulic_pressure_bar", label: "Cylinder pressure", unit: "bar", required: false, sortOrder: 46, meta: EXTENDED },
    { ...MEASURED, pointKey: "regen_kw", label: "Regenerative power returned", unit: "kW", required: false, sortOrder: 47, meta: EXTENDED },
    { ...MEASURED, pointKey: "kw", label: "Lift input power", unit: "kW", required: false, sortOrder: 48, meta: EXTENDED },
    { ...MEASURED, pointKey: "kwh_total", label: "Lift energy, cumulative", unit: "kWh", required: false, sortOrder: 49, meta: EXTENDED },
    // ---- Shaft, pit, machine room
    { ...MEASURED, pointKey: "machine_room_temp_c", label: "Machine room / MRL cabinet temperature", unit: "°C", required: false, sortOrder: 50, meta: EXTENDED },
    { ...MEASURED, pointKey: "machine_room_humidity_pct", label: "Machine room humidity", unit: "%", required: false, sortOrder: 51, meta: EXTENDED },
    { ...MEASURED, pointKey: "pit_water_state", label: "Pit flooded / water detected", unit: null, required: false, sortOrder: 52, meta: EXTENDED },
    { ...MEASURED, pointKey: "pit_light_state", label: "Pit / shaft light on", unit: null, required: false, sortOrder: 53, meta: EXTENDED },
    { ...MEASURED, pointKey: "shaft_temp_c", label: "Hoistway temperature (top)", unit: "°C", required: false, sortOrder: 54, meta: EXTENDED },
    { ...MEASURED, pointKey: "safety_chain_ok", label: "Safety circuit closed", unit: null, required: false, sortOrder: 55, meta: EXTENDED },
    { ...MEASURED, pointKey: "governor_tripped", label: "Overspeed governor / safety gear tripped", unit: null, required: false, sortOrder: 56, meta: EXTENDED },
    { ...MEASURED, pointKey: "terminal_limit_state", label: "Final limit switch struck", unit: null, required: false, sortOrder: 57, meta: EXTENDED },
    { ...MEASURED, pointKey: "car_light_state", label: "Car lighting on", unit: null, required: false, sortOrder: 58, meta: EXTENDED },
    { ...MEASURED, pointKey: "car_fan_state", label: "Car ventilation fan on", unit: null, required: false, sortOrder: 59, meta: EXTENDED },
    { ...MEASURED, pointKey: "car_temp_c", label: "Car interior temperature", unit: "°C", required: false, sortOrder: 60, meta: EXTENDED },
    // ---- Ride quality — a retrofit accelerometer in the car.
    { ...MEASURED, pointKey: "vibration_x_mg", label: "Lateral vibration, peak-to-peak", unit: "mg", required: false, sortOrder: 61, meta: EXTENDED },
    { ...MEASURED, pointKey: "vibration_y_mg", label: "Front-back vibration, peak-to-peak", unit: "mg", required: false, sortOrder: 62, meta: EXTENDED },
    { ...MEASURED, pointKey: "vibration_z_mg", label: "Vertical vibration, peak-to-peak", unit: "mg", required: false, sortOrder: 63, meta: EXTENDED },
    { ...MEASURED, pointKey: "max_accel_ms2", label: "Peak acceleration last trip", unit: "m/s²", required: false, sortOrder: 64, meta: EXTENDED },
    { ...MEASURED, pointKey: "max_jerk_ms3", label: "Peak jerk last trip", unit: "m/s³", required: false, sortOrder: 65, meta: EXTENDED },
    { ...MEASURED, pointKey: "noise_dba", label: "In-car noise", unit: "dB(A)", required: false, sortOrder: 66, meta: EXTENDED },
    // ---- Counters and usage. run_hours_h is REUSED and is extended HERE and
    // core on the pump — a tier is per entry, and a dry-contact lift reports no
    // hours at all.
    { ...MEASURED, pointKey: "trip_count", label: "Starts / trips, cumulative", unit: null, required: false, sortOrder: 67, meta: EXTENDED },
    { ...MEASURED, pointKey: "run_hours_h", label: "Motor run hours", unit: "h", required: false, sortOrder: 68, meta: EXTENDED },
    { ...MEASURED, pointKey: "floor_km_total", label: "Distance travelled, cumulative", unit: "km", required: false, sortOrder: 69, meta: EXTENDED },
    { ...MEASURED, pointKey: "passenger_count", label: "Passengers carried (load-weighing estimate, interval)", unit: null, required: false, sortOrder: 70, meta: EXTENDED },
    { ...MEASURED, pointKey: "waiting_time_avg_s", label: "Average hall-call waiting time (group controller)", unit: "s", required: false, sortOrder: 71, meta: EXTENDED },
    { ...MEASURED, pointKey: "waiting_time_max_s", label: "Longest hall-call wait in interval", unit: "s", required: false, sortOrder: 72, meta: EXTENDED },
    // ---- Manual / statutory — five signatures on certificates, entered
    // through F1.8, never mapped from a data key, always in skippedPoints.
    // statutory_inspection_overdue binds the first of them.
    { ...MEASURED, pointKey: "annual_inspection_due", label: "Statutory inspection due date (state Lift Act licence)", unit: null, required: false, sortOrder: 73, meta: MANUAL },
    { ...MEASURED, pointKey: "rope_condition", label: "Rope inspection result (broken wires, diameter)", unit: null, required: false, sortOrder: 74, meta: MANUAL },
    { ...MEASURED, pointKey: "brake_test_result", label: "Brake / UCMP test result", unit: null, required: false, sortOrder: 75, meta: MANUAL },
    { ...MEASURED, pointKey: "buffer_test_result", label: "Buffer / safety-gear test result", unit: null, required: false, sortOrder: 76, meta: MANUAL },
    { ...MEASURED, pointKey: "ard_battery_test", label: "ARD battery test result", unit: null, required: false, sortOrder: 77, meta: MANUAL },
    // ---- The two promoted derived codes. Both divide by a cumulative counter
    // that reads zero on a freshly reset controller: division by zero is
    // non_finite and yields NO value, which is correct and must not be guarded.
    {
      ...derived("{door_reversal_count} / {door_cycle_count} * 100"),
      pointKey: "door_reversal_ratio_pct",
      label: "Door reversals per cycle",
      unit: "%",
      required: false,
      sortOrder: 78,
    },
    {
      ...derived("{kwh_total} / {trip_count}"),
      pointKey: "kwh_per_trip",
      label: "Energy per trip",
      unit: "kWh",
      required: false,
      sortOrder: 79,
    },
  ],
};
