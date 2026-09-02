/**
 * Cross-cutting constants — the *non-contract* half of this package.
 *
 * Split out of `index.ts` by `F4.23` (ADR 0030 decision 2). These are not
 * contracts: nothing validates them, they describe what `apps/sim` writes and
 * what the Control Room screens read, and they are consumed as values rather
 * than as a description of a payload. Keeping them beside the schemas was the
 * objection to growing `packages/shared`; this is the answer to it, together
 * with the `@bms/shared/contracts` subpath.
 *
 * They live here rather than under `contracts/` for a second reason: the
 * point-key enums in `contracts/telemetry.ts` are BUILT from these arrays, so
 * the arrays have to sit below the schemas in the import graph.
 *
 * Everything here is re-exported from `index.ts`, so no consumer's import
 * changes.
 */

/** Separator between asset UUID and point key in `pointRef` URLs. */
export const TELEMETRY_POINT_REF_SEP = "::";

/** Electrical domain point keys written by `apps/sim` (keep in sync with simulator). */
export const ELECTRICAL_POINT_KEYS = [
  "voltage_l1_v",
  "current_a",
  "kw",
  "kvar",
  "pf",
  "breaker_main",
] as const;

export type ElectricalPointKey = (typeof ELECTRICAL_POINT_KEYS)[number];

/** HVAC / CRAC point keys written by `apps/sim` for `domain = hvac` assets. */
export const HVAC_POINT_KEYS = [
  "supply_air_temp_c",
  "return_air_temp_c",
  "fan_rpm",
  "fan_speed_pct",
  "chw_flow_lps",
  "chw_supply_temp_c",
  "chw_return_temp_c",
  "compressor_ok",
  "cooling_kw",
] as const;

export type HvacPointKey = (typeof HVAC_POINT_KEYS)[number];

/** Control Room UPS/battery points used by the 2D IBMS screens. */
export const CONTROL_ROOM_UPS_POINT_KEYS = [
  "load_pct",
  "output_voltage_v",
  "output_freq_hz",
  "battery_v",
  "battery_temp_c",
  "backup_min",
  "health_pct",
] as const;

export type ControlRoomUpsPointKey = (typeof CONTROL_ROOM_UPS_POINT_KEYS)[number];

/** Control Room rack/PDU points used by the 2D IBMS screens. */
export const CONTROL_ROOM_IT_POINT_KEYS = [
  "rack_kw",
  "rack_temp_c",
  "pdu_a_status",
  "pdu_b_status",
  "pdu_util_pct",
  "outlets_used",
] as const;

export type ControlRoomItPointKey = (typeof CONTROL_ROOM_IT_POINT_KEYS)[number];

/** Control Room environment points used by the 2D IBMS screens. */
export const CONTROL_ROOM_ENVIRONMENT_POINT_KEYS = [
  "temperature_c",
  "humidity_pct",
  "leak_state",
  "smoke_state",
] as const;

export type ControlRoomEnvironmentPointKey =
  (typeof CONTROL_ROOM_ENVIRONMENT_POINT_KEYS)[number];

/** Control Room electrical points beyond the generic SLD set. */
export const CONTROL_ROOM_ELECTRICAL_POINT_KEYS = [
  ...ELECTRICAL_POINT_KEYS,
  "frequency_hz",
  "kwh_today",
] as const;

export type ControlRoomElectricalPointKey =
  (typeof CONTROL_ROOM_ELECTRICAL_POINT_KEYS)[number];

