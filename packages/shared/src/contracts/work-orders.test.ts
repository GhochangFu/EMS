import { describe, it } from "vitest";

import {
  copilotNeverSendsSlaMinutes,
  createBodyBoundsSlaMinutes,
  itemRequiresReferenceAndSlaState,
  policyBodyIsStrictAndUniquePerPriority,
  policyResponseCarriesSource,
  prefixIsUpperCaseTwoToEight,
} from "./work-orders.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 — work-order depth contracts, PR 1 (ADR 0122)", () => {
  it("requires reference and slaState on the list item", () => {
    itemRequiresReferenceAndSlaState();
  });

  it("bounds slaMinutes on the create body and keeps it strict", () => {
    createBodyBoundsSlaMinutes();
  });

  it("keeps the SLA policy body strict and unique per priority", () => {
    policyBodyIsStrictAndUniquePerPriority();
  });

  it("answers policy rows with their source", () => {
    policyResponseCarriesSource();
  });

  it("accepts a prefix of two to eight upper-case letters or digits only", () => {
    prefixIsUpperCaseTwoToEight();
  });

  it("keeps slaMinutes out of the copilot's model body", () => {
    copilotNeverSendsSlaMinutes();
  });
});
