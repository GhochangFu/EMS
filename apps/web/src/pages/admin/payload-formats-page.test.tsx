// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aTenantAdminSeesTheStatusLine,
  anInUseDeleteListsTheRtus,
  invalidJsonIsRefused,
  theBuiltinRowHasNoControl,
  theTestBoxDecodesTheSample,
} from "./payload-formats-page.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.334 — the Payload Formats page (plan T5.2)", () => {
  it("P1 fails closed for a tenant admin", aTenantAdminSeesTheStatusLine);
  it("P2 gives the built-in row no control", theBuiltinRowHasNoControl);
  it("P3 refuses a definition that is not JSON", invalidJsonIsRefused);
  it("P4 decodes a sample in the test box", theTestBoxDecodesTheSample);
  it("P5 lists the RTUs of an in-use delete", anInUseDeleteListsTheRtus);
});