/**
 * `F3.41` — the metered-pumping point keys, **read from real hardware rather
 * than written by `apps/sim`**.
 *
 * PHE WB's six pumping stations publish these through their TeleCash RTUs.
 * `bmsPointKeyForSensor` in `packages/db/src/phe-pilot-seed.ts` is the map from
 * the vendor's sensor codes to them, and it is their only source of truth:
 * `TKWH → kwh_total`, `TKVA → kva`, `IR/IY/IB → current_i*`,
 * `VRY/VYB/VBR/VRN/VYN/VBN → voltage_v*`, `CPMP_ONOFF → chlorine_pump_on`.
 *
 * **They are NOT added to `ELECTRICAL_POINT_KEYS`, and the reason is that
 * array's own docblock** — "keep in sync with simulator". Nothing simulated
 * writes these; they arrive from plant. Keeping the two sets apart is what lets
 * a reader tell a code the demo estate produces from a code a real RTU does,
 * and it is the same distinction the UPS, IT and environment arrays already
 * draw.
 *
 * ---
 *
 * **WHY THIS ARRAY HAD TO EXIST AT ALL — a guard went stale, no key was
 * misspelled.**
 *
 * `tests/f3.38-stock-catalog-vocabulary.test.ts` refuses a stock-template
 * `pointKey` that is in no `*_POINT_KEYS` array, and states its premise in the
 * failure message: such a key means "`bms.point_keys` can never hold it and no
 * asset can ever register it". That was true when it was written. It stopped
 * being true for exactly these twelve codes when `F3.39` landed, because they
 * reach the table by two paths this file cannot see:
 *
 *  1. migration `0057` step 4 admits them with
 *     `SELECT DISTINCT ON (ap.point_key) FROM bms.asset_points` — data-derived,
 *     and it finds **nothing** on a cold start, because `asset_points` is still
 *     empty when a migration runs;
 *  2. `phe-pilot-seed.ts` registers each one inline, immediately before the
 *     `asset_points` row that references it, which is what makes a first
 *     `pnpm db:seed` on an empty volume satisfy `0057`'s foreign key at all.
 *
 * So the codes are real, registered and constrained, and the guard could not
 * see either path. Declaring them here closes that fork and makes a fresh
 * database hold them unconditionally rather than only where PHE assets exist.
 * **ADR 0051 decision 3 already ruled them admissible** — "ordinary three-phase
 * electrical and RTU-health codes that any organization may want" — so this
 * needs no ADR and no owner gate.
 *
 * **Twelve of the fifteen orphan codes, not all fifteen — and one of the
 * three has since left.** `network_strength` and `controller_power_status`
 * are the `PHE-AIRSP1051M-*` gateway's own health points, `environment`
 * domain rather than `electrical`. They would need a second array filed
 * under a second domain, no widget binds them, and nothing regresses by
 * leaving them on the two paths above.
 *
 * **`battery_charge_pct` no longer stays on those two paths.** `F2.11` / ADR
 * 0051 Amendment 6 promotes it into `ELECTRICAL_CLASS_POINT_KEYS` below, as
 * §4's *Battery charge remaining, %*. Its domain moves `environment` →
 * `electrical` (Amendment 6 decision 3 is unconditional — the filing domain
 * follows the asset, and the registering asset is a `PHE-AIRSP1051M-*`
 * gateway either way, so the ruling is the flip itself), and its unit fills
 * `NULL` → `"%"` through `seedPointKeyCatalog`'s
 * `COALESCE(bms.point_keys.unit, EXCLUDED.unit)` — the only value this row
 * can ever write for a code that arrives with no unit of its own.
 *
 * **The six `voltage_v*` codes enter the vocabulary with no widget binding
 * them, deliberately.** They are part of the meter's real key set and belong
 * beside the rest of it; authoring six more chart series is content nobody has
 * asked for. Recorded so a reader does not read the gap as an oversight.
 *
 * **Every code here needs a `UNIT_BY_KEY` entry in
 * `packages/db/src/point-keys-seed.ts`**, and
 * `tests/f3.39-global-point-key-vocabulary.test.ts` enforces it. `keysForDomain`
 * writes `UNIT_BY_KEY[code] ?? null`, and `seedPointKeyCatalog` runs last with a
 * plain `unit = EXCLUDED.unit`, so a missing entry silently reverts a correct
 * unit to NULL on every `compose up`.
 */
export const METERED_PUMPING_POINT_KEYS = [
  "kwh_total",
  "kva",
  "current_ir",
  "current_iy",
  "current_ib",
  "voltage_vry",
  "voltage_vyb",
  "voltage_vbr",
  "voltage_vrn",
  "voltage_vyn",
  "voltage_vbn",
  "chlorine_pump_on",
] as const;

export type MeteredPumpingPointKey = (typeof METERED_PUMPING_POINT_KEYS)[number];

