import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import type { AdminAssetDto } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { fetchAdminLocations } from "../../api/admin/locations";
import { fetchAdminRtus } from "../../api/admin/rtus";
import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { wizardBody, type WizardStep } from "../../lib/wizard-steps";
import { WizardShell } from "../wizard/wizard-shell";
import { AdminWizardFrame, fieldClass, labelClass, metaOf } from "./admin-wizard-frame";
import { MetadataStep } from "./metadata-step";

/**
 * `F3.86` PR 3b (ADR 0099 decision 6, plan §5.2) — the assets page's create
 * (`asset.create`) and edit (`asset.update`) wizards on the shared
 * `WizardShell`: Basics → Classification → Metadata → Review, an edit with
 * Now beside After. The Review-only deactivate and reactivate are
 * `asset-status-wizard.tsx` (AGENTS.md §4.2, one exported component).
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

/** Every field as text, the way a control reports it; `""` is "none" for the optional ones. */
export type AssetForm = {
  code: string;
  name: string;
  siteName: string;
  locationId: string;
  /** `""` is "no gateway" (ADR 0018), sent as `null`. */
  rtuId: string;
  domain: string;
  /** `""` is "not in the balance" (ADR 0073 decision 1), sent as `null`. */
  waterBalanceRole: string;
  /** `""` is "none" (ADR 0088), sent as `null`. */
  rating: string;
  tripCause: string;
  /** Only a copilot fill sets it (`MetadataStep`). */
  meta?: Record<string, unknown>;
};

/** The form a create opens with: blank fields, under the page's site and gateway, on the given domain. */
export function emptyAssetForm(locationId: string, rtuId: string, domain: string): AssetForm {
  return { code: "", name: "", siteName: "", locationId, rtuId, domain, waterBalanceRole: "", rating: "", tripCause: "" };
}

/** The form an edit opens with: the stored row, every optional value `""` when null. */
export function assetFormOf(row: AdminAssetDto): AssetForm {
  return {
    code: row.code,
    name: row.name,
    siteName: row.siteName,
    locationId: row.locationId,
    rtuId: row.rtuId ?? "",
    domain: row.domain,
    waterBalanceRole: row.waterBalanceRole ?? "",
    rating: row.rating ?? "",
    tripCause: row.tripCause ?? "",
  };
}

/**
 * The `asset.create` wizard's values: the body the page has always sent. An
 * empty gateway, role, rating or trip cause is `null`, never `""` (`rtuId` is
 * a uuid, the role a vocabulary code; the schema would refuse `""`).
 */
export function createAssetValues(form: AssetForm): Record<string, unknown> {
  return {
    code: form.code,
    name: form.name,
    siteName: form.siteName,
    locationId: form.locationId,
    rtuId: form.rtuId || null,
    domain: form.domain,
    waterBalanceRole: form.waterBalanceRole || null,
    rating: form.rating.trim() || null,
    tripCause: form.tripCause.trim() || null,
    meta: form.meta,
  };
}

/**
 * The `asset.update` wizard's values: only the fields that differ from the
 * stored row, so Review lists what changes and a body without `locationId`
 * is no move (the route checks the new site only for a move). An emptied
 * optional field is `null`, which clears the stored value.
 */
export function updateAssetValues(form: AssetForm, editing: AdminAssetDto): Record<string, unknown> {
  const sent = createAssetValues(form);
  const stored: Record<string, unknown> = {
    code: editing.code,
    name: editing.name,
    siteName: editing.siteName,
    locationId: editing.locationId,
    rtuId: editing.rtuId,
    domain: editing.domain,
    waterBalanceRole: editing.waterBalanceRole,
    rating: editing.rating,
    tripCause: editing.tripCause,
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sent)) {
    if (key === "meta" ? value !== undefined : value !== stored[key]) out[key] = value;
  }
  return out;
}

/** A copilot `fill_step` written into the form. A field the fill did not carry keeps its value. */
export function assetFormWithValues(form: AssetForm, values: Readonly<Record<string, unknown>>): AssetForm {
  const next = { ...form };
  for (const key of ["code", "name", "siteName", "locationId", "domain"] as const) {
    const value = values[key];
    if (typeof value === "string") next[key] = value;
  }
  // `null` is the body's "none" for the four optional fields; the form spells it `""`.
  for (const key of ["rtuId", "waterBalanceRole", "rating", "tripCause"] as const) {
    const value = values[key];
    if (typeof value === "string") next[key] = value;
    if (value === null) next[key] = "";
  }
  const meta = metaOf(values.meta);
  if (meta !== undefined) next.meta = meta;
  return next;
}

type AssetWizardProps = {
  /** The row an edit changes; `null` for a create. */
  editing: AdminAssetDto | null;
  /** The form a create opens with (the page's site, gateway and default domain). */
  initial: AssetForm;
  /** The organization whose active sites the wizard offers (the page's filter). */
  organizationId: string | undefined;
  pending: boolean;
  error: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
};

