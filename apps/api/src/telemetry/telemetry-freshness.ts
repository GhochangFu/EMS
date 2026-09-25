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
 * Every SQL site that tests fleet liveness interpolates this string (or
 * wraps it in `sql.raw` for a Drizzle query) rather than restating the
 * number; `tests/f3.28-offline-bound-single-source.test.ts` holds that for
 * every listed site. The status read is the one exception: it reads
 * {@link REPORTING_WINDOW_INTERVAL_SQL} instead (ADR 0075 Amendment 1).
 */
export const LIVE_WINDOW_INTERVAL_SQL = `interval '${LIVE_TELEMETRY_MAX_AGE_SECONDS} seconds'`;

/**
 * The shared `live` CTE: the asset ids with a sample of any point key newer
 * than the window above. Fleet-wide and unscoped by design — the caller
 * joins it against whatever scope its own query already carries (ADR 0075
 * plan decision 2).
 */
export const LIVE_ASSETS_CTE_SQL = `live AS (SELECT DISTINCT asset_id FROM telemetry.point_values WHERE time > now() - ${LIVE_WINDOW_INTERVAL_SQL})`;

/**
 * `F3.30` (ADR 0075 Amendment 1) — how long an asset's newest sample of any
 * point keeps it counted as **reporting** in the status read
 * (`GET /api/v1/system/status`), in seconds. It drives both `dataQuality`
 * and the `field_data` component, and is returned as `windowSeconds`.
 *
 * The real MQTT devices report every 60 s (measured on the dev stack,
 * 2026-09-25: median gap 60 s, maximum 61 s, 20 assets). Under the 25 s live
 * window above, a healthy 60 s device is fresh only about 25/60 of the time,
 * so Data Quality read 20–60 % and jumped between polls. 150 s is 2.5× the
 * measured cadence: one missed report still counts, two do not.
 *
 * It does not replace {@link LIVE_TELEMETRY_MAX_AGE_SECONDS}: the location
 * cards, `/` Sites online, the map, the F3.28 class strip and the web
 * `FRESH_MS` keep the 25 s window. The two answer different questions — "is
 * data arriving?" against "is this reading live?" — and may differ on the
 * same fleet at the same moment.
 */
export const REPORTING_WINDOW_SECONDS = 150;

if (!Number.isInteger(REPORTING_WINDOW_SECONDS) || REPORTING_WINDOW_SECONDS <= 0) {
  throw new Error("REPORTING_WINDOW_SECONDS must be a positive integer");
}

/**
 * The reporting window as a plan-time interval literal, for the same
 * chunk-exclusion reason as {@link LIVE_WINDOW_INTERVAL_SQL}. Safe to
 * interpolate: this module's own constant, checked above, never request
 * input (§4.4).
 */
export const REPORTING_WINDOW_INTERVAL_SQL = `interval '${REPORTING_WINDOW_SECONDS} seconds'`;

/**
 * The `reporting` CTE: the asset ids with a sample of any point key newer than
 * the reporting window. The same shape as {@link LIVE_ASSETS_CTE_SQL} —
 * fleet-wide, unscoped, `DISTINCT` so a join cannot fan out a row — under its
 * own name so the status service cannot read the live window by mistake.
 * `tests/f3.28-offline-bound-single-source.test.ts` pins the status service to
 * this CTE and forbids the live one.
 */
export const REPORTING_ASSETS_CTE_SQL = `reporting AS (SELECT DISTINCT asset_id FROM telemetry.point_values WHERE time > now() - ${REPORTING_WINDOW_INTERVAL_SQL})`;
