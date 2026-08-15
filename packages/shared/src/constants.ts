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
