import { DEFERRED_DERIVED_CODES } from "./stock-catalog-deferrals.spec";
import { alarmsOf, assert, checkEntry, maintenanceOf, requireStockEntry } from "./stock-catalog.spec";
import { FACILITY_TAG_LIST } from "./facility-classes.spec";
import {
  assertAlarmTable,
  assertDeferralsAbsent,
  assertDerivedPoints,
  assertEntryIdentity,
  assertMaintenanceBounds,
  assertNoKpis,
  assertNoLimitNumbers,
  assertPhilosophyRows,
  assertPointTable,
  assertProvenance,
  assertSkillAssignment,
  tierCount,
  type AlarmRow,
  type DerivedRow,
  type PointRow,
} from "./stock-transcription.spec";

/**
 * `E5.3` PR 2 pass C4 — §8a of `docs/e5.3-derived-taglist-v1.md`, the lift.
 *
 * **One entry per file from here on.** §1 and §2 are in `facility-classes.spec.ts`,
 * §3-§5 in `-2`, §6 and §7 in `-3`; §8a is alone in this file and §8b will be
 * alone in `-5`, because §8a transcribes **80 points** against the fire panel's
 * 24 and the §4.5 pre-commit guard reads a whole file.
 *
 * **`facility-classes-4.test.ts` is this file's name-sibling wrapper.**
 * `tests/repo-invariants.test.ts` pairs a spec with a wrapper of its own name:
 * a spec run from a differently-named wrapper still executes and is absent from
 * coverage.
 *
 * **The override self-test lives here, not in `stock-catalog.spec.ts`.** Task 11
 * exported `checkEntry` for exactly this — its docblock says *"so a per-class
 * spec can run it over a deliberately miscited COPY of a shipped entry"* — and
 * `stock-catalog.spec.ts` stands at 901 lines against the 1000-line cap. The
 * plan's snippet called a `refusalFrom` helper that does not exist there; the
 * only one in the directory is module-private in `stock-transcription.spec.ts`,
 * which imports FROM `stock-catalog.spec.ts`, so exporting it back would build
 * an import cycle. {@link refusalFrom} below is a local copy in the shape the
 * four negative fixtures in `stock-catalog.spec.ts` already use.
 */

/**
 * The regime sentence `assertNoLimitNumbers` prints for a **lift** row caught
 * carrying a digit — the fourth constant in this pack, and a continuation of
 * `E5.3` §13 item 7 rather than a new finding.
 *
 * Item 7's rule: the helper prints the sentence it is given, so a failure on
 * `governor_tripped` that cited NFPA 72 and IS 2189 would send the reader to a
 * fire-alarm standard that says nothing about an overspeed governor.
 * `FACILITY_LIFE_SAFETY_REGIME` is the fire panel's authority,
 * `FACILITY_OCCUPANCY_REGIME` the occupancy rows' and
 * `FACILITY_AIR_QUALITY_REGIME` the air node's; this is the lift's. The B7/B8
 * rule all four state is identical — v1 ships the meaning and no number — and
 * only the authority differs. §8b's escalator answers to EN 115 and IS 4591 and
 * gets its own in `facility-classes-5.spec.ts` (Task 14).
 *
 * It is safe for this string to carry the standard designations because it is
 * interpolated only into the FAILURE message; the rows themselves carry no
 * digit, in the alarm text and inside the `philosophy` too.
 */
export const FACILITY_VERTICAL_TRANSPORT_REGIME =
  "EN 81-20 and EN 81-50 fix what a lift's safety devices ARE — the overspeed governor and " +
  "safety gear, the brake and its unintended-car-movement monitoring, the buffers, the safety " +
  "chain — and ISO 18738 fixes how ride quality is MEASURED. Neither fixes a number a template " +
  "could ship: the tripping speed is set against that lift's rated speed, the brake test is " +
  "against that machine's rated load, and the ride-quality band is recorded at commissioning " +
  "for that installation. The statutory authority is the state Lift Act licence, which names " +
  "the inspection and not a limit.";

