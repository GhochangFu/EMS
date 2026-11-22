import { describe, it } from "vitest";

import {
  runABadBindBodyIsRefused,
  runTheBindBodyPasses,
  runTheBindIntervalIsTheSharedBound,
  runTheOrganizationBodyIsBounded,
  runTheOrganizationDtoRequiresTheDefault,
  runTheRtuDtoRequiresTheModbusFields,
} from "./rtu-modbus.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — RTU Modbus bind and organization poll interval contracts (ADR 0141 decisions 10, 15)", () => {
  it("M1 — the bind body passes, and the host is lower-cased", () => runTheBindBodyPasses());
  it("M2 — the bind interval is required and is the shared bound", () => runTheBindIntervalIsTheSharedBound());
  it("M3 — a bad scalar, a register list or an extra key is refused", () => runABadBindBodyIsRefused());
  it("M4 — the organization default body is bounded, nullable and strict", () => runTheOrganizationBodyIsBounded());
  it("M5 — the RTU DTO requires modbus and the organization default", () => runTheRtuDtoRequiresTheModbusFields());
  it("M6 — the organization DTO requires defaultPollIntervalMs", () => runTheOrganizationDtoRequiresTheDefault());
});
