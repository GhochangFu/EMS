import { describe, it } from "vitest";

import {
  aFormatFailureLogsNoPayload,
  anUnformattedTopicStillDecodesTheEnvelope,
  decodedRecordsKeepTheTopicCheck,
  oversizeIsRefusedBeforeDecoding,
  theBcplSampleEmitsTwoReadings,
} from "./mqtt-payload-format.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("MQTT adapter — payload formats per topic (ADR 0116 decision 6)", () => {
  it("A1 emits the two BCPL readings with the device time", async () => theBcplSampleEmitsTwoReadings());
  it("A2 logs a format failure without the payload", async () => aFormatFailureLogsNoPayload());
  it("A3 keeps the F1.7 topic check for decoded records", async () => decodedRecordsKeepTheTopicCheck());
  it("A4 decodes an unformatted topic as the PHE envelope", async () => anUnformattedTopicStillDecodesTheEnvelope());
  it("A5 refuses oversize before decoding", async () => oversizeIsRefusedBeforeDecoding());
});
