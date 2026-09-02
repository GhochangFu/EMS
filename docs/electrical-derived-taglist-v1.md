# Electrical/power derived tag list v1 — authored from industry practice

**Status: PROVISIONAL — derived, not confirmed.** Companion to
[`e5.1-derived-taglist-v1.md`](./e5.1-derived-taglist-v1.md),
[`e5.2-derived-taglist-v1.md`](./e5.2-derived-taglist-v1.md) and
[`e5.3-derived-taglist-v1.md`](./e5.3-derived-taglist-v1.md). There is no
`E5.x` row for electrical because the platform's electrical domain is the
one it was born with — `BASELINE-ELECTRICAL` is seeded, `apps/sim` writes
it, and `F3.41` just added the metered-pumping feeder set from real PHE
hardware. This document is the v1 catalog that turns that seed into
**per-asset-class templates** (transformer, DG, UPS, PV, APFC) rather than one
baseline, and it is the counterpart of the SOW page-9 *Electrical
Distribution Overview*.

**Derivation basis** (recorded so v1's assumptions are auditable):

1. **ISA-5.1** letter codes per point; point codes keep the repo's
   `snake_case` + unit-suffix convention.
2. **The SOW page-9 reference** (`docs/ux/ion-exchange-reference-alignment.md`)
   — asset classes Transformers · HT Panels · LT Panels · MCCs · VFDs · DG,
   KPI row Total Power / Demand vs Contract Demand / PF / Energy Today, and
   alarm texts *Overload (112%)*, *Oil Temperature High*, *THD High*. Page 10
   adds Utilities: DG / UPS / Solar / Capacitor.
3. **Energy-meter register maps** (Schneider PM/ION, Eaton PXM, ABB, Secure)
   and **IEC 61557-12** PMD classes — the multifunction-meter point set:
   per-phase V/I, kW/kVAR/kVA, PF, Hz, kWh/kVAh, THD-V/THD-I, unbalance,
   demand and maximum demand.
4. **IEC 60076-7 / IEEE C57.91** transformer loading guides — top-oil and
   winding hot-spot as the thermal points; OLTC tap position; DGA
   (H₂, CH₄, C₂H₂) and moisture as online-monitor extras.
5. **Genset controller register maps** (Deep Sea DSE 6xxx/7xxx, ComAp
   InteliLite/InteliGen, Cummins PowerCommand) — oil pressure, coolant
   temperature, fuel level, battery voltage, speed, run hours, kW, mode and
   alarm words.
6. **RFC 1628 UPS-MIB** — input/output/battery/alarm groups
   (`upsOutputPercentLoad`, `upsBatteryTemperature`,
   `upsEstimatedMinutesRemaining`, `upsAlarmsPresent`) as the protocol-neutral
   UPS set; IEC 62040 terminology.
7. **SunSpec Models 101–103 (inverter) and 303 (irradiance)** — PV point
   set and operating-state enum.
8. **The repo's existing vocabulary** — `ELECTRICAL_POINT_KEYS`
   (`voltage_l1_v`, `current_a`, `kw`, `kvar`, `pf`, `breaker_main`),
   `CONTROL_ROOM_ELECTRICAL_POINT_KEYS` (`frequency_hz`, `kwh_today`),
   `METERED_PUMPING_POINT_KEYS` (`kwh_total`, `kva`, `current_ir/iy/ib`,
   `voltage_vry/vyb/vbr/vrn/vyn/vbn`) and `CONTROL_ROOM_UPS_POINT_KEYS`
   (`load_pct`, `output_voltage_v`, `output_freq_hz`, `battery_v`,
   `battery_temp_c`, `backup_min`, `health_pct`) — **reused verbatim**. The
   Indian R/Y/B phase naming from `F3.41` is kept for per-phase points; the
   older `voltage_l1_v` stays as the simulator's single-phase summary.

Per B7/B8, alarm rows carry the parameter and its *meaning* only — **no limit
numbers**. Contract demand, transformer rating and DG rating are asset
attributes, and the percentage derivations reference them.

**Tiers.** `C` = core, `X` = extended, `M` = manual (`F1.8`), `D` = derived.

**How the client uses this document:** strike what is not fitted, add what is
missing, correct names and units.

**Gate before this becomes template content:** an ADR (or an amendment to
ADR 0051) promoting the class-specific keys into the global vocabulary, the
same path `F3.41` took for the metered-pumping set.

---

## 1. Feeder / incomer — multifunction energy meter (HT panel, LT panel, MCC feeder, sub-meter)

The base class. Every panel, feeder and sub-meter is this table; an HT
incomer adds the relay rows, a motor feeder adds the E5.2 §2 drive rows.

| Point code | ISA | Description | Unit | Tier |
|---|---|---|---|---|
| `voltage_vry` | ET | Line voltage R–Y | V | C |
| `voltage_vyb` | ET | Line voltage Y–B | V | C |
| `voltage_vbr` | ET | Line voltage B–R | V | C |
| `voltage_vrn` | ET | Phase voltage R–N | V | X |
| `voltage_vyn` | ET | Phase voltage Y–N | V | X |
| `voltage_vbn` | ET | Phase voltage B–N | V | X |
| `current_ir` | IT | Current R | A | C |
| `current_iy` | IT | Current Y | A | C |
| `current_ib` | IT | Current B | A | C |
| `current_in` | IT | Neutral current | A | X |
| `current_a` | IT | Average / total current (existing key) | A | C |
| `kw` | JT | Active power, total (existing key) | kW | C |
| `kvar` | JT | Reactive power, total (existing key) | kVAR | C |
| `kva` | JT | Apparent power, total (existing key) | kVA | C |
| `pf` | — | Power factor, total (existing key) | — | C |
| `frequency_hz` | ST | Frequency (existing key) | Hz | C |
| `kwh_total` | JQ | Active energy, cumulative (existing key) | kWh | C |
| `kvah_total` | JQ | Apparent energy, cumulative | kVAh | X |
| `kvarh_total` | JQ | Reactive energy, cumulative | kVARh | X |
| `kwh_today` | JQ | Energy today (existing key; meter or derived) | kWh | C/D |
| `demand_kw` | JT | Present demand (sliding window) | kW | X |
| `max_demand_kw` | JT | Maximum demand this billing period | kW | X |
| `max_demand_kva` | JT | Maximum demand (kVA billing) | kVA | X |
| `thd_v_pct` | — | Voltage THD (worst phase) | % | X |
| `thd_i_pct` | — | Current THD (worst phase) | % | X |
| `voltage_unbalance_pct` | — | Voltage unbalance | % | X |
| `current_unbalance_pct` | — | Current unbalance | % | X |
| `breaker_main` | — | Breaker closed / open (existing key) | 0/1 | C |
| `breaker_trip` | — | Breaker tripped on fault | 0/1 | C |
| `breaker_spring_charged` | — | ACB spring charged (HT/LT incomer) | 0/1 | X |
| `relay_trip_code` | — | Protection relay last trip (O/C, E/F, U/V) | code | X |
| `earth_fault_state` | — | Earth-fault indication | 0/1 | X |
| `meter_comms_ok` | — | Meter reachable | 0/1 | C |

**Derived:** `load_pct` D = kVA ÷ rating · `demand_vs_contract_pct` D =
demand ÷ contract demand (the page-9 KPI) · `pf_penalty_flag` D vs tariff PF
band · `kwh_per_unit_output` D (with production / KL) · `specific_energy_kwh_kl`
D · `losses_pct` D = incomer − Σ feeders.
**Alarms (meaning only):** overload (load % of rating — page-9's *Overload
(112%)*) · under/over-voltage · frequency out of band (grid / DG quality) ·
PF low (tariff penalty) · THD high (page-9's *THD High* — harmonics from
VFDs/UPS) · unbalance high (single-phasing / uneven load) · breaker trip
(relay code in text) · earth fault · demand approaching contract demand ·
meter comms loss.

## 2. Transformer — oil-immersed distribution / power transformer (dry-type: drop oil rows, keep winding RTDs)

Page-9's asset with the most on-screen detail (*2.60 MVA, 11.2/0.433 kV,
48.7 °C, Load 72%*).

