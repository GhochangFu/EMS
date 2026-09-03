/**
 * `E5.3` — the facility / smart-building point-key vocabulary.
 *
 * **Source and status.** Every code below is transcribed from
 * `docs/e5.3-derived-taglist-v1.md`, the derived tag list, under
 * **ADR 0054** (*E5.3 facility pack, provisional authoring*, Accepted
 * 2026-09-03). The document is **PROVISIONAL**: it was derived from the
 * Ion Exchange SOW and from the class conventions the earlier packs set, and
 * **no client has confirmed a row of it**. Nothing here is a commitment about
 * a site's real instrumentation. The plan is
 * `docs/plans/e5.3-facility-domain-pack.md`; §4.4 is the reconciled per-code
 * table these arrays are typed from, and §12 records the eight rulings the
 * repository owner made on 2026-09-04 before the first line was written.
 *
 * **Why this file exists at all, and why it is not `constants.ts`.**
 * ADR 0054 decision 3 says *"three arrays in `constants.ts`"*, and that cannot
 * be built. `packages/shared/src/constants.ts` is 927 lines; AGENTS.md §4.5's
 * 1000-line cap is read WHOLE-FILE by `.githooks/pre-commit.mjs:191-194`, and
 * PR 1's 104 codes need roughly a hundred lines at three per line with a
 * docblock. The ADR's Consequences say the cap *"is not the pressure `E5.2`
 * faced"* — true of the spec directory it measured, and not of the constants
 * file. §12 ruling 1 is the correction, and it lands in the closure's
 * `docs(adr):` pull request rather than here.
 *
 * **The four existing class arrays stay in `constants.ts`.** They are
 * write-once and frozen; moving 624 lines of settled data loses their blame
 * for nothing. `E5.2`'s docblocks say the arrays must stay in `constants.ts`
 * *because the guards read that file as text* — which stopped being true the
 * moment the guards started reading a LIST. `tests/f2.13`, `tests/f3.38` and
 * `tests/f3.39` now hold a `POINT_KEY_SOURCE_RELS` list with a **per-file
 * anti-vacuity floor**, so a file that parses as nothing names itself instead
 * of hiding behind the other file's codes.
 *
 * **Why three arrays and not one.** ADR 0054 decision 2 files each code under
 * the domain its entry's prefix spells, and `tests/f3.39`'s clash check reads
 * one domain per ARRAY: `ARRAY_DOMAIN` maps an array name to the domain
 * `keysForDomain` files it under, and a mixed array would give one code two
 * domains with the later `keysForDomain` call silently winning. So the
 * facility codes and the environment codes are two arrays here, and PR 2's
 * `VERTICAL_TRANSPORT_CLASS_POINT_KEYS` will be the third, filed `mechanical`.
 *
 * **The eleven reused codes are REFERENCED, never redeclared** (decision 3),
 * because a catalogue unit is write-once: `seedPointKeyCatalog` runs last and
 * a second declaration with a different spelling would overwrite a live one.
 * Four live in `CONTROL_ROOM_ENVIRONMENT_POINT_KEYS` (`smoke_state`,
 * `leak_state`, `temperature_c` `degC`, `humidity_pct` `%`), three in
 * `MECHANICAL_CLASS_POINT_KEYS` (`motor_current_a`, `motor_temp_c`,
 * `vibration_mms`) and four in the electrical arrays (`kw`, `kwh_total`,
 * `run_hours_h`, `start_count`). Every one of the eleven carries a unit the
 * document's own column agrees with — measured, not assumed (plan §4.2).
 *
 * **Why `ENVIRONMENT_CLASS_POINT_KEYS` is not appended to
 * `CONTROL_ROOM_ENVIRONMENT_POINT_KEYS`.** That array is consumed as a CLOSED
 * enum: `controlRoomEnvironmentPointKeySchema = z.enum(
 * CONTROL_ROOM_ENVIRONMENT_POINT_KEYS)` in `contracts/dashboard.ts:174`, and
 * the control-room screens bind exactly those four keys. Appending thirteen
 * indoor-air-quality codes would widen a contract enum that no control-room
 * widget can render, for no gain. A SECOND array under one domain is the
 * `HVAC_CLASS_POINT_KEYS` precedent — that array sits beside
 * `HVAC_POINT_KEYS` under `hvac` — and `tests/f3.39`'s clash check is per
 * code, not per domain, so two arrays under `environment` are legal as long
 * as they stay disjoint. They are.
 *
 * **First occurrence wins across the whole document.** A code declared in an
 * earlier section is not listed again in a later one, so the section comments
 * below give the document's row count and then the array's. `occupancy_state`
 * is §1's and §4 reuses it; `entry_count` and `exit_count` are §4's and §5
 * reuses them; `smoke_state` (§2) and `leak_state` (§7) are the control-room
 * array's. **Three codes cross a domain boundary inside the pack** and are
 * declared HERE, under `facility`, because that is where they occur first:
 * `co_ppm` and `sensor_battery_pct` (§5 and §4) are referenced by the
 * `environment` IAQ node, and `controller_comms_ok` (§3) is referenced by
 * PR 2's `mechanical` lift. A code's DOMAIN is where it is declared; an entry
 * in another domain may still name it, and `assertPointKeysActive` only asks
 * that the code exists and is active.
 *
 * **`co_ppm`'s tier differs by entry** — `core` on the parking level, where CO
 * drives the jet-fan interlock, and `extended` on the IAQ node. A tier is a
 * property of the template point, not of the vocabulary, so one code carrying
 * two tiers is correct and is asserted on both entries.
 *
 * **Eight codes are promoted DERIVED, nine points** (§12 ruling 2). A derived
 * template point is `bms-calc-v1` over MEASURED points the same entry
 * declares, and its code must be vocabulary, which is why they are listed here
 * beside the measured codes rather than left out. Four of the eight land in
 * PR 1, each marked on its line with the module that carries the formula:
 * `denied_ratio_pct` (access door), `occupancy_pct` (occupancy zone AND
 * parking level, one code and two formulas over two capacities, the
 * `recovery_pct` shape), `co2_above_outdoor_ppm` and
 * `pm25_indoor_outdoor_ratio` (IAQ node). The IAQ pair are the only two points
 * in the pack with a `maxInputAgeSeconds` override — 3600, because their
 * outdoor reference is a site or API value that arrives slowly, the
 * `approach_c` precedent (§12 ruling 7). Division by zero is handled by
 * `evaluate.ts`, which returns `non_finite` rather than a number, so no
 * formula guards its denominator.
 *
 * **Forty codes the document names are DEFERRED, in eight reason classes** —
 * seven that `E5.2` enumerated (window, attribute, method, another asset,
 * another system, and so on) and **one new: the roll-up**. `fire_system_healthy`,
 * `access_system_healthy` and `data_quality_pct` are all expressible and all
 * refused: a health flag computed over states is `content.health`'s surface
 * (ADR 0050) and each input already carries its own alarm, so a template point
 * would be a second, quieter answer to a question the platform already
 * answers. The full ledger is plan §5.0 and the per-entry lists live in
 * `stock-catalog-deferrals.spec.ts`.
 *
 * **Near-misses, checked and kept as spelled**, because the prefix says which
 * device reported the number (ADR 0053 decision 9's reasoning): `zone_kw` and
 * `zone_kwh_total` against `kw`/`kwh_total` — a DALI zone meter, not the
 * asset's own; `burn_hours_h` against `run_hours_h` — lamp hours;
 * `fire_pump_status` and `jockey_pump_status` against `pump_status` — a fire
 * system's pumps observed through the panel; `fire_tank_level_pct` against
 * `fuel_level_pct` — a different liquid; `door_open_state` (§7, the panel's
 * own door) against `door_state` (§3, the controlled door); `no2_ppm` (§5,
 * basement, ppm) against `no2_ppb` (§6, indoor, ppb) — two quantities at two
 * ranges; `co2_ppm` against the AHU's `return_air_co2_ppm` — a zone node, not
 * a duct; `ups_on_battery` against `on_battery`.
 *
 * **Every code here needs a `UNIT_BY_KEY` entry in
 * `packages/db/src/point-keys-seed.ts`**, enforced by
 * `tests/f3.39-global-point-key-vocabulary.test.ts` — `keysForDomain` writes
 * `UNIT_BY_KEY[code] ?? null`, so a missing entry seeds `NULL` on a new row.
 * It cannot overwrite a real unit: `seedPointKeyCatalog` writes
 * `COALESCE(bms.point_keys.unit, EXCLUDED.unit)`, so the next boot repairs a
 * NULL once the entry exists. A WRONG spelling is the permanent one, which is
 * why the codepoints below are the real gate. The empty string, never a
 * missing entry,
 * is how a `0/1`, `count`, `enum`, `code`, `text`, `floor` or `date` row and
 * the one dimensionless ratio spell an unset unit.
 *
 * **Both arrays are parsed as TEXT by three guards**, with a regex that
 * requires `export const <NAME> = [` and an array body containing no `]`
 * character (`[^\]]*` in all three). Keep the shape: no nested bracket, no
 * type annotation between the name and the `=`.
 */
