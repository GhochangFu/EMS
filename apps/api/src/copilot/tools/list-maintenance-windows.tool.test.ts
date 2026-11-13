import "reflect-metadata";

import { describe, it } from "vitest";

import {
  aFullOrganizationIsTruncated,
  anItemCarriesWhatAWriteNames,
  anOrganizationOutsideTheTurnIsRefused,
  oneCallPerAllowedOrganizationWithTheFilters,
  theAdminPassesTheUnrestrictedScope,
  theToolPassesTheCallersReadableSets,
} from "./list-maintenance-windows.tool.spec";

/** `F4.359` PR 6 — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.359 — list_maintenance_windows (ADR 0099 Amendment 19 decision 6, Q3)", () => {
  it("passes the caller's readable sets and subtree grant", () => theToolPassesTheCallersReadableSets());
  it("passes the unrestricted scope for the admin", () => theAdminPassesTheUnrestrictedScope());
  it("calls once per allowed organization with the filters", () => oneCallPerAllowedOrganizationWithTheFilters());
  it("refuses an organization outside the turn before any read", () => anOrganizationOutsideTheTurnIsRefused());
  it("an item carries what a write names", () => anItemCarriesWhatAWriteNames());
  it("a full organization is truncated", () => aFullOrganizationIsTruncated());
});