| Point code | ISA | Description | Unit | Tier |
|---|---|---|---|---|
| `top_oil_temp_c` | TT | Top-oil temperature (OTI) | °C | C |
| `winding_temp_c` | TT | Winding temperature (WTI, hottest phase) | °C | C |
| `winding_temp_r_c` | TT | Winding temperature R (fibre-optic / RTD) | °C | X |
| `winding_temp_y_c` | TT | Winding temperature Y | °C | X |
| `winding_temp_b_c` | TT | Winding temperature B | °C | X |
| `ambient_temp_c` | TT | Ambient at transformer | °C | X |
| `oil_level_pct` | LT | Conservator oil level | % | X |
| `oil_level_low` | — | Oil level low switch | 0/1 | C |
| `buchholz_alarm` | — | Buchholz gas alarm | 0/1 | C |
| `buchholz_trip` | — | Buchholz surge trip | 0/1 | C |
| `prv_operated` | — | Pressure relief valve operated | 0/1 | X |
| `oti_alarm` | — | OTI alarm contact | 0/1 | C |
| `oti_trip` | — | OTI trip contact | 0/1 | C |
| `wti_alarm` | — | WTI alarm contact | 0/1 | C |
| `wti_trip` | — | WTI trip contact | 0/1 | C |
| `tap_position` | — | OLTC tap position | tap | X |
| `oltc_in_progress` | — | Tap change in progress | 0/1 | X |
| `oltc_operation_count` | KQ | OLTC operations, cumulative | count | X |
| `cooling_fan_status` | — | ONAF fan(s) running | 0/1 | X |
| `cooling_pump_status` | — | OFAF/ODAF oil pump running | 0/1 | X |
| `dga_h2_ppm` | AT | Dissolved hydrogen (online DGA) | ppm | X |
| `dga_c2h2_ppm` | AT | Dissolved acetylene (online DGA) | ppm | X |
| `dga_ch4_ppm` | AT | Dissolved methane (online DGA) | ppm | X |
| `dga_co_ppm` | AT | Dissolved CO (cellulose) | ppm | X |
| `oil_moisture_ppm` | AT | Oil moisture (online) | ppm | X |
| `lv_load_pct` | — | LV-side load (from §1 meter on the LV feeder) | % | D |
| `oil_bdv_kv` | — | Oil breakdown voltage (lab, periodic) | kV | M |
| `oil_moisture_lab_ppm` | — | Oil moisture (lab, periodic) | ppm | M |
| `dga_lab_result` | — | Lab DGA summary (periodic) | text | M |
| `silica_gel_state` | — | Breather silica gel colour (manual) | enum | M |
| `insulation_resistance_mohm` | — | Megger IR (manual) | MΩ | M |

