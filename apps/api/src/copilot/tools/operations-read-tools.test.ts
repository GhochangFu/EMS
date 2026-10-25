import { describe, it } from "vitest";

import {
  listUsersListsIdNameAndRole,
  listUsersListsOnlyTheOrganizationsActiveUsers,
  listUsersNeverShowsAnEmail,
  listUsersRefusesAnOrganizationOutsideTheScope,
  listWorkOrdersCapsAt25,
  listWorkOrdersFiltersByStatus,
  listWorkOrdersNamesTheOrganizationsItRead,
  listWorkOrdersReadsEachOrganizationWithItsAssets,
  listWorkOrdersRefusesAnOrganizationOutsideTheScope,
  listWorkOrdersSearchesInTheService,
} from "./operations-read-tools.spec";

/** `F4.284` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.284 — list_work_orders and list_users (ADR 0106; DC1, DC7)", () => {
  it("One call per allowed organization, each with that organization's readable assets.", () => listWorkOrdersReadsEachOrganizationWithItsAssets());
  it("The result names the organizations it read, and their items.", () => listWorkOrdersNamesTheOrganizationsItRead());
  it("DC7: search reaches the service as titleSearch, so a match past the 100-row cap is found.", () => listWorkOrdersSearchesInTheService());
  it("DC7: a status filter reaches the service and narrows.", () => listWorkOrdersFiltersByStatus());
  it("The items are cut at 25, and truncated says there are more.", () => listWorkOrdersCapsAt25());
  it("An organization outside the turn's scope is refused, and nothing is read.", () => listWorkOrdersRefusesAnOrganizationOutsideTheScope());
  it("DC1: a user row holds id, displayName and role.", () => listUsersListsIdNameAndRole());
  it("DC1: an email address never reaches the model.", () => listUsersNeverShowsAnEmail());
  it("DC1: a global admin, a disabled account and another organization's user are not listed.", () => listUsersListsOnlyTheOrganizationsActiveUsers());
  it("An organization outside the turn's scope is refused.", () => listUsersRefusesAnOrganizationOutsideTheScope());
});
