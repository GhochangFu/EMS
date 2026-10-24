import { describe, it } from "vitest";

import {
  aCsvOfFiveMebibytesIsAccepted,
  aCsvOverFiveMebibytesIsRefused,
  anXlsxOverFiveMebibytesIsRefused,
  aSixMebibytePngIsStillAccepted,
} from "./copilot-attachments.spec";

/** `F4.283` — Vitest entry point for the dock's picker checks. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.283 — the picker takes a CSV or XLSX up to 5 MiB (ADR 0099 Amendment 8 Q20)", () => {
  it("accepts a CSV of exactly 5 MiB", () => aCsvOfFiveMebibytesIsAccepted());
  it("refuses a CSV over 5 MiB", () => aCsvOverFiveMebibytesIsRefused());
  it("refuses an XLSX over 5 MiB", () => anXlsxOverFiveMebibytesIsRefused());
  it("still accepts a 6 MiB PNG", () => aSixMebibytePngIsStillAccepted());
});
