import { FACILITY_STOCK_ASSET_TEMPLATES } from "./facility";
import { assertCoPpmTier } from "./facility-classes-2.spec";
import { FACILITY_LIFE_SAFETY_REGIME, FACILITY_TAG_LIST } from "./facility-classes.spec";
import { DEFERRED_DERIVED_CODES } from "./stock-catalog-deferrals.spec";
import { alarmsOf, assert, maintenanceOf, requireStockEntry } from "./stock-catalog.spec";
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
 * `E5.3` pass C, the third of three transcription spec files — §6 (the indoor
 * air quality node) and §7 (the BAS gateway) of
 * `docs/e5.3-derived-taglist-v1.md`.
 *
 * **Two entries here, three in `-2` and two in `facility-classes.spec.ts`**, the
 * split plan §4.5 fixed: the AGENTS.md §4.5 pre-commit guard reads a whole file.
 * **This file is created with the IAQ block alone and §7 appends to it** — the
 * runner at the foot is the seam, so Task 10 adds one `check…()` call and
 * nothing else moves.
 *
 * **It reaches into `-2` for one function and that is deliberate.**
 * `assertCoPpmTier` is the pack's dual-tier claim: `co_ppm` is `core` on the
 * parking level and `extended` here, one code declared once under `facility` and
 * filed at two tiers because a tier is per ENTRY (ADR 0054 decision 4). Each
 * block asserts its own half — a claim about a pair asserted from one side only
 * is half a claim, and each entry ships in its own commit, so neither block may
 * reach into an entry the catalog has not got yet.
 *
 * **`facility-classes-3.test.ts` is this file's name-sibling wrapper** —
 * `tests/repo-invariants.test.ts` matches the pair by name, and a spec imported
 * from a differently-named wrapper still runs but is absent from coverage.
 */

// ===========================================================================
// §6 — `environment-iaq-node`
// ===========================================================================

const IAQ_CODE = "environment-iaq-node";

/**
 * §6's 15 table rows in the document's own order (`sortOrder` 0-14), then the
 * two promoted derived points at 15 and 16 — `[pointKey, tier, unit]`.
 *
 * **Only two rows carry a null unit** — `sensor_online`, which is a `0/1` row,
 * and the dimensionless ratio at the foot. This is the pack's most
 * unit-dense table and the one where a mis-transcribed spelling would do the
 * most damage: `µg/m³` is **U+00B5 MICRO SIGN** followed by `g/m` and **U+00B3
 * SUPERSCRIPT THREE**, matching `E5.1`'s `µS/cm`, and `CFU/m³` carries the same
 * superscript. A `ug/m3` spelled with an ASCII `u` and a plain `3` is a
 * different string that renders almost identically, and `UNIT_BY_KEY`'s seed is
 * `COALESCE(existing, excluded)` — so an override shipped here could not be
 * corrected by a later seed on any organization that imported the entry.
 *
 * **Four rows are REUSED codes and none is redeclared** (ADR 0054 decision 3).
 * `temperature_c` and `humidity_pct` come from
 * `CONTROL_ROOM_ENVIRONMENT_POINT_KEYS` — the closed `z.enum` the control-room
 * screens consume, which this pack does not widen — and are `core` here with
 * `°C` and `%`. `co_ppm` and `sensor_battery_pct` are filed under `facility`,
 * by §5 and §4 respectively, and are referenced from this `environment` entry:
 * **a reference crosses a domain line, because first occurrence wins over the
 * whole document and not per domain.**
 *
 * `microbial_count_cfu` at index 14 is the entry's one `M` row — a laboratory
 * result entered by hand through `F1.8`, never mapped from a data key.
 *
 * `no2_ppb` here is **not** §5's `no2_ppm`: two quantities at two ranges, an
 * indoor node's trace measurement and a basement's diesel exhaust.
 */
