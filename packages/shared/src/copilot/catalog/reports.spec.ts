import { expect } from "vitest";

import { catalogEntry, EXCLUDED_ROUTES } from "./index";
import { modelBodyOf } from "./model-body";
import type { CatalogEntry, CatalogSummaryInput } from "./types";

/**
 * `F4.280` (ADR 0099 Amendment 8, D2–D5, Q7, Q14) — the report schedule
 * entries and the on-demand file save. The rules every entry obeys are
 * `catalog.spec.ts`; this file holds what is particular to these three.
 * Vitest entry point: the sibling `.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "33333333-3333-4333-8333-333333333333";

const REPORT_IDS = ["reportSchedule.create", "reportSchedule.update", "reportFile.save"];

const CREATE = {
  organizationId: ORG,
  name: "Weekly energy",
  formats: ["pdf"],
  cadence: "weekly",
  runAtLocal: "07:00",
  timezone: "Asia/Kolkata",
  locationIds: [ROW],
};

function entry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (!found) throw new Error(`no catalog entry ${id}`);
  return found;
}

function summary(id: string, input: Partial<CatalogSummaryInput> = {}): string {
  return entry(id).summary({ body: {}, params: { id: ROW }, targetName: "Weekly energy", organizationName: "Pune Works", ...input });
}

/** D2: the three entries are for the roles `assertMasterDataRole` admits. */
export function theEntriesAreForTheMasterDataRoles(): void {
  for (const id of REPORT_IDS) expect(entry(id).offeredTo, id).toEqual(["admin", "organization_admin", "location_admin"]);
}

/** D2: the creates name their organization with the report authority; the PATCH names the schedule row. */
export function theTargetsMirrorTheRoutes(): void {
  expect(REPORT_IDS.map((id) => entry(id).target)).toEqual([
    { kind: "organization", manage: "report" },
    { kind: "reportSchedule", param: "id" },
    { kind: "organization", manage: "report" },
  ]);
}

/** Q7: the copilot's schedule create names its organization. */
export function theScheduleCreateModelBodyRequiresTheOrganization(): void {
  const { organizationId: _omitted, ...body } = CREATE;
  expect(modelBodyOf(entry("reportSchedule.create")).safeParse(body).success).toBe(false);
}

/** Q7: the copilot's file save names its organization. */
export function theFileSaveModelBodyRequiresTheOrganization(): void {
  expect(
    modelBodyOf(entry("reportFile.save")).safeParse({ startDate: "2026-09-01", endDate: "2026-09-30", format: "pdf" }).success,
  ).toBe(false);
}

/** D5: the two schedule entries store the recipients for the card. */
export function theScheduleEntriesStoreTheRecipientsForTheCard(): void {
  expect([entry("reportSchedule.create").cardOnly, entry("reportSchedule.update").cardOnly]).toEqual([["recipients"], ["recipients"]]);
}

/** The file save emails nothing, so it stores nothing for the card alone. */
export function theFileSaveStoresNothingCardOnly(): void {
  expect(entry("reportFile.save").cardOnly ?? []).toEqual([]);
}

/** D4: a create that emails says that no later Confirm is asked. */
export function anEmailingCreateSaysNoLaterConfirm(): void {
  expect(summary("reportSchedule.create", { body: { ...CREATE, channelId: CHANNEL } })).toContain("no later Confirm");
}

/** A create without a channel makes no email claim (adjacent control). */
export function aCreateWithoutAChannelMakesNoEmailClaim(): void {
  expect(summary("reportSchedule.create", { body: CREATE })).not.toContain("emailed");
}

/** An update that clears the channel says email delivery stops. */
export function anUpdateClearingTheChannelSaysDeliveryStops(): void {
  expect(summary("reportSchedule.update", { body: { channelId: null } })).toContain("Email delivery stops");
}

/** An update that disables the schedule says it stops running. */
export function anUpdateDisablingSaysItStopsRunning(): void {
  expect(summary("reportSchedule.update", { body: { enabled: false } })).toContain("It stops running");
}

/** D5: no summary names an address. */
export function noSummaryNamesAnAddress(): void {
  const texts = [
    summary("reportSchedule.create", { body: { ...CREATE, channelId: CHANNEL } }),
    summary("reportSchedule.update", { body: { channelId: CHANNEL } }),
    summary("reportFile.save", { body: { organizationId: ORG, startDate: "2026-09-01", endDate: "2026-09-30", format: "pdf" } }),
  ];
  for (const text of texts) expect(text).not.toMatch(/@/);
}

/** Q14: the save's summary says the file is rendered on Confirm. */
export function theSaveSummarySaysItRendersOnConfirm(): void {
  expect(
    summary("reportFile.save", { body: { organizationId: ORG, startDate: "2026-09-01", endDate: "2026-09-30", format: "pdf" } }),
  ).toContain("rendered when you confirm");
}

/** "Not in this amendment": the two DELETE routes stay manual. */
export function theTwoDeletesAreExcluded(): void {
  const excluded = EXCLUDED_ROUTES.filter((route) => route.method === "DELETE").map((route) => route.path);
  expect(excluded).toEqual(expect.arrayContaining(["/reports/schedules/:id", "/reports/files/:id"]));
}

const SAVE_BODY = { organizationId: ORG, startDate: "2026-09-01", endDate: "2026-09-30", format: "pdf" };
const ROW2 = "44444444-4444-4444-8444-444444444444";

/** `F4.290` (Amendment 9 E4): a save naming sites says how many it is scoped to. */
export function aSaveNamingSitesSaysItsScope(): void {
  expect(summary("reportFile.save", { body: { ...SAVE_BODY, locationIds: [ROW, ROW2] } })).toContain("scoped to 2 locations");
}

/**
 * `F4.290` (critic fix): a save naming no site makes no scope claim — "the whole
 * organization" is false for a location admin, whose file is stamped to its grants.
 */
export function aSaveNamingNoSiteMakesNoScopeClaim(): void {
  expect(summary("reportFile.save", { body: SAVE_BODY })).not.toMatch(/scoped|whole organization/);
}

/** `F4.290`: the save's one step holds `locationIds`, so a copilot fill may set it. */
export function theSaveStepHoldsTheLocationIds(): void {
  expect(entry("reportFile.save").steps?.[0]?.fields).toContain("locationIds");
}

/** D5 still holds with the new field: a save naming sites names no address. */
export function aSaveNamingSitesNamesNoAddress(): void {
  expect(summary("reportFile.save", { body: { ...SAVE_BODY, locationIds: [ROW] } })).not.toMatch(/@/);
}
