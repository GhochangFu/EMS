import { describe, it } from "vitest";

import {
  causeCodeListRoundTrips,
  copilotNeverSendsTheFindings,
  detailCarriesFindingsAndTheSnapshot,
  itemRequiresCauseCodeAndApprovedAt,
  noRequestBodyTakesTheSnapshot,
  rootCauseBodyReplacesTheSet,
  snapshotHoldsFourNullableValues,
  statusBodyTakesTheFindings,
} from "./work-order-findings.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E3.1 — root cause and alarm snapshot contracts, PR 4 (ADR 0122 decisions 5 and 5a)", () => {
  it("requires causeCode and approvedAt on the list item", () => {
    itemRequiresCauseCodeAndApprovedAt();
  });

  it("carries the findings and the snapshot on the detail, still as a z.intersection", () => {
    detailCarriesFindingsAndTheSnapshot();
  });

  it("holds four nullable values in the snapshot", () => {
    snapshotHoldsFourNullableValues();
  });

  it("round-trips the cause-code list", () => {
    causeCodeListRoundTrips();
  });

  it("takes the four findings on the status body and keeps it strict", () => {
    statusBodyTakesTheFindings();
  });

  it("replaces the findings with the root-cause body", () => {
    rootCauseBodyReplacesTheSet();
  });

  it("takes the alarm snapshot in no request body (E3.4)", () => {
    noRequestBodyTakesTheSnapshot();
  });

  it("keeps the findings out of the copilot's model body", () => {
    copilotNeverSendsTheFindings();
  });
});
