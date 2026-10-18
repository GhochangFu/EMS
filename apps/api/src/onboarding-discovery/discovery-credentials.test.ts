import { describe, it } from "vitest";

import {
  assertControlCharPasswordIsRefused,
  assertControlCharUsernameIsRefused,
  assertCrLfIsAControlChar,
  assertNulAndDelAreControlChars,
  assertOnlyStringFieldsAreRead,
  assertPrintableIsNotAControlChar,
} from "./discovery-credentials.spec";

/** `F3.24b` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F3.24b — discovery credentials", () => {
  it("CR LF is a control character", () => assertCrLfIsAControlChar());
  it("NUL and DEL are control characters", () => assertNulAndDelAreControlChars());
  it("a printable value passes", () => assertPrintableIsNotAControlChar());
  it("refuses a password with a newline", () => assertControlCharPasswordIsRefused());
  it("refuses a username with a CR", () => assertControlCharUsernameIsRefused());
  it("reads only string username and password", () => assertOnlyStringFieldsAreRead());
});
