/**
 * `F3.28` (ADR 0074, owner ruling OQ1) — how long an asset's newest sample of
 * **any** point keeps it live, in seconds. An asset with no sample in this
 * window counts as offline in the per-role summary
 * (`GET /api/v1/assets/role-summary`).
 *
 * It is the same 25 s the web freshness gate uses — `FRESH_MS = 25_000` in
 * `apps/web/src/lib/schematic-telemetry.ts` (ADR 0027) — so the class strip's
 * offline count and the schematic's stale styling cannot disagree about one
 * asset. `tests/f3.28-offline-bound-single-source.test.ts` pins
 * `LIVE_TELEMETRY_MAX_AGE_SECONDS * 1000` to `FRESH_MS`.
 *
 * The role-summary SQL binds this as a parameter; it never restates the
 * number as an interval literal. The older `locationDashboard` fresh counts in
 * `dashboard.service.ts` still carry their own literal and are out of this
 * row's scope (the plan's rejected `kw`-only alternatives).
 */
export const LIVE_TELEMETRY_MAX_AGE_SECONDS = 25;
