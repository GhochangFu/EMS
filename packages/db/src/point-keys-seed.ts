import type pg from "pg";

import {
  CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
  CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
  CONTROL_ROOM_IT_POINT_KEYS,
  CONTROL_ROOM_UPS_POINT_KEYS,
  ELECTRICAL_POINT_KEYS,
  HVAC_POINT_KEYS,
} from "@bms/shared";

import { getOrganizationId } from "./hierarchy-seed";
import { withOrganization } from "./seed-tenant";

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

const ESKOM_CATALOG: PointKeySeed[] = [
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
];

const PHE_CATALOG: PointKeySeed[] = [
  ...keysForDomain(ELECTRICAL_POINT_KEYS, "electrical"),
  ...keysForDomain(HVAC_POINT_KEYS, "hvac"),
];

/**
 * Seeds org-scoped point key catalog rows for demo organizations.
 *
 * `E7.1a`: `bms.point_keys` is one of the five tables that carry
 * `FORCE ROW LEVEL SECURITY`, and this is the one seed module that writes to
 * both organizations in a single call. It therefore sets its own tenant context
 * around each catalog rather than taking one from `seed.ts` — the loop already
 * had the per-organization shape, so the transaction boundary lands on it.
 *
 * The `organization_id` bind parameter stays, and it is not redundant: it makes
 * the row's tenant explicit at the insert site, and the policy's `WITH CHECK`
 * then rejects any mismatch between it and the surrounding context rather than
 * letting the two drift.
 */
export async function seedPointKeyCatalog(pool: pg.Pool): Promise<void> {
  const eskomOrgId = await getOrganizationId(pool, "ESKOM");
  const phewbOrgId = await getOrganizationId(pool, "PHEWB");

  for (const [organizationId, catalog] of [
    [eskomOrgId, ESKOM_CATALOG],
    [phewbOrgId, PHE_CATALOG],
  ] as const) {
    await withOrganization(pool, organizationId, async () => {
      for (const row of catalog) {
        await pool.query(
          `
          INSERT INTO bms.point_keys (
            organization_id, code, name, domain, unit, active
          )
          VALUES ($1, $2, $3, $4, $5, true)
          ON CONFLICT (organization_id, code) DO UPDATE SET
            name = EXCLUDED.name,
            domain = EXCLUDED.domain,
            unit = EXCLUDED.unit
          `,
          [organizationId, row.code, row.name, row.domain, row.unit],
        );
      }
    });
  }
}
