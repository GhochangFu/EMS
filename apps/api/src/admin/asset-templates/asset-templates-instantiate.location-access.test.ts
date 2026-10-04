import { describe, it } from "vitest";

import {
  assertTheDefaultChecksTheTargetLocation,
  assertTheOrganizationOptionChecksTheOrganizationOnly,
} from "./asset-templates-instantiate.location-access.spec";

/**
 * `F3.22` (ADR 0091 decision 5) — Vitest entry point. Assertions live in the
 * sibling `.spec` (§4.6 / ADR 0014). No database: both cases are decided before
 * the first write, and the fake raises a sentinel there.
 */
describe("F3.22 — the instantiate core's location check is an option (ADR 0091 d5)", () => {
  it("A1: the default asks canManageLocation once and reaches the write", async () => {
    await assertTheDefaultChecksTheTargetLocation();
  });

  it("A2: the organization option skips canManageLocation and asks canManageOrganization", async () => {
    await assertTheOrganizationOptionChecksTheOrganizationOnly();
  });
});
