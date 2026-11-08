/**
 * The R-6 zone rule (`F3.5b`, ADR 0071 decision 7), moved out of
 * `report-writes.ts` by `F4.339` so `onboarding.ts` can read it: that module
 * reaches `copilot.ts`, which imports `onboarding.ts`. No imports, on purpose.
 * The account of why the rule is shaped this way stays in `report-period.ts`.
 */

const ZONE_SEGMENT_CASING = /^[A-Z][A-Za-z0-9_+-]*(\/[A-Z][A-Za-z0-9_+-]*)+$/;

/** R-6: contains `/`, constructs without `RangeError`, every segment capitalised. */
export function isValidTimeZone(zone: string): boolean {
  if (!zone.includes("/") || !ZONE_SEGMENT_CASING.test(zone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch (err) {
    if (err instanceof RangeError) {
      return false;
    }
    throw err;
  }
}

