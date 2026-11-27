import { describe, it } from "vitest";

import {
  runABoundRowReadsItsSummary,
  runANonModbusRowIsNull,
  runAnUnboundRowReadsLeniently,
} from "./rtu-connection-modbus.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the admin RTU row's modbus field (plan T7.1)", () => {
  it("D1 — a bound row reads its summary, never the register list", () => runABoundRowReadsItsSummary());
  it("D2 — an unbound or malformed row reads leniently", () => runAnUnboundRowReadsLeniently());
  it("D3 — no row, or another protocol, is null", () => runANonModbusRowIsNull());
});