export const FACILITY_CLASS_POINT_KEYS = [
  // §1 lighting zone — 15 (15 rows, no derived)
  "lighting_state", "lighting_level_pct", "lighting_mode",
  "lighting_scene", "occupancy_state", "illuminance_lux",
  "illuminance_sp_lux", "lamp_fault_count", "driver_fault_state",
  "emergency_test_state", "emergency_battery_ok", "zone_kw",
  "zone_kwh_total", "burn_hours_h", "schedule_active",
  // §2 fire alarm panel — 23 (24 rows less the reused smoke_state)
  "fire_alarm_state", "fire_fault_state", "fire_supervisory_state",
  "fire_isolate_state", "fire_prealarm_state", "panel_ac_ok",
  "panel_battery_ok", "panel_earth_fault", "panel_comms_ok",
  "zone_alarm_state", "zone_fault_state", "zone_isolated_state",
  "active_alarm_count", "active_fault_count", "sounder_active",
  "sounder_silenced", "fire_pump_status", "jockey_pump_status",
  "hydrant_header_pressure_bar", "fire_tank_level_pct", "sprinkler_flow_state",
  "suppression_released_state", "weekly_test_done",
  // §3 access door — 17 (16 rows + 1 derived)
  "door_state", "lock_state", "door_forced_state",
  "door_held_state", "door_mode", "reader_ok",
  "controller_comms_ok", "controller_tamper", "controller_ac_ok",
  "controller_battery_ok", "access_granted_count", "access_denied_count",
  "rex_count", "fire_release_state", "lockdown_state",
  "turnstile_status",
  "denied_ratio_pct", // E5.3: derived, formula in facility-access-door.ts
  // §4 occupancy zone — 10 (9 rows, occupancy_state is §1s, + 1 derived)
  "occupancy_count", "occupancy_capacity", "entry_count",
  "exit_count", "desk_occupied_count", "zone_temp_c",
  "zone_rh_pct", "zone_temp_sp_c", "sensor_battery_pct",
  // E5.3: derived, TWO formulas over two capacities — one in
  // facility-occupancy-zone.ts, one in facility-parking-level.ts
  "occupancy_pct",
  // §5 parking level — 14 (14 rows; entry_count and exit_count are §4s, and
  // occupancy_pct is authored a second time here but declared once above)
  "bays_total", "bays_occupied", "bays_free",
  "ev_bays_free", "entry_barrier_state", "exit_barrier_state",
  "barrier_fault", "co_ppm", "no2_ppm",
  "jet_fan_status", "jet_fan_fault", "guidance_comms_ok",
  "ev_charger_kw", "ev_charger_kwh_total",
  // §7 BAS gateway — 12 (13 rows less the reused leak_state)
  "device_online", "last_seen_age_s", "comms_error_count",
  "points_stale_count", "cpu_pct", "memory_pct",
  "enclosure_temp_c", "supply_voltage_v", "ups_on_battery",
  "door_open_state", "rtc_drift_s", "firmware_version",
] as const;