// ===========================================================================
// §8a — `mechanical-lift`
// ===========================================================================

const LIFT_CODE = "mechanical-lift";

/**
 * §8a's 78 table rows in the document's own order (`sortOrder` 0-77), then the
 * two promoted codes at 78 and 79 — `[pointKey, tier, unit]`.
 *
 * **The document's sub-block headers are kept as comments** so a reader can
 * check a block against the handout without counting to seventy-eight. There
 * are **eight** of them — service state, motion, doors, drive and machine,
 * shaft/pit/machine room, ride quality, counters and usage, manual/statutory —
 * and the plan's §5.8 says six (a §13 finding, reported and not corrected here:
 * the rows and their order are what this table asserts, and both agree).
 *
 * **Six codes are REFERENCED, never redeclared** (ADR 0054 decision 3):
 * `controller_comms_ok` is §3's, declared on the access door by PR 1, and
 * `motor_current_a`, `motor_temp_c`, `kw`, `kwh_total` and `run_hours_h` were
 * seeded long before this pack. Each carries the unit the vocabulary already
 * holds — `A`, `°C`, `kW`, `kWh`, `h` — exactly as `mechanical-pump.ts` spells
 * them, because a template `unit` is an override and `null` is right only where
 * `UNIT_BY_KEY` holds `""`.
 *
 * **`entrapment_state` at index 10 is the `X/D` row, authored MEASURED and
 * `extended`** (plan §12 ruling 3). The document defines it as *"car stopped
 * between floors with load, or alarm + not at landing"* — a derivation that
 * needs a CAR-LOAD THRESHOLD, and B7/B8 forbid a shipped number in v1, so
 * authoring it derived would mean either inventing the threshold or shipping a
 * formula that cannot express the definition. It is measured here, and a site
 * whose controller reports entrapment directly maps it.
 *
 * **`run_hours_h` is `extended` on this entry and `core` on the pump.** A tier
 * is per entry: §8a marks it `X` because a dry-contact lift installation (the
 * document's source 3) reports no hours at all.
 */