/**
 * `F2.11` / ADR 0051 Amendment 6 — the electrical class point keys, 139 codes
 * across the six electrical asset classes (feeder/incomer, transformer, DG
 * set, UPS, solar PV, APFC).
 *
 * **Citation.** `docs/electrical-derived-taglist-v1.md` is the source, and
 * ADR 0051 Amendment 6 (Accepted 2026-09-02) is the gate that promotes it:
 * *"the v1 point basis for every electrical class template, derived from
 * published practice and not from a client export."* That provenance is
 * what makes v1's assumptions auditable when the real A1 tag list lands and
 * v2 supersedes them.
 *
 * **Why one array and not six per class** (decision 2).
 * `tests/f3.39-global-point-key-vocabulary.test.ts`'s clash check requires
 * the `*_POINT_KEYS` arrays to be disjoint, because `seedPointKeyCatalog`
 * writes them in one `ON CONFLICT (code) DO UPDATE` pass and a code in two
 * arrays would take whichever domain came last, silently. Six per-class
 * arrays would recur on three codes among themselves and on all 25 reused
 * codes against the existing arrays. And class membership is content, not
 * vocabulary — a transformer template declares `top_oil_temp_c` *and* `kw`
 * *and* `voltage_vry`; the vocabulary's job ends at knowing each of them.
 *
 * **Why not `ELECTRICAL_POINT_KEYS`.** That array's own docblock says "keep
 * in sync with simulator", and nothing simulated writes these — the same
 * distinction `METERED_PUMPING_POINT_KEYS` above draws for the real PHE
 * meters.
 *
 * **`dga_lab_result` is excluded** (decision 7). Its unit is `text`, and
 * `telemetry.point_values.value` is a finite `double precision` (`F4.32`),
 * so a text result cannot be a point at all. It stays a lab record — `F1.13`
 * eLogBook or a maintenance note. The four numeric DGA rows (`dga_h2_ppm`,
 * `dga_c2h2_ppm`, `dga_ch4_ppm`, `dga_co_ppm`) carry what a point can.
 * **139 codes, not 140.**
 *
 * **Enum- and code-valued rows are promoted** (decision 7's second half).
 * `dg_mode`, `ups_status`, `inv_status`, `relay_trip_code`,
 * `silica_gel_state` and the like carry a numeric code in `value`; the
 * vendor-enum-to-number map is the ingest normaliser's, exactly as
 * `bmsPointKeyForSensor` maps PHE's sensor codes today.
 *
 * **Three codes recur across classes** — `ambient_temp_c` (§2, §4, §5),
 * `thd_v_pct` (§1, §6), `battery_v` (§3, §4) — and decision 5 rules them
 * one code, one meaning: `load_pct` means *load as a percentage of rating*
 * on a UPS, a feeder, a transformer and a DG alike, and `ambient_temp_c` is
 * ambient at the asset, whichever asset that is. Each recurring code is
 * promoted once, filed under the earliest class that lists it — except
 * `battery_v`, which is not promoted at all: it is one of the 25 reused
 * codes below. The class prefixes the tag list uses are kept as listed —
 * the DG's `gen_*`, the UPS's `input_*`/`output_*`, the PV's
 * `ac_*`/`dc_*` — because each separates the generating or converting side
 * from the §1 meter at the point of connection, and those are different
 * quantities.
 *
 * **Deliberately absent — the 25 codes already in a `*_POINT_KEYS` array**,
 * reused verbatim rather than re-declared, which is what keeps the clash
 * check green: `backup_min`, `battery_temp_c`, `battery_v`, `breaker_main`,
 * `current_a`, `current_ib`, `current_ir`, `current_iy`, `frequency_hz`,
 * `health_pct`, `kva`, `kvar`, `kw`, `kwh_today`, `kwh_total`, `load_pct`,
 * `output_freq_hz`, `output_voltage_v`, `pf`, `voltage_vbn`, `voltage_vbr`,
 * `voltage_vrn`, `voltage_vry`, `voltage_vyb`, `voltage_vyn`.
 *
 * **Every code here needs a `UNIT_BY_KEY` entry in
 * `packages/db/src/point-keys-seed.ts`**, enforced by
 * `tests/f3.39-global-point-key-vocabulary.test.ts` — `keysForDomain` writes
 * `UNIT_BY_KEY[code] ?? null`, so a missing entry seeds `NULL`.
 *
 * **The array must stay in THIS file.** Both `tests/f3.38`'s
 * `pointKeyVocabulary` and `tests/f3.39`'s `arraysByName` read
 * `packages/shared/src/constants.ts` as text, with a regex anchored on
 * matching every uppercase `POINT_KEYS` array declaration. A sibling file re-exported from
 * `index.ts` would be invisible to both, with nothing failing: the array
 * would be neither clash-checked nor unit-coverage-checked, and
 * `tests/f3.38`'s vocabulary would silently not contain these 139 codes.
 *
 * **`battery_charge_pct` is here, and it already has a row.** It reaches
 * `bms.point_keys` today through `phe-pilot-seed.ts`'s inline registration
 * and migration `0057`'s orphan sweep, filed `environment` with a NULL
 * unit. Joining this array flips its domain to `electrical` and fills its
 * unit to `"%"` through `seedPointKeyCatalog`'s `COALESCE` — see the
 * correction to `METERED_PUMPING_POINT_KEYS`'s docblock, just above, and
 * `packages/db/src/point-keys-seed.ts`'s `UNIT_BY_KEY` section comment.
 */
