import { describe, it } from "vitest";

import {
  deliveryEventEnvelopeAdmitsEveryKind,
  deliveryEventEnvelopeRefusesAnInventedKind,
  deliveryEventIsRequiredOnEveryRow,
  runNotificationDeliveryStatusEnvelopeTests,
  runPointAggregateBucketSecondsTests,
  runPointAggregateEmptyWindowTests,
  runPointAggregateIsNotStrictTests,
  runPointAggregateResponseShapeTests,
} from "./envelopes.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.35 Stage A — the point-aggregate response contract", () => {
  it("carries the tile's half and the chart's half without requiring either", () => {
    runPointAggregateResponseShapeTests();
  });

  it("treats a window with no samples as an answer, not a failure", () => {
    runPointAggregateEmptyWindowTests();
  });

  it("stays permissive, as every response contract in this directory is", () => {
    runPointAggregateIsNotStrictTests();
  });

  it("bounds the bucket width it reports in place of a level", () => {
    runPointAggregateBucketSecondsTests();
  });
});

describe("F3.52 — the deliveries envelope the web client parses with", () => {
  it("admits every delivery status the contract declares, `skipped_stale` included", () => {
    runNotificationDeliveryStatusEnvelopeTests();
  });
});

describe("F3.56 — the deliveries envelope carries the event kind", () => {
  it("admits every event kind the contract declares, and the set is exactly five", () => {
    deliveryEventEnvelopeAdmitsEveryKind();
  });

  it("refuses `retry` — that is F3.57's value, and this row does not add it", () => {
    deliveryEventEnvelopeRefusesAnInventedKind();
  });

  it("refuses a row with no `event` at all — the field is required", () => {
    deliveryEventIsRequiredOnEveryRow();
  });
});
