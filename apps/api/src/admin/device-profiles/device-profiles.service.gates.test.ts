import { describe, it } from "vitest";

import {
  aLocationAdminIsRefusedEveryWriteFirst,
  aMalformedInputIsA400BeforeAnyRead,
  anOrganizationOutOfReachIsA404BeforeAnyRead,
  aViewerIsRefusedTheReadsFirst,
  theStockListAndAnUnknownCode,
} from "./device-profiles.service.gates.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the device profile service gates (ADR 0141 decisions 12–14)", () => {
  it("G1 refuses a location admin every write with 403, before any parse or read", async () => aLocationAdminIsRefusedEveryWriteFirst());
  it("G2 refuses a viewer the reads with 403, before any parse", async () => aViewerIsRefusedTheReadsFirst());
  it("G3 answers 400 to a malformed body, id, code or query, and to 257 registers, before any read", async () =>
    aMalformedInputIsA400BeforeAnyRead());
  it("G4 answers 404 for an organization out of reach, before any read", async () => anOrganizationOutOfReachIsA404BeforeAnyRead());
  it("G5 lists the stock without a read and answers 404 to an unknown stock code", async () => theStockListAndAnUnknownCode());
});
