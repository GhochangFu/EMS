import { describe, it } from "vitest";

import * as spec from "./report-schedules.controller.spec";

/** `F3.5b` — `ReportSchedulesController`. Assertions live in the sibling `.spec.ts` (§4.6). */
describe("F3.5b ReportSchedulesController — create: the parse is the gate", () => {
  it("an unknown key (nextRunAt) is a 400 before the service", spec.assertCreateRefusesAnUnknownKeyBeforeTheService);
  it("Not/AZone is a 400 whose fieldErrors.timezone carries the R-6 sentence", spec.assertCreateRefusesAnUnknownZoneNamingTheField);
  it("asia/kolkata is a 400 (the amended R-6 segment casing)", spec.assertCreateRefusesALowercaseZone);
  it("Asia/Kolkata reaches the service (positive control)", spec.assertCreateAcceptsAsiaKolkata);
  it("a duplicate format is a 400 naming formats", spec.assertCreateRefusesADuplicateFormat);
  it("a valid body reaches the service once, parsed, with the JWT", spec.assertCreateHandsTheParsedBodyAndTheJwtToTheService);
  it("create answers 201", spec.assertCreateAnswers201);
});

describe("F3.5b ReportSchedulesController — update and get", () => {
  it("an empty PATCH is a 400 before the service", spec.assertUpdateRefusesAnEmptyBody);
  it("organizationId on PATCH is an unknown key", spec.assertUpdateRefusesOrganizationId);
  it("asia/kolkata on PATCH is a 400", spec.assertUpdateRefusesAnUnknownZone);
  it("a one-field PATCH reaches the service with the parsed id and body", spec.assertUpdateHandsTheIdAndTheBodyToTheService);
  it("a malformed id is a 400 before the service", spec.assertGetRefusesAMalformedId);
  it("remove answers 204", spec.assertRemoveAnswers204);
});

describe("F3.5b ReportSchedulesController — registry and source scan", () => {
  it("the registry names _create and _update and not the three body-less routes", spec.assertTheRegistryNamesTheTwoBodies);
  it("create parses before it calls the service", spec.assertCreateParsesBeforeTheService);
  it("update parses before it calls the service", spec.assertUpdateParsesBeforeTheService);
  it("no handler argument is named key/objectKey", spec.assertNoHandlerArgumentIsAKey);
  it("the class carries the guard and the prefix", spec.assertTheClassCarriesTheGuardAndThePrefix);
  it("no handler takes @Res()", spec.assertNoHandlerUsesRes);
});
