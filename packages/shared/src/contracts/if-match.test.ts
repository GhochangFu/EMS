import { describe, it } from "vitest";

import {
  aListOfTagsIsRefused,
  anInstantWithoutMillisecondsIsRefused,
  anUnquotedInstantIsRefused,
  aPendingChangeCarriesItsIfMatch,
  aPendingChangeWithoutIfMatchIsRefused,
  aQuotedInstantParsesToTheBareInstant,
  aQuotedNonInstantIsRefused,
  aStarIsRefused,
  aWeakTagIsRefused,
} from "./if-match.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.247 — the If-Match header and the pending change's ifMatch (ADR 0099 Amendment 5)", () => {
  it("parses a quoted ms instant to the bare instant", () => aQuotedInstantParsesToTheBareInstant());
  it("refuses a weak tag", () => aWeakTagIsRefused());
  it("refuses *", () => aStarIsRefused());
  it("refuses an unquoted instant", () => anUnquotedInstantIsRefused());
  it("refuses a quoted non-instant", () => aQuotedNonInstantIsRefused());
  it("refuses an instant without milliseconds", () => anInstantWithoutMillisecondsIsRefused());
  it("refuses a list of tags", () => aListOfTagsIsRefused());
  it("refuses a pending change without ifMatch", () => aPendingChangeWithoutIfMatchIsRefused());
  it("keeps a pending change's ifMatch, null or a string", () => aPendingChangeCarriesItsIfMatch());
});
