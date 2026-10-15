import { describe, it } from "vitest";

import {
  anAbsentFieldReadsAsTheStoreWritesIt,
  theFixturesAreRouteBodies,
  theFlowBodyRoundTrips,
  theHtLtBodyRoundTrips,
} from "./mimic-editor.write-body.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 5 — editorLayoutFromWriteBody", () => {
  it("takes fixtures the route accepts", () => theFixturesAreRouteBodies());
  it("round-trips the F3.80 HT/LT body", () => theHtLtBodyRoundTrips());
  it("round-trips the F3.80 flow body", () => theFlowBodyRoundTrips());
  it("reads an absent field as the store writes it", () => anAbsentFieldReadsAsTheStoreWritesIt());
});
