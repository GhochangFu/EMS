import { expect } from "vitest";

import type { NotificationChannelDto, ReportCadence } from "@bms/shared";

import {
  cadenceLabel,
  defaultTimezone,
  emailChannelOptions,
  nextRunLabel,
  scheduleBlockedReason,
  type ScheduleBlockedInput,
} from "./report-schedules-view";

/**
 * `F3.5b` Unit 12 (ADR 0071 R-18) — the pure Schedules-section view logic.
 *
 * Assertions live here, in the sibling `.spec`; `report-schedules-view.test.ts`
 * is the Vitest entry point (ADR 0014, §4.6).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

const CADENCES: readonly ReportCadence[] = ["daily", "weekly", "monthly"];
const EXPECTED_CADENCE_LABELS: Record<ReportCadence, string> = {
  daily: "Daily",
  weekly: "Weekly (Monday)",
  monthly: "Monthly (day 1)",
};

/** Every cadence resolves its exact sentence, all three. */
export function everyCadenceHasItsExactLabel(): void {
  for (const cadence of CADENCES) {
    expect(cadenceLabel(cadence)).toBe(EXPECTED_CADENCE_LABELS[cadence]);
  }
}

const LOCATIONS = [
  { id: "loc-1", timezone: "Europe/London" },
  { id: "loc-2", timezone: null },
  { id: "loc-3", timezone: "Asia/Kolkata" },
];

/** The first selected location's own zone, when it has one. */
export function defaultTimezoneReadsTheFirstSelectedLocationsZone(): void {
  expect(defaultTimezone(LOCATIONS, ["loc-1"])).toBe("Europe/London");
}

/**
 * A first selection with a `null` timezone falls to the default — never to a
 * later selected location's zone, even a non-null one. This pins the exact
 * reading the plan calls out: `[null, "Europe/London"]` → `"Asia/Kolkata"`.
 */
export function defaultTimezoneDoesNotFallThroughToTheSecondSelection(): void {
  expect(defaultTimezone(LOCATIONS, ["loc-2", "loc-1"])).toBe("Asia/Kolkata");
}

/** No selection at all also falls to the default. */
export function defaultTimezoneFallsBackWhenNothingIsSelected(): void {
  expect(defaultTimezone(LOCATIONS, [])).toBe("Asia/Kolkata");
}

/** `nextRunLabel` renders the ISO instant through `toLocaleString`. */
export function nextRunLabelUsesToLocaleString(): void {
  const iso = "2026-09-21T19:00:00.000Z";
  expect(nextRunLabel(iso)).toBe(new Date(iso).toLocaleString());
}

function channel(overrides: Partial<NotificationChannelDto> = {}): NotificationChannelDto {
  return {
    id: "channel-1",
    organizationId: ORG,
    code: "ops-email",
    name: "Ops",
    kind: "email",
    config: {},
    enabled: true,
    hasSecret: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A `webhook` channel is excluded even when its organization matches. */
export function emailChannelOptionsExcludesWebhook(): void {
  const webhook = channel({ id: "channel-2", kind: "webhook" });
  expect(emailChannelOptions([webhook], ORG)).toEqual([]);
}

/**
 * A fleet-wide channel (`organizationId: null`) is excluded even though its
 * `kind` matches — R-12: a `null` organization is never "the same" as the
 * schedule's own.
 */
export function emailChannelOptionsExcludesANullOrganization(): void {
  const fleetWide = channel({ id: "channel-3", organizationId: null });
  expect(emailChannelOptions([fleetWide], ORG)).toEqual([]);
}

/** Positive control: an email channel of the matching organization is included. */
export function emailChannelOptionsIncludesTheMatch(): void {
  const match = channel({ id: "channel-4" });
  const otherOrgEmail = channel({ id: "channel-5", organizationId: OTHER_ORG });
  expect(emailChannelOptions([match, otherOrgEmail], ORG)).toEqual([match]);
}

function blockedInput(overrides: Partial<ScheduleBlockedInput> = {}): ScheduleBlockedInput {
  return {
    name: "Weekly summary",
    formats: ["pdf"],
    runAtLocal: "07:00",
    timezone: "Asia/Kolkata",
    needsOrganization: false,
    organizationId: undefined,
    locationIds: ["loc-1"],
    canUseWholeOrganization: false,
    pending: false,
    ...overrides,
  };
}

/** Each `scheduleBlockedReason` condition, isolated, produces its own sentence. */
export function scheduleBlockedReasonPerCondition(): void {
  expect(scheduleBlockedReason(blockedInput({ pending: true }))).toBe("Saving…");
  expect(
    scheduleBlockedReason(blockedInput({ needsOrganization: true, organizationId: undefined })),
  ).toBe("Choose an organization first");
  expect(scheduleBlockedReason(blockedInput({ name: "  " }))).toBe("Enter a name");
  expect(scheduleBlockedReason(blockedInput({ formats: [] }))).toBe("Choose at least one format");
  expect(scheduleBlockedReason(blockedInput({ runAtLocal: "7:00" }))).toBe("Enter a run time");
  expect(scheduleBlockedReason(blockedInput({ timezone: "  " }))).toBe("Enter a timezone");
  expect(scheduleBlockedReason(blockedInput({ locationIds: [] }))).toBe("Choose at least one location");
}

/** Step-5 nit: an empty selection is "whole organization" only when the form offers it (never the `location_admin` form). */
export function scheduleBlockedReasonAllowsAnEmptySelectionWhenWholeOrganizationIsOffered(): void {
  expect(scheduleBlockedReason(blockedInput({ locationIds: [], canUseWholeOrganization: true }))).toBeNull();
}

/** Positive control: when none of the conditions holds, the form is not blocked. */
export function scheduleBlockedReasonIsNullWhenNothingBlocks(): void {
  expect(scheduleBlockedReason(blockedInput())).toBeNull();
}
