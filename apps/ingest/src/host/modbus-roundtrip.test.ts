import { describe, it } from "vitest";

import {
  assertALostServerIsReconnected,
  assertTheCloudWiringReadsTheMappedPoints,
  assertTheEdgeWiringReadsEveryRegister,
} from "./modbus-roundtrip.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the Modbus path end to end on a local socket (plan T4.4)", () => {
  it("M1 the cloud wiring reads the mapped points and drops none as unmapped", async () => {
    await assertTheCloudWiringReadsTheMappedPoints();
  }, 20_000);
  it("M2 the edge wiring reads every register", async () => {
    await assertTheEdgeWiringReadsEveryRegister();
  }, 20_000);
  it("M3 a lost server is reconnected through the backoff", async () => {
    await assertALostServerIsReconnected();
  }, 30_000);
});
