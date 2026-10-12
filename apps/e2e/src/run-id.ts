/**
 * One prefix per run for every record a spec creates (ADR 0100 decision 7), so
 * a second run on the same database passes. `playwright.config.ts` sets
 * `E2E_RUN_ID` once in the main process; the workers inherit it, so every
 * spec in a run sees the same value.
 */
export const RUN_ID: string = process.env.E2E_RUN_ID ?? `E2E-${Date.now().toString(36).toUpperCase()}`;

/** A slug for `createLocationBodySchema` (`/^[a-z0-9-]+$/`). */
export function slugOf(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}
