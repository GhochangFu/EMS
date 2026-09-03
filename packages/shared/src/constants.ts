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
 * `electrical` (Amendment 6 decision 3 is unconditional, and for this one
 * code it OVERRIDES the "filing domain follows the asset" heuristic that
 * justifies it: the only real registrant is a `PHE-AIRSP1051M-*` gateway,
 * which `deviceDomain()` files under `environment`. The owner accepted the
 * flip with that tension named — plan §9 Q3. Do not read this sentence as
 * the rule for the next promoted code; decision 3 is), and its unit fills
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
 * set, UPS, solar PV, APFC). `F2.12` appended six more (145 total) — see the
 * "SIX DERIVED CODES PROMOTED BY `F2.12`" paragraph below.
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
 * `tests/f3.38`'s vocabulary would silently not contain these 145 codes.
 *
 * **`battery_charge_pct` is here, and it already has a row.** It reaches
 * `bms.point_keys` today through `phe-pilot-seed.ts`'s inline registration
 * and migration `0057`'s orphan sweep, filed `environment` with a NULL
 * unit. Joining this array flips its domain to `electrical` and fills its
 * unit to `"%"` through `seedPointKeyCatalog`'s `COALESCE` — see the
 * correction to `METERED_PUMPING_POINT_KEYS`'s docblock, just above, and
 * `packages/db/src/point-keys-seed.ts`'s `UNIT_BY_KEY` section comment.
 *
 * **SIX DERIVED CODES PROMOTED BY `F2.12`, 139 → 145.** ADR 0051 Amendment 6
 * decision 8 pre-authorizes promoting *"each derived code it can actually
 * author a formula for, in its plan"* — five of the tag list's own named
 * "Derived:" codes turned out to be expressible over measured points in
 * their own class, and each is appended to the end of its own class section
 * above with a `// F2.12: derived, formula in electrical-<class>.ts`
 * comment:
 *
 *  - `oil_rise_over_ambient_c` (§2 transformer) —
 *    `{top_oil_temp_c} - {ambient_temp_c}`, `°C`.
 *  - `specific_fuel_l_kwh` (§3 DG set) — `{fuel_rate_lph} / {gen_kw}`,
 *    `L/kWh`.
 *  - `unplanned_run_flag` (§3 DG set) — `{dg_status} * {mains_available}`,
 *    unitless (`""`) — a boolean expressed as a product of two `0/1` codes,
 *    the only way the grammar has of writing one.
 *  - `load_headroom_pct` (§4 UPS) — `100 - {load_pct}`, `%`.
 *  - `inverter_efficiency_pct` (§5 solar PV) —
 *    `{ac_power_kw} / {dc_power_kw} * 100`, `%`.
 *
 * The sixth, `cell_voltage_spread_v` (§4 UPS) —
 * `{cell_voltage_max_v} - {cell_voltage_min_v}`, `V` — is **not** named by
 * the tag list's own "Derived:" list. It was ruled in by the owner at the
 * `F2.12` plan gate on 2026-09-02 (plan §12 ruling 2), because the UPS's
 * "cell voltage spread high (weak block)" alarm has no other parameter to
 * bind: the tag list gives `cell_voltage_min_v` and `cell_voltage_max_v` but
 * names no spread code, and an alarm whose parameter is not a point is an
 * alarm nobody can rationalize.
 *
 * Each formula's output code needed promoting here, not just authoring as a
 * `kind: "derived"` template point, because `assertPointKeysActive`
 * (`asset-templates.service.ts`) checks every point's key — derived
 * included — against `bms.point_keys` where `active = true`.
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
  // §2 transformer — 31
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
  "oil_rise_over_ambient_c", // F2.12: derived, formula in electrical-transformer.ts
  // §3 DG set — 37
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
  "specific_fuel_l_kwh", // F2.12: derived, formula in electrical-dg-set.ts
  "unplanned_run_flag", // F2.12: derived, formula in electrical-dg-set.ts
  // §4 UPS — 23
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
  "load_headroom_pct", // F2.12: derived, formula in electrical-ups.ts
  "cell_voltage_spread_v", // F2.12: derived, formula in electrical-ups.ts
  // §5 solar PV — 26
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
  "inverter_efficiency_pct", // F2.12: derived, formula in electrical-solar-pv.ts
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