**Derived:** `load_pct` D = LV kVA ÷ rating (page-9's *Load 72%*) ·
`hot_spot_estimate_c` D per IEC 60076-7 thermal model · `loss_of_life_pct_day`
D (ageing rate) · `oil_rise_over_ambient_c` D · `tap_changes_per_day` D ·
`duval_triangle_zone` D from DGA ratios.
**Alarms (meaning only):** OTI alarm / trip (page-9's *Oil Temperature High*)
· WTI alarm / trip · Buchholz alarm (gas accumulation — incipient fault) /
trip · oil level low · PRV operated · overload (load %) · cooling fan/pump
failure with temperature rising · DGA H₂ or C₂H₂ rising (arcing / hot
spot) · moisture high · OLTC operations abnormal · lab BDV low.

## 3. DG set — diesel generator with AMF/controller

Points mirror the DSE / ComAp / PowerCommand register groups; every DG
controller in the Indian market exposes this set.

| Point code | ISA | Description | Unit | Tier |
|---|---|---|---|---|
| `dg_status` | — | Engine running | 0/1 | C |
| `dg_mode` | — | Auto / manual / off / test | enum | C |
| `dg_on_load` | — | Generator breaker closed (supplying load) | 0/1 | C |
| `dg_alarm` | — | Warning active | 0/1 | C |
| `dg_shutdown` | — | Shutdown / trip active | 0/1 | C |
| `dg_alarm_code` | — | Active alarm / shutdown code (vendor enum) | code | X |
| `mains_available` | — | Mains healthy (AMF sense) | 0/1 | C |
| `engine_speed_rpm` | ST | Engine speed | rpm | C |
| `oil_pressure_bar` | PT | Lube oil pressure | bar | C |
| `coolant_temp_c` | TT | Coolant temperature | °C | C |
| `oil_temp_c` | TT | Lube oil temperature | °C | X |
| `exhaust_temp_c` | TT | Exhaust gas temperature | °C | X |
| `fuel_level_pct` | LT | Day-tank fuel level | % | C |
| `bulk_fuel_level_pct` | LT | Bulk tank fuel level | % | X |
| `fuel_rate_lph` | FT | Fuel consumption rate (ECU or flow meter) | L/hr | X |
| `fuel_totalizer_l` | FQ | Fuel consumed, cumulative | L | X |
| `battery_v` | ET | Starter battery voltage (existing key) | V | C |
| `charger_alternator_v` | ET | Charge alternator voltage | V | X |
| `coolant_level_low` | — | Coolant level low switch | 0/1 | X |
| `run_hours_h` | KQ | Engine run hours | h | C |
| `start_count` | KQ | Engine starts, cumulative | count | X |
| `failed_start_count` | KQ | Failed starts | count | X |
| `gen_voltage_vry` | ET | Generator line voltage R–Y | V | C |
| `gen_voltage_vyb` | ET | Generator line voltage Y–B | V | C |
| `gen_voltage_vbr` | ET | Generator line voltage B–R | V | C |
| `gen_current_ir` | IT | Generator current R | A | C |
| `gen_current_iy` | IT | Generator current Y | A | C |
| `gen_current_ib` | IT | Generator current B | A | C |
| `gen_frequency_hz` | ST | Generator frequency | Hz | C |
| `gen_kw` | JT | Generator active power | kW | C |
| `gen_kva` | JT | Generator apparent power | kVA | X |
| `gen_pf` | — | Generator power factor | — | X |
| `gen_kwh_total` | JQ | Generator energy, cumulative | kWh | C |
| `service_due_h` | — | Hours to next service (controller) | h | X |
| `emergency_stop_state` | — | E-stop pressed | 0/1 | X |
| `canopy_temp_c` | TT | Acoustic canopy / room temperature | °C | X |

**Derived:** `load_pct` D = kW ÷ rating · `specific_fuel_l_kwh` D · `fuel_hours_remaining_h`
D = level ÷ rate · `starts_per_day` D · `availability_pct` D · `unplanned_run_flag`
D (running with mains available) · `underload_hours` D (wet-stacking risk).
**Alarms (meaning only):** shutdown (code in text) · fail-to-start · oil
pressure low · coolant temperature high · overspeed · fuel level low
(runtime risk) · battery voltage low (next start at risk) · charger fault ·
overload · under/over-frequency · DG running with mains available (cost) ·
service due · E-stop.

## 4. UPS — static UPS with battery (single or parallel)

RFC 1628 groups, in the repo's existing key names where they exist.

| Point code | ISA | Description | Unit | Tier |
|---|---|---|---|---|
| `ups_status` | — | Output source: normal / on battery / bypass / off | enum | C |
| `ups_alarm` | — | Any alarm present (`upsAlarmsPresent` > 0) | 0/1 | C |
| `ups_alarm_code` | — | Highest active alarm (vendor / RFC enum) | code | X |
| `on_battery` | — | Output on battery | 0/1 | C |
| `on_bypass` | — | Output on bypass | 0/1 | C |
| `input_voltage_v` | ET | Input voltage (worst phase) | V | C |
| `input_frequency_hz` | ST | Input frequency | Hz | X |
| `output_voltage_v` | ET | Output voltage (existing key) | V | C |
| `output_freq_hz` | ST | Output frequency (existing key) | Hz | C |
| `output_current_a` | IT | Output current (total) | A | X |
| `output_kw` | JT | Output active power | kW | X |
| `output_kva` | JT | Output apparent power | kVA | X |
| `load_pct` | — | Output load (existing key) | % | C |
| `battery_v` | ET | Battery bus voltage (existing key) | V | C |
| `battery_current_a` | IT | Battery current (+ charge / − discharge) | A | X |
| `battery_temp_c` | TT | Battery temperature (existing key) | °C | C |
| `battery_charge_pct` | — | Battery charge remaining | % | C |
| `backup_min` | — | Estimated minutes remaining (existing key) | min | C |
| `battery_time_on_s` | KQ | Seconds on battery this event | s | X |
| `battery_replace_flag` | — | Battery needs replacement (self-test) | 0/1 | X |
| `battery_last_test` | — | Last self-test result | enum | X |
| `health_pct` | — | Vendor / derived health (existing key) | % | X/D |
| `rectifier_ok` | — | Rectifier / charger healthy | 0/1 | X |
| `inverter_ok` | — | Inverter healthy | 0/1 | X |
| `fan_ok` | — | Cooling fan healthy | 0/1 | X |
| `ambient_temp_c` | TT | UPS room / rack ambient | °C | X |
| `cell_voltage_min_v` | ET | Lowest cell / block voltage (BMS) | V | X |
| `cell_voltage_max_v` | ET | Highest cell / block voltage (BMS) | V | X |
| `impedance_test_result` | — | Battery impedance / conductance (manual or BMS) | enum | M |

**Derived:** `battery_events_per_month` D · `runtime_margin_min` D =
backup − required · `battery_age_months` D (attribute) · `charge_cycle_count`
D · `load_headroom_pct` D.
**Alarms (meaning only):** on battery (input lost) · low battery / runtime
below site minimum · on bypass (no protection) · overload · battery
temperature high (VRLA life, thermal runaway lead indicator) · battery
replace / self-test failed · rectifier / inverter / fan fault · input
voltage out of range · cell voltage spread high (weak block).

## 5. Solar PV — grid-tied inverter with plant sensors

SunSpec Model 103 fields, plus Model 303 irradiance and the module
temperature that PR needs.

| Point code | ISA | Description | Unit | Tier |
|---|---|---|---|---|
| `inv_status` | — | Operating state (SunSpec `St` enum: off / sleeping / MPPT / fault …) | enum | C |
| `inv_fault` | — | Fault active | 0/1 | C |
| `inv_event_code` | — | SunSpec event / vendor event bits | code | X |
| `dc_voltage_v` | ET | DC input voltage (per MPPT or total) | V | C |
| `dc_current_a` | IT | DC input current | A | C |
| `dc_power_kw` | JT | DC input power | kW | C |
| `ac_power_kw` | JT | AC output active power | kW | C |
| `ac_kva` | JT | AC apparent power | kVA | X |
| `ac_pf` | — | Power factor | — | X |
| `ac_frequency_hz` | ST | Grid frequency | Hz | C |
| `ac_voltage_vry` | ET | AC line voltage R–Y | V | X |
| `ac_voltage_vyb` | ET | AC line voltage Y–B | V | X |
| `ac_voltage_vbr` | ET | AC line voltage B–R | V | X |
| `ac_current_ir` | IT | AC current R | A | X |
| `ac_current_iy` | IT | AC current Y | A | X |
| `ac_current_ib` | IT | AC current B | A | X |
| `energy_total_kwh` | JQ | Lifetime energy yield | kWh | C |
| `energy_today_kwh` | JQ | Energy today | kWh | C/D |
| `cabinet_temp_c` | TT | Inverter cabinet / heatsink temperature | °C | X |
| `irradiance_wm2` | — | Plane-of-array irradiance (pyranometer, Model 303) | W/m² | X |
| `module_temp_c` | TT | Module back-sheet temperature | °C | X |
| `ambient_temp_c` | TT | Ambient temperature | °C | X |
| `string_current_a` | IT | String current (per string, combiner box) | A | X |
| `insulation_resistance_kohm` | — | DC insulation resistance (inverter self-test) | kΩ | X |
| `grid_export_kw` | JT | Net export at the point of connection (§1 meter) | kW | D |
| `soiling_loss_pct` | — | Soiling (manual or soiling station) | % | M |

**Derived:** `performance_ratio_pct` D = yield ÷ (irradiance × capacity) ·
`specific_yield_kwh_kwp_day` D · `inverter_efficiency_pct` D = AC ÷ DC ·
`capacity_utilization_pct` D · `string_current_deviation_pct` D (string
fault / shading) · `self_consumption_pct` D · `co2_avoided_kg` D (E4.2).
**Alarms (meaning only):** inverter fault (event in text) · zero output with
irradiance present (tripped / islanded) · PR low vs expected (soiling,
degradation, shading) · string current deviation high (open string, diode)
· cabinet temperature high (derating) · insulation resistance low (DC earth
fault) · grid voltage / frequency out of band (anti-islanding trips).

## 6. Capacitor bank / APFC panel

Page-10's *Capacitor* utility node.

| Point code | ISA | Description | Unit | Tier |
|---|---|---|---|---|
| `apfc_status` | — | Controller in auto / manual | enum | C |
| `apfc_alarm` | — | Controller alarm active | 0/1 | C |
| `target_pf` | — | PF setpoint | — | X |
| `actual_pf` | — | Measured PF at the bus | — | C |
| `steps_on_count` | — | Capacitor steps switched in | count | C |
| `step_state` | — | Per-step in / out (child points) | 0/1 | X |
| `kvar_connected` | JT | Connected reactive power | kVAR | X |
| `kvar_required` | JT | Reactive power still required (controller) | kVAR | X |
| `bus_voltage_v` | ET | Bus voltage | V | X |
| `thd_v_pct` | — | Bus voltage THD (resonance guard) | % | X |
| `panel_temp_c` | TT | Panel internal temperature | °C | X |
| `step_operation_count` | KQ | Switching operations (per step, cumulative) | count | X |
| `capacitor_current_a` | IT | Capacitor bank current (per step or total) | A | X |
| `step_fault_state` | — | Step failed / capacitor lost capacity | 0/1 | X |

**Derived:** `pf_correction_kvar` D · `steps_per_day` D (contactor wear) ·
`capacitor_health_pct` D = measured ÷ rated kVAR per step · `pf_penalty_hours`
D.
**Alarms (meaning only):** PF below target with all steps in (bank
undersized / steps failed) · step fault · panel temperature high · THD high
(resonance risk) · over-compensation (leading PF) · switching rate high.

---

## Cross-cutting notes

- **Every electrical class is §1 plus a class table.** A transformer asset
  is §1 on its LV feeder + §2; a DG is §3 with its own generator meter rows;
  a PV plant is §5 + §1 at the point of connection. `load_pct` is always
  *measured kVA ÷ rating attribute*, so the rating is an asset attribute,
  not a point (ADR 0015 attributes vs ADR 0019 content).
- **Phase naming.** Per-phase keys use the Indian R/Y/B convention `F3.41`
  established (`current_ir`, `voltage_vry`). The older `voltage_l1_v` is the
  simulator's single-value summary and stays for `BASELINE-ELECTRICAL`;
  templates authored from this document should carry both only where the
  seeded asset already has `voltage_l1_v`.
- **`kwh_today` is derived where the meter does not carry it.** The metered
  pumping stations publish `kwh_total`; today's energy is a calc-engine
  difference. The catalog lists it as `C/D` for that reason.
- **The data-centre rack / PDU class** (`CONTROL_ROOM_IT_POINT_KEYS`) and
  UPS §4 together cover the data-centre use case in the client sheet header.
- **Every `M` row lands via `F1.8` manual entry / `F1.9` import** — oil BDV,
  lab DGA, megger values, battery impedance, soiling.
- **Counts:** 169 points across six classes; 70 core, 87 extended, 7
  manual, the rest dual-tier. Extended is dominated by power-quality registers (THD, unbalance,
  demand) that a basic energy meter may not expose, and by transformer
  online-monitoring sensors (DGA, fibre-optic WTI) that only larger units
  carry.
- **What v2 will change:** which meter / relay / controller model sits on
  each panel (fixes the `X` tier and the code enums), CT/PT ratios and
  ratings as attributes, and the tariff's PF and demand bands for the
  derived penalty flags.

## Sources consulted

- SOW pages 9–10 reference dashboards (`docs/ux/ion-exchange-reference-alignment.md`)
  — asset classes, KPIs and alarm texts.
- IEC 61557-12 (PMD classes); Schneider PM8000 / ION, Eaton Power Xpert
  PXM, Setra and Honeywell PowerSmart+ Modbus register maps — meter point
  set including THD, unbalance and demand registers.
- IEC 60076-7 loading guide for mineral-oil-immersed transformers; IEEE
  C57.91; online DGA / OLTC monitoring practice — transformer points.
- Deep Sea Electronics DSE Modbus register guide (oil pressure, coolant
  temperature registers 1024/1025 …); ComAp InteliLite 4 Modbus map;
  Cummins PowerCommand 1.1/2.x Modbus register mapping — DG points.
- RFC 1628 *UPS Management Information Base* — input/output/battery/alarm
  groups; IEC 62040-3 terminology.
- SunSpec Alliance models `smdx_00103` (three-phase inverter) and 303
  (irradiance); SMA / SolarEdge SunSpec implementation notes — PV points.
- `packages/shared/src/constants.ts` on `main` — the existing keys reused.
