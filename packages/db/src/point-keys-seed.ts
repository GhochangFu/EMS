import type pg from "pg";

import {
  CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
  CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
  CONTROL_ROOM_IT_POINT_KEYS,
  CONTROL_ROOM_UPS_POINT_KEYS,
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
        unit = EXCLUDED.unit
      `,
      [row.code, row.name, row.domain, row.unit],
    );
  }
}
