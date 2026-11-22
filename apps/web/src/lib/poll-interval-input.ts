import { setOrganizationPollIntervalBodySchema } from "@bms/shared/contracts";

/**
 * `F1.2` (ADR 0141 decision 10, plan P4, T7.4) — the poll interval as both forms type it: whole or
 * decimal **seconds** in a text field, empty for "inherit". The bound is read from the shared
 * schema (`pollIntervalMsSchema`, through the organization body that embeds it), so the forms and
 * the API cannot disagree on it.
 */

const BOUND = setOrganizationPollIntervalBodySchema.shape.defaultPollIntervalMs.unwrap();
const MIN_SECONDS = (BOUND.minValue ?? 0) / 1000;
const MAX_SECONDS = (BOUND.maxValue ?? 0) / 1000;

/** Plan P4: both forms warn above this many seconds; the bound stays one hour. */
export const POLL_INTERVAL_WARN_SECONDS = 360;

/**
 * Plan P4's sentence. The freshness window is `clamp(2.5 × interval, 25 s, 900 s)`
 * (`telemetry-cadence.ts`), so above 360 s a device reads as not live between two polls.
 */
export const POLL_INTERVAL_SLOW_WARNING =
  "Above 360 s a device shows as not live between polls: the freshness window is at most 900 s.";

export const POLL_INTERVAL_RANGE_MESSAGE = `Enter seconds from ${MIN_SECONDS} to ${MAX_SECONDS}, or leave it empty to inherit.`;

export type ParsedPollInterval = { readonly ok: true; readonly ms: number | null } | { readonly ok: false };

/** Empty is `null` (inherit); a number of seconds in the bound is milliseconds; anything else is refused. */
export function parsePollIntervalSeconds(text: string): ParsedPollInterval {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: true, ms: null };
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false };
  }
  const ms = Math.round(Number(trimmed) * 1000);
  return BOUND.safeParse(ms).success ? { ok: true, ms } : { ok: false };
}

/** A stored value as the field shows it: seconds, or empty for `null`. */
export function pollIntervalSecondsText(ms: number | null): string {
  return ms === null ? "" : String(ms / 1000);
}

/** Whether the typed value is above P4's warning line. */
export function isSlowPollInterval(text: string): boolean {
  const parsed = parsePollIntervalSeconds(text);
  return parsed.ok && parsed.ms !== null && parsed.ms > POLL_INTERVAL_WARN_SECONDS * 1000;
}

/** How an inherited value reads beside the field: "60 s", or the adapter's own default. */
export function inheritedPollIntervalText(ms: number | null, fallback: string): string {
  return ms === null ? fallback : `${ms / 1000} s`;
}