export type FacilityClassPointKey = (typeof FACILITY_CLASS_POINT_KEYS)[number];

/**
 * `E5.3` §6 — the indoor air quality node's vocabulary, filed under
 * `environment`.
 *
 * **Thirteen, not fifteen.** The document's §6 has fifteen rows.
 * `temperature_c` and `humidity_pct` are the control-room array's and are
 * referenced; `co_ppm` and `sensor_battery_pct` occur earlier in the document
 * (§5 and §4) and are therefore declared under `facility` in
 * `FACILITY_CLASS_POINT_KEYS` above. Eleven rows remain, and the two promoted
 * derived codes bring the array to thirteen.
 *
 * **Why `environment` and not `facility`** (ADR 0054 decision 2): the node
 * measures air, and the `environment` domain already holds the temperature and
 * humidity keys its first two rows reuse. This is the first stock entry filed
 * under `environment` — the domain existed since migration `0029` and carried
 * only the PHE gateways' baseline.
 *
 * `microbial_count_cfu` is the pack's `M` row here: a laboratory result an
 * operator enters, `sourceDataKeyPattern: null` forever, and `F1.8` owns the
 * manual-entry flag. `pm25_indoor_outdoor_ratio` is dimensionless and carries
 * the empty-string unit, the `cop` spelling (§12 ruling 7).
 */
