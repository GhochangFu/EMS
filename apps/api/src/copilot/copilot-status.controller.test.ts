import { describe, it } from "vitest";

import {
  assertABadQueryIs400,
  assertAnUnprovisionedTokenGets403,
  assertOperatorsAndViewersGet403AndNoDecision,
  assertTheDecisionMapsOntoTheDto,
  assertTheDefaultOrganizationFollowsTheRole,
} from "./copilot-status.controller.spec";

describe("F3.85 — GET /copilot/status (ADR 0099 decision 5, plan §5.2)", () => {
  it("gives operators and viewers a 403 and decides nothing", () => assertOperatorsAndViewersGet403AndNoDecision());
  it("gives an unprovisioned token a 403", () => assertAnUnprovisionedTokenGets403());
  it("asks about the organization the role defaults to", () => assertTheDefaultOrganizationFollowsTheRole());
  it("maps the decision onto the DTO", () => assertTheDecisionMapsOntoTheDto());
  it("answers a malformed query with a 400", () => assertABadQueryIs400());
});
