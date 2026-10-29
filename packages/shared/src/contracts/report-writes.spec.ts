import { expect } from "vitest";

import {
  copilotCreateReportScheduleModelBodySchema,
  copilotSaveEnergyReportFileModelBodySchema,
  createReportScheduleBodySchema,
  energyReportQuerySchema,
  saveEnergyReportFileBodySchema,
  updateReportScheduleBodySchema,
} from "./report-writes";

/**
 * `F4.280` (ADR 0099 Amendment 8, Q7, ADR 0030) — the report write bodies, now
 * in `@bms/shared`, and the copilot's model bodies that name the organization.
 * No database: every claim is a parse. Vitest entry point: the sibling `.test.ts`.
 */

const ORG = "00000000-0000-4000-8000-000000000001";

const CREATE = {
  name: "Weekly energy",
  formats: ["pdf"],
  cadence: "weekly",
  runAtLocal: "07:00",
  timezone: "Asia/Kolkata",
  locationIds: [],
};

const SAVE = { startDate: "2026-09-01", endDate: "2026-09-30", format: "pdf" };

/** Q7: the copilot's schedule create names its organization. */
export function theCreateModelBodyRefusesNoOrganization(): void {
  expect(copilotCreateReportScheduleModelBodySchema.safeParse(CREATE).success).toBe(false);
}

/** The route body keeps `organizationId` optional (a one-organization admin gets theirs). */
export function theCreateRouteBodyAcceptsNoOrganization(): void {
  expect(createReportScheduleBodySchema.safeParse(CREATE).success).toBe(true);
}

/** The model body with the organization named passes (positive control for the refusal above). */
export function theCreateModelBodyAcceptsAnOrganization(): void {
  expect(copilotCreateReportScheduleModelBodySchema.safeParse({ ...CREATE, organizationId: ORG }).success).toBe(true);
}

/** Q7: the copilot's on-demand save names its organization. */
export function theSaveModelBodyRefusesNoOrganization(): void {
  expect(copilotSaveEnergyReportFileModelBodySchema.safeParse(SAVE).success).toBe(false);
}

/** E4.1a: an empty PATCH is a 400, not a no-op. */
export function theUpdateBodyRefusesAnEmptyObject(): void {
  expect(updateReportScheduleBodySchema.safeParse({}).success).toBe(false);
}

/** R-6: a lower-case zone is refused. */
export function aLowerCaseZoneIsRefused(): void {
  expect(createReportScheduleBodySchema.safeParse({ ...CREATE, timezone: "asia/kolkata" }).success).toBe(false);
}

/** R-6: the pilot's own zone passes. */
export function thePilotZonePasses(): void {
  expect(createReportScheduleBodySchema.safeParse({ ...CREATE, timezone: "Asia/Kolkata" }).success).toBe(true);
}

/** Step-5 security M1: a date that does not exist is refused, never rolled forward. */
export function aCalendarInvalidDateIsRefused(): void {
  expect(saveEnergyReportFileBodySchema.safeParse({ ...SAVE, startDate: "2026-02-30" }).success).toBe(false);
}

/*
 * `F4.290` (ADR 0099 Amendment 9 E4) — `locationIds` on the energy query and the
 * two save bodies: site ids, each meaning the site and its descendants.
 */

const SITE = "40000000-0000-4000-8000-000000000001";
const RANGE = { startDate: "2026-09-01", endDate: "2026-09-30" };

/** Today's producers (`apps/web/src/api/reports.ts`) send no `locationIds`: it parses absent. */
export function theQueryStillParsesWithoutLocationIds(): void {
  expect(energyReportQuerySchema.parse(RANGE).locationIds).toBeUndefined();
}

/** Express hands one `?locationIds=` as a bare string: it folds into a one-item list. */
export function theQueryFoldsOneLocationIdIntoAList(): void {
  expect(energyReportQuerySchema.parse({ ...RANGE, locationIds: SITE }).locationIds).toEqual([SITE]);
}

/** A location id that is not a uuid is refused. */
export function theQueryRefusesANonUuidLocationId(): void {
  expect(energyReportQuerySchema.safeParse({ ...RANGE, locationIds: ["lotapata"] }).success).toBe(false);
}

/** More than 200 locations (the schedule's bound, owner ruling P6) is refused. */
export function theQueryRefusesMoreThan200LocationIds(): void {
  const ids = Array.from({ length: 201 }, (_, i) => `40000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  expect(energyReportQuerySchema.safeParse({ ...RANGE, locationIds: ids }).success).toBe(false);
}

/** A site filter names at least one site: `[]` is refused, never read as "the whole organization". */
export function theQueryRefusesAnEmptyLocationIdList(): void {
  expect(energyReportQuerySchema.safeParse({ ...RANGE, locationIds: [] }).success).toBe(false);
}

/** The route's save body takes `locationIds`. */
export function theSaveBodyAcceptsLocationIds(): void {
  expect(saveEnergyReportFileBodySchema.parse({ ...SAVE, locationIds: [SITE] }).locationIds).toEqual([SITE]);
}

/** The copilot's save model body takes `locationIds`. */
export function theSaveModelBodyAcceptsLocationIds(): void {
  expect(copilotSaveEnergyReportFileModelBodySchema.parse({ ...SAVE, organizationId: ORG, locationIds: [SITE] }).locationIds).toEqual([SITE]);
}

/** The save body is still `.strict()`: an unknown key is refused. */
export function theSaveBodyStillRefusesAnUnknownKey(): void {
  expect(saveEnergyReportFileBodySchema.safeParse({ ...SAVE, locationIds: [SITE], siteId: SITE }).success).toBe(false);
}

/** The save model body is still `.strict()`: an unknown key is refused. */
export function theSaveModelBodyStillRefusesAnUnknownKey(): void {
  expect(
    copilotSaveEnergyReportFileModelBodySchema.safeParse({ ...SAVE, organizationId: ORG, locationIds: [SITE], siteId: SITE }).success,
  ).toBe(false);
}

/** `F4.290` (review fix): a repeated site is refused, so a file is never stamped "2 locations" for one site. */
export function theSaveBodyRefusesARepeatedLocationId(): void {
  expect(saveEnergyReportFileBodySchema.safeParse({ ...SAVE, locationIds: [SITE, SITE] }).success).toBe(false);
}

/** `F4.290` (review fix): the copilot's save model body refuses a repeated site too. */
export function theSaveModelBodyRefusesARepeatedLocationId(): void {
  expect(copilotSaveEnergyReportFileModelBodySchema.safeParse({ ...SAVE, organizationId: ORG, locationIds: [SITE, SITE] }).success).toBe(false);
}

/** `F4.290` (review fix): the energy query refuses a repeated site. */
export function theQueryRefusesARepeatedLocationId(): void {
  expect(energyReportQuerySchema.safeParse({ ...RANGE, locationIds: [SITE, SITE] }).success).toBe(false);
}
