import { describe, it } from "vitest";

import {
  aMalformedHeaderIsA400,
  aQuotedInstantParsesToTheBareInstant,
  noHeaderAddsNoPredicate,
  noHeaderParsesToUndefined,
  noRowWithAHeaderIsA412,
  noRowWithoutAHeaderIsTheRoutes404,
  theAssetTemplateUpdateHandlerTakesIfMatch,
  theEscalationProfileUpdateHandlerTakesIfMatch,
  thePredicateComparesTheStampAsText,
  thePutWidgetsHandlerTakesIfMatch,
} from "./if-match.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.247 — the If-Match helpers and their wiring (ADR 0099 Amendment 5 C3)", () => {
  it("parses no header to undefined", () => noHeaderParsesToUndefined());
  it("parses a quoted instant to the bare instant", () => aQuotedInstantParsesToTheBareInstant());
  it("refuses a malformed header with 400", () => aMalformedHeaderIsA400());
  it("adds no predicate without a header", () => noHeaderAddsNoPredicate());
  it("compares the stamp as text, never a cast", () => thePredicateComparesTheStampAsText());
  it("answers the route's 404 when no row was written and no header was sent", () => noRowWithoutAHeaderIsTheRoutes404());
  it("answers 412 when no row was written and a header was sent", () => noRowWithAHeaderIsA412());
  it("wires @Headers(\"if-match\") into PUT /dashboards/:id/widgets", () => thePutWidgetsHandlerTakesIfMatch());
  it("wires @Headers(\"if-match\") into PATCH /admin/asset-templates/:id", () => theAssetTemplateUpdateHandlerTakesIfMatch());
  it("wires @Headers(\"if-match\") into PATCH /admin/escalation-profiles/:id", () => theEscalationProfileUpdateHandlerTakesIfMatch());
});
