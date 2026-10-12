import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import type { AdminRtuDto } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { fetchAdminLocations } from "../../api/admin/locations";
import { wizardBody, type WizardStep } from "../../lib/wizard-steps";
import { WizardShell } from "../wizard/wizard-shell";
import { AdminWizardFrame, fieldClass, labelClass, MetadataStep, metaOf, numberOf } from "./location-wizards";

/**
 * `F3.86` PR 3a (ADR 0099 decision 6, plan §5.2) — the RTUs page's wizards on
 * the shared `WizardShell`: create (`rtu.create`, Basics → Source → Metadata
 * → Review), edit (`rtu.update`, the same steps, Now beside After), and the
 * Review-only deactivate and reactivate (ruling Q9).
 *
 * Each `<WizardShell>` writes the literal `entry={wizardEntry("<id>")}` (the
 * stepper gate's form). Submit hands the body Review parsed to the page,
 * which sends the plain request, with no `X-Copilot-Change` header.
 */

/** The catalog entry, or a build defect (the `calc-parameters-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F3.86: the catalog has no entry "${id}"`);
  return entry;
}

type SourceType = AdminRtuDto["sourceType"];
const SOURCE_TYPES: readonly SourceType[] = ["catalog", "mqtt", "simulator"];

export type RtuForm = {
  locationId: string;
  code: string;
  displayName: string;
  sourceType: SourceType;
  domain: string;
  mqttTopic: string;
  /** Kept as text; a number on submit. */
  externalRtuId: string;
  rtuCode: string;
  stationCode: string;
  stationName: string;
  ingestEnabled: boolean;
  /** Only a copilot fill sets it (`MetadataStep`). */
  meta?: Record<string, unknown>;
};

export function emptyRtuForm(locationId: string): RtuForm {
  return {
    locationId,
    code: "",
    displayName: "",
    sourceType: "catalog",
    domain: "",
    mqttTopic: "",
    externalRtuId: "",
    rtuCode: "",
    stationCode: "",
    stationName: "",
    ingestEnabled: false,
  };
}

export function rtuFormOf(row: AdminRtuDto): RtuForm {
  return {
    locationId: row.locationId,
    code: row.code,
    displayName: row.displayName,
    sourceType: row.sourceType,
    domain: row.domain ?? "",
    mqttTopic: row.mqttTopic ?? "",
    externalRtuId: row.externalRtuId === null ? "" : String(row.externalRtuId),
    rtuCode: row.rtuCode ?? "",
    stationCode: row.stationCode ?? "",
    stationName: row.stationName ?? "",
    ingestEnabled: row.ingestEnabled,
  };
}

/** An optional text: `undefined` (not sent) when empty. */
function optional(text: string): string | undefined {
  return text === "" ? undefined : text;
}

/**
 * The `rtu.create` wizard's values. `rtus.rtu_code` is the device key the
 * ingest host matches each payload's `dev_id` against (ADR 0016 §3), so a
 * pasted space would route nothing: the device ID and the topic are trimmed,
 * and a blank one is not sent, so the column stays NULL (`F4.143`).
 */
export function createRtuValues(form: RtuForm): Record<string, unknown> {
  return {
    locationId: form.locationId,
    code: form.code,
    displayName: form.displayName,
    sourceType: form.sourceType,
    domain: optional(form.domain),
    mqttTopic: optional(form.mqttTopic.trim()),
    externalRtuId: numberOf(form.externalRtuId),
    rtuCode: optional(form.rtuCode.trim()),
    stationCode: optional(form.stationCode),
    stationName: optional(form.stationName),
    ingestEnabled: form.ingestEnabled,
    meta: form.meta,
  };
}

/**
 * The `rtu.update` wizard's values. A Source field is sent only when it
 * changed (`F4.182`): `""` clears a column, and a restated blank would turn a
 * seeded NULL into `""`. An emptied external id is not sent — the body has
 * no way to clear it.
 */
