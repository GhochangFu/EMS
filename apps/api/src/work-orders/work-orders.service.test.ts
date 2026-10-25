import { describe, it } from "vitest";

import { aPlainSearchIsASubstring, theLikeMetacharactersAreEscaped } from "./work-orders.service.spec";

/** `F4.284` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.284 — the work-order title search is literal (DC7)", () => {
  it("a plain search is a substring pattern", () => aPlainSearchIsASubstring());
  it("escapes the LIKE metacharacters", () => theLikeMetacharactersAreEscaped());
});
