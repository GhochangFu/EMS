import { describe, it } from "vitest";

import {
  firstTabOfEveryAreaIsVisibleWithTheArea,
  gatesTheSymbolLibrariesTab,
  gatesTheUsersTab,
  givesEveryAdminRouteAnArea,
  groupsEveryTabIntoItsArea,
  hidesTheChannelTabsAndUsersAreaFromALocationAdmin,
  keepsOnlyTheVisibleTabsInAnArea,
  linksEachAreaToItsFirstVisibleTab,
  listsTheTabsAreaByArea,
  selectsTheTabOfEachRoute,
  showsFiveAreasToAnOrganizationAdmin,
  showsFiveAreasToTheGlobalAdmin,
} from "./master-data-areas.spec";

/** Vitest entry point — see `apps/api/src/admin/admin.schema.test.ts` (ADR 0014). */
describe("F3.76 master data areas", () => {
  it("A1 groups every tab into its area, in order", () => {
    groupsEveryTabIntoItsArea();
  });

  it("A2 lists the tabs area by area", () => {
    listsTheTabsAreaByArea();
  });

  it("A3a shows six areas to the global admin", () => {
    showsFiveAreasToTheGlobalAdmin();
  });

  it("A3b shows six areas to an organization_admin", () => {
    showsFiveAreasToAnOrganizationAdmin();
  });

  it("A3c hides Users & Access and the channel tabs from a location_admin (F4.359: Maintenance Windows shows)", () => {
    hidesTheChannelTabsAndUsersAreaFromALocationAdmin();
  });

  it("A4 keeps only the visible tabs in an area", () => {
    keepsOnlyTheVisibleTabsInAnArea();
  });

  it("A5 links each area to its first visible tab", () => {
    linksEachAreaToItsFirstVisibleTab();
  });

  it("A5b opens every area at its first tab, for every master-data role", () => {
    firstTabOfEveryAreaIsVisibleWithTheArea();
  });

  it("A6 gates the Symbol Libraries tab like the page", () => {
    gatesTheSymbolLibrariesTab();
  });

  it("A7 gates the Users tab like the page", () => {
    gatesTheUsersTab();
  });

  it("R1 selects the tab whose table each route shows", () => {
    selectsTheTabOfEachRoute();
  });

  it("R2 gives every admin route in app.tsx an area", () => {
    givesEveryAdminRouteAnArea();
  });
});
