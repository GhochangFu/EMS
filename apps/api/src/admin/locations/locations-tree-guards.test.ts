import { describe, it } from "vitest";

import {
  aTriggerRefusalMapsToThePreCheckException,
  aWrappedTriggerRefusalIsReadThroughItsCause,
  depthExceededFailsClosed,
  everyReasonMapsToItsStatus,
  everyRefusalBodyIsMessageAndReason,
  noCrossOrgReasonExists,
  otherErrorsAreNotMapped,
  theLockKeyMatchesTheTrigger,
} from "./locations-tree-guards.spec";

describe("F2.10 — locations tree guards", () => {
  it("G1 every reason maps to its status class", () => {
    everyReasonMapsToItsStatus();
  });
  it("G2 every refusal body is { message, reason }", () => {
    everyRefusalBodyIsMessageAndReason();
  });
  it("G3 there is no location_parent_cross_org (A3)", () => {
    noCrossOrgReasonExists();
  });
  it("G4 a trigger refusal maps to the pre-check exception", () => {
    aTriggerRefusalMapsToThePreCheckException();
  });
  it("G5 a wrapped trigger refusal is read through its cause", () => {
    aWrappedTriggerRefusalIsReadThroughItsCause();
  });
  it("G6 other errors are not mapped", () => {
    otherErrorsAreNotMapped();
  });
  it("G7 depthExceeded fails closed", () => {
    depthExceededFailsClosed();
  });
  it("G8 the lock key matches the trigger's", () => {
    theLockKeyMatchesTheTrigger();
  });
});
