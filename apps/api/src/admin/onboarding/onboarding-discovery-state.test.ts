import { describe, it } from "vitest";

import {
  aMalformedBlobReadsAsNull,
  anAbsentKeyReadsAsNull,
  aStoredDiscoveryReadsAsTheDto,
} from "./onboarding-discovery-state.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.24b — readDiscovery", () => {
  it("reads a stored discovery as the DTO without queuedAt", () => aStoredDiscoveryReadsAsTheDto());
  it("fails closed on a malformed blob", () => aMalformedBlobReadsAsNull());
  it("reads an absent key as null", () => anAbsentKeyReadsAsNull());
});
