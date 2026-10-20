import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { QUALITY_POLICIES } from "@bms/shared";
import type { AdminAssetPointDto, QualityPolicy } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { fetchAdminAssets } from "../../api/admin/assets";
import { fetchAdminPointKeys } from "../../api/admin/point-keys";
import { fetchAdminRtus } from "../../api/admin/rtus";
import { createBodyFrom, editBodyFrom, formFrom, type AssetPointForm } from "../../lib/asset-point-form";
import { wizardBody, type WizardStep } from "../../lib/wizard-steps";
import { WizardShell } from "../wizard/wizard-shell";
import { AdminWizardFrame, fieldClass, labelClass } from "./admin-wizard-frame";

/**
 * `F3.86` PR 3b (ADR 0099 decision 6, plan §5.2) — the asset-points page's
 * create (`assetPoint.create`) and edit (`assetPoint.update`) wizards on the
 * shared `WizardShell`: Mapping → Instrument → Review, an edit with Now
 * beside After. It left `asset-points-page.tsx`, which may not grow (plan
 * §5.2). The Review-only deactivate and reactivate are
 * `asset-point-status-wizard.tsx` (AGENTS.md §4.2).
 *
 * The values are `lib/asset-point-form.ts`'s two bodies: a create omits
 * every empty box, an edit is the diff against the loaded row (`F2.31`).
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

/**
 * The suffix on the synthetic option that holds a stored RTU the location list
 * does not. "loading" only while the fetch runs: a query that is disabled (no
 * location) or failed never succeeds, and "loading" there would read as forever.
 */
function storedRtuLabel(rtusQ: { isSuccess: boolean; isFetching: boolean }): string {
  if (rtusQ.isSuccess) return "not in this location";
  return rtusQ.isFetching ? "loading" : "unknown RTU";
}

const NUMBER_FIELDS = ["scaleMultiplier", "scaleOffset", "engMin", "engMax"] as const;

/**
 * A copilot `fill_step` written into the form. A field the fill did not carry
 * keeps its value; `null` is the body's "clear" and the form's empty box.
 */
export function assetPointFormWithValues(form: AssetPointForm, values: Readonly<Record<string, unknown>>): AssetPointForm {
  const next = { ...form };
  for (const key of ["assetId", "pointKey", "sourceDataKey", "sensorCode", "unit", "rtuId"] as const) {
    const value = values[key];
    if (typeof value === "string") next[key] = value;
    if (value === null && key === "rtuId") next.rtuId = "";
  }
  for (const key of NUMBER_FIELDS) {
    const value = values[key];
    if (typeof value === "number") next[key] = String(value);
    if (value === null) next[key] = "";
  }
  if (QUALITY_POLICIES.includes(values.qualityPolicy as QualityPolicy)) next.qualityPolicy = values.qualityPolicy as QualityPolicy;
  if (values.qualityPolicy === null) next.qualityPolicy = "";
  return next;
}

type AssetPointWizardProps = {
  /** The row an edit changes; `null` for a create. */
  editing: AdminAssetPointDto | null;
  /** The form a create opens with (the routed or filtered asset, or `""`). */
  initial: AssetPointForm;
  /** The routed asset's code, shown instead of a picker; `null` lets a create pick one. */
  assetLabel: string | null;
  /** The routed asset's location, or the filter's (ADR 0056 Amendment 3 part A); `null` when unknown. */
  locationId: string | null;
  pending: boolean;
  error: string | null;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
};