/**
 * The v1 point vocabulary for six water-treatment plant classes — WTP, RO,
 * softener, cooling tower, STP, ETP — from `docs/e5.1-derived-taglist-v1.md`
 * §§1–6, ADR 0040 (Accepted 2026-09-02, the water-pack authoring decisions)
 * and the plan `docs/plans/e5.1-water-domain-pack.md` §4.4. The source is
 * **PROVISIONAL**: it is derived from published water-treatment practice and
 * the client's own reference dashboards, not a client-confirmed tag list —
 * marked so in the pack's own entries (`stock-catalog/water*.ts`, `E5.1`),
 * and a v2 redline against it is expected. This array carries only the
 * vocabulary; the six template entries that consume it are `E5.1`'s later
 * tasks.
 *
 * **One array, not six per plant** — same reason `ELECTRICAL_CLASS_POINT_KEYS`
 * is one array, and stronger here: `tests/f3.39`'s clash check requires every
 * `*_POINT_KEYS` array disjoint, and four codes recur **inside the water tag
 * list itself** (`clarifier_sludge_level_pct` §1/§5, `influent_flow_klh`
 * §5/§6, `effluent_bod_mgl` §5/§6, `effluent_cod_mgl` §5/§6) — six per-plant
 * arrays would clash against each other before ever reaching the existing
 * seven. First occurrence wins, exactly as `ELECTRICAL_CLASS_POINT_KEYS`
 * resolves its own three recurrences.
 *
 * **`domain: "water"`** — the first array filed under a domain other than
 * `electrical`/`hvac`/`it`/`environment`. `bms.asset_domains` already holds
 * the code, seeded by migration `0029` *for this row*: "`water` is seeded now
 * although no row uses it yet. It is not speculative: `E5.1` is the P0
 * flagship." All six plant entries take `domain: "water"` — an STP, an ETP
 * and a cooling tower are all water-treatment plants, and ADR 0051 Amendment
 * 6 decision 3 settles the principle that `domain` is the filing domain, not
 * an exclusivity.
 *
 * **Four near-misses, checked clean against the seven existing arrays, each
 * worth naming before the next pack reaches for a similar code:**
 *
 *  - `supply_temp_c` / `return_temp_c` (cooling tower) do **not** clash with
 *    `HVAC_POINT_KEYS`'s `supply_air_temp_c` / `return_air_temp_c` /
 *    `chw_supply_temp_c` / `chw_return_temp_c` — four different codes for
 *    four different fluids. These two are cooling-tower **basin water**.
 *    `E5.2`'s chiller table must reuse `chw_supply_temp_c`, not mint a
 *    sibling.
 *  - `fan_status` / `fan_current_a` (cooling tower) do not clash with HVAC's
 *    `fan_rpm` / `fan_speed_pct` or the transformer's `cooling_fan_status`.
 *    From this row on, `fan_status` is a global code meaning "fan run
 *    status", and ADR 0051 Amendment 6 decision 5 (one code, one meaning)
 *    says `E5.2`'s AHU should reuse it rather than mint `ahu_fan_status`.
 *  - `hp_pump_status`, `intake_pump_status`, `circ_pump_status`,
 *    `transfer_pump_status` do not clash with `METERED_PUMPING_POINT_KEYS`,
 *    which holds meter codes and `chlorine_pump_on` only.
 *  - `flow_rate`, `ph`, `cod`, `dissolved_oxygen` — the four legacy spellings
 *    `dashboard-templates/stock-catalog.ts` binds at 8 sites — are **not**
 *    adopted. The water list spells them
 *    `raw_water_flow_klh`/`feed_flow_klh`/`influent_flow_klh`/…,
 *    `raw_ph`/`feed_ph`/`effluent_ph`/`circ_ph`/`neutralization_ph`/`discharge_ph`,
 *    `effluent_cod_mgl`, and `aeration_do_mgl`/`bio_do_mgl`. None of the four
 *    legacy spellings joins this array, verified by set intersection against
 *    the final 98. `tests/f3.38-stock-catalog-vocabulary.test.ts`'s
 *    `KEYS_AWAITING_A_VOCABULARY` list and its `stillOutside` assertion stay
 *    untouched and green — the four really are still outside the vocabulary
 *    — but its docblock's premise changes in this commit, corrected there.
 *
 * **Seven promoted derived codes, eight point instances** — the tag list
 * names 21 derived codes across its six sections; these seven are the ones
 * genuinely expressible over measured siblings *inside their own entry*, and
 * each is authored as a `kind: "derived"` template point with the formula
 * below (the other fourteen are deferred and named in
 * `stock-catalog/stock-catalog-deferrals.spec.ts`'s `DEFERRED_DERIVED_CODES`,
 * never placeholdered):
 *
 *  - `recovery_pct` — `water-wtp`:
 *    `{treated_water_flow_klh} / {raw_water_flow_klh} * 100`; `water-ro`:
 *    `{permeate_flow_klh} / {feed_flow_klh} * 100`. One code, two formulas,
 *    both `%` — the meaning is identical (the fraction of the input stream
 *    leaving as product), the inputs are just named differently on each
 *    plant, exactly as `load_pct` means the same thing on four electrical
 *    classes. **Not authored on the STP or the ETP** (owner ruling): the
 *    STP's own derived quantity is reuse, and hydraulic recovery shown where
 *    an operator expects reuse is the silent-wrong class of failure.
 *  - `turbidity_removal_pct` (§1 WTP) —
 *    `(1 - {filtered_turbidity_ntu} / {raw_turbidity_ntu}) * 100`, `%`.
 *  - `salt_rejection_pct` (§2 RO) —
 *    `(1 - {permeate_conductivity_uscm} / {feed_conductivity_uscm}) * 100`,
 *    `%`.
 *  - `range_c` (§4 cooling tower) — `{return_temp_c} - {supply_temp_c}`,
 *    `°C`.
 *  - `approach_c` (§4 cooling tower) —
 *    `{supply_temp_c} - {ambient_wetbulb_c}`, `°C`. Authored with
 *    `maxInputAgeSeconds: 3600`, not the 300 s default, because
 *    `ambient_wetbulb_c` commonly comes from a site weather station rather
 *    than the tower controller.
 *  - `cycles_of_concentration` (§4 cooling tower) —
 *    `{circ_conductivity_uscm} / {makeup_conductivity_uscm}`, unitless
 *    (`""`).
 *  - `makeup_pct` (§4 cooling tower) —
 *    `{makeup_flow_klh} / {circ_flow_klh} * 100`, `%`.
 *
 * **`recovery_pct`'s spelling is a deliberate departure from the tag list**,
 * which writes `pct_recovery` (owner ruling, plan §12 ruling 1): ADR 0040
 * decision 2's `snake_case` + unit-suffix convention wins over the document's
 * prefix-first spelling, because the code is seeded write-once and every
 * other percentage in the vocabulary is `*_pct`. The tag list's `D` rows are
 * corrected to match in the closure `docs(adr):` PR — the document is not
 * edited on this branch, so the two disagree until then, by design.
 *
 * **`salt_efficiency_kg_kl` (softener) is deferred, not authored, and it is
 * the one worth reading closely** — the formula
 * `{salt_consumption_kg} / {outlet_flow_totalizer_kl}` parses over two
 * declared measured points, but `salt_consumption_kg` is a manual (`M`) row
 * with `sourceDataKeyPattern: null` forever, so `planAsset` puts it in
 * `skippedPoints` and it never gets an `asset_points` row, never gets a
 * `point_values` row, and the formula never has an input to read. A
 * permanent, foreign-keyed point key for a formula that cannot run is the
 * decorative vocabulary ADR 0051 fact 4 exists to end — do not "complete" it
 * later without first giving the manual row somewhere to write to
 * (`F1.8`).
 *
 * **`µS/cm` is `U+00B5` MICRO SIGN, not `U+03BC` GREEK SMALL LETTER MU** —
 * verified against the codepoint in `docs/e5.1-derived-taglist-v1.md`. The
 * two render identically and are different strings; six codes below carry
 * it, and `seedPointKeyCatalog`'s `COALESCE(bms.point_keys.unit,
 * EXCLUDED.unit)` makes the first value written permanent on every database
 * that seeds it. `°C`'s `°` is `U+00B0`, matching the existing entries.
 *
 * **The tag list's own *Counts:* line
 * (`docs/e5.1-derived-taglist-v1.md:221-222`) does not reconcile with its own
 * table rows.** It reads "~100 points across six plant types; 58 core, 27
 * extended, ~15 manual/lab". A row-by-row count of the six sections gives 95
 * table rows (91 distinct codes after four intra-list recurrences), 53 core,
 * 31 extended, 11 manual-or-dual — not one of the four numbers matches. This
 * is a finding against the source document, not a transcription error here;
 * it is a v2 redline candidate, recorded in the pack docblock and the
 * closure record, and the document is not edited on this branch.
 *
 * **`""` is exactly twelve codes** — the eleven `0/1` rows (`backwash_status`,
 * `intake_pump_status`, `hp_pump_status`, `cip_status`, `regen_status`,
 * `fan_status`, `circ_pump_status`, `blower_status`, `uv_status`,
 * `filter_press_status`, `transfer_pump_status`) plus
 * `cycles_of_concentration`, a dimensionless ratio spelled the way `pf`
 * already is. **`pH`, `Hazen` and `SDI15` are named units, not `""`** (owner
 * ruling, plan §12 ruling 3) — ADR 0051 Amendment 6 decision 4 maps only
 * "0/1, enum, code, tap and count" to the empty string, and these three are
 * named scales an operator reads.
 *
 * **Every code here needs a `UNIT_BY_KEY` entry in
 * `packages/db/src/point-keys-seed.ts`**, enforced by
 * `tests/f3.39-global-point-key-vocabulary.test.ts` — `keysForDomain` writes
 * `UNIT_BY_KEY[code] ?? null`, so a missing entry seeds `NULL`.
 *
 * **The array must stay in THIS file.** Both `tests/f3.38`'s
 * `pointKeyVocabulary` and `tests/f3.39`'s `arraysByName` read
 * `packages/shared/src/constants.ts` as text, with a regex anchored on
 * matching every uppercase `POINT_KEYS` array declaration and requiring the
 * array body contain no `]` character (`[^\]]*` in both). A sibling file, or
 * a bracketed citation inside the literal, would make the array invisible to
 * both with nothing failing.
 *
 * **Out of scope for this array — v2 work, not a silent omission:** UF, DM,
 * dosing skids and potable water, named by the `E5.1` backlog row's title but
 * with no section in `docs/e5.1-derived-taglist-v1.md`; a train of unit
 * assets (ADR 0040 ruling 5 — one asset per plant for v1); and every derived
 * code with no in-entry formula, deferred by name in
 * `stock-catalog/stock-catalog-deferrals.spec.ts`.
 */
