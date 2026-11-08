import { describe, it } from "vitest";

import {
  aChosenCodeWithNoRowChangesNothing,
  anInvalidRowIsLeftOutByCode,
  theChosenFormatGoesFirst,
  theOrderIsKeptWithNoChoice,
} from "./discovery-formats.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.334 — the discovery catalog read (ADR 0116 decision 8)", () => {
  it("keeps the query order with no chosen format", async () => theOrderIsKeptWithNoChoice());
  it("moves the chosen format first", async () => theChosenFormatGoesFirst());
  it("changes nothing for a chosen code with no row", async () => aChosenCodeWithNoRowChangesNothing());
  it("leaves an invalid row out and names it by code", async () => anInvalidRowIsLeftOutByCode());
});