const IAQ_POINTS: readonly PointRow[] = [
  ["temperature_c", "core", "°C"],
  ["humidity_pct", "core", "%"],
  ["co2_ppm", "core", "ppm"],
  ["pm25_ugm3", "core", "µg/m³"],
  ["pm10_ugm3", "extended", "µg/m³"],
  ["tvoc_ugm3", "extended", "µg/m³"],
  ["ch2o_ugm3", "extended", "µg/m³"],
  ["co_ppm", "extended", "ppm"],
  ["o3_ppb", "extended", "ppb"],
  ["no2_ppb", "extended", "ppb"],
  ["outdoor_pm25_ugm3", "extended", "µg/m³"],
  ["outdoor_co2_ppm", "extended", "ppm"],
  ["sensor_battery_pct", "extended", "%"],
  ["sensor_online", "core", null],
  ["microbial_count_cfu", "manual", "CFU/m³"],
  ["co2_above_outdoor_ppm", "derived", "ppm"],
  ["pm25_indoor_outdoor_ratio", "derived", null],
];

/**
 * §6 promotes **two** of its five derived codes, and they are **the only two
 * points in the whole pack that override `maxInputAgeSeconds`**.
 *
 * Both divide or subtract an INDOOR reading by an OUTDOOR one, and §6 spells the
 * outdoor rows *"site or API"*. A weather service updates hourly at best, so at
 * the 300 s default the formula would silently never fire — which reads to an
 * operator as *"the feature is broken"* and is the harder failure to diagnose
 * than a wrong number. `3600` is `E5.1`'s `approach_c` precedent and `E5.2`'s
 * `oil_rise_over_ambient_c` one: a slow site input gets an age the site can
 * actually meet.
 *
 * `pm25_indoor_outdoor_ratio` is **dimensionless** and carries a `null` unit
 * here against `""` in the vocabulary — the `cop` spelling (plan §12 ruling 7).
 * A ratio with a percent sign on it would be read as a percentage and is not
 * one: it is above one when the indoor air is dirtier than the outdoor air.
 *
 * A node whose outdoor reference is missing or zero divides by zero and
 * `evaluate.ts` returns `non_finite` — no value, never a wrong one — so neither
 * row is guarded or clamped.
 */
const IAQ_DERIVED: readonly DerivedRow[] = [
  ["co2_above_outdoor_ppm", "{co2_ppm} - {outdoor_co2_ppm}", 3600],
  ["pm25_indoor_outdoor_ratio", "{pm25_ugm3} / {outdoor_pm25_ugm3}", 3600],
];

/**
 * §6's six alarm bullets, one row each — nothing dropped and nothing invented.
 *
 * **Every row carries a `skill`**, and this is the only entry after §1's
 * lighting zone where that is true. Four are `hvac` because what answers an air
 * quality reading is ventilation and filtration, and two are `controls` because
 * a node that has stopped reporting or is running its battery down is a sensor
 * binding.
 *
 * `co2_above_outdoor_high` **binds the derived point** — shipped behaviour, the
 * `recovery_low` shape — and it must, because the quantity the ventilation
 * question is asked about is the DIFFERENCE and not the absolute indoor reading:
 * a site whose outdoor air is already high is not under-ventilated for having a
 * high indoor number.
 */
const IAQ_ALARMS: readonly AlarmRow[] = [
  ["co2_above_outdoor_high", "co2_above_outdoor_ppm", "warning", "comfort"],
  ["pm25_high", "pm25_ugm3", "warning", "comfort"],
  ["tvoc_high", "tvoc_ugm3", "warning", "comfort"],
  ["co_high", "co_ppm", "critical", "safety"],
  ["sensor_offline", "sensor_online", "warning", "operations"],
  ["sensor_battery_low", "sensor_battery_pct", "info", "operations"],
];

/**
 * **The pack's two `maxInputAgeSeconds` overrides, asserted in BOTH directions.**
 *
 * The positive half — that the two IAQ formulas carry `3600` — is already in
 * {@link IAQ_DERIVED} and `assertDerivedPoints` checks it. This function adds
 * the half that a per-entry table cannot make: **every other derived point in
 * the pack carries `null`**, so a later author cannot quietly give a third
 * formula an override "to be safe". An override is a claim that an input is slow,
 * and it is wrong on a point whose inputs arrive from the asset's own controller
 * at the asset's own scan rate.
 *
 * It walks `FACILITY_STOCK_ASSET_TEMPLATES` rather than a list of codes, so it
 * covers §7 when Task 10 lands it and the two vertical-transport entries when
 * PR 2 does — and it is scoped to this pack rather than the whole catalog
 * because `electrical-transformer`'s `oil_rise_over_ambient_c` legitimately
 * carries `3600` for the same reason and is not this pack's claim to make.
 */