const LIFT_POINTS: readonly PointRow[] = [
  // Service state — 13 rows
  ["lift_in_service", "core", null],
  ["lift_mode", "core", null],
  ["lift_fault", "core", null],
  ["lift_fault_code", "extended", null],
  ["lift_fault_count", "extended", null],
  ["fire_recall_state", "core", null],
  ["fire_operation_state", "extended", null],
  ["emergency_power_mode", "extended", null],
  ["ard_state", "extended", null],
  ["passenger_alarm", "core", null],
  ["entrapment_state", "extended", null],
  ["intercom_call_active", "extended", null],
  ["controller_comms_ok", "core", null],
  // Motion — 13 rows
  ["car_position_floor", "extended", null],
  ["car_position_m", "extended", "m"],
  ["car_direction", "extended", null],
  ["car_moving", "extended", null],
  ["car_speed_ms", "extended", "m/s"],
  ["car_load_pct", "extended", "%"],
  ["car_load_kg", "extended", "kg"],
  ["overload_state", "core", null],
  ["full_load_bypass_state", "extended", null],
  ["levelling_error_mm", "extended", "mm"],
  ["hall_calls_pending", "extended", null],
  ["car_calls_pending", "extended", null],
  ["next_stop_floor", "extended", null],
  // Doors — 8 rows
  ["car_door_state", "extended", null],
  ["landing_door_state", "extended", null],
  ["door_zone_state", "extended", null],
  ["door_cycle_count", "extended", null],
  ["door_reversal_count", "extended", null],
  ["door_open_time_s", "extended", "s"],
  ["door_fault_state", "extended", null],
  ["door_motor_current_a", "extended", "A"],
  // Drive and machine — 16 rows
  ["drive_status", "extended", null],
  ["drive_fault_code", "extended", null],
  ["motor_current_a", "extended", "A"],
  ["motor_temp_c", "extended", "°C"],
  ["drive_heatsink_temp_c", "extended", "°C"],
  ["dc_bus_v", "extended", "V"],
  ["brake_state", "extended", null],
  ["brake_temp_c", "extended", "°C"],
  ["brake_fault_state", "extended", null],
  ["rope_brake_state", "extended", null],
  ["hydraulic_oil_temp_c", "extended", "°C"],
  ["hydraulic_oil_level_low", "extended", null],
  ["hydraulic_pressure_bar", "extended", "bar"],
  ["regen_kw", "extended", "kW"],
  ["kw", "extended", "kW"],
  ["kwh_total", "extended", "kWh"],
  // Shaft, pit, machine room — 11 rows
  ["machine_room_temp_c", "extended", "°C"],
  ["machine_room_humidity_pct", "extended", "%"],
  ["pit_water_state", "extended", null],
  ["pit_light_state", "extended", null],
  ["shaft_temp_c", "extended", "°C"],
  ["safety_chain_ok", "extended", null],
  ["governor_tripped", "extended", null],
  ["terminal_limit_state", "extended", null],
  ["car_light_state", "extended", null],
  ["car_fan_state", "extended", null],
  ["car_temp_c", "extended", "°C"],
  // Ride quality — 6 rows
  ["vibration_x_mg", "extended", "mg"],
  ["vibration_y_mg", "extended", "mg"],
  ["vibration_z_mg", "extended", "mg"],
  ["max_accel_ms2", "extended", "m/s²"],
  ["max_jerk_ms3", "extended", "m/s³"],
  ["noise_dba", "extended", "dB(A)"],
  // Counters and usage — 6 rows
  ["trip_count", "extended", null],
  ["run_hours_h", "extended", "h"],
  ["floor_km_total", "extended", "km"],
  ["passenger_count", "extended", null],
  ["waiting_time_avg_s", "extended", "s"],
  ["waiting_time_max_s", "extended", "s"],
  // Manual / statutory — 5 rows
  ["annual_inspection_due", "manual", null],
  ["rope_condition", "manual", null],
  ["brake_test_result", "manual", null],
  ["buffer_test_result", "manual", null],
  ["ard_battery_test", "manual", null],
  // Promoted, appended after the table (plan §5.0, §12 ruling 2)
  ["door_reversal_ratio_pct", "derived", "%"],
  ["kwh_per_trip", "derived", "kWh"],
];

/**
 * §8a's two promoted codes, as literal strings (plan §5.0).
 *
 * Both are **lifetime ratios over cumulative counters** — `E5.2`'s
 * `load_factor_pct` shape — and both divide by a counter that reads zero on a
 * lift that has not moved since its controller was reset. Division by zero is
 * `non_finite` in `bms-calc-v1` and produces **no value**, which is the correct
 * outcome and must not be guarded: a `clamp` would ship a fabricated ratio for
 * a lift nobody has used.
 *
 * Both reference `X`-tier inputs, which is legal and deliberate — a site whose
 * gateway reports no door counters and no energy meter simply gets no value.
 * Neither carries a `maxInputAgeSeconds` override: the pack's only two are the
 * IAQ node's, whose outdoor reference is a slow *"site or API"* input. A
 * cumulative counter from the lift's own controller arrives at the controller's
 * scan rate, so the 300 s default is right.
 */
const LIFT_DERIVED: readonly DerivedRow[] = [
  ["door_reversal_ratio_pct", "{door_reversal_count} / {door_cycle_count} * 100", null],
  ["kwh_per_trip", "{kwh_total} / {trip_count}", null],
];

