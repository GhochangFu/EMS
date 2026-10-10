import { describe, it } from "vitest";

import {
  assertADenyExceptionNarrowsTheOrganizationAdmin,
  assertADenyExceptionRefusesUnderARoleSwitchedOn,
  assertANewOrganizationIsOffForEveryAdministrator,
  assertARoleSwitchWithNoRowIsOn,
  assertARoleSwitchedOffIsRefused,
  assertAScopedAdministratorOfAIsRefusedForBWithNoRead,
  assertAScopedAdministratorWithNoHomeOrganizationIsRefused,
  assertAScopedAdministratorWithNoOrganizationIsRefused,
  assertAnAllowExceptionDoesNotSurviveADemotion,
  assertAnAllowExceptionReEnablesUnderARoleSwitchedOff,
  assertAnUnprovisionedTokenIsRefusedWithNoRead,
  assertEveryReadIsBoundToTheAskedOrganization,
  assertOperatorsAndViewersAreRefusedByRoleWithNoRead,
  assertTheGlobalAdminIsAvailableAcrossOrganizations,
  assertTheOrganizationAdminFollowsTheOrganizationSwitch,
  assertTheOrganizationSwitchBeatsAnAllowException,
  assertTheOrganizationSwitchBindsTheGlobalAdmin,
} from "./copilot-availability.spec";

describe("F3.85 — who may use the copilot (ADR 0099 decision 5, plan §5.2 and Q2)", () => {
  it("refuses a token with no user row, reading nothing", () => assertAnUnprovisionedTokenIsRefusedWithNoRead());
  it("refuses operators and viewers by role, reading nothing", () =>
    assertOperatorsAndViewersAreRefusedByRoleWithNoRead());
  it("lets the global admin hold a cross-organization conversation", () =>
    assertTheGlobalAdminIsAvailableAcrossOrganizations());
  it("binds the global admin to an organization's switch inside it", () =>
    assertTheOrganizationSwitchBindsTheGlobalAdmin());
  it("keeps a new organization off for every administrator in it", () =>
    assertANewOrganizationIsOffForEveryAdministrator());
  it("refuses a scoped administrator of A asked about B, reading no switch", () =>
    assertAScopedAdministratorOfAIsRefusedForBWithNoRead());
  it("refuses a scoped administrator with no organization", () =>
    assertAScopedAdministratorWithNoOrganizationIsRefused());
  it("refuses a scoped administrator with no home organization", () =>
    assertAScopedAdministratorWithNoHomeOrganizationIsRefused());
  it("follows the organization switch for the organization admin", () =>
    assertTheOrganizationAdminFollowsTheOrganizationSwitch());
  it("narrows the organization admin with a deny exception", () =>
    assertADenyExceptionNarrowsTheOrganizationAdmin());
  it("treats a role switch with no row as on", () => assertARoleSwitchWithNoRowIsOn());
  it("refuses a role switched off, and only that role", () => assertARoleSwitchedOffIsRefused());
  it("re-enables a user under a role switched off with an allow exception", () =>
    assertAnAllowExceptionReEnablesUnderARoleSwitchedOff());
  it("refuses a user under a role switched on with a deny exception", () =>
    assertADenyExceptionRefusesUnderARoleSwitchedOn());
  it("lets the organization switch beat an allow exception", () =>
    assertTheOrganizationSwitchBeatsAnAllowException());
  it("does not let an allow exception survive a demotion", () => assertAnAllowExceptionDoesNotSurviveADemotion());
  it("binds every read to the organization asked about", () => assertEveryReadIsBoundToTheAskedOrganization());
});
