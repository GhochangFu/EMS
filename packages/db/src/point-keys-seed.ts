import type pg from "pg";

import {
  CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
  CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
  CONTROL_ROOM_IT_POINT_KEYS,
  CONTROL_ROOM_UPS_POINT_KEYS,
  ELECTRICAL_CLASS_POINT_KEYS,
  ELECTRICAL_POINT_KEYS,
  HVAC_POINT_KEYS,
  METERED_PUMPING_POINT_KEYS,
} from "@bms/shared";

type PointKeySeed = {
  code: string;
  name: string;
  domain: string;
  unit: string | null;
};

const UNIT_BY_KEY: Record<string, string> = {
  voltage_l1_v: "V",
  current_a: "A",
  kw: "kW",
  kvar: "kVAr",
  pf: "",
  breaker_main: "",
  supply_air_temp_c: "°C",
  return_air_temp_c: "°C",
  fan_rpm: "RPM",
  fan_speed_pct: "%",
  chw_flow_lps: "L/s",
  chw_supply_temp_c: "°C",
  chw_return_temp_c: "°C",
  compressor_ok: "",
  cooling_kw: "kW",
  load_pct: "%",
  output_voltage_v: "V",
  output_freq_hz: "Hz",
  battery_v: "V",
  battery_temp_c: "°C",
  backup_min: "min",
  health_pct: "%",
  rack_kw: "kW",
  rack_temp_c: "°C",
  pdu_a_status: "",
  pdu_b_status: "",
  pdu_util_pct: "%",
  outlets_used: "",
  temperature_c: "°C",
  humidity_pct: "%",
  leak_state: "",
  smoke_state: "",
  frequency_hz: "Hz",
  kwh_today: "kWh",
  // `F3.41` — `METERED_PUMPING_POINT_KEYS`. Every unit is read from
  // `phe-catalog.json`'s own `UnitCode` column rather than inferred from the
  // code's name, so the catalog row and the `asset_points` row `phe-pilot-seed`
  // writes beside it agree. `chlorine_pump_on` is a binary and takes `""`, the
  // way `pf` and `breaker_main` above already spell an unset unit — NOT a
  // missing entry, which would seed NULL and overwrite the real value on every
  // `compose up`.
  kwh_total: "kWh",
  kva: "kVA",
  current_ir: "A",
  current_iy: "A",
  current_ib: "A",
  voltage_vry: "V",
  voltage_vyb: "V",
  voltage_vbr: "V",
  voltage_vrn: "V",
  voltage_vyn: "V",
  voltage_vbn: "V",
  chlorine_pump_on: "",
  // `F2.11` — `ELECTRICAL_CLASS_POINT_KEYS`. Every unit is read from
  // `docs/electrical-derived-taglist-v1.md`'s own Unit column, per ADR 0051
  // Amendment 6 decision 4 — `0/1`, `enum`, `code`, `tap`, `count` and `—`
  // all map to `""`, the way `pf`, `breaker_main` and `outlets_used` above
  // already spell an unset unit, and NEVER a missing entry, which would
  // seed NULL and revert a global administrator's correction on every
  // `compose up`. `kVAR`/`kVARh` in the source file are spelled `kVAr`/
  // `kVArh` here to match `kvar` above, and `rpm` is spelled `RPM` to match
  // `fan_rpm` above (owner ruling 2026-09-02).
  //
  // §1 feeder / incomer
  current_in: "A",
  kvah_total: "kVAh",
  kvarh_total: "kVArh",
  demand_kw: "kW",
  max_demand_kw: "kW",
  max_demand_kva: "kVA",
  thd_v_pct: "%",
  thd_i_pct: "%",
  voltage_unbalance_pct: "%",
  current_unbalance_pct: "%",
  breaker_trip: "",
  breaker_spring_charged: "",
  relay_trip_code: "",
  earth_fault_state: "",
  meter_comms_ok: "",
  // §2 transformer
  top_oil_temp_c: "°C",
  winding_temp_c: "°C",
  winding_temp_r_c: "°C",
  winding_temp_y_c: "°C",
  winding_temp_b_c: "°C",
  ambient_temp_c: "°C",
  oil_level_pct: "%",
  oil_level_low: "",
  buchholz_alarm: "",
  buchholz_trip: "",
  prv_operated: "",
  oti_alarm: "",
  oti_trip: "",
  wti_alarm: "",
  wti_trip: "",
  tap_position: "",
  oltc_in_progress: "",
  oltc_operation_count: "",
  cooling_fan_status: "",
  cooling_pump_status: "",
  dga_h2_ppm: "ppm",
  dga_c2h2_ppm: "ppm",
  dga_ch4_ppm: "ppm",
  dga_co_ppm: "ppm",
  oil_moisture_ppm: "ppm",
  lv_load_pct: "%",
  oil_bdv_kv: "kV",
  oil_moisture_lab_ppm: "ppm",
  silica_gel_state: "",
  insulation_resistance_mohm: "MΩ",
  // §3 DG set
  dg_status: "",
  dg_mode: "",
  dg_on_load: "",
  dg_alarm: "",
  dg_shutdown: "",
  dg_alarm_code: "",
  mains_available: "",
  engine_speed_rpm: "RPM",
  oil_pressure_bar: "bar",
  coolant_temp_c: "°C",
  oil_temp_c: "°C",
  exhaust_temp_c: "°C",
  fuel_level_pct: "%",
  bulk_fuel_level_pct: "%",
  fuel_rate_lph: "L/hr",
  fuel_totalizer_l: "L",
  charger_alternator_v: "V",
  coolant_level_low: "",
  run_hours_h: "h",
  start_count: "",
  failed_start_count: "",
  gen_voltage_vry: "V",
  gen_voltage_vyb: "V",
  gen_voltage_vbr: "V",
  gen_current_ir: "A",
  gen_current_iy: "A",
  gen_current_ib: "A",
  gen_frequency_hz: "Hz",
  gen_kw: "kW",
  gen_kva: "kVA",
  gen_pf: "",
  gen_kwh_total: "kWh",
  service_due_h: "h",
  emergency_stop_state: "",
  canopy_temp_c: "°C",
  // §4 UPS
  ups_status: "",
  ups_alarm: "",
  ups_alarm_code: "",
  on_battery: "",
  on_bypass: "",
  input_voltage_v: "V",
  input_frequency_hz: "Hz",
  output_current_a: "A",
  output_kw: "kW",
  output_kva: "kVA",
  battery_current_a: "A",
  battery_charge_pct: "%",
  battery_time_on_s: "s",
  battery_replace_flag: "",
  battery_last_test: "",
  rectifier_ok: "",
  inverter_ok: "",
  fan_ok: "",
  cell_voltage_min_v: "V",
  cell_voltage_max_v: "V",
  impedance_test_result: "",
  // §5 solar PV
  inv_status: "",
  inv_fault: "",
  inv_event_code: "",
  dc_voltage_v: "V",
  dc_current_a: "A",
  dc_power_kw: "kW",
  ac_power_kw: "kW",
  ac_kva: "kVA",
  ac_pf: "",
  ac_frequency_hz: "Hz",
  ac_voltage_vry: "V",
  ac_voltage_vyb: "V",
  ac_voltage_vbr: "V",
  ac_current_ir: "A",
  ac_current_iy: "A",
  ac_current_ib: "A",
  energy_total_kwh: "kWh",
  energy_today_kwh: "kWh",
  cabinet_temp_c: "°C",
  irradiance_wm2: "W/m²",
  module_temp_c: "°C",
  string_current_a: "A",
  insulation_resistance_kohm: "kΩ",
  grid_export_kw: "kW",
  soiling_loss_pct: "%",
  // §6 capacitor bank / APFC
  apfc_status: "",
  apfc_alarm: "",
  target_pf: "",
  actual_pf: "",
  steps_on_count: "",
  step_state: "",
  kvar_connected: "kVAr",
  kvar_required: "kVAr",
  bus_voltage_v: "V",
  panel_temp_c: "°C",
  step_operation_count: "",
  capacitor_current_a: "A",
  step_fault_state: "",
};

