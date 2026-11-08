import { metaTimezone } from "./onboarding-commit-values";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** F4.339 (plan R10): a valid string `meta.timezone` is the fallback; anything else is ignored. */
export function assertMetaTimezoneReadsOnlyAValidZone(): void {
  assert(metaTimezone({ timezone: "Asia/Kolkata" }) === "Asia/Kolkata", "a valid zone");
  assert(metaTimezone({ timezone: "Kolkata" }) === undefined, "an invalid name");
  assert(metaTimezone({ timezone: 5 }) === undefined, "a number");
  assert(metaTimezone({ timezone: `Asia/${"K".repeat(70)}` }) === undefined, "over the column width");
  assert(metaTimezone(undefined) === undefined && metaTimezone({}) === undefined, "absent");
}