function assertTheOnlyTwoSlowInputOverrides(): void {
  const overridden: string[] = [];
  const defaulted: string[] = [];
  for (const entry of FACILITY_STOCK_ASSET_TEMPLATES) {
    for (const point of entry.points) {
      if (point.kind !== "derived") continue;
      const label = `${entry.code}.${point.pointKey}`;
      if (point.maxInputAgeSeconds === null) defaulted.push(label);
      else overridden.push(`${label}=${String(point.maxInputAgeSeconds)}`);
    }
  }
  assert(
    overridden.join(", ") ===
      `${IAQ_CODE}.co2_above_outdoor_ppm=3600, ${IAQ_CODE}.pm25_indoor_outdoor_ratio=3600`,
    "the facility pack must carry EXACTLY two maxInputAgeSeconds overrides, both on " +
      `${IAQ_CODE}, both 3600. Got: [${overridden.join(", ") || "(none)"}]. An override is a ` +
      "CLAIM that an input is slow, and §6's outdoor reference rows are the only inputs in this " +
      "pack that are — the document spells them \"site or API\", and a weather service updates " +
      "hourly at best. On a point whose inputs arrive from the asset's own controller at the " +
      "asset's own scan rate the 300 s default is right, and raising it there hides a source " +
      "that has gone stale behind a formula that keeps computing.",
  );
  assert(
    defaulted.length > 0,
    "no derived point in the facility pack carries the default maxInputAgeSeconds, which means " +
      "this check has nothing to compare the two overrides against and is vacuous. At least the " +
      "access door's denial ratio and both occupancy ratios must carry null.",
  );
}

/**
 * **The two reused control-room codes, asserted with their units.**
 *
 * `temperature_c` and `humidity_pct` live in
 * `CONTROL_ROOM_ENVIRONMENT_POINT_KEYS` and stay there: it backs
 * `controlRoomEnvironmentPointKeySchema`, a **closed `z.enum`** the control-room
 * screens consume, and `ENVIRONMENT_CLASS_POINT_KEYS` is a SECOND array under
 * the same domain rather than a widening of that one (the
 * `HVAC_CLASS_POINT_KEYS` precedent, ADR 0054 decision 3).
 *
 * Their units are the reason this is asserted rather than left to the point
 * table: both are already seeded, write-once through the seed's `COALESCE`, and
 * this entry must carry the SAME spellings rather than override them on every
 * organization that imports it. Both are `core` here because an air quality node
 * that reports no temperature and no humidity cannot say whether the air is
 * comfortable, only whether it is clean.
 */
function assertTheReusedControlRoomCodes(entry = requireStockEntry(IAQ_CODE)): void {
  for (const [pointKey, unit] of [
    ["temperature_c", "°C"],
    ["humidity_pct", "%"],
  ] as const) {
    const point = entry.points.find((row) => row.pointKey === pointKey);
    assert(
      point?.meta?.tier === "core" && point.required === true && point.unit === unit,
      `${IAQ_CODE}.${pointKey} must be tier C, required, with unit "${unit}". It is a REUSED ` +
        "code from CONTROL_ROOM_ENVIRONMENT_POINT_KEYS and is referenced here, never redeclared " +
        "— that array backs controlRoomEnvironmentPointKeySchema, a closed z.enum the " +
        "control-room screens consume, and ENVIRONMENT_CLASS_POINT_KEYS is a second array under " +
        "the same domain rather than a widening of it. The unit is already seeded write-once " +
        "through COALESCE, so this row must carry the same spelling rather than override the " +
        `catalog on every organization that imports the entry. Got tier ` +
        `${String(point?.meta?.tier)}, required ${String(point?.required)}, unit ` +
        `${String(point?.unit)}.`,
    );
  }
}

/**
 * `environment-iaq-node` against `docs/e5.3-derived-taglist-v1.md` §6 (plan
 * §5.6) — **the first stock entry ever filed under `environment`**, and the
 * pack's second escalation checkpoint.
 *
 * Four things meet here and nowhere else in PR 1: a domain that is not the
 * prefix of five of its six siblings, two references that cross a domain line
 * (`co_ppm` and `sensor_battery_pct` are filed under `facility`), two reused
 * control-room codes, and the pack's only two `maxInputAgeSeconds` overrides.
 */
