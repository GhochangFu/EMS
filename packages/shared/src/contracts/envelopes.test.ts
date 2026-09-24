import { describe, it } from "vitest";

import {
  alarmSummaryResponseAcceptsAZeroCountRow,
  alarmSummaryResponseRequiresTotal,
  assetListResponseSchemaAndNoOldNameSurvives,
  assetListRowAcceptsAFullyWiredRow,
  assetListRowAcceptsAnUnwiredRow,
  assetListRowRefusesAMissingRequiredField,
  deliveryEventEnvelopeAdmitsEveryKind,
  deliveryEventEnvelopeRefusesAnInventedKind,
  deliveryEventIsRequiredOnEveryRow,
  pointValuesAtInstantAcceptsASampledAndAnUnsampledRef,
  pointValuesAtInstantRequiresPointRefAndAt,
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

describe("F3.28 — alarmSummaryResponseSchema (ADR 0074 decision 3)", () => {
  it("accepts a zero-count severity row alongside the total", () => {
    alarmSummaryResponseAcceptsAZeroCountRow();
  });

  it("requires total", () => {
    alarmSummaryResponseRequiresTotal();
  });
});

describe("F3.28 — pointValuesAtInstantResponseSchema (ADR 0074 decision 2)", () => {
  it("accepts a sampled ref and an unsampled ref in the same response", () => {
    pointValuesAtInstantAcceptsASampledAndAnUnsampledRef();
  });

  it("requires `at` on the response and `pointRef` on every item", () => {
    pointValuesAtInstantRequiresPointRefAndAt();
  });
});

describe("F3.31 — assetListRowSchema (ADR 0068 decision 2)", () => {
  it("accepts a fully wired row", () => {
    assetListRowAcceptsAFullyWiredRow();
  });

  it("accepts an unwired, hand-created row with every nullable field null", () => {
    assetListRowAcceptsAnUnwiredRow();
  });

  it("refuses a row missing a required field", () => {
    assetListRowRefusesAMissingRequiredField();
  });

  it("parses a response array, and leaves no assetPickerRowSchema alias behind", async () => {
    await assetListResponseSchemaAndNoOldNameSurvives();
  });
});
