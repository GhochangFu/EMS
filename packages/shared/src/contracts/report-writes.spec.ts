import { expect } from "vitest";

import {
  copilotCreateReportScheduleModelBodySchema,
  copilotSaveEnergyReportFileModelBodySchema,
  createReportScheduleBodySchema,
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