export const WATER_CLASS_POINT_KEYS = [
  // §1 WTP — 20 (18 rows + 2 derived)
  "raw_water_flow_klh",
  "raw_turbidity_ntu",
  "raw_ph",
  "settled_turbidity_ntu",
  "filtered_turbidity_ntu",
  "filter_dp_bar",
  "backwash_status",
  "coagulant_dose_lph",
  "chlorine_dose_lph",
  "treated_cl2_residual_mgl",
  "treated_water_flow_klh",
  "clearwell_level_pct",
  "clarifier_sludge_level_pct",
  "treated_conductivity_uscm",
  "intake_pump_current_a",
  "intake_pump_status",
  "raw_color_hazen",
  "raw_alkalinity_mgl",
  "recovery_pct", // E5.1: derived, formula in water-wtp.ts
  "turbidity_removal_pct", // E5.1: derived, formula in water-wtp.ts
  // §2 RO — 17 (16 rows + 1 derived; recovery_pct is §1's, promoted once)
  "feed_flow_klh",
  "permeate_flow_klh",
  "reject_flow_klh",
  "feed_pressure_bar",
  "stage1_dp_bar",
  "feed_conductivity_uscm",
  "permeate_conductivity_uscm",
  "feed_ph",
  "feed_orp_mv",
  "feed_temp_c",
  "hp_pump_current_a",
  "hp_pump_status",
  "cip_status",
  "antiscalant_dose_lph",
  "feed_sdi",
  "cartridge_filter_dp_bar",
  "salt_rejection_pct", // E5.1: derived, formula in water-ro.ts
  // §3 softener — 9 (9 rows, no derived)
  "inlet_flow_klh",
  "outlet_flow_totalizer_kl",
  "outlet_hardness_mgl",
  "inlet_hardness_mgl",
  "vessel_dp_bar",
  "regen_status",
  "brine_tank_level_pct",
  "salt_consumption_kg",
  "outlet_conductivity_uscm",
  // §4 cooling tower — 21 (17 rows + 4 derived)
  "supply_temp_c",
  "return_temp_c",
  "ambient_wetbulb_c",
  "circ_flow_klh",
  "makeup_flow_klh",
  "blowdown_flow_klh",
  "basin_level_pct",
  "circ_conductivity_uscm",
  "makeup_conductivity_uscm",
  "circ_ph",
  "circ_orp_mv",
  "fan_status",
  "fan_current_a",
  "circ_pump_status",
  "circ_pump_current_a",
  "inhibitor_dose_lph",
  "circ_tds_mgl",
  "range_c", // E5.1: derived, formula in water-cooling-tower.ts
  "approach_c", // E5.1: derived, formula in water-cooling-tower.ts
  "cycles_of_concentration", // E5.1: derived, formula in water-cooling-tower.ts
  "makeup_pct", // E5.1: derived, formula in water-cooling-tower.ts
  // §5 STP — 17 (18 rows less clarifier_sludge_level_pct, §1's; no derived)
  "influent_flow_klh",
  "effluent_flow_klh",
  "aeration_do_mgl",
  "mlss_mgl",
  "effluent_turbidity_ntu",
  "effluent_tss_mgl",
  "effluent_ph",
  "effluent_cl2_residual_mgl",
  "effluent_bod_mgl",
  "effluent_cod_mgl",
  "blower_status",
  "blower_current_a",
  "ras_flow_klh",
  "eq_tank_level_pct",
  "treated_tank_level_pct",
  "mbr_tmp_bar",
  "uv_status",
  // §6 ETP — 14 (17 rows less influent_flow_klh, effluent_cod_mgl,
  // effluent_bod_mgl, all §5's; no derived)
  "neutralization_ph",
  "dosing_acid_lph",
  "dosing_alkali_lph",
  "bio_mlss_mgl",
  "bio_do_mgl",
  "settling_tss_mgl",
  "clarifier_turbidity_ntu",
  "discharge_flow_klh",
  "discharge_ph",
  "oil_grease_mgl",
  "sludge_holding_level_pct",
  "filter_press_status",
  "transfer_pump_status",
  "guard_pond_level_pct",
] as const;

