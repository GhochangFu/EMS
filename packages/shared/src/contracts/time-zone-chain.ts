import { isValidTimeZone } from "./report-writes";

/**
 * `F4.298` U1 (ADR 0108 decisions 1.9, 2.8 and Status ruling b) — the one
 * location → organization → `Etc/UTC` chain. The energy view (`F4.298`) and the
 * asset history page (`F4.297`) both call it; no second chain is declared.
 *
 * - The first link that is `"UTC"` or passes {@link isValidTimeZone} wins.
 * - `"UTC"` is the `bms.organizations.timezone` column default, and
 *   `isValidTimeZone("UTC")` is false (it requires a `/`), so
 *   `report-period.ts`'s formatter would throw on it. It is therefore reported
 *   as `timeZone: "UTC"` and computed on `arithmeticZone: "Etc/UTC"`.
 * - Any other stored value that fails `isValidTimeZone` falls to the next link,
 *   never a 500. When no link is valid, the answer is `UTC` / `Etc/UTC`.
 *
 * Pure, no I/O: the caller reads `locations.timezone` (nullable) and
 * `organizations.timezone` and passes them in. An organization view, or a view
 * over several locations, passes `null` for the location.
 */
export interface ResolvedSiteTimeZone {
  /** The zone the response reports: the stored value, `"UTC"` included. */
  readonly timeZone: string;
  /** The zone the date arithmetic runs in: always passes `isValidTimeZone`. */
  readonly arithmeticZone: string;
}

const STORED_UTC = "UTC";
const UTC_ARITHMETIC_ZONE = "Etc/UTC";

function linkOf(zone: string | null): ResolvedSiteTimeZone | null {
  if (zone === null) {
    return null;
  }
  if (zone === STORED_UTC) {
    return { timeZone: STORED_UTC, arithmeticZone: UTC_ARITHMETIC_ZONE };
  }
  return isValidTimeZone(zone) ? { timeZone: zone, arithmeticZone: zone } : null;
}

/** The location's valid stored zone, else the organization's, else `UTC` (arithmetic in `Etc/UTC`). */
export function resolveSiteTimeZone(locationZone: string | null, organizationZone: string | null): ResolvedSiteTimeZone {
  return (
    linkOf(locationZone) ??
    linkOf(organizationZone) ?? { timeZone: STORED_UTC, arithmeticZone: UTC_ARITHMETIC_ZONE }
  );
}