/** `assetPoint.create` and `assetPoint.update`. */
export function AssetPointWizard(props: AssetPointWizardProps) {
  const { editing } = props;
  const [form, setForm] = useState<AssetPointForm>(() => (editing ? formFrom(editing) : props.initial));
  const pickAsset = !editing && props.assetLabel === null;
  const assetsQ = useQuery({
    queryKey: ["admin", "assets", "true", props.locationId ?? undefined],
    queryFn: () => fetchAdminAssets("true", props.locationId ?? undefined),
    enabled: pickAsset,
  });
  const picked = (assetsQ.data?.items ?? []).find((asset) => asset.id === form.assetId);
  // `F3.39`: one fleet-wide catalog, so no organization in the key.
  const catalogQ = useQuery({ queryKey: ["admin", "point-keys", "true"], queryFn: () => fetchAdminPointKeys("true") });
  // ADR 0056 Amendment 3 part A (`F2.27`): the RTUs of the asset's location — the row's own on Edit,
  // the routed asset's or the filter's on Add, else the picked asset's. Unknown: disabled, with a hint.
  const formLocationId = editing?.locationId ?? props.locationId ?? picked?.locationId ?? null;
  const rtusQ = useQuery({
    queryKey: ["admin", "rtus", "all", formLocationId],
    queryFn: () => fetchAdminRtus("all", formLocationId ?? undefined),
    enabled: formLocationId !== null,
  });
  const rtuOptions = rtusQ.data?.items ?? [];
  // A stored RTU the location list no longer holds keeps an option, or the select shows blank.
  const storedRtuMissing = editing?.rtuId != null && !rtuOptions.some((option) => option.id === editing.rtuId);
  const values: Record<string, unknown> = editing ? { ...editBodyFrom(editing, form) } : { ...createBodyFrom(form) };

  const text = (label: string, field: "sourceDataKey" | "sensorCode" | "unit") => (
    <label className={labelClass}>
      {label}
      <input className={fieldClass} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} />
    </label>
  );
  const numberBox = (label: string, field: (typeof NUMBER_FIELDS)[number]) => (
    <label className={labelClass}>
      {label}
      <input
        type="number"
        step="any"
        aria-label={label}
        className={fieldClass}
        value={form[field]}
        onChange={(event) => setForm({ ...form, [field]: event.target.value })}
      />
    </label>
  );

  // Every step's elements are built here, once per render; `renderStep` only picks one.
  const mapping = (
    <>
      {pickAsset ? (
        <label className={labelClass}>
          Asset
          <select className={fieldClass} value={form.assetId} onChange={(event) => setForm({ ...form, assetId: event.target.value, rtuId: "" })}>
            <option value="">Select asset</option>
            {(assetsQ.data?.items ?? []).map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.code} · {asset.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-xs text-ink-muted">{`Asset: ${editing?.assetCode ?? props.assetLabel ?? ""}`}</p>
      )}
      <label className={labelClass}>
        Point key
        <select
          className={fieldClass}
          value={form.pointKey}
          onChange={(event) => {
            const selected = (catalogQ.data?.items ?? []).find((item) => item.code === event.target.value);
            setForm({ ...form, pointKey: event.target.value, unit: selected?.unit ?? form.unit });
          }}
        >
          <option value="">Select catalog point key</option>
          {(catalogQ.data?.items ?? []).map((item) => (
            <option key={item.id} value={item.code}>
              {item.code} · {item.name}
            </option>
          ))}
        </select>
      </label>
      {text("Source data key", "sourceDataKey")}
      {text("Sensor code", "sensorCode")}
      {text("Unit", "unit")}
      {/* `F2.27`: blank on Add is omitted (the asset's gateway); blank on Edit is `rtuId: null`
          (unwire) — sent only when changed (`editBodyFrom`), so a computed row stays editable. */}
      <label className={labelClass}>
        RTU
        <select
          aria-label="RTU"
          className={fieldClass}
          value={form.rtuId}
          disabled={formLocationId === null}
          onChange={(event) => setForm({ ...form, rtuId: event.target.value })}
        >
          <option value="">{editing ? "Unwired" : "Inherit the asset's gateway"}</option>
          {rtuOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.code} · {option.displayName}
              {option.active ? "" : " (inactive)"}
            </option>
          ))}
          {storedRtuMissing && editing?.rtuId ? (
            <option value={editing.rtuId}>
              {editing.rtuId} ({storedRtuLabel(rtusQ)})
            </option>
          ) : null}
        </select>
        <span className="mt-1 block text-[11px] font-normal">
          {formLocationId === null
            ? "Choose a location to pick an RTU"
            : editing
              ? "On an existing mapping, blank unwires the point (a measured point becomes unmapped)."
              : "Blank keeps the asset's own gateway."}
        </span>
      </label>
    </>
  );
  // `F2.7` / ADR 0056 decision 1 — the per-asset override of the five. Empty follows the
  // template: omitted on a create, an explicit `null` on an edit of a stored value.
  const instrument = (
    <>
      <p className="text-[11px] text-ink-muted">
        Leave a field below empty to follow this asset&apos;s template default. Clearing one on an existing mapping puts it
        back on the template.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {numberBox("Scale multiplier", "scaleMultiplier")}
        {numberBox("Scale offset", "scaleOffset")}
        {numberBox("Engineering minimum", "engMin")}
        {numberBox("Engineering maximum", "engMax")}
        <label className={labelClass}>
          Quality policy
          <select
            aria-label="Quality policy"
            className={fieldClass}
            value={form.qualityPolicy}
            onChange={(event) => setForm({ ...form, qualityPolicy: event.target.value as QualityPolicy | "" })}
          >
            {/* The two policies are `packages/shared`'s vocabulary, never a second list (§4.8). */}
            <option value="">Follow the template</option>
            {QUALITY_POLICIES.map((policy) => (
              <option key={policy} value={policy}>
                {policy}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );

  function renderStep(step: WizardStep): ReactNode {
    return step.id === "mapping" ? mapping : instrument;
  }

  if (editing) {
    return (
      <AdminWizardFrame title="Edit mapping">
        <WizardShell
          key={`update-${editing.id}`}
          entry={wizardEntry("assetPoint.update")}
          values={values}
          onChange={(next) => setForm(assetPointFormWithValues(form, next))}
          renderStep={renderStep}
          onSubmit={props.onSubmit}
          onCancel={props.onCancel}
          submitting={props.pending}
          submitError={props.error}
          current={{
            pointKey: editing.pointKey,
            sourceDataKey: editing.sourceDataKey,
            sensorCode: editing.sensorCode,
            unit: editing.unit,
            rtuId: editing.rtuId,
            scaleMultiplier: editing.scaleMultiplier,
            scaleOffset: editing.scaleOffset,
            engMin: editing.engMin,
            engMax: editing.engMax,
            qualityPolicy: editing.qualityPolicy,
          }}
          summary={wizardEntry("assetPoint.update").summary({
            body: wizardBody(values),
            params: { id: editing.id },
            targetName: editing.pointKey,
            organizationName: "",
          })}
        />
      </AdminWizardFrame>
    );
  }
  return (
    <AdminWizardFrame title="Add mapping">
      <WizardShell
        key="create"
        entry={wizardEntry("assetPoint.create")}
        params={{}}
        // `F4.245` (critique C2): on an asset's page the asset is fixed, so a fill never moves the mapping.
        fixedFields={pickAsset ? undefined : ["assetId"]}
        values={values}
        onChange={(next) => setForm(assetPointFormWithValues(form, next))}
        renderStep={renderStep}
        onSubmit={props.onSubmit}
        onCancel={props.onCancel}
        submitting={props.pending}
        submitError={props.error}
        summary={wizardEntry("assetPoint.create").summary({
          body: values,
          params: {},
          targetName: picked?.name ?? props.assetLabel ?? "the asset",
          organizationName: "its organization",
        })}
      />
    </AdminWizardFrame>
  );
}