/** `asset.create` and `asset.update`. */
export function AssetWizard(props: AssetWizardProps) {
  const { editing } = props;
  const [form, setForm] = useState<AssetForm>(() => (editing ? assetFormOf(editing) : props.initial));
  const locationsQ = useQuery({
    queryKey: ["admin", "locations", "true", props.organizationId],
    queryFn: () => fetchAdminLocations("true", props.organizationId),
  });
  const rtusQ = useQuery({
    queryKey: ["admin", "rtus", "true", form.locationId],
    queryFn: () => fetchAdminRtus("true", form.locationId || undefined),
    enabled: Boolean(form.locationId),
  });
  // ADR 0031 Amendment 1: the plant vocabulary is data; the rules page's key, one cache entry.
  const vocabQ = useQuery({ queryKey: vocabulariesQueryKey, queryFn: fetchVocabularies, staleTime: 5 * 60 * 1000 });
  const locations = locationsQ.data?.items ?? [];
  const assetDomains = vocabQ.data?.assetDomains ?? [];
  const waterBalanceRoles = vocabQ.data?.waterBalanceRoles ?? [];
  // Post-merge sweep L1: the edited asset's stored role, offered while the vocabulary no longer carries it.
  const storedRole = editing?.waterBalanceRole ?? null;
  const retiredStoredRole =
    storedRole !== null && vocabQ.isSuccess && !waterBalanceRoles.some((role) => role.code === storedRole) ? storedRole : null;
  const values = editing ? updateAssetValues(form, editing) : createAssetValues(form);

  const text = (label: string, field: "code" | "name" | "siteName" | "rating" | "tripCause", maxLength?: number) => (
    <label className={labelClass}>
      {label}
      <input
        className={fieldClass}
        value={form[field]}
        maxLength={maxLength}
        onChange={(event) => setForm({ ...form, [field]: event.target.value })}
      />
    </label>
  );

  // Every step's elements are built here, once per render; `renderStep` only picks one.
  const basics = (
    <>
      {text("Code", "code")}
      {text("Name", "name")}
      {text("Site name", "siteName")}
      <label className={labelClass}>
        Location
        <select
          className={fieldClass}
          value={form.locationId}
          // A gateway belongs to one site (`assertRtuLocation`): a new site clears it.
          onChange={(event) => setForm({ ...form, locationId: event.target.value, rtuId: "" })}
        >
          <option value="">Select location</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        RTU
        <select className={fieldClass} value={form.rtuId} onChange={(event) => setForm({ ...form, rtuId: event.target.value })}>
          {/* ADR 0018: optional — an asset read off a dial or imported from a workbook has no gateway. */}
          <option value="">No gateway — readings entered or imported</option>
          {(rtusQ.data?.items ?? []).map((rtu) => (
            <option key={rtu.id} value={rtu.id}>
              {rtu.displayName}
            </option>
          ))}
        </select>
      </label>
    </>
  );
  const classification = (
    <>
      <label className={labelClass}>
        Domain
        {/* The live vocabulary, never a hand-kept list (ADR 0031; `assets_domain_fk`). */}
        <select className={fieldClass} value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })}>
          {assetDomains.map((domain) => (
            <option key={domain.code} value={domain.code}>
              {domain.label}
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Water balance role
        {/* ADR 0073 decision 1: options from `bms.water_balance_roles`; the one literal is "none". */}
        <select
          className={fieldClass}
          value={form.waterBalanceRole}
          onChange={(event) => setForm({ ...form, waterBalanceRole: event.target.value })}
        >
          <option value="">Not in the balance</option>
          {waterBalanceRoles.map((role) => (
            <option key={role.code} value={role.code}>
              {role.label}
            </option>
          ))}
          {retiredStoredRole !== null ? <option value={retiredStoredRole}>{retiredStoredRole} (retired)</option> : null}
        </select>
      </label>
      {/* F3.74 / ADR 0088: shown on the breaker's mimic readout. Both optional. */}
      {text("Rating", "rating", 32)}
      {text("Last trip cause", "tripCause", 128)}
    </>
  );
  const metadata = <MetadataStep meta={form.meta} what="asset" />;

  function renderStep(step: WizardStep): ReactNode {
    if (step.id === "basics") return basics;
    return step.id === "classification" ? classification : metadata;
  }

  if (editing) {
    return (
      <AdminWizardFrame title="Edit asset">
        <WizardShell
          key={`update-${editing.id}`}
          entry={wizardEntry("asset.update")}
          values={values}
          onChange={(next) => setForm(assetFormWithValues(form, next))}
          renderStep={renderStep}
          onSubmit={props.onSubmit}
          onCancel={props.onCancel}
          submitting={props.pending}
          submitError={props.error}
          current={{
            code: editing.code,
            name: editing.name,
            siteName: editing.siteName,
            locationId: editing.locationId,
            rtuId: editing.rtuId,
            domain: editing.domain,
            waterBalanceRole: editing.waterBalanceRole,
            rating: editing.rating,
            tripCause: editing.tripCause,
          }}
          summary={wizardEntry("asset.update").summary({
            body: wizardBody(values),
            params: { id: editing.id },
            targetName: editing.name,
            organizationName: "",
          })}
        />
      </AdminWizardFrame>
    );
  }
  const site = locations.find((loc) => loc.id === form.locationId);
  return (
    <AdminWizardFrame title="Add asset">
      <WizardShell
        key="create"
        entry={wizardEntry("asset.create")}
        values={values}
        onChange={(next) => setForm(assetFormWithValues(form, next))}
        renderStep={renderStep}
        onSubmit={props.onSubmit}
        onCancel={props.onCancel}
        submitting={props.pending}
        submitError={props.error}
        summary={wizardEntry("asset.create").summary({
          body: values,
          params: {},
          targetName: site?.name ?? "the site",
          organizationName: site?.organizationName ?? "its organization",
        })}
      />
    </AdminWizardFrame>
  );
}
