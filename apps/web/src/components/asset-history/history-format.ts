import { resolveSiteTimeZone } from "@bms/shared/contracts";

/**
 * `F4.297` U5 (ADR 0108 decision 1.9) — the asset history page's time and access helpers.
 *
 * Every time on the page is wall time in the asset's site zone, never the browser's. The zone
 * arrives on the `aggregate` response as `timeZone`; {@link siteZoneOf} turns the reported name
 * into the zone `Intl` formats in through the one shared chain (`resolveSiteTimeZone`), so a
 * stored `UTC` formats as `Etc/UTC` and an unknown name falls back rather than throwing.
 */

/** The zone used when the response carries none (an older API image); the page says so. */
export const FALLBACK_ZONE = "Etc/UTC";

/** The one sentence a 403 (or an asset missing from the caller's list) renders. */
export const ACCESS_SENTENCE = "Asset not found or outside your access.";

export interface SiteZone {
  /** The name printed under the chart: the reported zone, or {@link FALLBACK_ZONE}. */
  readonly label: string;
  /** The zone `Intl` formats in. */
  readonly zone: string;
  /** False when the response named no zone and the page fell back. */
  readonly reported: boolean;
}

/** The display zone for a reported `timeZone` (absent → {@link FALLBACK_ZONE}, said so). */
export function siteZoneOf(reported: string | undefined): SiteZone {
  if (reported === undefined) {
    return { label: FALLBACK_ZONE, zone: FALLBACK_ZONE, reported: false };
  }
  const { arithmeticZone } = resolveSiteTimeZone(reported, null);
  return { label: reported, zone: arithmeticZone, reported: true };
}

/** An instant as `31 Oct 2026, 07:12:05` in `zone`; `—` when it is not a valid instant. */
export function formatInZone(iso: string | null | undefined, zone: string): string {
  const ms = iso === null || iso === undefined ? Number.NaN : Date.parse(iso);
  if (Number.isNaN(ms)) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

/** A chart axis label in `zone`: `31 Oct 07:12`. */
export function axisLabelInZone(ms: number, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

/** How long ago `iso` was, from `nowMs`: `12 s ago`, `5 min ago`, `3 h ago`, `3 d ago`. */
export function ageOf(iso: string, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 1000));
  if (seconds < 60) {
    return `${seconds} s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} min ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)} h ago`;
  }
  return `${Math.floor(seconds / 86_400)} d ago`;
}

/**
 * Whether a read failed with a 403. The api clients throw `"<name> <status>"`
 * (`telemetry aggregate 403`, `asset points 403`), so the status is the last word.
 */
export function isForbidden(error: unknown): boolean {
  return error instanceof Error && /\b403$/.test(error.message.trim());
}

/** A TanStack `retry` that never retries a 403 (no retry loop on a refusal) and gives up after 2. */
export function retryUnlessForbidden(failureCount: number, error: unknown): boolean {
  return !isForbidden(error) && failureCount < 2;
}
