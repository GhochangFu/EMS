import { describe, it } from "vitest";

import {
  aBinaryFrameOnAnEnvelopeTopicIsNotJson,
  aPooledFrameDecodes,
  aShortFrameLogsNoBytes,
  oversizeIsRefusedFirst,
  theGoatFrameEmitsItsReadings,
  theVapFaultCodesAreReportedAbsent,
} from "./mqtt-binary-payload-format.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("MQTT adapter — binary payload formats (ADR 0119 decision 3)", () => {
  it("B1 emits the GOAT readings with the device time", async () => theGoatFrameEmitsItsReadings());
  it("B1b decodes a frame inside a pooled buffer", async () => aPooledFrameDecodes());
  it("B2 logs a short frame without its bytes", async () => aShortFrameLogsNoBytes());
  it("B3 reports the VAP fault codes as absent readings", async () => theVapFaultCodesAreReportedAbsent());
  it("B4 reads a binary frame on an envelope topic as not JSON", async () => aBinaryFrameOnAnEnvelopeTopicIsNotJson());
  it("B5 refuses oversize before decoding", async () => oversizeIsRefusedFirst());
});
