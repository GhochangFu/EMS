import { describe, it } from "vitest";

import { anotherHashFindsNothing, aRememberedFileIsFoundByItsHash, theHashIsLowerCaseHex } from "./copilot-file-memory.spec";

/** `F4.283` — Vitest entry point for the kept files. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.283 — the tab keeps the attached files by SHA-256 (ADR 0099 Amendment 8 Q19)", () => {
  it("the hash is lower-case hex", () => theHashIsLowerCaseHex());
  it("a remembered file is found by its hash", () => aRememberedFileIsFoundByItsHash());
  it("another hash finds nothing", () => anotherHashFindsNothing());
});
