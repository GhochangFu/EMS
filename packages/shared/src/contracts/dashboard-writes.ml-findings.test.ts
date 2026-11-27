import { describe, it } from "vitest";

import {
  acceptsAnMlFindingsWidget,
  refusesAnMlFindingsBinding,
  refusesAnMlFindingsConfigOutsideItsTwoKeys,
} from "./dashboard-writes.ml-findings.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9f — the ml_findings widget write arm (ADR 0135 Amendment 8 decision 13)", () => {
  it("has a write arm, last, and accepts {}, show only and paragraph only", () => {
    acceptsAnMlFindingsWidget();
  });

  it("refuses an unknown config key and an unknown show value", () => {
    refusesAnMlFindingsConfigOutsideItsTwoKeys();
  });

  it("refuses any point and any source", () => {
    refusesAnMlFindingsBinding();
  });
});