export type WaterClassPointKey = (typeof WATER_CLASS_POINT_KEYS)[number];

/**
 * `E5.2` / ADR 0053 — the mechanical/utility class point-key vocabulary, 68
 * codes across four mechanical machine classes (pump set, motor + VFD, air
 * compressor, boiler). `HVAC_CLASS_POINT_KEYS`, immediately below, holds the
 * other 39 (chiller, AHU) — 107 in all.
 *
 * **Citation.** `docs/e5.2-derived-taglist-v1.md` §§1-3 and §7 are the
 * source, and ADR 0053 (Accepted 2026-09-03) is the gate: the source is
 * **PROVISIONAL** — derived from published mechanical/HVAC practice, not a
 * client-confirmed tag list — marked so in every entry this vocabulary feeds
 * (`stock-catalog/mechanical.ts`, `E5.2`).
 *
 * **Why two arrays and not one.** ADR 0053 decision 2 files a template's
 * `domain` from its code prefix (`mechanical-*` → `"mechanical"`, `hvac-*` →
 * `"hvac"`), and `tests/f3.39-global-point-key-vocabulary.test.ts`'s clash
 * check requires each `*_POINT_KEYS` array single-domain, the same
 * constraint that already keeps `ELECTRICAL_CLASS_POINT_KEYS` and
 * `WATER_CLASS_POINT_KEYS` apart. **Why not six, one per machine class**:
 * there is no intra-list code recurrence within this pack to resolve (§4.1
 * of the plan), so a per-class split would buy nothing but six `ARRAY_DOMAIN`
 * lines for what is still only two domains.
 *
 * **Why `HVAC_CLASS_POINT_KEYS` is not appended to `HVAC_POINT_KEYS`.**
 * `hvacPointKeySchema = z.enum(HVAC_POINT_KEYS)` (`contracts/dashboard.ts`)
 * is a CLOSED enum consumed by the CRAC screens, `rule-points.ts` and
 * `control-room-bindings.ts` / `crac-page.tsx` — `apps/sim`'s CRAC shape
 * writes exactly those nine codes. Widening that array would widen the enum
 * under every existing consumer with no code changed to expect it. The
 * naming mirrors `ELECTRICAL_CLASS_POINT_KEYS` beside `ELECTRICAL_POINT_KEYS`
 * for the same reason, and neither new name is a substring of the array it
 * sits beside, so `tests/f3.39`'s lookbehind-anchored `keysForDomain(` pin
 * cannot confuse them.
 *
 * **Twenty-one codes are reused, never redeclared** (ADR 0053 decision 3) —
 * `current_a`, `kw`, `kwh_total`, `run_hours_h`, `start_count`,
 * `winding_temp_c`, `insulation_resistance_mohm`, `fuel_level_pct` (the DG
 * set's day-tank level, reused for the boiler's by the plan's §12 ruling 1;
 * all `ELECTRICAL_CLASS_POINT_KEYS`),
 * `oil_temp_c`, `oil_pressure_bar`, `service_due_h`, `fan_current_a` (also
 * `ELECTRICAL_CLASS_POINT_KEYS`), and the nine `HVAC_POINT_KEYS` codes
 * `chw_supply_temp_c`, `chw_return_temp_c`, `chw_flow_lps`, `compressor_ok`,
 * `cooling_kw`, `supply_air_temp_c`, `return_air_temp_c`, `fan_speed_pct`,
 * `fan_rpm`. They stay in the arrays that hold them today; units are
 * write-once (`COALESCE` in `seedPointKeyCatalog`) and a second `UNIT_BY_KEY`
 * entry would be a duplicate object key TypeScript refuses anyway.
 *
 * **Seven near-misses, checked and clean** (plan §4.2): `fuel_level_pct` is
 * reused for the boiler's day-tank level rather than minting
 * `fuel_tank_level_pct` (§12 ruling 1 — one code, one meaning, ADR 0051
 * Amendment 6 decision 5); `motor_current_a` / `compressor_current_a` are
 * kept distinct from `current_a` (several motors per package, the register
 * is the main one's); `vfd_power_kw` / `vfd_kwh_total` / `vfd_run_hours_h`
 * are kept distinct from `kw` / `kwh_total` / `run_hours_h` (the VFD is its
 * own asset, ADR 0053 decision 9); `flow_klh` is not folded into any legacy
 * dashboard key; `chw_supply_temp_c` / `chw_return_temp_c` mean the same
 * thing on the chiller and the AHU (plant loop vs. one coil) and are reused
 * on both rather than renamed; the four `_sp_`/`setpoint` codes are
 * authored as measured points because the controller reports them and no
 * `_sp` convention existed before this pack; `fan_status` is NOT on the AHU
 * table (the tag list's alarm bullet needing it binds `fan_current_a`
 * instead — a v2 redline candidate, plan §4.2).
 *
 * **Thirteen promoted derived codes** (plan §5.0, six on this array's
 * classes: `head_m`, `specific_energy_kwh_kl` (pump); `load_factor_pct`,
 * `specific_power_kw_m3min` (compressor); `steam_to_fuel_ratio`,
 * `excess_air_pct` (boiler) — each marked `// E5.2: derived, formula in
 * mechanical-<class>.ts` below; the other seven are on `HVAC_CLASS_POINT_KEYS`.
 * **`specific_energy_kwh_kl` is one code, three entries, one authoring**: it
 * is deferred on `electrical-feeder` (needs production/KL, cross-asset) and
 * on `water-ro` (which declares HP-pump current, not `kw`); the pump
 * declares both `kw` and `flow_klh`, so it is authored — and filed
 * `mechanical` — here. One meaning, the `load_pct` shape.
 *
 * **Two new deferral classes** this pack introduces to `DEFERRAL_REASON`
 * (plan §5.0): *a standard's lookup* (`vibration_band` — ISO 20816 zones are
 * an attribute table, the grammar has no lookup) and *a method the document
 * only names* (`air_leak_estimate_pct`, `efficiency_indirect_pct` — each
 * needs a test window or a fuel-analysis model the tag list does not
 * supply).
 *
 * **`""` for every `0/1`, `enum` and `code` row and for the two dimensionless
 * ratios** (`cop`, `steam_to_fuel_ratio`) — ADR 0051 Amendment 6 decision 4 —
 * never a missing `UNIT_BY_KEY` entry, which would seed NULL. Every other
 * unit is spelled exactly as the tag list spells it. `°` is `U+00B0` on
 * every `°C` code; `³` in `fad_m3h` and `specific_power_kw_m3min` is
 * `U+00B3` SUPERSCRIPT THREE, matching `W/m²`'s `U+00B2` convention. No `µ`
 * and no `Ω` occur among these codes — `MΩ` belongs to the reused
 * `insulation_resistance_mohm`, not redeclared here.
 *
 * **Every code here needs a `UNIT_BY_KEY` entry in
 * `packages/db/src/point-keys-seed.ts`**, enforced by
 * `tests/f3.39-global-point-key-vocabulary.test.ts` — `keysForDomain` writes
 * `UNIT_BY_KEY[code] ?? null`, so a missing entry seeds `NULL`.
 *
 * **This array stays in THIS file, but a pack's array no longer has to.**
 * Until `E5.3` it did: `tests/f3.38`'s `pointKeyVocabulary` and `tests/f3.39`'s
 * `arraysByName` read `packages/shared/src/constants.ts` as text, so a sibling
 * file was invisible to both **with nothing failing** — which is why this
 * docblock used to forbid one outright. `E5.3` had to add 104 codes against a
 * 927-line file and the AGENTS.md §4.5 cap, so ADR 0054 §12 ruling 1 put them
 * in `packages/shared/src/facility-point-keys.ts` and the three guards now
 * read a **list** of source files, `POINT_KEY_SOURCE_RELS`, parsing each and
 * unioning the result. The silence is what got closed: each file carries its
 * own floor, so a rel that parses as nothing fails **naming that file**, and
 * `tests/f3.39`'s `ARRAY_DOMAIN` must cover every array parsed from every
 * source. Adding a third file means adding its rel, its floor and its
 * `ARRAY_DOMAIN` entries — not editing a regex. The four arrays already here
 * stay put regardless: they are write-once data four merged pull requests have
 * reviewed, and moving them would be churn.
 */