function checkIaqNode(): void {
  const entry = requireStockEntry(IAQ_CODE);
  assertEntryIdentity(IAQ_CODE, entry, "iaq_node", "environment");

  // ---- 17 points, 5 core + 9 extended + 1 manual + 2 derived --------------

  assert(
    tierCount(entry, "core") === 5 &&
      tierCount(entry, "extended") === 9 &&
      tierCount(entry, "manual") === 1 &&
      tierCount(entry, "derived") === 2,
    `§6 marks 5 rows C, 9 X and 1 M, and two of its five derived codes are authored — 5/9/1/2. ` +
      `Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(IAQ_CODE, "§6", entry, IAQ_POINTS);
  assertDerivedPoints(IAQ_CODE, entry, IAQ_DERIVED);
  assertTheOnlyTwoSlowInputOverrides();
  assertTheReusedControlRoomCodes(entry);
  assertCoPpmTier(IAQ_CODE, "extended");
  assertNoKpis(IAQ_CODE, entry, "§6");
  assertDeferralsAbsent(IAQ_CODE, entry);

  // ---- the M row, and the domain that is not the pack's prefix ------------

  const microbial = entry.points.find((point) => point.pointKey === "microbial_count_cfu");
  assert(
    microbial?.meta?.tier === "manual" &&
      microbial.required === false &&
      microbial.sourceDataKeyPattern === null,
    `${IAQ_CODE}.microbial_count_cfu must be tier M, optional and carry a null ` +
      "sourceDataKeyPattern. §6 marks it M because a total microbial count is a LABORATORY " +
      "result on a periodic sample, not a telemetry point: it arrives through F1.8 manual entry " +
      "and is never mapped from a data key. An M row therefore never gets an asset_points row " +
      `at all — it is always in skippedPoints — and promoting it to C would make every import ` +
      `fail. Got tier ${String(microbial?.meta?.tier)}, required ${String(microbial?.required)}, ` +
      `pattern ${String(microbial?.sourceDataKeyPattern)}.`,
  );
  const batteryRow = entry.points.find((point) => point.pointKey === "sensor_battery_pct");
  assert(
    batteryRow?.meta?.tier === "extended" && batteryRow.unit === "%",
    `${IAQ_CODE}.sensor_battery_pct must be tier X with unit "%". It is filed under FACILITY — ` +
      "§4's occupancy zone is its first occurrence in the document — and is referenced here from " +
      "an ENVIRONMENT entry, which is the point: first occurrence wins over the whole document " +
      "and not per domain (ADR 0054 decision 3), so a domain line is not a vocabulary boundary. " +
      `Got tier ${String(batteryRow?.meta?.tier)}, unit ${String(batteryRow?.unit)}.`,
  );

  // ---- 6 alarms, every one of them with a trade --------------------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(IAQ_CODE, "§6", alarms, IAQ_ALARMS);
  assertPhilosophyRows(IAQ_CODE, alarms);
  assertSkillAssignment(
    IAQ_CODE,
    alarms,
    {
      co2_above_outdoor_high: "hvac",
      pm25_high: "hvac",
      tvoc_high: "hvac",
      co_high: "hvac",
      sensor_offline: "controls",
      sensor_battery_low: "controls",
    },
    // Every row here carries a trade, and the empty list is the CLAIM —
    // assertSkillAssignment requires the map and this list to partition the six.
    // Four are ventilation and filtration questions (hvac) and two are sensor
    // bindings (controls). None of the pack's 14 no-skill rows is on this entry:
    // an air quality reading is not a life-safety event somebody attends, it is
    // a condition an engineer corrects.
    [],
  );
  assertNoLimitNumbers(
    IAQ_CODE,
    alarms,
    ["co2_above_outdoor_high", "pm25_high", "co_high"],
    FACILITY_LIFE_SAFETY_REGIME,
  );

  const aboveOutdoor = alarms.find((alarm) => alarm.code === "co2_above_outdoor_high");
  assert(
    aboveOutdoor?.pointKey === "co2_above_outdoor_ppm",
    `${IAQ_CODE}'s co2_above_outdoor_high must bind the DERIVED co2_above_outdoor_ppm and not ` +
      "the raw indoor reading. The ventilation question is asked about the DIFFERENCE: a site " +
      "whose outdoor air is already high is not under-ventilated for having a high indoor " +
      "number, and a site in clean air is under-ventilated well before its indoor reading looks " +
      `alarming. An alarm on a derived point is shipped behaviour. Got ` +
      `"${String(aboveOutdoor?.pointKey)}".`,
  );
  const co = alarms.find((alarm) => alarm.code === "co_high");
  assert(
    co?.severity === "critical" && co.category === "safety",
    `${IAQ_CODE}'s co_high must be critical / safety — it is the one row on this entry that is ` +
      "not about comfort. Carbon monoxide indoors is combustion ingress: a flue, a plant room, a " +
      "loading bay or a kitchen appliance venting into occupied space. The other three readings " +
      `are conditions to correct and this one is people to move. Got ${String(co?.severity)} / ` +
      `${String(co?.category)}.`,
  );
  assert(
    DEFERRED_DERIVED_CODES[IAQ_CODE].length === 3,
    "§6's Derived: line names five codes: two are authored above and three are deferred — two " +
      "METHODS the document only names (iaq_index's ISHRAE banding and " +
      "ventilation_adequacy_pct's rate, which is per occupancy category) and one window " +
      `(hours_out_of_band_day). Got ${DEFERRED_DERIVED_CODES[IAQ_CODE].length}.`,
  );

  // ---- 3 maintenance plans, none safetyCritical, none condition_based -----

  const plans = maintenanceOf(entry);
  assert(plans.length === 3, `plan §5.10 authors 3 IAQ plans; the entry carries ${plans.length}`);
  // NO safetyCritical plan, and that is authoring rather than omission (E5.2
  // §13 item 10). This is a SENSING node: nothing on it is a barrier whose
  // silent failure hurts somebody, and the co_high row it raises is answered by
  // moving people and finding the source, not by a plan. ADR 0054 decision 8
  // names ten critical plans across the pack and none of them is here.
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 0,
    `${IAQ_CODE} must carry NO safetyCritical plan. It is a sensing node: nothing on it is a ` +
      "barrier whose silent failure hurts somebody, and the co_high row it raises is answered by " +
      "moving people and finding the combustion source rather than by a task. The calibration " +
      "is what keeps its readings honest and it is calibration work. Got " +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ")}`,
  );
  const calibration = plans.find((plan) => plan.category === "calibration");
  for (const pointKey of ["co2_ppm", "pm25_ugm3"]) {
    assert(
      String(calibration?.triggerSummary ?? "").includes(pointKey),
      `${IAQ_CODE}'s calibration plan must name ${pointKey} in its triggerSummary — the two ` +
        "readings a co-location check is done on, and the two the entry's derived points are " +
        `computed from. Got: "${String(calibration?.triggerSummary)}"`,
    );
  }
  const sampling = plans.find((plan) => plan.category === "inspection_round");
  assert(
    String(sampling?.triggerSummary ?? "").includes("microbial_count_cfu"),
    `${IAQ_CODE}'s microbial sampling round must name microbial_count_cfu in its triggerSummary ` +
      "— the M row the round EXISTS to record. An M row gets no asset_points row and is always " +
      "skipped at instantiation, so the plan is the only thing in the template that says how " +
      `the value arrives. Got: "${String(sampling?.triggerSummary)}"`,
  );
  const conditionPlans = plans.filter((plan) => plan.category === "condition_based");
  assert(
    conditionPlans.length === 0 && plans.every((plan) => plan.generationMode === "calendar"),
    `${IAQ_CODE} must carry NO condition_based plan and every plan in "calendar" mode. A sensor ` +
      "is co-located and re-spanned on a schedule, a battery is replaced on a round and a " +
      "microbial sample is taken periodically; none of the three is generated by a reading, and " +
      "a high pollutant reading is an alarm somebody answers now rather than a work order raised " +
      `later. Got ${conditionPlans.length} condition_based plan(s), modes [` +
      `${plans.map((plan) => String(plan.generationMode)).join(", ")}].`,
  );
  assertMaintenanceBounds(IAQ_CODE, entry);
  assertProvenance(IAQ_CODE, entry, FACILITY_TAG_LIST, "§6");
}

/**
 * Every per-class block in this file. Called by `facility-classes-3.test.ts`,
 * its name-sibling wrapper. **§1 and §2 live in `facility-classes.spec.ts` and
 * §3, §4 and §5 in `-2`**, so no file in this directory approaches the §4.5 cap.
 */
export function runFacilityClassEntryTests3(): void {
  checkIaqNode();
}
