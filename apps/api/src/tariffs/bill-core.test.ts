import { describe, it } from "vitest";

import {
  assertMappingInForce,
  assertPickVersionRules,
  assertTheFleetReadsKeepTheirOrganizationEquality,
  assertTheKolkataMonthWindow,
} from "./bill-core.spec";

/** `F4.365` U4 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.365 — bill core", () => {
  it("cuts a month in the location's zone", () => assertTheKolkataMonthWindow());
  it("picks the version in force; the organization wins a tie", () => assertPickVersionRules());
  it("finds the mapping in force, half-open", () => assertMappingInForce());
  it("keeps the organization equality in every fleet read", () => assertTheFleetReadsKeepTheirOrganizationEquality());
});
