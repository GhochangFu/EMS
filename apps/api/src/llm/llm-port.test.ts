import { describe, it } from "vitest";

import {
  assertAStringIsItsOwnText,
  assertNoTextPartIsEmptyText,
  assertTextPartsAreJoinedAndFilePartsDropped,
} from "./llm-port.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("textOfContent (F3.87, ADR 0099 Amendment 3 A5)", () => {
  it("returns a string content as it is", () => {
    assertAStringIsItsOwnText();
  });

  it("joins the text parts and drops the file parts", () => {
    assertTextPartsAreJoinedAndFilePartsDropped();
  });

  it("gives empty text for parts with no text part", () => {
    assertNoTextPartIsEmptyText();
  });
});
