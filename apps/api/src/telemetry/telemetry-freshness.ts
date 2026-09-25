/**
 * `F3.28` (ADR 0074, owner ruling OQ1) — how long an asset's newest sample of
 * **any** point keeps it live, in seconds. An asset with no sample in this
 * window counts as offline in the per-role summary
 * (`GET /api/v1/assets/role-summary`).
 *
 * It is the same 25 s the web freshness gate uses — `FRESH_MS = 25_000` in
 * `apps/web/src/lib/schematic-telemetry.ts` (ADR 0027) — so the class strip
 * and the schematic use the same window. They can still disagree about one
 * asset: the strip counts a sample of any point, while the web gate judges
 * each reading on its own. `tests/f3.28-offline-bound-single-source.test.ts` pins
 * `LIVE_TELEMETRY_MAX_AGE_SECONDS * 1000` to `FRESH_MS`.
 *
 * `F3.30` (ADR 0075 decision 2): the four fleet freshness counts that used to
 * test only a `kw` sample — `locationKpis`, `locationDashboard`'s RTU rows,
 * `kpis.sites_online` and the map's `fresh_count`, all in
 * `dashboard.service.ts` and `map.service.ts` — now read this same any-point
 * window through {@link LIVE_ASSETS_CTE_SQL}. `total_kw` is unaffected; it
 * keeps its own unbounded `kw` read.
 */
export const LIVE_TELEMETRY_MAX_AGE_SECONDS = 25;

if (!Number.isInteger(LIVE_TELEMETRY_MAX_AGE_SECONDS) || LIVE_TELEMETRY_MAX_AGE_SECONDS <= 0) {
  throw new Error("LIVE_TELEMETRY_MAX_AGE_SECONDS must be a positive integer");
}

/**
 * The window as a plan-time interval literal, not a bound parameter.
 * TimescaleDB excludes `point_values` chunks at plan time only for
 * `now() - <literal interval>`; a bound `$n` plans every chunk and prunes at
 * executor start instead (measured on the dev database, 2026-09-24,
 * ~5.4k chunks, as `bms_fleet`: 520–1900 ms with the parameter, 42–100 ms
 * with the literal). Safe as `sql.raw`/string interpolation: the value is
 * this module's own constant, checked above to be a positive integer, and
 * never request input (§4.4).
 *
 * Every SQL site that tests fleet freshness interpolates this string (or
 * wraps it in `sql.raw` for a Drizzle query) rather than restating the
 * number; `tests/f3.28-offline-bound-single-source.test.ts` holds that for
 * every listed site.
 */
export const LIVE_WINDOW_INTERVAL_SQL = `interval '${LIVE_TELEMETRY_MAX_AGE_SECONDS} seconds'`;

/**
 * The shared `live` CTE: the asset ids with a sample of any point key newer
 * than the window above. Fleet-wide and unscoped by design — the caller
 * joins it against whatever scope its own query already carries (ADR 0075
 * plan decision 2).
 */
export const LIVE_ASSETS_CTE_SQL = `live AS (SELECT DISTINCT asset_id FROM telemetry.point_values WHERE time > now() - ${LIVE_WINDOW_INTERVAL_SQL})`;
