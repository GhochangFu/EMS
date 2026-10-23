import { describe, it } from "vitest";

import {
  theClearBodyParsesWithTheRouteBody,
  theClearModelBodyAcceptsTheEmptyMap,
  theClearModelBodyRefusesItems,
  theProfileCreateModelBodyAcceptsAnOrganization,
  theProfileCreateModelBodyRefusesNoOrganization,
  theSetModelBodyRefusesAnEmptyMap,
} from "./escalation-writes.spec";

/** `F4.279` — Vitest entry point for the escalation request bodies. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.279 — escalation request bodies", () => {
  it("the copilot profile create model body refuses a missing organizationId", () => {
    theProfileCreateModelBodyRefusesNoOrganization();
  });

  it("the copilot profile create model body accepts an organizationId", () => {
    theProfileCreateModelBodyAcceptsAnOrganization();
  });

  it("the copilot set model body refuses an empty map", () => {
    theSetModelBodyRefusesAnEmptyMap();
  });

  it("the copilot clear model body refuses a non-empty map", () => {
    theClearModelBodyRefusesItems();
  });

  it("the copilot clear model body accepts the empty map", () => {
    theClearModelBodyAcceptsTheEmptyMap();
  });

  it("the clear body parses with the route's own body", () => {
    theClearBodyParsesWithTheRouteBody();
  });
});