export const ENVIRONMENT_CLASS_POINT_KEYS = [
  // §6 indoor air quality node — 13 (11 rows + 2 derived)
  "co2_ppm", "pm25_ugm3", "pm10_ugm3",
  "tvoc_ugm3", "ch2o_ugm3", "o3_ppb",
  "no2_ppb", "outdoor_pm25_ugm3", "outdoor_co2_ppm",
  "sensor_online", "microbial_count_cfu",
  "co2_above_outdoor_ppm", // E5.3: derived, formula in environment-iaq-node.ts
  "pm25_indoor_outdoor_ratio", // E5.3: derived, dimensionless, same module
] as const;

export type EnvironmentClassPointKey = (typeof ENVIRONMENT_CLASS_POINT_KEYS)[number];

/**
 * `E5.3` §§8a/8b — the vertical-transport (lift, escalator) vocabulary, filed
 * under `mechanical`. Plan `docs/plans/e5.3-facility-domain-pack.md` §4.4.
 *
 * **A second array under `mechanical`, not an append.** `MECHANICAL_CLASS_POINT_KEYS`
 * lives in `constants.ts` and is write-once; §12 ruling 1 files this array here instead,
 * the `HVAC_CLASS_POINT_KEYS` precedent (a second array under one domain).
 *
 * **Eight codes are already seeded and are REFERENCED, never redeclared**:
 * `controller_comms_ok` (declared under `facility`, §3 access door),
 * `motor_current_a`, `motor_temp_c`, `vibration_mms` (`MECHANICAL_CLASS_POINT_KEYS`),
 * `kw`, `kwh_total`, `run_hours_h`, `start_count` (the electrical arrays).
 *
 * **§8a lift — 74** (78 rows less the six reused above = 72, + 2 derived) and
 * **§8b escalator — 28** (40 rows less thirteen reused = 27, + 1 derived) — see plan
 * §4.4 for the row-by-row derivation. `door_reversal_ratio_pct`, `kwh_per_trip` (lift)
 * and `kwh_per_run_hour` (escalator) are promoted DERIVED (§12 ruling 2), the last two
 * following `E5.2`'s `load_factor_pct` precedent for a lifetime-counter ratio.
 * `handrail_speed_dev_pct` is likewise promoted DERIVED, signed, at `sortOrder 39`
 * (§12 ruling 3) — `entrapment_state` stays MEASURED, `extended` tier, for the same
 * ruling.
 *
 * **New codepoints and unit spellings** (plan §4.4/§4.6): `²` is `U+00B2` in
 * `max_accel_ms2`'s `m/s²`; `³` is `U+00B3` in `max_jerk_ms3`'s `m/s³`;
 * `kwh_per_run_hour` is `kWh/h`, not `kW` (§12 ruling 7 — the quantity is an averaged
 * consumption over run time, not an instantaneous power). `lux`, `µg/m³`, `ppb`,
 * `CFU/m³`, `m/s`, `mm`, `mg`, `dB(A)`, `km` do not apply to this array (they are
 * `FACILITY_CLASS_POINT_KEYS`'s or `ENVIRONMENT_CLASS_POINT_KEYS`'s); this array
 * introduces `m`, `kg`, `A`, `bar`, `V` reused from existing spellings plus
 * `m/s²`, `m/s³`, `dB(A)`, `km`, `kWh/h` new to `UNIT_BY_KEY`.
 */
