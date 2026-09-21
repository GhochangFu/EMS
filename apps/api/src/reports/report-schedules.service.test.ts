import { describe, it } from "vitest";

import * as spec from "./report-schedules.service.spec";

/** `F3.5b` — `ReportSchedulesService` over fakes. Assertions live in the sibling `.spec.ts` (§4.6). */
describe("F3.5b ReportSchedulesService — create: the R-12 refusals", () => {
  it("assetGroupAdminIs403BeforeAnyRead", spec.assetGroupAdminIs403BeforeAnyRead);
  it("globalAdminMustNameTheOrganization", spec.globalAdminMustNameTheOrganization);
  it("aLocationOutsideTheOrganizationIs400", spec.aLocationOutsideTheOrganizationIs400);
  it("aLocationOutsideTheScopeIs403", spec.aLocationOutsideTheScopeIs403);
  it("a held location of the organization is admitted (positive control)", spec.aHeldLocationOfTheOrganizationIsAdmitted);
  it("emptyLocationIdsNeedOrganizationRights — a location scope is 403", () => spec.emptyLocationIdsNeedOrganizationRights("location"));
  it("emptyLocationIdsNeedOrganizationRights — an organization scope proceeds", () => spec.emptyLocationIdsNeedOrganizationRights("organization"));
  it("aWebhookChannelIs400", spec.aWebhookChannelIs400);
  it("aForeignChannelIs400", spec.aForeignChannelIs400);
  it("aNullOrganizationChannelIs400", spec.aNullOrganizationChannelIs400);
  it("an unknown channel is 404", spec.anUnknownChannelIs404);
  it("a channel loadById refuses is 403 (Q-6)", spec.aChannelRefusedByLoadByIdIs403);
  it("an email channel of this organization is admitted (positive control)", spec.anEmailChannelOfThisOrganizationIsAdmitted);
});

describe("F3.5b ReportSchedulesService — create: the cap and the clock", () => {
  it("theCapRefusesBeforeTheInsert (count 50 → 409, insert.calls === 0)", spec.theCapRefusesBeforeTheInsert);
  it("a NaN count is 409", spec.theCapFailsClosedOnANonNumericCount);
  it("one under the cap locks, counts, inserts, audits, then commits", spec.oneUnderTheCapLocksCountsInsertsAuditsThenCommits);
  it("the advisory lock names the organization", spec.theAdvisoryLockNamesTheOrganization);
  it("the tenant GUC binds the resolved organization", spec.theTenantGucBindsTheResolvedOrganization);
  it("createComputesNextRunAtInTheZone", spec.createComputesNextRunAtInTheZone);
  it("create stamps the template, the actor and enabled by default", spec.createStampsTheTemplateTheActorAndEnabledByDefault);
});

describe("F3.5b ReportSchedulesService — update (Q-3 / R-8)", () => {
  it("patchRecomputesOnCadenceRunAtOrTimezone — cadence", () => spec.patchRecomputesOnCadenceRunAtOrTimezone("cadence"));
  it("patchRecomputesOnCadenceRunAtOrTimezone — runAtLocal", () => spec.patchRecomputesOnCadenceRunAtOrTimezone("runAtLocal"));
  it("patchRecomputesOnCadenceRunAtOrTimezone — timezone", () => spec.patchRecomputesOnCadenceRunAtOrTimezone("timezone"));
  it("patchRecomputesOnReenable", spec.patchRecomputesOnReenable);
  it("enabled true on an enabled row keeps nextRunAt (negative control)", spec.patchOfEnabledTrueOnAnEnabledRowKeepsNextRunAt);
  it("enabled false keeps nextRunAt", spec.patchOfEnabledFalseKeepsNextRunAt);
  it("patchOfNameAloneKeepsNextRunAt", spec.patchOfNameAloneKeepsNextRunAt);
  it("re-sending the stored cadence keeps nextRunAt", spec.patchOfTheSameCadenceKeepsNextRunAt);
  it("the write checks run on the new locationIds", spec.patchRunsTheWriteChecksOnTheNewLocationIds);
  it("the write checks run on the new channelId", spec.patchRunsTheWriteChecksOnTheNewChannelId);
  it("a name-only PATCH asks no write-check read", spec.patchOfNameAloneAsksNoWriteCheckRead);
  it("out of scope is 403 before any write", spec.patchOutOfScopeIs403BeforeAnyWrite);
  it("an unknown id is 404", spec.patchOfAnUnknownIdIs404);
});

describe("F3.5b ReportSchedulesService — get and list", () => {
  it("get out of scope is 403 with the one sentence", spec.getOutOfScopeIs403WithTheOneSentence);
  it("get of an unknown id is 404 before the verdict", spec.getOfAnUnknownIdIs404BeforeTheVerdict);
  it("listAppliesTheLocationPredicateOnlyForLocationAdmins — location", () => spec.listAppliesTheLocationPredicateOnlyForLocationAdmins("location"));
  it("listAppliesTheLocationPredicateOnlyForLocationAdmins — organization", () => spec.listAppliesTheLocationPredicateOnlyForLocationAdmins("organization"));
  it("listAppliesTheLocationPredicateOnlyForLocationAdmins — global", () => spec.listAppliesTheLocationPredicateOnlyForLocationAdmins("global"));
  it("list maps every row through the DTO", spec.listOrdersNewestFirst);
});

describe("F3.5b ReportSchedulesService — remove (Q-2)", () => {
  it("removeDeletesFilesThenTheScheduleThenTheObjects", spec.removeDeletesFilesThenTheScheduleThenTheObjects);
  it("a deleteObject throw resolves with one warn naming the file id", spec.removeResolvesAndWarnsOncePerFailedObjectNamingTheFileId);
  it("a vanished row is 404 and deletes no object", spec.removeOfAVanishedRowIs404AndDeletesNoObject);
  it("out of scope is 403 before any write", spec.removeOutOfScopeIs403BeforeAnyWrite);
  it("remove is 503 when storage is unconfigured", spec.removeIs503WhenStorageIsUnconfigured);
});

describe("F3.5b ReportSchedulesService — audit (R-10) and DTO (R-16)", () => {
  it("auditPayloadsCarryIdsAndEnumsNeverTheName — create", () => spec.auditPayloadsCarryIdsAndEnumsNeverTheName("create"));
  it("auditPayloadsCarryIdsAndEnumsNeverTheName — update", () => spec.auditPayloadsCarryIdsAndEnumsNeverTheName("update"));
  it("auditPayloadsCarryIdsAndEnumsNeverTheName — remove", () => spec.auditPayloadsCarryIdsAndEnumsNeverTheName("remove"));
  it("the create audit payload carries the seven R-10 keys", spec.theCreateAuditPayloadCarriesTheSevenKeys);
  it("dtoNeverCarriesNextRunAtAsADate", spec.dtoNeverCarriesNextRunAtAsADate);
  it("runAtLocalIsSlicedToMinutes", spec.runAtLocalIsSlicedToMinutes);
  it("a broken row is a 500, never a 400", spec.aBrokenRowIs500NotA400);
});