export const MECHANICAL_CLASS_POINT_KEYS = [
  // §1 pump set — 13 (11 rows + 2 derived)
  "pump_status", "pump_mode", "pump_trip",
  "suction_pressure_bar", "discharge_pressure_bar", "flow_klh",
  "de_bearing_temp_c", "nde_bearing_temp_c", "vibration_mms",
  "seal_leak_state", "dry_run_state",
  "head_m", // E5.2: derived, formula in mechanical-pump.ts
  "specific_energy_kwh_kl", // E5.2: derived, formula in mechanical-pump.ts
  // §2 motor + VFD — 15 (15 rows, no derived)
  "vfd_status", "vfd_ready", "vfd_fault",
  "vfd_fault_code", "vfd_output_freq_hz", "vfd_speed_ref_pct",
  "vfd_output_current_a", "vfd_output_voltage_v", "vfd_dc_bus_v",
  "vfd_torque_pct", "vfd_power_kw", "vfd_kwh_total",
  "vfd_heatsink_temp_c", "motor_temp_c", "vfd_run_hours_h",
  // §3 air compressor — 17 (15 rows + 2 derived)
  "comp_status", "comp_load_state", "comp_fault",
  "comp_warning", "outlet_pressure_bar", "pressure_setpoint_bar",
  "element_outlet_temp_c", "intake_filter_dp_mbar", "oil_separator_dp_bar",
  "loaded_hours_h", "motor_current_a", "dryer_dewpoint_c",
  "dryer_status", "receiver_pressure_bar", "fad_m3h",
  "load_factor_pct", // E5.2: derived, formula in mechanical-compressor.ts
  "specific_power_kw_m3min", // E5.2: derived, formula in mechanical-compressor.ts
  // §7 boiler — 23 (21 rows + 2 derived; the boiler's day-tank level is the
  // DG set's reused fuel_level_pct, §12 ruling 1, and is not listed here)
  "boiler_status", "boiler_trip", "steam_pressure_bar",
  "steam_temp_c", "steam_flow_kgh", "steam_totalizer_kg",
  "drum_level_pct", "feedwater_flow_kgh", "feedwater_temp_c",
  "feedwater_tds_ppm", "feed_pump_status", "fuel_flow_kgh",
  "fuel_totalizer_kg", "flue_gas_temp_c",
  "flue_o2_pct", "flue_co_ppm", "combustion_air_temp_c",
  "furnace_draft_mmwc", "blowdown_state", "boiler_water_ph",
  "blowdown_tds_ppm",
  "steam_to_fuel_ratio", // E5.2: derived, formula in mechanical-boiler.ts
  "excess_air_pct", // E5.2: derived, formula in mechanical-boiler.ts
] as const;