/**
 * §8a's sixteen alarm bullets become **seventeen** rows: *passenger alarm /
 * entrapment* is one bullet over two distinct declared points and splits.
 *
 * Two rows are the ones this table exists to hold.
 * `door_reversal_ratio_rising` binds `door_reversal_ratio_pct` — **a DERIVED
 * point**, which `assertContentRefsResolve` accepts because a derived point is
 * still a declared template point, and which is the whole reason the code was
 * promoted rather than deferred. `statutory_inspection_overdue` binds
 * `annual_inspection_due` — **a `manual` row**, whose value arrives through
 * `F1.8` manual entry and never from a data key (plan §12 ruling 6: author it,
 * do not drop it; nothing fires before `E2.4` in any case).
 */
const LIFT_ALARMS: readonly AlarmRow[] = [
  ["lift_out_of_service", "lift_in_service", "critical", "operations"],
  ["lift_fault", "lift_fault", "critical", "operations"],
  ["passenger_alarm", "passenger_alarm", "critical", "safety"],
  ["entrapment", "entrapment_state", "critical", "safety"],
  ["fire_recall_active", "fire_recall_state", "warning", "safety"],
  ["door_fault", "door_fault_state", "warning", "operations"],
  ["overload_persistent", "overload_state", "warning", "operations"],
  ["brake_monitoring_fault", "brake_fault_state", "critical", "safety"],
  ["governor_tripped", "governor_tripped", "critical", "safety"],
  ["pit_water", "pit_water_state", "warning", "safety"],
  ["machine_room_temp_high", "machine_room_temp_c", "warning", "operations"],
  ["hydraulic_oil_temp_high", "hydraulic_oil_temp_c", "warning", "operations"],
  ["ard_activation", "ard_state", "warning", "operations"],
  ["controller_comms_loss", "controller_comms_ok", "critical", "operations"],
  ["door_reversal_ratio_rising", "door_reversal_ratio_pct", "warning", "operations"],
  ["ride_quality_worsening", "vibration_z_mg", "warning", "operations"],
  ["statutory_inspection_overdue", "annual_inspection_due", "warning", "safety"],
];

/**
 * **`fire_recall_active` is the ONE row on this entry that carries no `skill`**
 * (plan §12 ruling 4 — 2 no-skill rows in PR 2, one here and
 * `emergency_stop_pressed` on the escalator).
 *
 * The rule the fire panel set: a trade answers the machine's own
 * infrastructure; none of migration `0034`'s five trades answers the EVENT the
 * machine reports. A lift under Phase 1 recall is not broken and no lift
 * engineer is dispatched — the fire system has taken the lift, and the
 * responder is the site's fire function. Every other row here is machine work:
 * the lift itself (`mechanical`), the pit (`civil`), the machine room's
 * ventilation (`hvac`), the mains supply that made the rescue device run
 * (`electrical`) and the gateway link (`controls`).
 *
 * `entrapment` and `passenger_alarm` DO carry `mechanical`, and that is the
 * distinction rather than an exception: somebody must physically release a
 * trapped passenger, and that is the lift engineer.
 */
const LIFT_NO_SKILL_ROWS = ["fire_recall_active"] as const;

/**
 * The message a callable throws, or `null` if it returns.
 *
 * A local copy of the shape the four negative fixtures in
 * `stock-catalog.spec.ts` already use inline. The plan's Task 13 snippet called
 * a `refusalFrom` that does not exist there, and the only one in the directory
 * is module-private in `stock-transcription.spec.ts` — which imports FROM
 * `stock-catalog.spec.ts`, so exporting it back would make an import cycle
 * (`E5.3` §13 finding, reported by the Task 11 implementer).
 */
