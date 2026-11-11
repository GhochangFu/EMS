// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aCancelledTicketStopsWhereItWasAndReadsCancelled,
  aClosedTicketReadsCompletedWithFiveReached,
  anInProgressAlarmTicketShowsFiveStepsFourReached,
  aResolvedTicketAwaitsApproval,
  aTicketWithNoEventsStillDrawsFromItsStatus,
  theFirstStepNamesHowTheTicketWasRaised,
} from "./work-order-stepper.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 the work-order stepper (ADR 0122 decision 8)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows five steps with four reached for an in-progress alarm ticket", () => {
    anInProgressAlarmTicketShowsFiveStepsFourReached();
  });

  it("reads Awaiting approval on step 5 of a resolved ticket", () => {
    aResolvedTicketAwaitsApproval();
  });

  it("stops a cancelled ticket at the step it reached and reads Cancelled", () => {
    aCancelledTicketStopsWhereItWasAndReadsCancelled();
  });

  it("names the first step by how the ticket was raised", () => {
    theFirstStepNamesHowTheTicketWasRaised();
  });

  it("draws a ticket with no events from its status", () => {
    aTicketWithNoEventsStillDrawsFromItsStatus();
  });

  it("reads Completed with five reached on a closed ticket", () => {
    aClosedTicketReadsCompletedWithFiveReached();
  });
});
