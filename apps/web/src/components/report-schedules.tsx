import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ReportCadence, ReportFileFormat, ReportScheduleDto } from "@bms/shared";
import { REPORT_CADENCES, REPORT_FILE_FORMATS } from "@bms/shared/contracts";

import { fetchAdminLocations } from "../api/admin/locations";
import { fetchAdminOrganizations } from "../api/admin/organizations";
import { fetchNotificationChannels } from "../api/notifications";
import {
  createReportSchedule,
  deleteReportSchedule,
  fetchReportSchedules,
  updateReportSchedule,
  type CreateReportScheduleBody,
  type UpdateReportScheduleBody,
} from "../api/reports";
import { apiErrorMessage } from "../lib/api-error-message";
import { formatLabel } from "../lib/report-files-view";
import {
  cadenceLabel,
  defaultTimezone,
  emailChannelOptions,
  nextRunLabel,
  scheduleBlockedReason,
} from "../lib/report-schedules-view";
import type { AuthUser } from "../stores/auth-store";

/**
 * `F3.5b` Unit 13 — the Schedules section (ADR 0071 R-12, R-18; Q-6).
 *
 * Every sentence and every filtering rule is in `lib/report-schedules-view.ts`
 * (inside the web coverage `include`); this file is wiring on the
 * `report-history.tsx` / `SaveToHistory` shape. It has **no role predicate of
 * its own**: `ReportsPanel` renders it only for `isMasterDataAdmin(user.role)`
 * (R-13), the same gate the five routes hold.
 *
 * Three role shapes: the global `admin` names an organization (the select
 * exists only for that role, and only on create — a schedule never moves);
 * an `organization_admin` gets the channel select, resolved through the
 * organization of the locations the API answered with; a `location_admin`
 * (Q-6) has neither the "Whole organization" option nor the channel select —
 * `canManageNotificationChannel` is false for that role, so the form reads
 * the sentence rather than offering a control that buys a 403.
 */

export const REPORT_SCHEDULES_QUERY_KEY = ["report-schedules"] as const;

const CHANNEL_SENTENCE = "Email delivery needs an organization administrator";
const NOTHING_CHANGED = "Nothing changed yet";

/** The zone list the datalist offers is the browser's (the `locations-page.tsx` shape). */
function browserTimezones(): string[] {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
}

type FormState = {
  name: string;
  cadence: ReportCadence;
  runAtLocal: string;
  timezone: string;
  formats: ReportFileFormat[];
  locationIds: string[];
  channelId: string | null;
  enabled: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  cadence: "daily",
  runAtLocal: "06:00",
  timezone: defaultTimezone([], []),
  formats: ["pdf"],
  locationIds: [],
  channelId: null,
  enabled: true,
};

