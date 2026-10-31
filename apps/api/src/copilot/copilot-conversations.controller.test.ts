import "reflect-metadata";

import { describe, it } from "vitest";

import {
  aBeforeQueryGetsTheDefaultLimit,
  aLimitQueryReachesTheServiceAsAPage,
  aMissingCursorIs404,
  anEarlierPageAnswersNoWait,
  anEarlierPageNeverReadsTheLatestChange,
  anEmptyQueryPassesNoPage,
  aNonUuidBeforeIs400,
  aZeroLimitIs400,
  theNewestPageStillCarriesTheWait,
  aJsonTurnWithoutWizardsIs400,
  aMalformedMultipartWizardsFieldIs400,
  aWizardTheCatalogRefusesIs400,
  assertTheDetailAlwaysCarriesTheAwaitingFollowUpKey,
  assertTheDetailCarriesTheAwaitingFollowUp,
  assertTheDetailCarriesTheOpenChanges,
  assertABadBodyIs400,
  assertAJsonTurnPassesNoFiles,
  assertAMultipartTurnPassesTheFiles,
  assertTheTurnRouteDeclaresTheFilesInterceptor,
  assertANonUuidIdIs404,
  assertATurnBodyNamingAnOrganizationIs400,
  assertATurnOnANonUuidIdIs404,
  assertTheTurnRouteAnswers200,
  assertTheTurnRoutePassesTheCallerAndTheMessage,
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

describe("F3.85 — POST /copilot/conversations/:id/turns (ADR 0099 decisions 1, 9, 10, plan section 9 PR 7)", () => {
  it("passes the caller, the id and the message to the turn service", () =>
    assertTheTurnRoutePassesTheCallerAndTheMessage());
  it("answers a body naming an organization, an empty or an over-long message with a 400", () =>
    assertATurnBodyNamingAnOrganizationIs400());
  it("answers a non-uuid id with a 404", () => assertATurnOnANonUuidIdIs404());
  it("answers 200", () => assertTheTurnRouteAnswers200());
  it("F3.87 PR 7: a JSON turn passes no files", () => assertAJsonTurnPassesNoFiles());
  it("F3.87 PR 7: a multipart turn passes its message and files", () => assertAMultipartTurnPassesTheFiles());
  it("F4.245: a JSON turn without wizards is a 400", () => aJsonTurnWithoutWizardsIs400());
  it("F4.245: a wizard the catalog refuses is a 400", () => aWizardTheCatalogRefusesIs400());
  it("F4.245: a malformed multipart wizards field is a 400", () => aMalformedMultipartWizardsFieldIs400());
  it("F3.87 PR 7: the route declares the files interceptor", () => assertTheTurnRouteDeclaresTheFilesInterceptor());
  it("F3.85 PR 8: the detail carries the conversation's open changes", async () => {
    await assertTheDetailCarriesTheOpenChanges();
  });
  it("F4.244: the detail carries the awaited follow-up", async () => {
    await assertTheDetailCarriesTheAwaitingFollowUp();
  });
  it("F4.244: the detail always carries the awaitingFollowUp key", async () => {
    await assertTheDetailAlwaysCarriesTheAwaitingFollowUpKey();
  });
});

describe("F4.292 — the detail route parses before/limit (ADR 0099 Amendment 9 E7)", () => {
  it("a limit query reaches the service as a page", () => aLimitQueryReachesTheServiceAsAPage());
  it("a before query gets the default limit of 50", () => aBeforeQueryGetsTheDefaultLimit());
  it("an empty query passes no page", () => anEmptyQueryPassesNoPage());
  it("a limit of 0 is a 400", () => aZeroLimitIs400());
  it("a non-uuid before is a 400", () => aNonUuidBeforeIs400());
  it("a cursor the service does not find is a 404", () => aMissingCursorIs404());
  it("an earlier page answers awaitingFollowUp null", () => anEarlierPageAnswersNoWait());
  it("an earlier page never reads latestFinished", () => anEarlierPageNeverReadsTheLatestChange());
  it("the newest page still carries the wait", () => theNewestPageStillCarriesTheWait());
});
