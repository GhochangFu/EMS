import { resolveSiteTimeZone } from "./time-zone-chain";

/**
 * `F4.298` U1 (ADR 0108 decisions 1.9, 2.8 and ruling b) — the one location →
 * organization → `Etc/UTC` chain. One assertion per link. Assertions here; the
 * sibling `.test.ts` is the Vitest entry (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertResolves(
  location: string | null,
  organization: string | null,
  expected: { timeZone: string; arithmeticZone: string },
): void {
  const got = resolveSiteTimeZone(location, organization);
  assert(
    got.timeZone === expected.timeZone && got.arithmeticZone === expected.arithmeticZone,
    `resolveSiteTimeZone(${JSON.stringify(location)}, ${JSON.stringify(organization)}) must be ` +
      `${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
  );
}

export function assertAValidLocationZoneWins(): void {
  assertResolves("Asia/Kolkata", "Europe/London", { timeZone: "Asia/Kolkata", arithmeticZone: "Asia/Kolkata" });
}

export function assertANullLocationZoneFallsToTheOrganization(): void {
  assertResolves(null, "Europe/London", { timeZone: "Europe/London", arithmeticZone: "Europe/London" });
}

export function assertAnInvalidLocationZoneFallsToTheOrganization(): void {
  assertResolves("Not/A_Zone", "Europe/London", { timeZone: "Europe/London", arithmeticZone: "Europe/London" });
  assertResolves("asia/kolkata", "Europe/London", { timeZone: "Europe/London", arithmeticZone: "Europe/London" });
}

export function assertUtcIsComputedAsEtcUtc(): void {
  assertResolves("UTC", "Europe/London", { timeZone: "UTC", arithmeticZone: "Etc/UTC" });
  assertResolves(null, "UTC", { timeZone: "UTC", arithmeticZone: "Etc/UTC" });
}

export function assertBothInvalidFallToEtcUtc(): void {
  assertResolves("Not/A_Zone", "Mars/Olympus", { timeZone: "UTC", arithmeticZone: "Etc/UTC" });
  assertResolves(null, null, { timeZone: "UTC", arithmeticZone: "Etc/UTC" });
  assertResolves("", "", { timeZone: "UTC", arithmeticZone: "Etc/UTC" });
}
