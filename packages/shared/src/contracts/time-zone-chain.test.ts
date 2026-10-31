import { describe, it } from "vitest";

import * as spec from "./time-zone-chain.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.298 — the site time-zone chain (ADR 0108 decisions 1.9 and 2.8)", () => {
  it("a valid location zone wins", () => spec.assertAValidLocationZoneWins());
  it("a null location zone falls to the organization's", () => spec.assertANullLocationZoneFallsToTheOrganization());
  it("an invalid location zone falls to the organization's", () => spec.assertAnInvalidLocationZoneFallsToTheOrganization());
  it("a stored UTC is computed as Etc/UTC and reported as UTC", () => spec.assertUtcIsComputedAsEtcUtc());
  it("no valid link falls to Etc/UTC", () => spec.assertBothInvalidFallToEtcUtc());
});