export const ELECTRICAL_CLASS_POINT_KEYS = [
  // §1 feeder / incomer — 15
  "current_in",
  "kvah_total",
  "kvarh_total",
  "demand_kw",
  "max_demand_kw",
  "max_demand_kva",
  "thd_v_pct",
  "thd_i_pct",
  "voltage_unbalance_pct",
  "current_unbalance_pct",
  "breaker_trip",
  "breaker_spring_charged",
  "relay_trip_code",
  "earth_fault_state",
  "meter_comms_ok",
  // §2 transformer — 30
  "top_oil_temp_c",
  "winding_temp_c",
  "winding_temp_r_c",
  "winding_temp_y_c",
  "winding_temp_b_c",
  "ambient_temp_c",
  "oil_level_pct",
  "oil_level_low",
  "buchholz_alarm",
  "buchholz_trip",
  "prv_operated",
  "oti_alarm",
  "oti_trip",
  "wti_alarm",
  "wti_trip",
  "tap_position",
  "oltc_in_progress",
  "oltc_operation_count",
  "cooling_fan_status",
  "cooling_pump_status",
  "dga_h2_ppm",
  "dga_c2h2_ppm",
  "dga_ch4_ppm",
  "dga_co_ppm",
  "oil_moisture_ppm",
  "lv_load_pct",
  "oil_bdv_kv",
  "oil_moisture_lab_ppm",
  "silica_gel_state",
  "insulation_resistance_mohm",
  // §3 DG set — 35
  "dg_status",
  "dg_mode",
  "dg_on_load",
  "dg_alarm",
  "dg_shutdown",
  "dg_alarm_code",
  "mains_available",
  "engine_speed_rpm",
  "oil_pressure_bar",
  "coolant_temp_c",
  "oil_temp_c",
  "exhaust_temp_c",
  "fuel_level_pct",
  "bulk_fuel_level_pct",
  "fuel_rate_lph",
  "fuel_totalizer_l",
  "charger_alternator_v",
  "coolant_level_low",
  "run_hours_h",
  "start_count",
  "failed_start_count",
  "gen_voltage_vry",
  "gen_voltage_vyb",
  "gen_voltage_vbr",
  "gen_current_ir",
  "gen_current_iy",
  "gen_current_ib",
  "gen_frequency_hz",
  "gen_kw",
  "gen_kva",
  "gen_pf",
  "gen_kwh_total",
  "service_due_h",
  "emergency_stop_state",
  "canopy_temp_c",
  // §4 UPS — 21
  "ups_status",
  "ups_alarm",
  "ups_alarm_code",
  "on_battery",
  "on_bypass",
  "input_voltage_v",
  "input_frequency_hz",
  "output_current_a",
  "output_kw",
  "output_kva",
  "battery_current_a",
  "battery_charge_pct",
  "battery_time_on_s",
  "battery_replace_flag",
  "battery_last_test",
  "rectifier_ok",
  "inverter_ok",
  "fan_ok",
  "cell_voltage_min_v",
  "cell_voltage_max_v",
  "impedance_test_result",
  // §5 solar PV — 25
  "inv_status",
  "inv_fault",
  "inv_event_code",
  "dc_voltage_v",
  "dc_current_a",
  "dc_power_kw",
  "ac_power_kw",
  "ac_kva",
  "ac_pf",
  "ac_frequency_hz",
  "ac_voltage_vry",
  "ac_voltage_vyb",
  "ac_voltage_vbr",
  "ac_current_ir",
  "ac_current_iy",
  "ac_current_ib",
  "energy_total_kwh",
  "energy_today_kwh",
  "cabinet_temp_c",
  "irradiance_wm2",
  "module_temp_c",
  "string_current_a",
  "insulation_resistance_kohm",
  "grid_export_kw",
  "soiling_loss_pct",
  // §6 capacitor bank / APFC — 13
  "apfc_status",
  "apfc_alarm",
  "target_pf",
  "actual_pf",
  "steps_on_count",
  "step_state",
  "kvar_connected",
  "kvar_required",
  "bus_voltage_v",
  "panel_temp_c",
  "step_operation_count",
  "capacitor_current_a",
  "step_fault_state",
] as const;

export type ElectricalClassPointKey = (typeof ELECTRICAL_CLASS_POINT_KEYS)[number];