export function updateRtuValues(form: RtuForm, editing: AdminRtuDto): Record<string, unknown> {
  const changed = (text: string, stored: string | null) => (text === (stored ?? "").trim() ? undefined : text);
  const externalRtuId = numberOf(form.externalRtuId);
  return {
    code: form.code,
    displayName: form.displayName,
    sourceType: form.sourceType,
    domain: optional(form.domain),
    mqttTopic: changed(form.mqttTopic.trim(), editing.mqttTopic),
    externalRtuId: externalRtuId === (editing.externalRtuId ?? undefined) ? undefined : externalRtuId,
    rtuCode: changed(form.rtuCode.trim(), editing.rtuCode),
    stationCode: changed(form.stationCode, editing.stationCode),
    stationName: changed(form.stationName, editing.stationName),
    ingestEnabled: form.ingestEnabled,
    meta: form.meta,
  };
}

/** A copilot `fill_step` written into the form. A field the fill did not carry keeps its value. */
export function rtuFormWithValues(form: RtuForm, values: Readonly<Record<string, unknown>>): RtuForm {
  const next = { ...form };
  const texts = ["locationId", "code", "displayName", "domain", "mqttTopic", "rtuCode", "stationCode", "stationName"] as const;
  for (const key of texts) {
    const value = values[key];
    if (typeof value === "string") next[key] = value;
  }
  if (SOURCE_TYPES.includes(values.sourceType as SourceType)) next.sourceType = values.sourceType as SourceType;
  if (typeof values.externalRtuId === "number") next.externalRtuId = String(values.externalRtuId);
  if (typeof values.ingestEnabled === "boolean") next.ingestEnabled = values.ingestEnabled;
  const meta = metaOf(values.meta);
  if (meta !== undefined) next.meta = meta;
  return next;
}

type RtuWizardProps = {
  /** The row an edit changes; `null` for a create. */
  editing: AdminRtuDto | null;
  /** A create's site, preselected from the page's route or filter. */
  locationId: string;
  /** The organization whose active sites a create offers (the page's filter). */
  organizationId: string | undefined;
  pending: boolean;
  error: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
};

