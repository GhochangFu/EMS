import { describe, it } from "vitest";

import {
  aMalformedInputIsA400,
  aTenantAdminIsRefusedEveryWriteFirst,
  theTestResponseNarrowsBuiltinValues,
  theTestRouteDecodesAndStoresNothing,
} from "./mqtt-payload-formats.service.gates.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.334 — the payload format service gates and test route (ADR 0116 decision 5)", () => {
  it("G1 refuses a tenant admin every write and the test route, before any read", async () => aTenantAdminIsRefusedEveryWriteFirst());
  it("G2 answers 400 to a malformed body or code before any read", async () => aMalformedInputIsA400());
  it("G3 decodes the BCPL sample on the test route and stores nothing", async () => theTestRouteDecodesAndStoresNothing());
  it("G4 narrows the built-in kind's values to numbers or null", () => theTestResponseNarrowsBuiltinValues());
});