function formFromRow(row: ReportScheduleDto): FormState {
  return {
    name: row.name,
    cadence: row.cadence,
    runAtLocal: row.runAtLocal,
    timezone: row.timezone,
    formats: [...row.formats],
    locationIds: [...row.locationIds],
    channelId: row.channelId,
    enabled: row.enabled,
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/**
 * The PATCH body — only the keys whose value differs from the row. Arrays are
 * compared as sets, so an unchanged selection never ships as a changed key.
 * `channelId` is compared only when the form offers the select
 * (`offersChannel`): a `location_admin` never sends it (Q-6).
 */
function patchFor(row: ReportScheduleDto, form: FormState, offersChannel: boolean): UpdateReportScheduleBody {
  const patch: UpdateReportScheduleBody = {};
  if (form.name !== row.name) patch.name = form.name;
  if (form.cadence !== row.cadence) patch.cadence = form.cadence;
  if (form.runAtLocal !== row.runAtLocal) patch.runAtLocal = form.runAtLocal;
  if (form.timezone !== row.timezone) patch.timezone = form.timezone;
  if (!sameSet(form.formats, row.formats)) patch.formats = form.formats;
  if (!sameSet(form.locationIds, row.locationIds)) patch.locationIds = form.locationIds;
  if (offersChannel && form.channelId !== row.channelId) patch.channelId = form.channelId;
  if (form.enabled !== row.enabled) patch.enabled = form.enabled;
  return patch;
}

function locationsCell(count: number): string {
  if (count === 0) return "Whole organization";
  return count === 1 ? "1 location" : `${count} locations`;
}

export type ReportSchedulesProps = {
  /** The signed-in user, passed from `ReportsPanel` (the `SaveToHistory` shape). */
  user: AuthUser;
};

export function ReportSchedules({ user }: ReportSchedulesProps): JSX.Element {
  const queryClient = useQueryClient();
  const isGlobalAdmin = user.role === "admin";
  const offersChannel = user.role !== "location_admin";
  const offersWholeOrganization = user.role !== "location_admin";
  const timezones = useMemo(browserTimezones, []);

  const [editing, setEditing] = useState<ReportScheduleDto | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // The user typed a zone: the location-driven default no longer overwrites it.
  const [timezoneTouched, setTimezoneTouched] = useState(false);
  const [chosenOrganizationId, setChosenOrganizationId] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<{ tone: "saved" | "refused"; text: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // One entry per delete in flight — append, never replace (F3.4 sweep C2).
  const [deletingIds, setDeletingIds] = useState<readonly string[]>([]);

  // The organization select exists only for the global admin, and only on
  // create; an edit reads the row's organization.
  const needsOrganization = isGlobalAdmin && editing === null;
  const organizationId = editing !== null ? editing.organizationId : isGlobalAdmin ? chosenOrganizationId : undefined;

  const schedulesQ = useQuery({ queryKey: REPORT_SCHEDULES_QUERY_KEY, queryFn: fetchReportSchedules });
  const organizationsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
    enabled: needsOrganization,
  });
  const locationsQ = useQuery({
    // `"true"` is the active filter (`MasterDataActiveFilter`); the plan wrote
    // `"active"`, which the type refuses.
    queryKey: ["admin", "locations", "true", organizationId ?? null],
    queryFn: () => fetchAdminLocations("true", organizationId),
    enabled: !isGlobalAdmin || organizationId !== undefined,
  });
  const channelsQ = useQuery({
    queryKey: ["notification-channels"],
    queryFn: fetchNotificationChannels,
    enabled: offersChannel,
  });

  const locations = useMemo(() => locationsQ.data?.items ?? [], [locationsQ.data]);
  // A non-global admin's organization is the one the API scoped the locations to.
  const effectiveOrganizationId = organizationId ?? locations[0]?.organizationId;
  const channelOptions = useMemo(
    () =>
      effectiveOrganizationId === undefined
        ? []
        : emailChannelOptions(channelsQ.data?.items ?? [], effectiveOrganizationId),
    [channelsQ.data, effectiveOrganizationId],
  );
  const channelCodeById = useMemo(
    () => new Map((channelsQ.data?.items ?? []).map((channel) => [channel.id, channel.code])),
    [channelsQ.data],
  );

  // The location-driven timezone default: re-derived whenever the selection
  // or the fetched list changes, and only while the user has not typed a zone.
  useEffect(() => {
    if (timezoneTouched) return;
    const zone = defaultTimezone(locations, form.locationIds);
    setForm((current) => (current.timezone === zone ? current : { ...current, timezone: zone }));
  }, [form.locationIds, locations, timezoneTouched]);

  const resetForm = (): void => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setTimezoneTouched(false);
  };

  const saveM = useMutation({
    mutationFn: async () => {
      if (editing !== null) {
        return updateReportSchedule(editing.id, patchFor(editing, form, offersChannel));
      }
      const body: CreateReportScheduleBody = {
        name: form.name,
        formats: form.formats,
        cadence: form.cadence,
        runAtLocal: form.runAtLocal,
        timezone: form.timezone,
        locationIds: form.locationIds,
        enabled: form.enabled,
        // `channelId` only when the form offers the select (Q-6); `organizationId`
        // only for the global admin (R-12 — every other role sends none).
        ...(offersChannel ? { channelId: form.channelId } : {}),
        ...(isGlobalAdmin && organizationId ? { organizationId } : {}),
      };
      return createReportSchedule(body);
    },
    onSuccess: async (row) => {
      setOutcome({ tone: "saved", text: `Saved schedule ${row.name}.` });
      resetForm();
      await queryClient.invalidateQueries({ queryKey: REPORT_SCHEDULES_QUERY_KEY });
    },
    onError: (cause: Error) => setOutcome({ tone: "refused", text: apiErrorMessage(cause) }),
  });

  const deleteM = useMutation({
    mutationFn: (row: ReportScheduleDto) => deleteReportSchedule(row.id),
    onMutate: (row: ReportScheduleDto) => {
      setDeletingIds((current) => (current.includes(row.id) ? current : [...current, row.id]));
    },
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: REPORT_SCHEDULES_QUERY_KEY });
    },
    onError: (cause: Error) => setActionError(apiErrorMessage(cause)),
    // Removes only **its own** id: two deletes settle twice.
    onSettled: (_data, _error, row: ReportScheduleDto) =>
      setDeletingIds((current) => current.filter((id) => id !== row.id)),
  });

  const blockedReason =
    scheduleBlockedReason({
      name: form.name,
      formats: form.formats,
      runAtLocal: form.runAtLocal,
      timezone: form.timezone,
      needsOrganization,
      organizationId,
      locationIds: form.locationIds,
      canUseWholeOrganization: offersWholeOrganization,
      pending: saveM.isPending,
    }) ??
    (editing !== null && Object.keys(patchFor(editing, form, offersChannel)).length === 0 ? NOTHING_CHANGED : null);

  const startEdit = (row: ReportScheduleDto): void => {
    setEditing(row);
    setForm(formFromRow(row));
    setTimezoneTouched(true);
    setOutcome(null);
  };

  const onLocationsChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const values = Array.from(event.target.selectedOptions).map((option) => option.value);
    const wholeNow = values.includes("");
    const wholeBefore = form.locationIds.length === 0;
    const picked = values.filter((value) => value !== "");
    setForm({ ...form, locationIds: wholeNow && !wholeBefore ? [] : picked });
  };

  const toggleFormat = (format: ReportFileFormat): void => {
    setForm({
      ...form,
      formats: form.formats.includes(format)
        ? form.formats.filter((value) => value !== format)
        : [...form.formats, format],
    });
  };

  const rows = schedulesQ.data;
  const inputClass = "rounded border border-gray-300 px-3 py-2 text-sm";
  const labelClass = "text-xs font-medium text-bms-muted";

  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <h2 className="font-condensed text-sm font-bold text-bms-ink">Schedules</h2>
      {schedulesQ.isPending ? <p className="mt-2 text-sm text-bms-muted">Loading schedules…</p> : null}
      {schedulesQ.isError ? (
        <p className="mt-2 text-sm text-red-700">{apiErrorMessage(schedulesQ.error)}</p>
      ) : null}
      {rows !== undefined && rows.length === 0 ? (
        <p className="mt-2 text-sm text-bms-muted">No schedules yet.</p>
      ) : null}
      {rows !== undefined && rows.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-bms-muted">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Cadence</th>
                <th className="px-3 py-2">Run at</th>
                <th className="px-3 py-2">Next run</th>
                <th className="px-3 py-2">Formats</th>
                <th className="px-3 py-2">Locations</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Enabled</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((row) => {
                const deleting = deletingIds.includes(row.id);
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2 font-medium text-bms-ink">{row.name}</td>
                    <td className="px-3 py-2 text-bms-muted">{cadenceLabel(row.cadence)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{`${row.runAtLocal} ${row.timezone}`}</td>
                    <td className="px-3 py-2 text-bms-muted">{nextRunLabel(row.nextRunAt)}</td>
                    <td className="px-3 py-2 text-bms-muted">{row.formats.map(formatLabel).join(" · ")}</td>
                    <td className="px-3 py-2 text-bms-muted">{locationsCell(row.locationIds.length)}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.channelId === null ? "—" : (channelCodeById.get(row.channelId) ?? "Configured")}
                    </td>
                    <td className="px-3 py-2 text-bms-muted">{row.enabled ? "Yes" : "No"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          className="text-xs font-semibold text-bms-green disabled:cursor-not-allowed disabled:text-gray-400"
                          disabled={deleting}
                          onClick={() => startEdit(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-xs text-bms-muted disabled:cursor-not-allowed"
                          disabled={deleting}
                          onClick={() => deleteM.mutate(row)}
                        >
                          {deleting ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {actionError !== null ? <p className="mt-2 text-xs text-red-700">{actionError}</p> : null}

      <div className="mt-4 border-t border-gray-200 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-bms-muted">
          {editing !== null ? `Edit schedule: ${editing.name}` : "New schedule"}
        </h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {needsOrganization ? (
            <div className="grid gap-1 sm:col-span-2">
              <label className={labelClass} htmlFor="schedule-organization">
                Schedule organization
              </label>
              <select
                id="schedule-organization"
                className={inputClass}
                value={chosenOrganizationId ?? ""}
                onChange={(e) => {
                  setChosenOrganizationId(e.target.value === "" ? undefined : e.target.value);
                  setForm({ ...form, locationIds: [], channelId: null });
                }}
              >
                <option value="">Choose an organization</option>
                {(organizationsQ.data?.items ?? []).map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.code} · {organization.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="grid gap-1 sm:col-span-2">
            <label className={labelClass} htmlFor="schedule-name">
              Name
            </label>
            <input
              id="schedule-name"
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <label className={labelClass} htmlFor="schedule-cadence">
              Cadence
            </label>
            <select
              id="schedule-cadence"
              className={inputClass}
              value={form.cadence}
              onChange={(e) => setForm({ ...form, cadence: e.target.value as ReportCadence })}
            >
              {REPORT_CADENCES.map((cadence) => (
                <option key={cadence} value={cadence}>
                  {cadenceLabel(cadence)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label className={labelClass} htmlFor="schedule-run-at">
              Run time
            </label>
            <input
              id="schedule-run-at"
              type="time"
              step="60"
              className={inputClass}
              value={form.runAtLocal}
              onChange={(e) => setForm({ ...form, runAtLocal: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <label className={labelClass} htmlFor="schedule-timezone">
              Timezone
            </label>
            <input
              id="schedule-timezone"
              list="schedule-timezone-list"
              className={`${inputClass} font-mono`}
              value={form.timezone}
              onChange={(e) => {
                setTimezoneTouched(true);
                setForm({ ...form, timezone: e.target.value });
              }}
            />
            <datalist id="schedule-timezone-list">
              {timezones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </div>
          <fieldset className="grid gap-1">
            <legend className={labelClass}>Formats</legend>
            <div className="flex gap-4 py-2 text-sm">
              {REPORT_FILE_FORMATS.map((format) => (
                <label key={format} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={form.formats.includes(format)}
                    onChange={() => toggleFormat(format)}
                  />
                  {formatLabel(format)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-1">
            <label className={labelClass} htmlFor="schedule-locations">
              Locations
            </label>
            <select
              id="schedule-locations"
              multiple
              className={inputClass}
              value={offersWholeOrganization && form.locationIds.length === 0 ? [""] : form.locationIds}
              onChange={onLocationsChange}
            >
              {offersWholeOrganization ? <option value="">Whole organization</option> : null}
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            {offersChannel ? (
              <>
                <label className={labelClass} htmlFor="schedule-channel">
                  Email channel
                </label>
                <select
                  id="schedule-channel"
                  className={inputClass}
                  value={form.channelId ?? ""}
                  onChange={(e) => setForm({ ...form, channelId: e.target.value === "" ? null : e.target.value })}
                >
                  <option value="">None</option>
                  {channelOptions.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.code}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <span className={labelClass}>Email channel</span>
                <p className="py-2 text-sm text-bms-muted">{CHANNEL_SENTENCE}</p>
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            className="rounded bg-bms-ink px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
            disabled={blockedReason !== null}
            onClick={() => saveM.mutate()}
          >
            {saveM.isPending ? "Saving…" : "Save schedule"}
          </button>
          {editing !== null ? (
            <button type="button" className="text-sm text-bms-muted" onClick={resetForm}>
              Cancel
            </button>
          ) : null}
          {blockedReason !== null && !saveM.isPending ? (
            <p className="text-xs text-bms-muted">{blockedReason}</p>
          ) : null}
        </div>
        {outcome !== null ? (
          <p className={`mt-2 text-xs ${outcome.tone === "saved" ? "text-bms-green" : "text-red-600"}`}>
            {outcome.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}
