import { describe, it } from "vitest";

import {
  aBrokenRowFailsTheParse,
  aLocationAdminLists,
  anAssetGroupAdminIsRefusedBeforeTheService,
  anOrganizationOutsideTheAllowedSetIsRefused,
  aRowCarriesTheUpdateFields,
  aRowOfAnotherOrganizationIsDropped,
  fortyRowsAreCutToTheCap,
  searchNarrowsBeforeTheCap,
  theServiceIsCalledOnce,
} from "./report-read-tools.spec";

/** `F4.280` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.280 — list_report_schedules (ADR 0099 Amendment 8 D7)", () => {
  it("refuses an asset_group_admin before the service", () => anAssetGroupAdminIsRefusedBeforeTheService());
  it("lists for a location_admin", () => aLocationAdminLists());
  it("refuses an organization outside the allowed set", () => anOrganizationOutsideTheAllowedSetIsRefused());
  it("drops a row of another organization", () => aRowOfAnotherOrganizationIsDropped());
  it("returns the fields the update needs", () => aRowCarriesTheUpdateFields());
  it("cuts forty rows to the cap and marks truncated", () => fortyRowsAreCutToTheCap());
  it("narrows by search before the cap", () => searchNarrowsBeforeTheCap());
  it("calls the service once", () => theServiceIsCalledOnce());
  it("fails a row that breaks its contract", () => aBrokenRowFailsTheParse());
});