function refusalFrom(run: () => void): string | null {
  try {
    run();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return null;
}

/**
 * **The override self-test, and the reason PR 2 changed a mechanism at all.**
 *
 * `mechanical-lift`'s prefix is `mechanical`, and `PACK_SOURCE_DOC` maps that
 * prefix to `e5.2-derived-taglist-v1.md` — `E5.2`'s document, which must keep
 * being the source for `E5.2`'s six entries. This entry's rows come from
 * `E5.3`'s. Task 11 added `ENTRY_SOURCE_DOC` to say so per code, and consulted
 * it first.
 *
 * **Without this test the override is a change nothing checks.** Delete the two
 * `ENTRY_SOURCE_DOC` keys and every other test in the repository still passes:
 * `checkEntry` would fall through to the prefix default, find
 * `e5.2-derived-taglist-v1.md`, and this entry's description does not contain
 * it — so the failure would be *"must cite e5.2-… by name"*, which reads as an
 * authoring mistake rather than a missing override. Worse is the other
 * direction: an author who "fixed" the description to cite `E5.2`'s document
 * would get a green suite and a citation pointing at the wrong handout, which
 * reads as provenance and is not.
 *
 * So the claim is made the only way that separates the two: take the SHIPPED
 * entry, swap its citation to `E5.2`'s document, and require that `checkEntry`
 * refuses it **naming E5.3's**. Only the override can produce that message.
 * `checkEntry` is never called on a real entry here — the catalog loop in
 * `stock-catalog.spec.ts` already does that — only on a deliberately broken
 * copy.
 */
function assertTheOverrideDecidesTheSource(entry = requireStockEntry(LIFT_CODE)): void {
  const description = String(entry.description ?? "");
  assert(
    description.includes(FACILITY_TAG_LIST),
    `${LIFT_CODE}.description must cite ${FACILITY_TAG_LIST} before this test can swap it. Got: ` +
      `"${description}"`,
  );
  const miscited = refusalFrom(() =>
    checkEntry({
      ...entry,
      description: description.replace(FACILITY_TAG_LIST, "e5.2-derived-taglist-v1.md"),
    }),
  );
  assert(
    miscited !== null && /e5\.3-derived-taglist-v1\.md/.test(miscited),
    `a ${LIFT_CODE} citing E5.2's document must be refused NAMING E5.3's — proof that ` +
      "ENTRY_SOURCE_DOC, and not the PACK_SOURCE_DOC prefix default, decides this entry's " +
      "source. The prefix is mechanical and the prefix map sends mechanical to E5.2's document, " +
      "which is correct for E5.2's six entries and wrong for this one; if the override were " +
      "dropped, the refusal would name E5.2's document instead and an author could go green by " +
      `citing the wrong handout. Got ${String(miscited)}`,
  );
  const unchanged = refusalFrom(() => checkEntry(entry));
  assert(
    unchanged === null,
    `${LIFT_CODE} as shipped must pass checkEntry — this test only proves the MISCITED copy is ` +
      `refused, and a shipped entry that also fails would make the claim above vacuous. Got ` +
      `${String(unchanged)}`,
  );
}

/**
 * `mechanical-lift` against `docs/e5.3-derived-taglist-v1.md` §8a (plan §5.8) —
 * **the pack's largest entry at 80 points**, and the one the per-entry citation
 * override exists for.
 *
 * Four properties meet here that no earlier entry in this pack has together: an
 * alarm binding a **derived** point, an alarm binding a **manual** row, six
 * referenced codes from four different sources, and a citation that its own
 * prefix would get wrong.
 */
function checkLift(): void {
  const entry = requireStockEntry(LIFT_CODE);
  assertEntryIdentity(LIFT_CODE, entry, "lift", "mechanical");

  // ---- 80 points, 7 core + 66 extended + 5 manual + 2 derived -------------

  assert(
    tierCount(entry, "core") === 7 &&
      tierCount(entry, "extended") === 66 &&
      tierCount(entry, "manual") === 5 &&
      tierCount(entry, "derived") === 2,
    "§8a marks 7 rows C, 66 X (the X/D entrapment_state among them) and 5 M, and two of its " +
      `thirteen derived codes are promoted — 7/66/5 + 2. Got ${tierCount(entry, "core")}/` +
      `${tierCount(entry, "extended")}/${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(LIFT_CODE, "§8a", entry, LIFT_POINTS);
  assertDerivedPoints(LIFT_CODE, entry, LIFT_DERIVED);
  assertNoKpis(LIFT_CODE, entry, "§8a");
  assertDeferralsAbsent(LIFT_CODE, entry);

  // ---- the X/D row, authored measured, and the reason --------------------

  const entrapment = entry.points.find((point) => point.pointKey === "entrapment_state");
  assert(
    entrapment?.kind === "measured" &&
      entrapment.meta?.tier === "extended" &&
      entrapment.required === false,
    `${LIFT_CODE}.entrapment_state must be MEASURED and tier X, not derived (plan §12 ruling 3). ` +
      "§8a marks it X/D, and the document's own definition — car stopped between floors WITH " +
      "LOAD, or alarm and not at a landing — needs a CAR-LOAD THRESHOLD to evaluate. B7/B8 " +
      "forbid a shipped limit in v1, so a derived authoring would have to either invent that " +
      "threshold or write a formula that does not express the definition; both are worse than a " +
      "point a controller reports directly. checkEntry's meta.tier-iff-measured rule then makes " +
      `the tier readable, which a derived point could not carry. Got kind ${String(entrapment?.kind)}, ` +
      `tier ${String(entrapment?.meta?.tier)}, required ${String(entrapment?.required)}.`,
  );

  // ---- the six referenced codes, each with the unit the vocabulary holds --

  const referenced: Readonly<Record<string, string | null>> = {
    controller_comms_ok: null,
    motor_current_a: "A",
    motor_temp_c: "°C",
    kw: "kW",
    kwh_total: "kWh",
    run_hours_h: "h",
  };
  for (const [pointKey, unit] of Object.entries(referenced)) {
    const point = entry.points.find((row) => row.pointKey === pointKey);
    assert(
      point !== undefined && (point.unit ?? null) === unit,
      `${LIFT_CODE}.${pointKey} is a REFERENCED code — declared by an earlier entry or seeded ` +
        "long before this pack, and redeclared nowhere (ADR 0054 decision 3). It must carry the " +
        `unit the vocabulary already holds (${String(unit)}), because a template unit OVERRIDES ` +
        "the catalog's on every instantiated point and UNIT_BY_KEY's seed is COALESCE(existing, " +
        `excluded), so a wrong one here cannot be corrected by a later seed. Got ` +
        `${String(point?.unit)}.`,
    );
  }
  const commsOk = entry.points.find((point) => point.pointKey === "controller_comms_ok");
  assert(
    commsOk?.meta?.tier === "core" && commsOk.required === true,
    `${LIFT_CODE}.controller_comms_ok must be tier C and required. §3 declared it on the access ` +
      "door in PR 1 and §8a references it, which is the dependency that made PR 2 a second pull " +
      "request cut from main rather than a stacked branch: without PR 1's vocabulary commit this " +
      `key is not an active point_keys row and every import fails. Got tier ` +
      `${String(commsOk?.meta?.tier)}, required ${String(commsOk?.required)}.`,
  );

  // ---- the five M rows ----------------------------------------------------

  const manualRows = entry.points.filter((point) => point.meta?.tier === "manual");
  assert(
    manualRows.every((point) => point.required === false && point.sourceDataKeyPattern === null) &&
      manualRows.map((point) => point.pointKey).join(",") ===
        "annual_inspection_due,rope_condition,brake_test_result,buffer_test_result,ard_battery_test",
    `${LIFT_CODE}'s five M rows are the statutory block: the inspection due date and the four ` +
      "test results, all of them a signature on a certificate rather than telemetry. Each must " +
      "be optional with a null sourceDataKeyPattern — an M row is always in skippedPoints and " +
      "never gets an asset_points row, so promoting one to C would make every instantiation " +
      `fail. Got [${manualRows.map((point) => point.pointKey).join(", ")}].`,
  );

  // ---- 17 alarms from sixteen bullets, one of them with no trade ----------

  const alarms = alarmsOf(entry);
  assertAlarmTable(LIFT_CODE, "§8a", alarms, LIFT_ALARMS);
  assertPhilosophyRows(LIFT_CODE, alarms);
  assertSkillAssignment(
    LIFT_CODE,
    alarms,
    {
      lift_out_of_service: "mechanical",
      lift_fault: "mechanical",
      passenger_alarm: "mechanical",
      entrapment: "mechanical",
      door_fault: "mechanical",
      overload_persistent: "mechanical",
      brake_monitoring_fault: "mechanical",
      governor_tripped: "mechanical",
      pit_water: "civil",
      machine_room_temp_high: "hvac",
      hydraulic_oil_temp_high: "mechanical",
      ard_activation: "electrical",
      controller_comms_loss: "controls",
      door_reversal_ratio_rising: "mechanical",
      ride_quality_worsening: "mechanical",
      statutory_inspection_overdue: "mechanical",
    },
    LIFT_NO_SKILL_ROWS,
  );
  assert(
    LIFT_NO_SKILL_ROWS.length === 1 && LIFT_NO_SKILL_ROWS[0] === "fire_recall_active",
    `${LIFT_CODE} must carry exactly ONE row with no skill — fire_recall_active. A lift under ` +
      "Phase 1 recall is not broken and no lift engineer is dispatched: the fire system has " +
      "taken the lift and the responder is the site's fire function, which is not one of " +
      "migration 0034's five trades. Every other row here is machine work, the pit (civil), the " +
      "machine room's ventilation (hvac), the mains supply (electrical) or the gateway link " +
      `(controls). Got [${LIFT_NO_SKILL_ROWS.join(", ")}].`,
  );
  assertNoLimitNumbers(
    LIFT_CODE,
    alarms,
    ["entrapment", "brake_monitoring_fault", "governor_tripped", "ride_quality_worsening"],
    FACILITY_VERTICAL_TRANSPORT_REGIME,
  );

  // ---- the derived binding and the manual binding -------------------------

  const reversalRising = alarms.find((alarm) => alarm.code === "door_reversal_ratio_rising");
  const reversalPoint = entry.points.find((point) => point.pointKey === "door_reversal_ratio_pct");
  assert(
    reversalRising?.pointKey === "door_reversal_ratio_pct" && reversalPoint?.kind === "derived",
    `${LIFT_CODE}'s door_reversal_ratio_rising must bind door_reversal_ratio_pct, and that point ` +
      "must be DERIVED. This is the reason the code was promoted rather than deferred: the ratio " +
      "is the lead indicator §8a names for an obstruction or a misaligned door, and an alarm on " +
      "the raw door_reversal_count would fire on a busy lift. assertContentRefsResolve accepts " +
      "it because a derived point is still a declared template point. Got " +
      `"${String(reversalRising?.pointKey)}" binding a ${String(reversalPoint?.kind)} point.`,
  );
  const inspectionOverdue = alarms.find(
    (alarm) => alarm.code === "statutory_inspection_overdue",
  );
  const inspectionPoint = entry.points.find(
    (point) => point.pointKey === "annual_inspection_due",
  );
  assert(
    inspectionOverdue?.pointKey === "annual_inspection_due" &&
      inspectionPoint?.meta?.tier === "manual",
    `${LIFT_CODE}'s statutory_inspection_overdue must bind annual_inspection_due, and that row ` +
      "must be tier M. It is the pack's first alarm on a MANUAL row (plan §12 ruling 6: author " +
      "it, do not drop it) — the date arrives through F1.8 manual entry and never from a data " +
      "key, so the row is always in skippedPoints and no reading ever moves it. The binding is " +
      "still legal and still resolves at import, and nothing fires before E2.4 wires rules in " +
      `any case. Got "${String(inspectionOverdue?.pointKey)}" binding a tier ` +
      `${String(inspectionPoint?.meta?.tier)} row.`,
  );
  assert(
    DEFERRED_DERIVED_CODES[LIFT_CODE].length === 11,
    "§8a's Derived: line names thirteen codes; two are promoted and eleven are deferred — seven " +
      "windows, one that lives in the work-order system (mttr_h, E3.1), one method the document " +
      "only names (ride_quality_index), one baseline trend (levelling_drift_mm) and one rate " +
      "whose two counters do not share a denominator (fault_rate_per_1000_trips). Got " +
      `${DEFERRED_DERIVED_CODES[LIFT_CODE].length}.`,
  );

  // ---- the citation its own prefix would get wrong -------------------------

  assertTheOverrideDecidesTheSource(entry);

  // ---- 6 maintenance plans, three of them safetyCritical ------------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 6, `plan §5.10 authors 6 lift plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 3 &&
      safetyCritical.every((plan) => plan.category === "safety_critical") &&
      safetyCritical.map((plan) => plan.title).join(" | ") ===
        "Brake and UCMP test | Overspeed governor and safety-gear test | " +
          "Annual statutory inspection and licence",
    "exactly three lift plans are safetyCritical, all three also categorised safety_critical — " +
      "the brake and UCMP test, the overspeed governor and safety-gear test, and the annual " +
      "statutory inspection and licence. Those three are the barriers between a lift and a free " +
      "fall, and the licence is what makes the lift legal to run. The door operator service, the " +
      "rope and machine inspection and the ARD battery test all matter and none of them is a " +
      `barrier. Got ${safetyCritical.length}: ` +
      `${safetyCritical.map((plan) => plan.title).join(" | ") || "(none)"}`,
  );
  const statutory = plans.find((plan) => plan.title === "Annual statutory inspection and licence");
  assert(
    statutory?.complianceRef === "State Lift Act licence",
    `${LIFT_CODE}'s annual statutory inspection must carry complianceRef "State Lift Act ` +
      'licence". Lifts in India are licensed state by state and the inspection is what renews ' +
      "the licence, so complianceRef names the statute rather than a standard — and it is a " +
      `citation, not a limit, which is why no alarm row here carries a digit. Got ` +
      `"${String(statutory?.complianceRef)}".`,
  );
  const conditionPlans = plans.filter((plan) => plan.category === "condition_based");
  assert(
    conditionPlans.length === 1 && conditionPlans[0]?.generationMode === "condition",
    `${LIFT_CODE} must carry exactly one condition_based plan, generated in "condition" mode — ` +
      "the door operator service. A door operator is the one part of a lift whose service " +
      "interval is genuinely driven by use rather than by the calendar, and the other five plans " +
      `are all fixed by a standard or a statute. Got ${conditionPlans.length} plan(s), mode ` +
      `"${String(conditionPlans[0]?.generationMode)}".`,
  );
  const trigger = String(conditionPlans[0]?.triggerSummary ?? "");
  for (const pointKey of ["door_cycle_count", "door_reversal_ratio_pct"]) {
    assert(
      trigger.includes(pointKey),
      `${LIFT_CODE}'s door operator plan must name ${pointKey} in its triggerSummary — the wear ` +
        "counter and the promoted ratio, which are exactly the two rows whose movement generates " +
        "the work order and the two the door_reversal_ratio_rising alarm is built on. A " +
        "condition plan that does not say what condition generates it is a calendar plan with a " +
        `different word on it. Got: "${trigger}"`,
    );
  }
  assertMaintenanceBounds(LIFT_CODE, entry);
  assertProvenance(LIFT_CODE, entry, FACILITY_TAG_LIST, "§8a");
}

/**
 * Every per-class block in this file — one, and one more is owed. Called by
 * `facility-classes-4.test.ts`, its name-sibling wrapper. §8b (the escalator)
 * lands in `facility-classes-5.spec.ts` at Task 14.
 */
export function runFacilityClassEntryTests4(): void {
  checkLift();
}
