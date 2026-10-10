import { describe, it } from "vitest";

import {
  writeLeavesTheRowAloneOutsideACopilotChange,
  writeManyLeavesRowsAloneOutsideACopilotChange,
  writeManyMarksEveryRow,
  writeMarksANullPayloadToo,
  writeMarksARowInsideACopilotChange,
} from "./master-data-audit.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 — the copilot mark on master-data audit rows (ADR 0099 decision 4.5)", () => {
  it("marks a row written inside a copilot change", () => writeMarksARowInsideACopilotChange());
  it("marks a row whose payload is absent", () => writeMarksANullPayloadToo());
  it("leaves the payload unchanged outside a copilot change", () => writeLeavesTheRowAloneOutsideACopilotChange());
  it("marks every row of writeMany", () => writeManyMarksEveryRow());
  it("leaves writeMany's rows unchanged outside a copilot change", () =>
    writeManyLeavesRowsAloneOutsideACopilotChange());
});
