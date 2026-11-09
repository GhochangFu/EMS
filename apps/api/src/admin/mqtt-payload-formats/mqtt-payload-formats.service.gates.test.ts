import { describe, it } from "vitest";

import {
  aMalformedInputIsA400,
  aTenantAdminIsRefusedEveryWriteFirst,
  theTestResponseNarrowsBuiltinValues,
  theTestRouteDecodesAndStoresNothing,
  theTestRouteTakesHex,
} from "./mqtt-payload-formats.service.gates.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.334 — the payload format service gates and test route (ADR 0116 decision 5)", () => {
  it("G1 refuses a tenant admin every write and the test route, before any read", async () => aTenantAdminIsRefusedEveryWriteFirst());
  it("G2 answers 400 to a malformed body or code before any read", async () => aMalformedInputIsA400());
  it("G3 decodes the BCPL sample on the test route and stores nothing", async () => theTestRouteDecodesAndStoresNothing());
  it("G4 narrows the built-in kind's values to numbers or null", () => theTestResponseNarrowsBuiltinValues());
});

describe("F4.343 — the test route takes a hex sample (ADR 0119 decision 5)", () => {
  it("G5 decodes a hex sample with a binary format and refuses bad hex with a fixed 400", async () =>
    theTestRouteTakesHex());
});
