const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `F3.28` task 2.6 — the instant 24 h before `nowMs`, floored to the minute
 * *before* subtracting the day, and rendered as an ISO string with the `Z`
 * suffix `datetime({ offset: true })` accepts (`telemetry.schema.ts`'s
 * `pointValuesAtQuerySchema`, ADR 0074 decision 2).
 *
 * The minute floor is what makes `usePriorPointValues`' query key stable
 * (`use-prior-point-values.ts`): every call inside the same minute must ask
 * for, and cache under, the same `at`, or the 60 s `refetchInterval` would
 * never hit the cache and would instead fire a fresh request — and a fresh
 * `prior` — on every render.
 */
export function priorInstantIso(nowMs: number): string {
  const flooredToMinute = Math.floor(nowMs / MS_PER_MINUTE) * MS_PER_MINUTE;
  return new Date(flooredToMinute - MS_PER_DAY).toISOString();
}
