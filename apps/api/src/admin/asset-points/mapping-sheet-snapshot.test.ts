import { describe, it } from "vitest";

import { assertKeysAreOwnerScoped, assertStoredTextReadsBlankAsNull } from "./mapping-sheet-snapshot.spec";

describe("F2.7 — mapping-sheet snapshot helpers", () => {
  it("reads an empty stored text as null so the round trip stays an identity", () => {
    assertStoredTextReadsBlankAsNull();
  });

  it("scopes the two map keys to their owner", () => {
    assertKeysAreOwnerScoped();
  });
});
