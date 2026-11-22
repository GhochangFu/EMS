import { describe, it } from "vitest";

import {
  runBadScalarsAreRefused,
  runServerFieldsAreRefused,
  runTheBodiesPass,
  runTheRegisterBoundIsTheSharedOne,
  runTheResponsesAreOpenAndComplete,
} from "./device-profiles.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — device profile contracts (ADR 0141 decisions 12–14)", () => {
  it("B1 — each body passes as written", () => runTheBodiesPass());
  it("B2 — a server-set field in a body is refused (.strict())", () => runServerFieldsAreRefused());
  it("B3 — the register list is the shared 1-to-256 schema", () => runTheRegisterBoundIsTheSharedOne());
  it("B4 — a bad code, base version or organization id is refused", () => runBadScalarsAreRefused());
  it("B5 — the responses are not strict and require the server fields", () => runTheResponsesAreOpenAndComplete());
});