export const VERTICAL_TRANSPORT_CLASS_POINT_KEYS = [
  // §8a lift — 74 (78 rows less 6 reused = 72, + 2 derived), six sub-blocks
  // service state
  "lift_in_service", "lift_mode", "lift_fault",
  "lift_fault_code", "lift_fault_count", "fire_recall_state",
  "fire_operation_state", "emergency_power_mode", "ard_state",
  "passenger_alarm", "entrapment_state", "intercom_call_active",
  // motion
  "car_position_floor", "car_position_m", "car_direction",
  "car_moving", "car_speed_ms", "car_load_pct",
  "car_load_kg", "overload_state", "full_load_bypass_state",
  "levelling_error_mm", "hall_calls_pending", "car_calls_pending",
  "next_stop_floor",
  // doors
  "car_door_state", "landing_door_state", "door_zone_state",
  "door_cycle_count", "door_reversal_count", "door_open_time_s",
  "door_fault_state", "door_motor_current_a",
  // drive and machine
  "drive_status", "drive_fault_code", "drive_heatsink_temp_c",
  "dc_bus_v", "brake_state", "brake_temp_c",
  "brake_fault_state", "rope_brake_state", "hydraulic_oil_temp_c",
  "hydraulic_oil_level_low", "hydraulic_pressure_bar", "regen_kw",
  // shaft, pit, machine room
  "machine_room_temp_c", "machine_room_humidity_pct", "pit_water_state",
  "pit_light_state", "shaft_temp_c", "safety_chain_ok",
  "governor_tripped", "terminal_limit_state", "car_light_state",
  "car_fan_state", "car_temp_c",
  // ride quality
  "vibration_x_mg", "vibration_y_mg", "vibration_z_mg",
  "max_accel_ms2", "max_jerk_ms3", "noise_dba",
  // counters and usage
  "trip_count", "floor_km_total", "passenger_count",
  "waiting_time_avg_s", "waiting_time_max_s",
  // manual / statutory
  "annual_inspection_due", "rope_condition", "brake_test_result",
  "buffer_test_result", "ard_battery_test",
  "door_reversal_ratio_pct", // E5.3: derived, formula in mechanical-lift.ts
  "kwh_per_trip", // E5.3: derived, formula in mechanical-lift.ts
  // §8b escalator — 28 (40 rows less 13 reused = 27, + 1 derived)
  "esc_status", "esc_direction", "esc_mode",
  "esc_fault", "esc_fault_code", "esc_emergency_stop",
  "safety_circuit_ok", "safety_device_tripped", "step_speed_ms",
  "handrail_speed_l_ms", "handrail_speed_r_ms",
  // E5.3: the X/D row, authored DERIVED (§12 ruling 3) — formula in
  // mechanical-escalator.ts
  "handrail_speed_dev_pct",
  "gearbox_temp_c", "gearbox_oil_level_low", "aux_brake_tripped",
  "step_chain_tension_ok", "drive_chain_ok", "missing_step_state",
  "comb_plate_state", "skirt_switch_state", "handrail_inlet_state",
  "passenger_sensor_state", "machine_space_temp_c", "truss_water_state",
  "lubrication_fault", "standby_hours_h", "step_chain_elongation_pct",
  "kwh_per_run_hour", // E5.3: derived, formula in mechanical-escalator.ts — §12 ruling 7
] as const;

export type VerticalTransportClassPointKey =
  (typeof VERTICAL_TRANSPORT_CLASS_POINT_KEYS)[number];