export type MechanicalClassPointKey = (typeof MECHANICAL_CLASS_POINT_KEYS)[number];

/**
 * `E5.2` / ADR 0053 — the HVAC class point-key vocabulary, 39 codes across
 * two machine classes (chiller, AHU) — see `MECHANICAL_CLASS_POINT_KEYS`,
 * immediately above, for the citation, the two-array rationale, the reused
 * codes, the near-misses and the codepoint rules; they hold for this array
 * too and are not repeated here.
 *
 * **Filed `hvac`, a domain that already holds `HVAC_POINT_KEYS`'s nine
 * codes.** A second array under one domain is what
 * `CONTROL_ROOM_UPS_POINT_KEYS` beside `ELECTRICAL_CLASS_POINT_KEYS` already
 * does for `electrical` — the clash check in
 * `tests/f3.39-global-point-key-vocabulary.test.ts` is per code, not per
 * domain, so this is not a new shape.
 *
 * **`hvac-chiller` and `hvac-ahu` are the first two stock entries ever filed
 * under `hvac`.** `chw_supply_temp_c` / `chw_return_temp_c` are reused on
 * both — the chiller's plant-loop CHW and the AHU's coil CHW are the same
 * meaning read at a different point, not two quantities.
 *
 * **Seven promoted derived codes on these two classes** (the other six are
 * on `MECHANICAL_CLASS_POINT_KEYS`): `cooling_load_tr`, `kw_per_tr`, `cop`,
 * `chw_delta_t_c`, `cw_delta_t_c` (chiller — the N4 KPIs, plan §5.0, two of
 * them the document's own physical constants, `4.19` and `3.517`); the N5
 * health signal `kw_per_tr_high` binds `kw_per_tr`, one of these — a derived
 * point, not `content.kpis`/`content.health` (ADR 0053 decision 11, ADR
 * 0050's surface). `sat_deviation_c`, `coil_delta_t_c` (AHU).
 * `coil_delta_t_c` is the same formula string as `chw_delta_t_c` on a
 * different asset — the plant loop ΔT vs. one coil's ΔT, kept as two codes
 * because the tag list names them separately (plan §5.0, §12 ruling 4).
 *
 * **`fan_rpm`'s catalogue unit stays `RPM`**, the existing spelling, not the
 * document's `rpm` — reused, not redeclared, so no second spelling of the
 * same unit ships to an importer.
 */
