import { describe, it } from "vitest";

import {
  runKnownNoticeTest,
  runNoRowSettingTest,
  runUnknownBuiltinKeyTest,
  runUnknownKindTest,
  runUnknownNoticeTest,
} from "./site-control-room-views.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.67 — site Control Room view contracts (ADR 0076 decisions 3–5)", () => {
  it("C1 — accepts the no-row shape (kind: generated, every optional field null)", () => {
    runNoRowSettingTest();
  });

  it("C2 — rejects a setting with an unknown kind", () => {
    runUnknownKindTest();
  });

  it("C3a — rejects an unknown fail-safe notice", () => {
    runUnknownNoticeTest();
  });

  it("C3b — accepts dashboard_removed as a known fail-safe notice", () => {
    runKnownNoticeTest();
  });

  it("C4 — rejects an unknown built-in view key", () => {
    runUnknownBuiltinKeyTest();
  });
});
