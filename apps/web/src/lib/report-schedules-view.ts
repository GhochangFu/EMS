import { RUN_AT_LOCAL_PATTERN, type NotificationChannelDto, type ReportCadence } from "@bms/shared";

/**
 * `F3.5b` Unit 12 (ADR 0071 R-18) — pure view logic for the Schedules
 * section. Kept here, not in `report-schedules.tsx`, on the
 * `report-files-view.ts` precedent: every sentence and every filtering rule
 * is spelled once, asserted without a DOM, and reused by the jsdom spec in
 * U13.
 */

const CADENCE_LABELS: Record<ReportCadence, string> = {
  daily: "Daily",
  weekly: "Weekly (Monday)",
  monthly: "Monthly (day 1)",
};

/** The exact cadence sentence, over every `ReportCadence` (a fourth cadence is a compile error). */
export function cadenceLabel(cadence: ReportCadence): string {
  return CADENCE_LABELS[cadence];
}

const DEFAULT_TIMEZONE = "Asia/Kolkata";

/**
 * The timezone the form defaults to when the location selection changes.
 *
 * **Only the first selected id is read.** A first selection with a `null`
 * timezone falls straight to `DEFAULT_TIMEZONE` — it does *not* fall through
 * to a second selected location's zone, even a non-null one: the form shows
 * one selection's default, not a scan across the set.
 */
export function defaultTimezone(
  locations: readonly { id: string; timezone: string | null }[],
  selectedIds: readonly string[],
): string {
  const firstId = selectedIds[0];
  if (firstId === undefined) {
    return DEFAULT_TIMEZONE;
  }
  const first = locations.find((location) => location.id === firstId);
  return first?.timezone ?? DEFAULT_TIMEZONE;
}

/** `nextRunAt`'s ISO instant, in the browser's own locale/zone rendering. */
export function nextRunLabel(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** The inputs `scheduleBlockedReason` reads, one per condition it checks. */
export type ScheduleBlockedInput = {
  readonly name: string;
  readonly formats: readonly string[];
  readonly runAtLocal: string;
  readonly timezone: string;
  /** True when the caller's role requires an organization choice. */
  readonly needsOrganization: boolean;
  readonly organizationId: string | undefined;
  readonly pending: boolean;
};

/**
 * The reason the schedule form's Save is disabled, or `null` when it is not.
 *
 * **Order is load-bearing** (checked most-blocking-first, the
 * `report-files-view.ts` `saveBlockedReason` order): a save in flight wins
 * over everything else, then a missing organization choice, then an empty
 * name, then no format chosen, then a malformed run time, then an empty
 * timezone.
 */
export function scheduleBlockedReason(input: ScheduleBlockedInput): string | null {
  if (input.pending) {
    return "Saving…";
  }
  if (input.needsOrganization && !input.organizationId) {
    return "Choose an organization first";
  }
  if (input.name.trim().length === 0) {
    return "Enter a name";
  }
  if (input.formats.length === 0) {
    return "Choose at least one format";
  }
  if (!RUN_AT_LOCAL_PATTERN.test(input.runAtLocal)) {
    return "Enter a run time";
  }
  if (input.timezone.trim().length === 0) {
    return "Enter a timezone";
  }
  return null;
}

/**
 * The channels the schedule form's Email `<select>` offers: `kind ===
 * "email"` **and** `organizationId` matching the schedule's own — a
 * fleet-wide channel (`organizationId: null`) is excluded (R-12: a schedule's
 * `channelId` must name a channel of the same organization, and a `null`
 * organization is never "the same" as one).
 */
export function emailChannelOptions(
  channels: readonly NotificationChannelDto[],
  organizationId: string,
): NotificationChannelDto[] {
  return channels.filter(
    (channel) => channel.kind === "email" && channel.organizationId === organizationId,
  );
}
