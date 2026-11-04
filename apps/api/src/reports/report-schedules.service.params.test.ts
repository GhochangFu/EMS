import { describe, it } from "vitest";

import * as spec from "./report-schedules.service.params.spec";

/** `F4.303` U11 — the schedule create and update with a template and params. Assertions live in the sibling `.spec.ts` (§4.6). */
describe("F4.303 ReportSchedulesService — the stored template and params", () => {
  it("S1 a body without templateId or params stores energy_consumption and NULL", spec.aBodyWithoutTemplateStoresEnergyAndNull);
  it("S2 energy_consumption with compare off stores NULL", spec.energyWithCompareOffStoresNull);
  it("S3 energy_consumption with compare on stores { compare: true }", spec.energyWithCompareOnStoresTheArm);
  it("trend_points stores the template and the trend arm", spec.trendPointsStoresTheTemplateAndTheArm);
});

describe("F4.303 ReportSchedulesService — the pairing check", () => {
  it("S4 trend_points without params is a 400", () => spec.aMismatchedArmIs400("trendWithoutParams"));
  it("S5 trend_points with the energy arm is a 400", () => spec.aMismatchedArmIs400("trendWithEnergyArm"));
  it("S6 energy_consumption with the trend arm is a 400", () => spec.aMismatchedArmIs400("energyWithTrendArm"));
  it("S7 the S4 400 precedes the channel read", () => spec.theMismatchIsRefusedBeforeTheChannelRead("trendWithoutParams"));
  it("S7 the S5 400 precedes the channel read", () => spec.theMismatchIsRefusedBeforeTheChannelRead("trendWithEnergyArm"));
  it("S7 the S6 400 precedes the channel read", () => spec.theMismatchIsRefusedBeforeTheChannelRead("energyWithTrendArm"));
});

describe("F4.303 ReportSchedulesService — the point check's place", () => {
  it("trend_points runs the point check after the location read and before the transaction", spec.trendPointsRunsThePointCheckBeforeTheTransaction);
  it("energy_consumption runs no point check", spec.energyRunsNoPointCheck);
  it("PATCH locationIds on a trend_points row re-checks the stored points against the new list", spec.patchLocationIdsOnATrendRowRechecksThePoints);
  it("PATCH locationIds on an energy_consumption row runs no point check", spec.patchLocationIdsOnAnEnergyRowRunsNoPointCheck);
  it("PATCH name on a trend_points row runs no point check", spec.patchOfNameOnATrendRowRunsNoPointCheck);
});

describe("F4.303 ReportSchedulesService — audit and DTO", () => {
  it("S8 the audit payload carries templateId and pointCount, never a point", spec.theAuditPayloadCarriesTheTemplateAndThePointCount);
  it("S8 an energy audit payload carries pointCount 0", spec.anEnergyAuditPayloadCarriesPointCountZero);
  it("S9 the DTO carries the stored params", spec.theDtoCarriesTheStoredParams);
});
