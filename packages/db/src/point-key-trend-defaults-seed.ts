import type pg from "pg";

/**
 * `F4.300` (ADR 0108 decision 3, C2, owner answer Q4) — the catalog codes the
 * seed marks as key trend points (`bms.point_keys.trend_default = true`,
 * migration `0117`). This is seed data that names point codes per segment: data,
 * not a decision in code (`tests/adr-0108-no-org-or-segment-literals.test.ts`
 * exempts this file for that reason).
 *
 * The 21 codes the plan proposed, then the `ups` default set chosen from the
 * seven `CONTROL_ROOM_UPS_POINT_KEYS` codes: load, battery voltage, autonomy,
 * battery temperature and output voltage. Mechanical and facility seed none.
 */
export const TREND_DEFAULT_SEED: readonly string[] = [
  // electrical
  "kw",
  "kwh_total",
  "pf",
  "voltage_l1_v",
  "current_a",
  "frequency_hz",
  // hvac
  "supply_air_temp_c",
  "return_air_temp_c",
  "chw_supply_temp_c",
  "chw_return_temp_c",
  "cooling_kw",
  // it
  "rack_kw",
  "rack_temp_c",
  "pdu_util_pct",
  // environment
  "temperature_c",
  "humidity_pct",
  // water
  "raw_water_flow_klh",
  "treated_water_flow_klh",
  "raw_turbidity_ntu",
  "treated_cl2_residual_mgl",
  "clearwell_level_pct",
  // ups (Q4)
  "load_pct",
  "battery_v",
  "backup_min",
  "battery_temp_c",
  "output_voltage_v",
];

/**
 * Seeds `bms.point_keys.trend_default` in one
 * `UPDATE … SET trend_default = true WHERE trend_default IS NULL AND code = ANY(…)`.
 *
 * **`trend_default IS NULL` is the whole of C2.** The column is tri-state:
 * `NULL` = undecided, `true`/`false` = decided. The seed fills only an
 * undecided row, so a global admin's `false` survives every later
 * `pnpm db:seed` (the `headline_rank IS NULL` shape of F3.68 OQ3). The codes are
 * one bound array parameter, never interpolated into the SQL text.
 *
 * Call it after `seedPointKeyCatalog` and `seedPheCatalog` (both insert rows
 * with the flag left NULL) on every path, with no tenant context —
 * `bms.point_keys` is fleet-wide.
 *
 * @param pool anything with `pg`'s `query` (the seed's pool, or one client
 * inside a transaction).
 * @param codes the codes to mark; defaults to {@link TREND_DEFAULT_SEED}. A
 * parameter so a test can pass a per-run fixture code.
 * @returns the number of rows changed (0 once every listed code is decided).
 */
export async function seedPointKeyTrendDefaults(
  pool: Pick<pg.Pool, "query">,
  codes: readonly string[] = TREND_DEFAULT_SEED,
): Promise<number> {
  const result = await pool.query(
    `UPDATE bms.point_keys
        SET trend_default = true
      WHERE trend_default IS NULL
        AND code = ANY($1::text[])`,
    [[...codes]],
  );
  return result.rowCount ?? 0;
}
