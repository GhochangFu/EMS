import type pg from "pg";

import {
  CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
  CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
  CONTROL_ROOM_IT_POINT_KEYS,
  CONTROL_ROOM_UPS_POINT_KEYS,
  ELECTRICAL_CLASS_POINT_KEYS,
  ELECTRICAL_POINT_KEYS,
  ENVIRONMENT_CLASS_POINT_KEYS,
  FACILITY_CLASS_POINT_KEYS,
  HVAC_CLASS_POINT_KEYS,
  HVAC_POINT_KEYS,
  MECHANICAL_CLASS_POINT_KEYS,
  METERED_PUMPING_POINT_KEYS,
  VERTICAL_TRANSPORT_CLASS_POINT_KEYS,
  WATER_CLASS_POINT_KEYS,
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
  oil_rise_over_ambient_c: "°C", // F2.12: derived, formula in electrical-transformer.ts
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
  specific_fuel_l_kwh: "L/kWh", // F2.12: derived, formula in electrical-dg-set.ts
  unplanned_run_flag: "", // F2.12: derived, formula in electrical-dg-set.ts
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
  load_headroom_pct: "%", // F2.12: derived, formula in electrical-ups.ts
  cell_voltage_spread_v: "V", // F2.12: derived, formula in electrical-ups.ts
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
  inverter_efficiency_pct: "%", // F2.12: derived, formula in electrical-solar-pv.ts
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
  // `E5.1` — `WATER_CLASS_POINT_KEYS` (ADR 0040 decision 2). Every unit is
  // read from `docs/e5.1-derived-taglist-v1.md`'s own Unit column, exactly
  // §4.4 of `docs/plans/e5.1-water-domain-pack.md` spells it. `""` — never a
  // missing entry, which would seed NULL and revert a global administrator's
  // correction on every `compose up` — is the spelling for the eleven `0/1`
  // rows and for `cycles_of_concentration`, a dimensionless ratio. `pH`,
  // `Hazen` and `SDI15` are named units an operator reads, not `""` (ADR
  // 0051 Amendment 6 decision 4 maps only 0/1, enum, code, tap and count to
  // the empty string). `µS/cm` below is `U+00B5` MICRO SIGN, not `U+03BC`
  // GREEK SMALL LETTER MU — verified against the tag list's own codepoint —
  // and that value is permanent the moment this seed runs once.
  //
  // §1 WTP
  raw_water_flow_klh: "KL/hr",
  raw_turbidity_ntu: "NTU",
  raw_ph: "pH",
  settled_turbidity_ntu: "NTU",
  filtered_turbidity_ntu: "NTU",
  filter_dp_bar: "bar",
  backwash_status: "",
  coagulant_dose_lph: "L/hr",
  chlorine_dose_lph: "L/hr",
  treated_cl2_residual_mgl: "mg/L",
  treated_water_flow_klh: "KL/hr",
  clearwell_level_pct: "%",
  clarifier_sludge_level_pct: "%",
  treated_conductivity_uscm: "µS/cm",
  intake_pump_current_a: "A",
  intake_pump_status: "",
  raw_color_hazen: "Hazen",
  raw_alkalinity_mgl: "mg/L",
  recovery_pct: "%", // E5.1: derived, formula in water-wtp.ts / water-ro.ts
  turbidity_removal_pct: "%", // E5.1: derived, formula in water-wtp.ts
  // §2 RO
  feed_flow_klh: "KL/hr",
  permeate_flow_klh: "KL/hr",
  reject_flow_klh: "KL/hr",
  feed_pressure_bar: "bar",
  stage1_dp_bar: "bar",
  feed_conductivity_uscm: "µS/cm",
  permeate_conductivity_uscm: "µS/cm",
  feed_ph: "pH",
  feed_orp_mv: "mV",
  feed_temp_c: "°C",
  hp_pump_current_a: "A",
  hp_pump_status: "",
  cip_status: "",
  antiscalant_dose_lph: "L/hr",
  feed_sdi: "SDI15",
  cartridge_filter_dp_bar: "bar",
  salt_rejection_pct: "%", // E5.1: derived, formula in water-ro.ts
  // §3 softener
  inlet_flow_klh: "KL/hr",
  outlet_flow_totalizer_kl: "KL",
  outlet_hardness_mgl: "mg/L",
  inlet_hardness_mgl: "mg/L",
  vessel_dp_bar: "bar",
  regen_status: "",
  brine_tank_level_pct: "%",
  salt_consumption_kg: "kg",
  outlet_conductivity_uscm: "µS/cm",
  // §4 cooling tower
  supply_temp_c: "°C",
  return_temp_c: "°C",
  ambient_wetbulb_c: "°C",
  circ_flow_klh: "KL/hr",
  makeup_flow_klh: "KL/hr",
  blowdown_flow_klh: "KL/hr",
  basin_level_pct: "%",
  circ_conductivity_uscm: "µS/cm",
  makeup_conductivity_uscm: "µS/cm",
  circ_ph: "pH",
  circ_orp_mv: "mV",
  fan_status: "",
  fan_current_a: "A",
  circ_pump_status: "",
  circ_pump_current_a: "A",
  inhibitor_dose_lph: "L/hr",
  circ_tds_mgl: "mg/L",
  range_c: "°C", // E5.1: derived, formula in water-cooling-tower.ts
  approach_c: "°C", // E5.1: derived, formula in water-cooling-tower.ts
  cycles_of_concentration: "", // E5.1: derived, formula in water-cooling-tower.ts
  makeup_pct: "%", // E5.1: derived, formula in water-cooling-tower.ts
  // §5 STP
  influent_flow_klh: "KL/hr",
  effluent_flow_klh: "KL/hr",
  aeration_do_mgl: "mg/L",
  mlss_mgl: "mg/L",
  effluent_turbidity_ntu: "NTU",
  effluent_tss_mgl: "mg/L",
  effluent_ph: "pH",
  effluent_cl2_residual_mgl: "mg/L",
  effluent_bod_mgl: "mg/L",
  effluent_cod_mgl: "mg/L",
  blower_status: "",
  blower_current_a: "A",
  ras_flow_klh: "KL/hr",
  eq_tank_level_pct: "%",
  treated_tank_level_pct: "%",
  mbr_tmp_bar: "bar",
  uv_status: "",
  // §6 ETP
  neutralization_ph: "pH",
  dosing_acid_lph: "L/hr",
  dosing_alkali_lph: "L/hr",
  bio_mlss_mgl: "mg/L",
  bio_do_mgl: "mg/L",
  settling_tss_mgl: "mg/L",
  clarifier_turbidity_ntu: "NTU",
  discharge_flow_klh: "KL/hr",
  discharge_ph: "pH",
  oil_grease_mgl: "mg/L",
  sludge_holding_level_pct: "%",
  filter_press_status: "",
  transfer_pump_status: "",
  guard_pond_level_pct: "%",
  // `E5.2` / ADR 0053 decision 3 — `MECHANICAL_CLASS_POINT_KEYS` +
  // `HVAC_CLASS_POINT_KEYS`, 107 entries, exactly as §4.4 of
  // `docs/plans/e5.2-mechanical-domain-pack.md` spells them. `""` — never a
  // missing entry, which would seed NULL and revert a global administrator's
  // correction on every `compose up` — is the spelling for every `0/1`,
  // `enum` and `code` row, and for the two dimensionless ratios (`cop`,
  // `steam_to_fuel_ratio`). `°` is `U+00B0` on every `°C` code below, and `³`
  // in `fad_m3h` / `specific_power_kw_m3min` is `U+00B3` SUPERSCRIPT THREE —
  // both verified against the tag list's own codepoint, and permanent the
  // moment this seed runs once. The twenty reused codes
  // (`current_a`, `kw`, `kwh_total`, `run_hours_h`, `start_count`,
  // `winding_temp_c`, `insulation_resistance_mohm`, `oil_temp_c`,
  // `oil_pressure_bar`, `service_due_h`, `chw_supply_temp_c`,
  // `chw_return_temp_c`, `chw_flow_lps`, `compressor_ok`, `cooling_kw`,
  // `supply_air_temp_c`, `return_air_temp_c`, `fan_speed_pct`, `fan_rpm`,
  // `fan_current_a`) and the boiler's reused `fuel_level_pct` are NOT
  // redeclared here — they already have an entry above.
  //
  // §1 pump set
  pump_status: "",
  pump_mode: "",
  pump_trip: "",
  suction_pressure_bar: "bar",
  discharge_pressure_bar: "bar",
  flow_klh: "KL/hr",
  de_bearing_temp_c: "°C",
  nde_bearing_temp_c: "°C",
  vibration_mms: "mm/s",
  seal_leak_state: "",
  dry_run_state: "",
  head_m: "m", // E5.2: derived, formula in mechanical-pump.ts
  specific_energy_kwh_kl: "kWh/KL", // E5.2: derived, formula in mechanical-pump.ts
  // §2 motor + VFD
  vfd_status: "",
  vfd_ready: "",
  vfd_fault: "",
  vfd_fault_code: "",
  vfd_output_freq_hz: "Hz",
  vfd_speed_ref_pct: "%",
  vfd_output_current_a: "A",
  vfd_output_voltage_v: "V",
  vfd_dc_bus_v: "V",
  vfd_torque_pct: "%",
  vfd_power_kw: "kW",
  vfd_kwh_total: "kWh",
  vfd_heatsink_temp_c: "°C",
  motor_temp_c: "°C",
  vfd_run_hours_h: "h",
  // §3 air compressor
  comp_status: "",
  comp_load_state: "",
  comp_fault: "",
  comp_warning: "",
  outlet_pressure_bar: "bar",
  pressure_setpoint_bar: "bar",
  element_outlet_temp_c: "°C",
  intake_filter_dp_mbar: "mbar",
  oil_separator_dp_bar: "bar",
  loaded_hours_h: "h",
  motor_current_a: "A",
  dryer_dewpoint_c: "°C",
  dryer_status: "",
  receiver_pressure_bar: "bar",
  fad_m3h: "m³/hr",
  load_factor_pct: "%", // E5.2: derived, formula in mechanical-compressor.ts
  specific_power_kw_m3min: "kW/(m³/min)", // E5.2: derived, formula in mechanical-compressor.ts
  // §7 boiler (fuel_level_pct reused from the DG set, §12 ruling 1, not
  // redeclared)
  boiler_status: "",
  boiler_trip: "",
  steam_pressure_bar: "bar",
  steam_temp_c: "°C",
  steam_flow_kgh: "kg/hr",
  steam_totalizer_kg: "kg",
  drum_level_pct: "%",
  feedwater_flow_kgh: "kg/hr",
  feedwater_temp_c: "°C",
  feedwater_tds_ppm: "ppm",
  feed_pump_status: "",
  fuel_flow_kgh: "kg/hr",
  fuel_totalizer_kg: "kg",
  flue_gas_temp_c: "°C",
  flue_o2_pct: "%",
  flue_co_ppm: "ppm",
  combustion_air_temp_c: "°C",
  furnace_draft_mmwc: "mmWC",
  blowdown_state: "",
  boiler_water_ph: "pH",
  blowdown_tds_ppm: "ppm",
  steam_to_fuel_ratio: "", // E5.2: derived, formula in mechanical-boiler.ts
  excess_air_pct: "%", // E5.2: derived, formula in mechanical-boiler.ts
  // §4 chiller
  chiller_status: "",
  chiller_alarm: "",
  chiller_fault_code: "",
  chw_setpoint_c: "°C",
  cw_entering_temp_c: "°C",
  cw_leaving_temp_c: "°C",
  cw_flow_lps: "L/s",
  evap_pressure_bar: "bar",
  cond_pressure_bar: "bar",
  evap_approach_c: "°C",
  cond_approach_c: "°C",
  compressor_load_pct: "%",
  compressor_current_a: "A",
  discharge_temp_c: "°C",
  refrigerant_charge_pct: "%",
  cooling_load_tr: "TR", // E5.2: derived, formula in hvac-chiller.ts
  kw_per_tr: "kW/TR", // E5.2: derived, formula in hvac-chiller.ts
  cop: "", // E5.2: derived, formula in hvac-chiller.ts
  chw_delta_t_c: "°C", // E5.2: derived, formula in hvac-chiller.ts
  cw_delta_t_c: "°C", // E5.2: derived, formula in hvac-chiller.ts
  // §6 AHU
  ahu_status: "",
  ahu_fault: "",
  supply_air_temp_sp_c: "°C",
  mixed_air_temp_c: "°C",
  outdoor_air_temp_c: "°C",
  return_air_rh_pct: "%",
  supply_air_rh_pct: "%",
  duct_static_pa: "Pa",
  duct_static_sp_pa: "Pa",
  return_fan_speed_pct: "%",
  chw_valve_pct: "%",
  oa_damper_pct: "%",
  ra_damper_pct: "%",
  filter_dp_pa: "Pa",
  filter_dirty_state: "",
  return_air_co2_ppm: "ppm",
  fire_trip_state: "",
  sat_deviation_c: "°C", // E5.2: derived, formula in hvac-ahu.ts
  coil_delta_t_c: "°C", // E5.2: derived, formula in hvac-ahu.ts
  // E5.3 (ADR 0054 decision 3) — the facility pack's 104 codes, from
  // packages/shared/src/facility-point-keys.ts, in the tag list's section
  // order. `""` and NEVER a missing entry for every 0/1, count, enum, code,
  // text, floor and date row and for the one dimensionless ratio: `?? null`
  // seeds NULL on a NEW row. It cannot overwrite a real one —
  // `seedPointKeyCatalog` writes `COALESCE(bms.point_keys.unit,
  // EXCLUDED.unit)`, so the next boot repairs a NULL once the entry exists.
  // The failure that IS permanent is a WRONG spelling, which is why the
  // codepoint check and not the presence check is the real gate: ° is U+00B0,
  // µ is U+00B5 (MICRO SIGN, E5.1's µS/cm, never U+03BC), ³ is U+00B3.
  // §1 lighting zone — 15
  lighting_state: "",
  lighting_level_pct: "%",
  lighting_mode: "",
  lighting_scene: "",
  occupancy_state: "",
  illuminance_lux: "lux",
  illuminance_sp_lux: "lux",
  lamp_fault_count: "",
  driver_fault_state: "",
  emergency_test_state: "",
  emergency_battery_ok: "",
  zone_kw: "kW",
  zone_kwh_total: "kWh",
  burn_hours_h: "h",
  schedule_active: "",
  // §2 fire alarm panel — 23 (smoke_state is the control-room array's)
  fire_alarm_state: "",
  fire_fault_state: "",
  fire_supervisory_state: "",
  fire_isolate_state: "",
  fire_prealarm_state: "",
  panel_ac_ok: "",
  panel_battery_ok: "",
  panel_earth_fault: "",
  panel_comms_ok: "",
  zone_alarm_state: "",
  zone_fault_state: "",
  zone_isolated_state: "",
  active_alarm_count: "",
  active_fault_count: "",
  sounder_active: "",
  sounder_silenced: "",
  fire_pump_status: "",
  jockey_pump_status: "",
  hydrant_header_pressure_bar: "bar",
  fire_tank_level_pct: "%",
  sprinkler_flow_state: "",
  suppression_released_state: "",
  weekly_test_done: "",
  // §3 access door — 17 (16 rows + 1 derived)
  door_state: "",
  lock_state: "",
  door_forced_state: "",
  door_held_state: "",
  door_mode: "",
  reader_ok: "",
  controller_comms_ok: "",
  controller_tamper: "",
  controller_ac_ok: "",
  controller_battery_ok: "",
  access_granted_count: "",
  access_denied_count: "",
  rex_count: "",
  fire_release_state: "",
  lockdown_state: "",
  turnstile_status: "",
  denied_ratio_pct: "%", // E5.3: derived, formula in facility-access-door.ts
  // §4 occupancy zone — 10 (occupancy_state is §1's; 9 rows + 1 derived)
  occupancy_count: "",
  occupancy_capacity: "",
  entry_count: "",
  exit_count: "",
  desk_occupied_count: "",
  zone_temp_c: "°C",
  zone_rh_pct: "%",
  zone_temp_sp_c: "°C",
  sensor_battery_pct: "%",
  occupancy_pct: "%", // E5.3: derived, two formulas — occupancy zone and parking level
  // §5 parking level — 14 (entry_count and exit_count are §4's)
  bays_total: "",
  bays_occupied: "",
  bays_free: "",
  ev_bays_free: "",
  entry_barrier_state: "",
  exit_barrier_state: "",
  barrier_fault: "",
  co_ppm: "ppm",
  no2_ppm: "ppm",
  jet_fan_status: "",
  jet_fan_fault: "",
  guidance_comms_ok: "",
  ev_charger_kw: "kW",
  ev_charger_kwh_total: "kWh",
  // §7 BAS gateway — 12 (leak_state is the control-room array's)
  device_online: "",
  last_seen_age_s: "s",
  comms_error_count: "",
  points_stale_count: "",
  cpu_pct: "%",
  memory_pct: "%",
  enclosure_temp_c: "°C",
  supply_voltage_v: "V",
  ups_on_battery: "",
  door_open_state: "",
  rtc_drift_s: "s",
  firmware_version: "",
  // §6 IAQ node — 13, the environment array (11 rows + 2 derived)
  co2_ppm: "ppm",
  pm25_ugm3: "µg/m³",
  pm10_ugm3: "µg/m³",
  tvoc_ugm3: "µg/m³",
  ch2o_ugm3: "µg/m³",
  o3_ppb: "ppb",
  no2_ppb: "ppb",
  outdoor_pm25_ugm3: "µg/m³",
  outdoor_co2_ppm: "ppm",
  sensor_online: "",
  microbial_count_cfu: "CFU/m³",
  co2_above_outdoor_ppm: "ppm", // E5.3: derived, formula in environment-iaq-node.ts
  pm25_indoor_outdoor_ratio: "", // E5.3: derived, dimensionless (the `cop` spelling)
  // §8a lift — 74 (72 rows + 2 derived); controller_comms_ok, motor_current_a,
  // motor_temp_c, kw, kwh_total, run_hours_h are reused, not redeclared here
  lift_in_service: "",
  lift_mode: "",
  lift_fault: "",
  lift_fault_code: "",
  lift_fault_count: "",
  fire_recall_state: "",
  fire_operation_state: "",
  emergency_power_mode: "",
  ard_state: "",
  passenger_alarm: "",
  entrapment_state: "",
  intercom_call_active: "",
  car_position_floor: "",
  car_position_m: "m",
  car_direction: "",
  car_moving: "",
  car_speed_ms: "m/s",
  car_load_pct: "%",
  car_load_kg: "kg",
  overload_state: "",
  full_load_bypass_state: "",
  levelling_error_mm: "mm",
  hall_calls_pending: "",
  car_calls_pending: "",
  next_stop_floor: "",
  car_door_state: "",
  landing_door_state: "",
  door_zone_state: "",
  door_cycle_count: "",
  door_reversal_count: "",
  door_open_time_s: "s",
  door_fault_state: "",
  door_motor_current_a: "A",
  drive_status: "",
  drive_fault_code: "",
  drive_heatsink_temp_c: "°C",
  dc_bus_v: "V",
  brake_state: "",
  brake_temp_c: "°C",
  brake_fault_state: "",
  rope_brake_state: "",
  hydraulic_oil_temp_c: "°C",
  hydraulic_oil_level_low: "",
  hydraulic_pressure_bar: "bar",
  regen_kw: "kW",
  machine_room_temp_c: "°C",
  machine_room_humidity_pct: "%",
  pit_water_state: "",
  pit_light_state: "",
  shaft_temp_c: "°C",
  safety_chain_ok: "",
  governor_tripped: "",
  terminal_limit_state: "",
  car_light_state: "",
  car_fan_state: "",
  car_temp_c: "°C",
  vibration_x_mg: "mg",
  vibration_y_mg: "mg",
  vibration_z_mg: "mg",
  max_accel_ms2: "m/s²",
  max_jerk_ms3: "m/s³",
  noise_dba: "dB(A)",
  trip_count: "",
  floor_km_total: "km",
  passenger_count: "",
  waiting_time_avg_s: "s",
  waiting_time_max_s: "s",
  annual_inspection_due: "",
  rope_condition: "",
  brake_test_result: "",
  buffer_test_result: "",
  ard_battery_test: "",
  door_reversal_ratio_pct: "%", // E5.3: derived, formula in mechanical-lift.ts
  kwh_per_trip: "kWh", // E5.3: derived, formula in mechanical-lift.ts
  // §8b escalator — 28 (27 rows + 1 derived); controller_comms_ok,
  // motor_current_a, motor_temp_c, brake_state, brake_temp_c, passenger_count,
  // kw, kwh_total, run_hours_h, start_count, vibration_mms,
  // annual_inspection_due, brake_test_result are reused, not redeclared here
  esc_status: "",
  esc_direction: "",
  esc_mode: "",
  esc_fault: "",
  esc_fault_code: "",
  esc_emergency_stop: "",
  safety_circuit_ok: "",
  safety_device_tripped: "",
  step_speed_ms: "m/s",
  handrail_speed_l_ms: "m/s",
  handrail_speed_r_ms: "m/s",
  handrail_speed_dev_pct: "%", // E5.3: derived, sortOrder 39 — §12 ruling 3
  gearbox_temp_c: "°C",
  gearbox_oil_level_low: "",
  aux_brake_tripped: "",
  step_chain_tension_ok: "",
  drive_chain_ok: "",
  missing_step_state: "",
  comb_plate_state: "",
  skirt_switch_state: "",
  handrail_inlet_state: "",
  passenger_sensor_state: "",
  machine_space_temp_c: "°C",
  truss_water_state: "",
  lubrication_fault: "",
  standby_hours_h: "h",
  step_chain_elongation_pct: "%",
  kwh_per_run_hour: "kWh/h", // E5.3: derived, formula in mechanical-escalator.ts — §12 ruling 7
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
  // `E5.1` — the water-treatment class point keys (ADR 0040), LAST and
  // unfiltered, for the same two reasons the electrical class array above is
  // last. (a) The `.filter()` above, which subtracts `ELECTRICAL_POINT_KEYS`
  // from the control-room array, keeps reading exactly what it read before.
  // (b) `created_at` ordering: the same five fixtures pick their point key
  // with `ORDER BY created_at, code`, and appending this array last gives
  // all 98 rows the newest `created_at` on every database, existing and
  // fresh — and unlike `ELECTRICAL_CLASS_POINT_KEYS`'s `battery_charge_pct`,
  // there is no pre-existing row among these 98, so no fixture window moves
  // at all (verified on a cold start, not assumed).
  ...keysForDomain(WATER_CLASS_POINT_KEYS, "water"),
  // `E5.2` — the mechanical and HVAC class point keys (ADR 0053), LAST and
  // unfiltered, for the same two reasons the water class array above is
  // last. (a) The `.filter()` above, which subtracts `ELECTRICAL_POINT_KEYS`
  // from the control-room array, keeps reading exactly what it read before.
  // (b) `created_at` ordering: the same five fixtures pick their point key
  // with `ORDER BY created_at, code`, and appending these arrays last gives
  // all 107 rows the newest `created_at` on every database, existing and
  // fresh — none of the 107 pre-exists, so no fixture window moves at all
  // (verified on a cold start, not assumed). The `hvac` line files 39 codes
  // under a domain that already holds `HVAC_POINT_KEYS`'s nine; the clash
  // check `tests/f3.39-global-point-key-vocabulary.test.ts` runs is per
  // code, not per domain.
  ...keysForDomain(MECHANICAL_CLASS_POINT_KEYS, "mechanical"),
  ...keysForDomain(HVAC_CLASS_POINT_KEYS, "hvac"),
  // `E5.3` — the facility pack (ADR 0054), LAST and unfiltered, for the same
  // two reasons the mechanical arrays above are last, and from a second
  // shared file (plan §4.5: `constants.ts` is at the §4.5 line cap). None of
  // the 104 pre-exists, so no `ORDER BY created_at, code` fixture window
  // moves. The `environment` line files 13 codes under a domain that already
  // holds six rows, of which `CONTROL_ROOM_ENVIRONMENT_POINT_KEYS` declares
  // FOUR. The other two — `controller_power_status` and `network_strength` —
  // are the PHE gateway's own health points and reach this table only through
  // `phe-pilot-seed.ts`, in no shared array at all. That matters beyond
  // arithmetic: the clash check in
  // `tests/f3.39-global-point-key-vocabulary.test.ts` iterates `ARRAY_DOMAIN`
  // over the parsed source files, so those two are OUTSIDE its reach, and a
  // later pack that declared either would be silently re-filed by this seed's
  // `domain = EXCLUDED.domain` with nothing failing. `E5.3` is safe — all 104
  // codes were checked against both, and against every code in
  // `GLOBAL_CATALOG`, with zero overlap.
  ...keysForDomain(FACILITY_CLASS_POINT_KEYS, "facility"),
  ...keysForDomain(ENVIRONMENT_CLASS_POINT_KEYS, "environment"),
  // `E5.3` PR 2 — the vertical-transport pack (ADR 0054), LAST and unfiltered,
  // for the same two reasons the facility arrays above are last, and from the
  // same second shared file. None of the 102 pre-exists, so no
  // `ORDER BY created_at, code` fixture window moves. This line files 102 codes
  // under a domain that already holds 68 (`MECHANICAL_CLASS_POINT_KEYS`) — the
  // `HVAC_CLASS_POINT_KEYS` precedent; the clash check in
  // `tests/f3.39-global-point-key-vocabulary.test.ts` is per code, not per
  // domain, and all 102 were checked against every code in `GLOBAL_CATALOG`
  // with zero overlap.
  ...keysForDomain(VERTICAL_TRANSPORT_CLASS_POINT_KEYS, "mechanical"),
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
