import { describe, it } from "vitest";

import {
  aCodeIsAnExactOrPrefixMatch,
  aDomainIsAnExactMatch,
  aForbiddenOrganizationIsSkipped,
  aLongListIsTruncated,
  anotherErrorIsRethrown,
  aRowIsTheEightFields,
  aStatusIsPassedThrough,
  rowsAreOrderedByOrganizationCodeAndVersion,
  theDefaultStatusIsPublished,
  theResultNamesTheOrganizationsItHolds,
  theToolTakesCodeDomainAndStatus,
} from "./asset-template-read-tools.spec";

/** `F4.315` PR A — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.315 PR A — list_asset_templates (ADR 0099 Amendment 14 decision 1)", () => {
  it("asks the published versions when no status is given", () => theDefaultStatusIsPublished());
  it("passes a status through", () => aStatusIsPassedThrough());
  it("matches a code exactly or by prefix, case-insensitive", () => aCodeIsAnExactOrPrefixMatch());
  it("matches a domain exactly", () => aDomainIsAnExactMatch());
  it("skips an organization the caller may not manage", () => aForbiddenOrganizationIsSkipped());
  it("re-throws any other error of the list", () => anotherErrorIsRethrown());
  it("maps a row to exactly the eight fields", () => aRowIsTheEightFields());
  it("orders by organization code, code, then version newest first", () => rowsAreOrderedByOrganizationCodeAndVersion());
  it("names the organizations whose rows it holds", () => theResultNamesTheOrganizationsItHolds());
  it("keeps what fits a long list and says truncated", () => aLongListIsTruncated());
  it("takes only code, domain and status", () => theToolTakesCodeDomainAndStatus());
});
