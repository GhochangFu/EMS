import "reflect-metadata";

import { describe, it } from "vitest";

import {
  assertABadBodyIs400,
  assertANonUuidIdIs404,
  assertAScopedAdminBindsTheHomeOrganization,
  assertEveryRouteSweepsForTheCaller,
  assertTheControllerCarriesBothGuards,
  assertTheControllerTouchesNoDatabase,
  assertTheGlobalAdminCannotBindAMissingOrOffOrganization,
  assertTheGlobalAdminChoosesTheBinding,
  assertTheGuardAdmitsAndAsksAboutTheDefaultOrganization,
  assertTheGuardRefusesWithA403,
} from "./copilot-conversations.controller.spec";

describe("F3.85 — /copilot/conversations (ADR 0099 decision 8, plan section 7 PR 5)", () => {
  it("binds a scoped admin's conversation to the home organization", () => assertAScopedAdminBindsTheHomeOrganization());
  it("lets the global admin choose null or an organization", () => assertTheGlobalAdminChoosesTheBinding());
  it("refuses a missing organization (404) and one the copilot is off for (403)", () =>
    assertTheGlobalAdminCannotBindAMissingOrOffOrganization());
  it("answers a bad body with a 400", () => assertABadBodyIs400());
  it("sweeps the caller's stuck changes at the start of every route", () => assertEveryRouteSweepsForTheCaller());
  it("answers a non-uuid id with a 404", () => assertANonUuidIdIs404());
  it("the guard refuses with a 403", () => assertTheGuardRefusesWithA403());
  it("the guard admits and asks about the default organization", () =>
    assertTheGuardAdmitsAndAsksAboutTheDefaultOrganization());
  it("the controller carries the JWT guard and the copilot guard", () => assertTheControllerCarriesBothGuards());
  it("the controller injects no database pool; the service owns the queries", () =>
    assertTheControllerTouchesNoDatabase());
});