function titleCase(code: string): string {
  return code
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function keysForDomain(
  codes: readonly string[],
  domain: string,
): PointKeySeed[] {
  return codes.map((code) => ({
    code,
    name: titleCase(code),
    domain,
    unit: UNIT_BY_KEY[code] ?? null,
  }));
}

/**
 * `F3.39` / ADR 0051 decision 2 — ONE catalog, not one per organization.
 *
 * This was two lists: an `ESKOM_CATALOG` of 34 codes and a `PHE_CATALOG` of 15,
 * the second a strict subset of the first built from the same two arrays. That
 * split described nothing — a code names a measurement, not an estate — and it
 * broke the one thing a stock dashboard template needs, which is that a
 * `pointKey` means the same quantity in every organization. Migration `0057`
 * drops `point_keys.organization_id`, so there is no longer an axis to split on.
 *
 * The union is exactly what `ESKOM_CATALOG` already held, so nothing is added
 * here and nothing is lost. What PHEWB gains is the 19 codes it was denied for
 * no reason — including `frequency_hz`, which its pilot meters have been
 * reading all along while its own catalog did not name it.
 */
const GLOBAL_CATALOG: PointKeySeed[] = [
  ...keysForDomain(ELECTRICAL_POINT_KEYS, "electrical"),
  ...keysForDomain(HVAC_POINT_KEYS, "hvac"),
  ...keysForDomain(CONTROL_ROOM_UPS_POINT_KEYS, "electrical"),
  ...keysForDomain(CONTROL_ROOM_IT_POINT_KEYS, "it"),
  ...keysForDomain(CONTROL_ROOM_ENVIRONMENT_POINT_KEYS, "environment"),
  ...keysForDomain(
    CONTROL_ROOM_ELECTRICAL_POINT_KEYS.filter(
      (key) => !(ELECTRICAL_POINT_KEYS as readonly string[]).includes(key),
    ),
    "electrical",
  ),
  // `F3.41` — the real-ingest metered-pumping set, LAST and unfiltered.
  //
  // Last so the `.filter()` above, which subtracts `ELECTRICAL_POINT_KEYS` from
  // the control-room array, keeps reading exactly what it read before. This
  // array needs no such filter: its twelve codes are disjoint from all six
  // arrays above, which `tests/f3.39-global-point-key-vocabulary.test.ts`'s
  // clash check proves rather than this comment asserting it.
  //
  // Filed under `electrical` because `deviceDomain()` in `phe-pilot-seed.ts`
  // files the MFM and both PUMP shapes that carry these codes under
  // `electrical`. A disagreement here would give one code two domains, and
  // after `F3.39`'s single-pass `ON CONFLICT (code) DO UPDATE` the later array
  // would win silently — which is the drift that clash check exists for.
  ...keysForDomain(METERED_PUMPING_POINT_KEYS, "electrical"),
  // `F2.11` — the electrical class point keys (ADR 0051 Amendment 6), LAST
  // and unfiltered, for the same two reasons `F3.41`'s array above is last.
  //
  // (a) The `.filter()` above, which subtracts `ELECTRICAL_POINT_KEYS` from
  // the control-room array, keeps reading exactly what it read before.
  //
  // (b) `created_at` ordering. Five fixtures pick their point key with
  // `ORDER BY created_at, code` over the whole table
  // (telemetry-write.spec.ts, telemetry-import.spec.ts,
  // resolve-catalog-point-key.spec.ts,
  // asset-templates.instantiate.integration.spec.ts,
  // asset-templates.lifecycle.integration.spec.ts). Appending this array
  // last gives 138 of its 139 rows the newest `created_at` on every database,
  // existing and fresh, so no NEW row enters a head window. The exception is
  // `battery_charge_pct`: it already holds a row that `seedPheCatalog` wrote
  // earlier, `ON CONFLICT ... DO UPDATE` leaves `created_at` alone, and on a
  // cold start that row is the OLDEST in the table. Its unit filling
  // `NULL` → `"%"` therefore moves it INTO the two `unit IS NOT NULL ...
  // LIMIT 5` windows (telemetry-write.spec.ts, telemetry-import.spec.ts) at
  // position 0 and evicts the fifth row — harmless, since `"%"` is a real
  // unit and both specs need four, but a reader who trusts "none move" would
  // be wrong by exactly one row. Verified on a scratch cold start (F2.11).
  ...keysForDomain(ELECTRICAL_CLASS_POINT_KEYS, "electrical"),
];

/**
 * Every code this seed writes, in declaration order.
 *
 * Exported so a fixture that names a catalog code can prove the code is **stock
 * vocabulary** rather than a row some integration suite registered and is about
 * to delete. A database lookup cannot tell those apart; this list can, and it
 * grows with the `*_POINT_KEYS` arrays instead of duplicating them.
 *
 * **`F3.42`'s post-merge sweep is why the distinction is worth an export.**
 * `access-fixtures-seed.ts` chose its point with `ORDER BY created_at, code
 * LIMIT 1` over the whole table, which was bounded only while `bms.point_keys`
 * carried an organization predicate. `0057` removed it, so the answer became
 * whatever the database's own history put first — a transient fixture code was
 * reachable, and on a fresh database a PHE pilot code won. That fixture names
 * its code now, and this list is what keeps the name honest.
 */
export const STOCK_POINT_KEY_CODES: readonly string[] = GLOBAL_CATALOG.map((row) => row.code);

/**
 * Seeds the fleet-wide point key catalog.
 *
 * **`F3.39` — no tenant context, because there is no tenant.** This used to run
 * inside `withOrganization` once per organization: `bms.point_keys` was one of
 * the five tables carrying `FORCE ROW LEVEL SECURITY` (`E7.1a`), so a write
 * needed `app.current_organization` set and an explicit `organization_id` bind
 * for the policy's `WITH CHECK` to compare against. Migration `0057` removes
 * the policy, the FORCE flag and the column, so both are gone: a context that
 * nothing reads and a bind for a column that does not exist.
 *
 * The upsert arbiter moves with the index — `(organization_id, code)` was
 * dropped by `0057` and `(code)` replaces it.
 *
 * `description` is deliberately not written and not overwritten. A repaired
 * orphan row from `0057` carries a NULL one and an admin may fill it in; this
 * seed re-runs on every `compose up` and must not revert that.
 *
 * **`unit` is `COALESCE`d for exactly the same reason, since `F3.41`.** It used
 * to be a plain `unit = EXCLUDED.unit`, which reverted an administrator's fill
 * on every `compose up` — and `bms.point_keys` is fleet-wide and unpoliced
 * since `0057`, so the administrator in question is a global one and ADR 0051
 * Amendment 1 names their correction as the remedy for a code the platform
 * mislabels. `phe-pilot-seed.ts` had already made this call for the codes it
 * writes, in those words: *"an admin who fills one in must not have it reverted
 * at the next boot."* The two seeds disagreed, and `seedPointKeyCatalog` runs
 * **last**, so the plain assignment won.
 *
 * `F3.41` is what made that reachable rather than theoretical: it added twelve
 * PHE codes to `GLOBAL_CATALOG` that until then reached the table only through
 * `phe-pilot-seed.ts`'s protective upsert, so a branch about a dashboard
 * template would have quietly removed a protection from twelve rows. Found by
 * the `security-reviewer` sweep.
 *
 * **THE COST, STATED RATHER THAN DISCOVERED LATER: this seed can no longer
 * CORRECT a unit.** Change a value in `UNIT_BY_KEY` and existing databases keep
 * the old one; only a fresh row takes the new. That is the same trade
 * `phe-pilot-seed.ts` and `description` above already accept, and it is the
 * right way round — a seed that overwrites is a seed that silently undoes
 * operator input, and an admin can always re-`PATCH` the code through
 * `/api/v1/admin/point-keys/:id`.
 *
 * `name` and `domain` stay assigned outright, AND THAT IS A COST TOO — this
 * paragraph used to claim neither was administrator-editable, which is false:
 * `updatePointKeyBodySchema` in `apps/api/src/admin/point-keys/point-keys.schema.ts`
 * is a `.partial()` over `name`, `domain`, `unit` and `description`, so a
 * global administrator's `PATCH` of a `name` is reverted on the next
 * `compose up`, with the `master.point_key.update` audit row left asserting
 * a change the table no longer holds. Found by the `F2.11` security and
 * migration reviews (2026-09-02); pre-existing since `F3.39`, and `F2.11`
 * multiplies the exposure from 46 rows to 185, most of them `titleCase`
 * names ("Dga H2 Ppm", "Oltc In Progress") an administrator is likely to
 * correct. Left as-is here because the seed MUST be able to correct a
 * `domain` — `ARRAY_DOMAIN`'s clash check in
 * `tests/f3.39-global-point-key-vocabulary.test.ts` is entitled to assume the
 * seed corrects a drifted one, and ADR 0051 Amendment 6 decision 3 is
 * implemented by exactly this assignment. Whether `name` should be
 * `COALESCE`d like `unit`, or the `PATCH` body narrowed, is an owner decision
 * filed as a backlog row by the `F2.11` closure sweep.
 */
export async function seedPointKeyCatalog(pool: pg.Pool): Promise<void> {
  for (const row of GLOBAL_CATALOG) {
    await pool.query(
      `
      INSERT INTO bms.point_keys (code, name, domain, unit, active)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        domain = EXCLUDED.domain,
        unit = COALESCE(bms.point_keys.unit, EXCLUDED.unit)
      `,
      [row.code, row.name, row.domain, row.unit],
    );
  }
}
