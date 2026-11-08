import { expect } from "vitest";

import { isValidTimeZone } from "./time-zone";

/** R-6 (`report-period.ts`): a `/`, every segment capitalised, and ICU constructs the zone. */
export function assertTheR6RuleAcceptsRegionNamesOnly(): void {
  for (const zone of ["Asia/Kolkata", "Asia/Calcutta", "Etc/GMT+5", "America/Port-au-Prince", "America/Argentina/Buenos_Aires"]) {
    expect(isValidTimeZone(zone), zone).toBe(true);
  }
  for (const zone of ["UTC", "EST", "asia/kolkata", "Kolkata", "Mars/Olympus", ""]) {
    expect(isValidTimeZone(zone), zone).toBe(false);
  }
}
