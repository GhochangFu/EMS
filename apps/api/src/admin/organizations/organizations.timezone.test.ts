import { describe, it } from "vitest";

import {
  aRegionZonePasses,
  anInvalidZoneIsRefused,
  theDtoContractRequiresTimezone,
  theKeyIsOptional,
  utcPasses,
} from "./organizations.timezone.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 organizations.timezone — request schemas and DTO contract", () => {
  it("Z1 a region/city zone passes on create and update", () => {
    aRegionZonePasses();
  });

  it("Z2 UTC passes although isValidTimeZone refuses slash-less names", () => {
    utcPasses();
  });

  it("Z3 an invalid, mis-cased or empty zone is refused on the timezone path", () => {
    anInvalidZoneIsRefused();
  });

  it("Z4 the key is optional on create and update", () => {
    theKeyIsOptional();
  });

  it("Z5 the shared DTO contract requires timezone", () => {
    theDtoContractRequiresTimezone();
  });
});