/** `rtu.create` and `rtu.update`. */
export function RtuWizard(props: RtuWizardProps) {
  const { editing } = props;
  const [form, setForm] = useState<RtuForm>(() => (editing ? rtuFormOf(editing) : emptyRtuForm(props.locationId)));
  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "true", props.organizationId],
    queryFn: () => fetchAdminLocations("true", props.organizationId),
    enabled: !editing,
  });
  const locations = locationsQ.data?.items ?? [];
  const values = editing ? updateRtuValues(form, editing) : createRtuValues(form);

  const text = (label: string, field: "code" | "displayName" | "domain" | "mqttTopic" | "stationCode" | "stationName") => (
    <label className={labelClass}>
      {label}
      <input className={fieldClass} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} />
    </label>
  );

  // Every step's elements are built here, once per render; `renderStep` only picks one.
  const basics = (
    <>
      {!editing ? (
        <label className={labelClass}>
          Location
          <select
            className={fieldClass}
            value={form.locationId}
            onChange={(event) => setForm({ ...form, locationId: event.target.value })}
          >
            <option value="">Select location</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-xs text-ink-muted">{`Location: ${editing.locationName}`}</p>
      )}
      {text("Code", "code")}
      {text("Display name", "displayName")}
      <label className={labelClass}>
        Source type
        <select
          className={fieldClass}
          value={form.sourceType}
          onChange={(event) => setForm({ ...form, sourceType: event.target.value as SourceType })}
        >
          {SOURCE_TYPES.map((sourceType) => (
            <option key={sourceType} value={sourceType}>
              {sourceType}
            </option>
          ))}
        </select>
      </label>
      {text("Domain", "domain")}
    </>
  );
  const source = (
    <>
      {text("MQTT topic", "mqttTopic")}
      <label className={labelClass}>
        Device ID (dev_id)
        <input
          className={`${fieldClass} font-mono`}
          value={form.rtuCode}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setForm({ ...form, rtuCode: event.target.value })}
        />
      </label>
      <label className={labelClass}>
        External RTU id
        <input
          className={fieldClass}
          inputMode="numeric"
          value={form.externalRtuId}
          onChange={(event) => setForm({ ...form, externalRtuId: event.target.value })}
        />
      </label>
      {text("Station code", "stationCode")}
      {text("Station name", "stationName")}
      <label className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
        <input
          type="checkbox"
          checked={form.ingestEnabled}
          onChange={(event) => setForm({ ...form, ingestEnabled: event.target.checked })}
        />
        Ingest enabled
      </label>
    </>
  );
  const metadata = <MetadataStep meta={form.meta} what="RTU" />;

  function renderStep(step: WizardStep): ReactNode {
    if (step.id === "basics") return basics;
    return step.id === "source" ? source : metadata;
  }

  if (editing) {
    return (
      <AdminWizardFrame title="Edit RTU">
        <WizardShell
          key={`update-${editing.id}`}
          entry={wizardEntry("rtu.update")}
          values={values}
          onChange={(next) => setForm(rtuFormWithValues(form, next))}
          renderStep={renderStep}
          onSubmit={props.onSubmit}
          onCancel={props.onCancel}
          submitting={props.pending}
          submitError={props.error}
          current={{
            code: editing.code,
            displayName: editing.displayName,
            sourceType: editing.sourceType,
            domain: editing.domain,
            mqttTopic: editing.mqttTopic,
            externalRtuId: editing.externalRtuId,
            rtuCode: editing.rtuCode,
            stationCode: editing.stationCode,
            stationName: editing.stationName,
            ingestEnabled: editing.ingestEnabled,
          }}
          summary={wizardEntry("rtu.update").summary({
            body: wizardBody(values),
            params: { id: editing.id },
            targetName: editing.displayName,
            organizationName: "",
          })}
        />
      </AdminWizardFrame>
    );
  }
  const site = locations.find((loc) => loc.id === form.locationId);
  return (
    <AdminWizardFrame title="Add RTU">
      <WizardShell
        key="create"
        entry={wizardEntry("rtu.create")}
        values={values}
        onChange={(next) => setForm(rtuFormWithValues(form, next))}
        renderStep={renderStep}
        onSubmit={props.onSubmit}
        onCancel={props.onCancel}
        submitting={props.pending}
        submitError={props.error}
        summary={wizardEntry("rtu.create").summary({
          body: values,
          params: {},
          targetName: site?.name ?? "the site",
          organizationName: site?.organizationName ?? "its organization",
        })}
      />
    </AdminWizardFrame>
  );
}

/** A bodyless wizard's values (deactivate, reactivate): it has no field to fill. */
const NO_VALUES: Record<string, unknown> = {};

/** Deactivate or reactivate, a Review-only wizard (ruling Q9). Submit hands the write to the page, which closes it. */
export function RtuStatusWizard({
  target,
  onCancel,
  onSubmit,
}: {
  target: AdminRtuDto;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const context = { body: NO_VALUES, params: { id: target.id }, targetName: target.displayName, organizationName: "" };
  const shared = {
    values: NO_VALUES,
    onChange: () => undefined,
    renderStep: () => null,
    onSubmit: () => onSubmit(),
    onCancel,
    submitting: false,
  };
  if (target.active) {
    return (
      <AdminWizardFrame title={`Deactivate ${target.displayName}`}>
        <WizardShell
          key={`deactivate-${target.id}`}
          {...shared}
          entry={wizardEntry("rtu.deactivate")}
          summary={wizardEntry("rtu.deactivate").summary(context)}
        />
      </AdminWizardFrame>
    );
  }
  return (
    <AdminWizardFrame title={`Reactivate ${target.displayName}`}>
      <WizardShell
        key={`reactivate-${target.id}`}
        {...shared}
        entry={wizardEntry("rtu.reactivate")}
        summary={wizardEntry("rtu.reactivate").summary(context)}
      />
    </AdminWizardFrame>
  );
}
