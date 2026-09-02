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
 * **Twelve of the fifteen orphan codes, not all fifteen.**
 * `battery_charge_pct`, `network_strength` and `controller_power_status` are
 * the `PHE-AIRSP1051M-*` gateway's own health points, `environment` domain
 * rather than `electrical`. They would need a second array filed under a second
 * domain, no widget binds them, and nothing regresses by leaving them on the
 * two paths above.
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
