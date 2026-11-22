import { describe, it } from "vitest";

import {
  assertAnUnknownKeyIsFixedTextAtCommit,
  assertAnUnparsableModbusConfigIsTheValidation400,
  assertIngestIsKeptForMqttAndForABoundModbusRtuOnly,
  assertOnlyModbusRtusAreReadWithACanonicalEndpoint,
} from "./onboarding-commit-modbus.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 PR 11 — the onboarding commit's Modbus step (ADR 0141 decision 23)", () => {
  it("CM1 reads only Modbus RTUs, with a canonical endpoint", () => assertOnlyModbusRtusAreReadWithACanonicalEndpoint());
  it("CM2 answers an unparsable Modbus config with the validation 400", () =>
    assertAnUnparsableModbusConfigIsTheValidation400());
  it("CM2b forwards an unknown key as fixed text (review L2)", () => assertAnUnknownKeyIsFixedTextAtCommit());
  it("CM3 keeps ingest for MQTT and a bound Modbus RTU only", () => assertIngestIsKeptForMqttAndForABoundModbusRtuOnly());
});