export const HVAC_CLASS_POINT_KEYS = [
  // §4 chiller — 20 (15 rows + 5 derived)
  "chiller_status", "chiller_alarm", "chiller_fault_code",
  "chw_setpoint_c", "cw_entering_temp_c", "cw_leaving_temp_c",
  "cw_flow_lps", "evap_pressure_bar", "cond_pressure_bar",
  "evap_approach_c", "cond_approach_c", "compressor_load_pct",
  "compressor_current_a", "discharge_temp_c", "refrigerant_charge_pct",
  "cooling_load_tr", // E5.2: derived, formula in hvac-chiller.ts
  "kw_per_tr", // E5.2: derived, formula in hvac-chiller.ts
  "cop", // E5.2: derived, formula in hvac-chiller.ts
  "chw_delta_t_c", // E5.2: derived, formula in hvac-chiller.ts
  "cw_delta_t_c", // E5.2: derived, formula in hvac-chiller.ts
  // §6 AHU — 19 (17 rows + 2 derived)
  "ahu_status", "ahu_fault", "supply_air_temp_sp_c",
  "mixed_air_temp_c", "outdoor_air_temp_c", "return_air_rh_pct",
  "supply_air_rh_pct", "duct_static_pa", "duct_static_sp_pa",
  "return_fan_speed_pct", "chw_valve_pct", "oa_damper_pct",
  "ra_damper_pct", "filter_dp_pa", "filter_dirty_state",
  "return_air_co2_ppm", "fire_trip_state",
  "sat_deviation_c", // E5.2: derived, formula in hvac-ahu.ts
  "coil_delta_t_c", // E5.2: derived, formula in hvac-ahu.ts
] as const;

export type HvacClassPointKey = (typeof HVAC_CLASS_POINT_KEYS)[number];
