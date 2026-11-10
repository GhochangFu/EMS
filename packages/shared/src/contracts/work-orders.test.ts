import { describe, it } from "vitest";

import {
  copilotNeverSendsSlaMinutes,
  createBodyBoundsSlaMinutes,
  detailIsAnIntersectionWithTheListItem,
  eventDetailIsAClosedShape,
  eventRowRoundTrips,
  eventTypesAreTheTenRuled,
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

describe("E3.1 — work-order timeline contracts, PR 2 (ADR 0122 decisions 7 and 8)", () => {
  it("names the ten ruled event types", () => {
    eventTypesAreTheTenRuled();
  });

  it("keeps an event's detail a closed shape", () => {
    eventDetailIsAClosedShape();
  });

  it("round-trips an event row", () => {
    eventRowRoundTrips();
  });

  it("builds the detail as a z.intersection with the list item", () => {
    detailIsAnIntersectionWithTheListItem();
  });
});
