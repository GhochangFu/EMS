import { expect } from "vitest";

import { deviceProfileSchema } from "../../ingest-modbus";
import { STOCK_MODBUS_PROFILES } from "./index";

/**
 * `F1.2` plan T1.5 / ADR 0141 decisions 12 and 14 — every stock Modbus
 * profile is a valid device profile that cites its public manual.
 *
 * The list is empty until PR 9 adds the meters, so `checkStockProfiles` is
 * also run over a hand-made list (S2, S3): a check that only ever sees an
 * empty list could not fail.
 *
 * Assertions live here; `stock-profiles.test.ts` is the vitest entry point.
 */

/** Returns one problem per entry that is not a valid, cited, uniquely coded profile. */
export function checkStockProfiles(profiles: readonly unknown[]): string[] {
  const problems: string[] = [];
  const codes = new Set<string>();
  profiles.forEach((profile, index) => {
    const parsed = deviceProfileSchema.safeParse(profile);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join(".") || "(root)");
      problems.push(`stock profile ${index} is not a device profile: ${paths.join(", ")}`);
      return;
    }
    // The schema requires `source.document`, `.revision` and `.pages` (non-empty).
    const { code } = parsed.data;
    if (codes.has(code)) problems.push(`stock profile code ${code} appears twice`);
    codes.add(code);
  });
  return problems;
}

export function assertEveryStockProfileIsValidAndCited(): void {
  expect(checkStockProfiles(STOCK_MODBUS_PROFILES)).toEqual([]);
}

const sample = (over: Record<string, unknown> = {}) => ({
  code: "sample-meter",
  version: 1,
  vendor: "Vendor",
  model: "Model",
  source: { document: "User manual", revision: "Rev 2", pages: "40-44" },
  verified: false,
  registers: [{ sourceKey: "kw", table: "input", address: 0, type: "float32" }],
  ...over,
});

export function assertTheCheckAcceptsACitedProfile(): void {
  expect(checkStockProfiles([sample()])).toEqual([]);
}

export function assertTheCheckRefusesAnUncitedOrRepeatedProfile(): void {
  expect(checkStockProfiles([sample({ source: { document: "User manual", revision: "Rev 2" } })])).toEqual([
    "stock profile 0 is not a device profile: source.pages",
  ]);
  expect(checkStockProfiles([sample(), sample({ version: 2 })])).toEqual([
    "stock profile code sample-meter appears twice",
  ]);
}
