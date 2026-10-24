import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ReportCadence, ReportFileFormat, ReportScheduleDto } from "@bms/shared";
import { REPORT_CADENCES, REPORT_FILE_FORMATS } from "@bms/shared/contracts";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { fetchAdminLocations } from "../api/admin/locations";
import { fetchAdminOrganizations } from "../api/admin/organizations";
import { fetchNotificationChannels } from "../api/notifications";
import {
  createReportSchedule,
  type CreateReportScheduleBody,
  updateReportSchedule,
  type UpdateReportScheduleBody,
} from "../api/reports";
import { apiErrorMessage } from "../lib/api-error-message";
import { locationTreeOptions } from "../lib/location-tree";
import { formatLabel } from "../lib/report-files-view";
import { cadenceLabel, defaultTimezone, emailChannelOptions, scheduleBlockedReason } from "../lib/report-schedules-view";
import type { AuthUser } from "../stores/auth-store";
import { AdminWizardFrame, fieldClass, labelClass } from "./admin/admin-wizard-frame";
import { WizardShell } from "./wizard/wizard-shell";

/** The catalog entry, or a build defect (the `rule-wizard.tsx` rule). */
export function reportScheduleWizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.280: the catalog has no entry "${id}"`);
  return entry;
}

/** Q-6: a `location_admin` reads this rather than a channel select that buys a 403. */
export const SCHEDULE_CHANNEL_SENTENCE = "Email delivery needs an organization administrator";
const NOTHING_CHANGED = "Nothing changed yet";

/** The zone list the datalist offers is the browser's (the `locations-page.tsx` shape). */
function browserTimezones(): string[] {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/**
 * The PATCH body — only the keys whose value differs from the row. Arrays are
 * compared as sets, so an unchanged selection never ships as a changed key.
 * `channelId` is compared only when the form offers the select
 * (`offersChannel`): a `location_admin` never sends it (Q-6).
 */
export function schedulePatchFor(
  row: ReportScheduleDto,
  body: Readonly<Record<string, unknown>>,
  offersChannel: boolean,
): UpdateReportScheduleBody {
  const patch: UpdateReportScheduleBody = {};
  if (body.name !== row.name) patch.name = textOf(body.name);
  if (body.cadence !== row.cadence) patch.cadence = body.cadence as ReportCadence;
  if (body.runAtLocal !== row.runAtLocal) patch.runAtLocal = textOf(body.runAtLocal);
  if (body.timezone !== row.timezone) patch.timezone = textOf(body.timezone);
  if (!sameSet(strings(body.formats), row.formats)) patch.formats = strings(body.formats) as ReportFileFormat[];
  if (!sameSet(strings(body.locationIds), row.locationIds)) patch.locationIds = strings(body.locationIds);
  const channelId = typeof body.channelId === "string" ? body.channelId : null;
  if (offersChannel && channelId !== row.channelId) patch.channelId = channelId;
  if (typeof body.enabled === "boolean" && body.enabled !== row.enabled) patch.enabled = body.enabled;
  return patch;
}

/** The values a schedule's wizard starts from: the route's body keys. */
function initialValues(schedule: ReportScheduleDto | null, offersChannel: boolean): Record<string, unknown> {
  if (schedule !== null) {
    return {
      name: schedule.name,
      formats: [...schedule.formats],
      cadence: schedule.cadence,
      runAtLocal: schedule.runAtLocal,
      timezone: schedule.timezone,
      enabled: schedule.enabled,
      locationIds: [...schedule.locationIds],
      ...(offersChannel ? { channelId: schedule.channelId } : {}),
    };
  }
  return {
    organizationId: undefined,
    name: "",
    formats: ["pdf"],
    cadence: "daily",
    runAtLocal: "06:00",
    timezone: defaultTimezone([], []),
    enabled: true,
    locationIds: [],
    ...(offersChannel ? { channelId: null } : {}),
  };
}

export type ReportScheduleWizardProps = {
  user: AuthUser;
  /** The schedule to edit; `null` for a new one. */
  schedule: ReportScheduleDto | null;
  onCancel: () => void;
  onDone: (row: ReportScheduleDto) => Promise<void> | void;
};

/**
 * `F4.280` (ADR 0099 decision 6, Amendment 8) — the Reports page's schedule
 * form on the shared `WizardShell`: `reportSchedule.create` and `.update`,
 * Schedule → Locations → Delivery → Review. The values are the route's own
 * body; an edit sends only the changed keys ({@link schedulePatchFor}).
 *
 * The role rules are the `F3.5b` form's: the global `admin` names an
 * organization (only on create — a schedule never moves); a `location_admin`
 * (Q-6) has neither the "Whole organization" option nor the channel select;
 * the timezone follows the first chosen location until the user types one.
 */
export function ReportScheduleWizard({ user, schedule, onCancel, onDone }: ReportScheduleWizardProps) {
  const isGlobalAdmin = user.role === "admin";
  const offersChannel = user.role !== "location_admin";
  const offersWholeOrganization = user.role !== "location_admin";
  const needsOrganization = isGlobalAdmin && schedule === null;
  const timezones = useMemo(browserTimezones, []);
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(schedule, offersChannel));
  // The user typed a zone (or the row has one): the location-driven default no longer overwrites it.
  const [timezoneTouched, setTimezoneTouched] = useState(schedule !== null);

  const chosenOrganizationId = typeof values.organizationId === "string" ? values.organizationId : undefined;
  const organizationId = schedule !== null ? schedule.organizationId : isGlobalAdmin ? chosenOrganizationId : undefined;
  const locationIds = strings(values.locationIds);

  const organizationsQ = useQuery({
    queryKey: ["admin", "organizations", "true"],
    queryFn: () => fetchAdminOrganizations("true"),
    enabled: needsOrganization,
  });
  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "true", organizationId ?? null],
    queryFn: () => fetchAdminLocations("true", organizationId),
    enabled: !isGlobalAdmin || organizationId !== undefined,
  });
  const channelsQ = useQuery({ queryKey: ["notification-channels"], queryFn: fetchNotificationChannels, enabled: offersChannel });

  const locations = useMemo(() => locationsQ.data?.items ?? [], [locationsQ.data]);
  // A non-global admin's organization is the one the API scoped the locations to.
  const effectiveOrganizationId = organizationId ?? locations[0]?.organizationId;
  const channelOptions = useMemo(
    () => (effectiveOrganizationId === undefined ? [] : emailChannelOptions(channelsQ.data?.items ?? [], effectiveOrganizationId)),
    [channelsQ.data, effectiveOrganizationId],
  );

  useEffect(() => {
    if (timezoneTouched) return;
    const zone = defaultTimezone(locations, locationIds);
    setValues((current) => (current.timezone === zone ? current : { ...current, timezone: zone }));
  }, [JSON.stringify(locationIds), locations, timezoneTouched]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      schedule !== null
        ? updateReportSchedule(schedule.id, schedulePatchFor(schedule, body, offersChannel))
        : createReportSchedule(body as CreateReportScheduleBody),
    onSuccess: async (row) => onDone(row),
  });

  const patch = schedule !== null ? schedulePatchFor(schedule, values, offersChannel) : null;
  const blocked =
    scheduleBlockedReason({
      name: textOf(values.name),
      formats: strings(values.formats),
      runAtLocal: textOf(values.runAtLocal),
      timezone: textOf(values.timezone),
      needsOrganization,
      organizationId,
      locationIds,
      canUseWholeOrganization: offersWholeOrganization,
      pending: false,
    }) ?? (patch !== null && Object.keys(patch).length === 0 ? NOTHING_CHANGED : null);

  const onLocationsChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const picked = Array.from(event.target.selectedOptions).map((option) => option.value);
    const wholeNow = picked.includes("");
    setValues({ ...values, locationIds: wholeNow && locationIds.length > 0 ? [] : picked.filter((value) => value !== "") });
  };
  const toggleFormat = (format: ReportFileFormat): void => {
    const formats = strings(values.formats);
    setValues({ ...values, formats: formats.includes(format) ? formats.filter((value) => value !== format) : [...formats, format] });
  };

  const scheduleStep = (
    <>
      {needsOrganization ? (
        <label className={labelClass}>
          Schedule organization
          <select
            className={fieldClass}
            value={chosenOrganizationId ?? ""}
            onChange={(event) =>
              setValues({
                ...values,
                organizationId: event.target.value === "" ? undefined : event.target.value,
                locationIds: [],
                ...(offersChannel ? { channelId: null } : {}),
              })
            }
          >
            <option value="">Choose an organization</option>
            {(organizationsQ.data?.items ?? []).map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.code} · {organization.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className={labelClass}>
        Name
        <input className={fieldClass} value={textOf(values.name)} onChange={(event) => setValues({ ...values, name: event.target.value })} />
      </label>
      <label className={labelClass}>
        Cadence
        <select className={fieldClass} value={textOf(values.cadence)} onChange={(event) => setValues({ ...values, cadence: event.target.value })}>
          {REPORT_CADENCES.map((cadence) => (
            <option key={cadence} value={cadence}>
              {cadenceLabel(cadence)}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Run time
        <input
          type="time"
          step="60"
          className={fieldClass}
          value={textOf(values.runAtLocal)}
          onChange={(event) => setValues({ ...values, runAtLocal: event.target.value })}
        />
      </label>
      <label className={labelClass}>
        Timezone
        <input
          list="schedule-timezone-list"
          className={`${fieldClass} font-mono`}
          value={textOf(values.timezone)}
          onChange={(event) => {
            setTimezoneTouched(true);
            setValues({ ...values, timezone: event.target.value });
          }}
        />
      </label>
      <datalist id="schedule-timezone-list">
        {timezones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <fieldset className="grid gap-1">
        <legend className={labelClass}>Formats</legend>
        <div className="flex gap-4 py-2 text-sm">
          {REPORT_FILE_FORMATS.map((format) => (
            <label key={format} className="flex items-center gap-1">
              <input type="checkbox" checked={strings(values.formats).includes(format)} onChange={() => toggleFormat(format)} />
              {formatLabel(format)}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={values.enabled !== false} onChange={(event) => setValues({ ...values, enabled: event.target.checked })} />
        Enabled
      </label>
    </>
  );

  const scopeStep = (
    <>
      <label className={labelClass}>
        Locations
        <select
          multiple
          className={fieldClass}
          value={offersWholeOrganization && locationIds.length === 0 ? [""] : locationIds}
          onChange={onLocationsChange}
        >
          {offersWholeOrganization ? <option value="">Whole organization</option> : null}
          {/* `F2.10` (ADR 0098 B11) — the tree depth-first, one `— ` per level. */}
          {locationTreeOptions(locations).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {!offersWholeOrganization && locationIds.length === 0 ? <p className="text-xs text-ink-muted">Choose at least one location</p> : null}
    </>
  );

  const deliveryStep = offersChannel ? (
    <label className={labelClass}>
      Email channel
      <select
        className={fieldClass}
        value={textOf(values.channelId)}
        onChange={(event) => setValues({ ...values, channelId: event.target.value === "" ? null : event.target.value })}
      >
        <option value="">None</option>
        {channelOptions.map((channel) => (
          <option key={channel.id} value={channel.id}>
            {channel.code}
          </option>
        ))}
      </select>
    </label>
  ) : (
    <>
      <span className={labelClass}>Email channel</span>
      <p className="py-2 text-sm text-ink-muted">{SCHEDULE_CHANNEL_SENTENCE}</p>
    </>
  );

  const id = schedule !== null ? "reportSchedule.update" : "reportSchedule.create";
  const organizationName =
    organizationsQ.data?.items.find((organization) => organization.id === organizationId)?.name ??
    locations[0]?.organizationName ??
    "the organization";
  const shared = {
    values,
    onChange: setValues,
    renderStep: (step: { id: string }) => (step.id === "schedule" ? scheduleStep : step.id === "scope" ? scopeStep : deliveryStep),
    onSubmit: (body: Record<string, unknown>) => {
      if (blocked === null) save.mutate(body);
    },
    onCancel,
    submitting: save.isPending,
    submitError: blocked ?? (save.error ? apiErrorMessage(save.error) : null),
    summary: reportScheduleWizardEntry(id).summary({
      body: patch ?? values,
      params: schedule !== null ? { id: schedule.id } : {},
      targetName: schedule?.name ?? "",
      organizationName,
    }),
  };
  return schedule !== null ? (
    <AdminWizardFrame title="Edit a report schedule">
      <WizardShell
        entry={reportScheduleWizardEntry("reportSchedule.update")}
        {...shared}
        params={{ id: schedule.id }}
        current={initialValues(schedule, offersChannel)}
      />
    </AdminWizardFrame>
  ) : (
    <AdminWizardFrame title="Create a report schedule">
      <WizardShell entry={reportScheduleWizardEntry("reportSchedule.create")} {...shared} params={{}} />
    </AdminWizardFrame>
  );
}
