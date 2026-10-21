import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import type { AdminLocationDto } from "@bms/shared";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";

import { fetchAdminLocations, fetchAdminLocationTypes } from "../../api/admin/locations";
import { locationTreeOptions, subtreeIds } from "../../lib/location-tree";
import { wizardBody, type WizardStep } from "../../lib/wizard-steps";
import { WizardShell } from "../wizard/wizard-shell";
import { AdminWizardFrame, fieldClass, labelClass, metaOf, numberOf } from "./admin-wizard-frame";
import { LocationMoveDialog } from "./location-move-dialog";
import { MetadataStep } from "./metadata-step";

/**
 * `F3.86` PR 3a (ADR 0099 decision 6, plan §5.2) — the locations page's
 * wizards on the shared `WizardShell`: create (`location.create`, Basics →
 * Place → Metadata → Review), edit (`location.update`, the same steps, Now
 * beside After), and the Review-only deactivate and reactivate (ruling Q9).
 * They left `locations-page.tsx` so it stays under the §4.5 cap.
 *
 * Each `<WizardShell>` writes the literal `entry={wizardEntry("<id>")}` (the
 * stepper gate's form). Submit hands the body Review parsed to the page,
 * which sends the plain request — never an `X-Copilot-Change` header: a
 * wizard used alone is not a copilot change.
 *
 * The wizard is not a `<form>`, so no `required` attribute holds a field: a
 * required text stays the string typed (`""` fails its own schema on the
 * step) and an emptied number is `undefined` (Review names it), never
 * `Number("")`, which is `0`.
 */

/** The catalog entry, or a build defect (the `calc-parameters-page.tsx` rule). */
function wizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F3.86: the catalog has no entry "${id}"`);
  return entry;
}

export type LocationForm = {
  organizationId: string;
  code: string;
  slug: string;
  name: string;
  /** `""` until the administrator picks: the types list's first code is then the value. */
  type: string;
  province: string;
  capital: string;
  timezone: string;
  latitude: string;
  longitude: string;
  /** `F2.10` (ADR 0098) — the parent's id; `""` is a root. */
  parentId: string;
  /** Only a copilot fill sets it (`MetadataStep`). */
  meta?: Record<string, unknown>;
};

export const EMPTY_LOCATION_FORM: LocationForm = {
  organizationId: "",
  code: "",
  slug: "",
  name: "",
  type: "",
  province: "",
  capital: "",
  timezone: "",
  // `F3.79` (owner ruling 2026-10-04): Mumbai, not (0,0). Every active location is a map pin,
  // and a pin at (0,0) sat in the Gulf of Guinea and stretched the map's box.
  latitude: "19.076",
  longitude: "72.8777",
  parentId: "",
};

/** The form an edit opens with: the stored row, every optional text `""` when null. */
export function locationFormOf(row: AdminLocationDto): LocationForm {
  return {
    organizationId: row.organizationId,
    code: row.code,
    slug: row.slug,
    name: row.name,
    type: row.type,
    province: row.province ?? "",
    capital: row.capital ?? "",
    timezone: row.timezone ?? "",
    latitude: String(row.latitude),
    longitude: String(row.longitude),
    parentId: row.parentId ?? "",
  };
}

/** The fields create and edit send alike. An empty optional text is `null` (it clears), never `""`. */
function placeValues(form: LocationForm): Record<string, unknown> {
  return {
    province: form.province || null,
    capital: form.capital || null,
    latitude: numberOf(form.latitude),
    longitude: numberOf(form.longitude),
    timezone: form.timezone || null,
  };
}

/**
 * The `location.create` wizard's values. `type` is the resolved one (the
 * list's first code when untouched); an organization not picked stays `""`,
 * which fails the uuid check and holds the wizard on Basics.
 */
export function createLocationValues(form: LocationForm, type: string): Record<string, unknown> {
  return {
    organizationId: form.organizationId,
    code: form.code,
    slug: form.slug,
    name: form.name,
    type: type === "" ? undefined : type,
    parentId: form.parentId || null,
    ...placeValues(form),
    meta: form.meta,
  };
}

/**
 * The `location.update` wizard's values. `type` only when the administrator
 * changed it (`F4.162` D8: an untouched retired type is not among the active
 * codes); `parentId` only when a role that may move picked another parent —
 * any body that names it is a 403 below the organization level (ADR 0098
 * decision 12).
 */
export function updateLocationValues(
  form: LocationForm,
  editing: AdminLocationDto,
  type: string,
  canMove: boolean,
): Record<string, unknown> {
  const moved = canMove && form.parentId !== (editing.parentId ?? "");
  return {
    code: form.code,
    slug: form.slug,
    name: form.name,
    type: type === editing.type ? undefined : type,
    parentId: moved ? form.parentId || null : undefined,
    ...placeValues(form),
    meta: form.meta,
  };
}

/** A copilot `fill_step` written into the form. A field the fill did not carry keeps its text. */
export function locationFormWithValues(form: LocationForm, values: Readonly<Record<string, unknown>>): LocationForm {
  const next = { ...form };
  const texts = ["organizationId", "code", "slug", "name", "type", "province", "capital", "timezone"] as const;
  for (const key of texts) {
    const value = values[key];
    if (typeof value === "string") next[key] = value;
    else if (value === null && key !== "organizationId") next[key] = "";
  }
  if (typeof values.latitude === "number") next.latitude = String(values.latitude);
  if (typeof values.longitude === "number") next.longitude = String(values.longitude);
  if (typeof values.parentId === "string") next.parentId = values.parentId;
  else if (values.parentId === null) next.parentId = "";
  const meta = metaOf(values.meta);
  if (meta !== undefined) next.meta = meta;
  return next;
}

/**
 * E4.1b (plan Q13): the zone list the form OFFERS is the browser's — no
 * endpoint; the server validates against `pg_timezone_names` on write.
 * Guarded: `Intl.supportedValuesOf` is ES2022 and absent on older engines,
 * where the input stays a free-text field.
 */
function browserTimezones(): string[] {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
}

type LocationWizardProps = {
  /** The row an edit changes; `null` for a create. */
  editing: AdminLocationDto | null;
  /** A create's organization, preselected from the page's filter. */
  organizationId: string;
  organizations: readonly { id: string; code: string; name: string }[];
  /** `F2.10` (ADR 0098 decision 12) — only an organization-level administrator moves a node. */
  canMove: boolean;
  /** The parent's name an edit shows to a role that may not move it. */
  parentName: string;
  pending: boolean;
  error: string | null;
  /** The body Review parsed; a move has been confirmed in the move dialog first. */
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
};

/** `location.create` and `location.update`. A body that moves the node asks in `LocationMoveDialog` first. */
export function LocationWizard(props: LocationWizardProps) {
  const { editing, canMove } = props;
  const [form, setForm] = useState<LocationForm>(() =>
    editing ? locationFormOf(editing) : { ...EMPTY_LOCATION_FORM, organizationId: props.organizationId },
  );
  /** `F2.10` — the moving body the administrator is asked to confirm; `null` while none is pending. */
  const [pendingMove, setPendingMove] = useState<Record<string, unknown> | null>(null);
  const timezones = useMemo(browserTimezones, []);

  // `F4.157` (D9) — the Type select's vocabulary; the admin write paths refuse a code that is
  // not one of these active rows.
  const typesQ = useQuery({ queryKey: ["admin", "location-types"], queryFn: fetchAdminLocationTypes });
  const types = typesQ.data?.items ?? [];
  /** `form.type` once picked, otherwise the list's first code — the select and the body agree. */
  const resolvedType = form.type || types[0]?.code || "";

  // `F2.10` (ADR 0098 B6) — the Parent select's vocabulary: the organization's ACTIVE nodes (an
  // inactive parent is a guaranteed 409). On edit only a role that may move reads it. The move
  // dialog reads its chains from the same list.
  const parentsQ = useQuery({
    queryKey: ["admin", "locations", "true", form.organizationId],
    queryFn: () => fetchAdminLocations("true", form.organizationId),
    enabled: Boolean(form.organizationId) && (!editing || canMove),
  });
  const parentNodes = useMemo(() => parentsQ.data?.items ?? [], [parentsQ.data?.items]);
  const parentOptions = useMemo(() => {
    // Editing: never the node itself or one of its descendants (the server refuses a cycle too).
    const excluded = editing ? subtreeIds(parentNodes, editing.id) : new Set<string>();
    return locationTreeOptions(parentNodes.filter((n) => !excluded.has(n.id)));
  }, [editing, parentNodes]);

  const values = editing
    ? updateLocationValues(form, editing, resolvedType, canMove)
    : createLocationValues(form, resolvedType);

  // Every step's elements are built here, once per render; `renderStep` only picks one (the
  // `calc-parameters-page.tsx` rule: a new element between a select's events can lose a pick).
  const basics = (
    <>
      {!editing ? (
        <label className={labelClass}>
          Organization
          <select
            className={fieldClass}
            value={form.organizationId}
            onChange={(event) =>
              // `F2.10` — a parent picked in another organization is not an option here.
              setForm({ ...form, organizationId: event.target.value, parentId: "" })
            }
          >
            <option value="">Select organization</option>
            {props.organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.code} · {org.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {!editing || canMove ? (
        <label className={labelClass}>
          Parent
          <select
            className={fieldClass}
            value={form.parentId}
            disabled={!form.organizationId}
            onChange={(event) => setForm({ ...form, parentId: event.target.value })}
          >
            <option value="">No parent (root)</option>
            {parentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="text-xs text-ink-muted">{`Parent: ${props.parentName}`}</div>
      )}
      {(["code", "slug", "name"] as const).map((field) => (
        <label key={field} className={labelClass}>
          {field}
          <input
            className={fieldClass}
            value={form[field]}
            onChange={(event) => setForm({ ...form, [field]: event.target.value })}
          />
        </label>
      ))}
      <label className={labelClass}>
        Type
        <select
          className={fieldClass}
          value={resolvedType}
          disabled={types.length === 0}
          onChange={(event) => setForm({ ...form, type: event.target.value })}
        >
          {/* Only once the list has loaded: while it is pending or failed, `types` is empty and
              every row's own type would read as "(retired)". */}
          {typesQ.isSuccess && editing && !types.some((locationType) => locationType.code === editing.type) ? (
            <option value={editing.type}>{editing.typeLabel} (retired)</option>
          ) : null}
          {types.map((locationType) => (
            <option key={locationType.code} value={locationType.code}>
              {locationType.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );

  const textInput = (label: string, field: "province" | "capital" | "latitude" | "longitude") => (
    <label className={labelClass}>
      {label}
      <input
        className={fieldClass}
        value={form[field]}
        onChange={(event) => setForm({ ...form, [field]: event.target.value })}
      />
    </label>
  );
  const place = (
    <>
      {textInput("Province", "province")}
      {textInput("Capital", "capital")}
      {textInput("Latitude", "latitude")}
      {textInput("Longitude", "longitude")}
      <label className={labelClass}>
        Timezone (IANA)
        <input
          className={fieldClass}
          list="tz-list"
          placeholder="Asia/Kolkata"
          value={form.timezone}
          onChange={(event) => setForm({ ...form, timezone: event.target.value })}
        />
        <datalist id="tz-list">
          {timezones.map((tz) => (
            <option key={tz} value={tz} />
          ))}
        </datalist>
      </label>
    </>
  );
  const metadata = <MetadataStep meta={form.meta} what="location" />;

  function renderStep(step: WizardStep): ReactNode {
    if (step.id === "basics") return basics;
    return step.id === "place" ? place : metadata;
  }

  function submit(body: Record<string, unknown>): void {
    // `F2.10` — a changed parent is confirmed in the move dialog first.
    if (editing && "parentId" in body) {
      setPendingMove(body);
      return;
    }
    props.onSubmit(body);
  }

  const organizationName = props.organizations.find((org) => org.id === form.organizationId)?.name ?? "the organization";

  return (
    <AdminWizardFrame title={editing ? "Edit location" : "Add location"}>
      {editing ? (
        <WizardShell
          key={`update-${editing.id}`}
          entry={wizardEntry("location.update")}
          params={{ id: editing.id }}
          values={values}
          onChange={(next) => setForm(locationFormWithValues(form, next))}
          renderStep={renderStep}
          onSubmit={submit}
          onCancel={props.onCancel}
          submitting={props.pending}
          submitError={props.error}
          current={{
            code: editing.code,
            slug: editing.slug,
            name: editing.name,
            type: editing.type,
            parentId: editing.parentId,
            province: editing.province,
            capital: editing.capital,
            latitude: editing.latitude,
            longitude: editing.longitude,
            timezone: editing.timezone,
          }}
          summary={wizardEntry("location.update").summary({
            body: wizardBody(values),
            params: { id: editing.id },
            targetName: editing.name,
            organizationName: editing.organizationName,
          })}
        />
      ) : (
        <WizardShell
          key="create"
          entry={wizardEntry("location.create")}
          params={{}}
          values={values}
          onChange={(next) => setForm(locationFormWithValues(form, next))}
          renderStep={renderStep}
          onSubmit={submit}
          onCancel={props.onCancel}
          submitting={props.pending}
          submitError={props.error}
          summary={wizardEntry("location.create").summary({ body: values, params: {}, targetName: "", organizationName })}
        />
      )}
      {pendingMove && editing ? (
        <LocationMoveDialog
          node={{ id: editing.id, name: editing.name, organizationId: editing.organizationId }}
          fromParentId={editing.parentId}
          toParentId={(pendingMove.parentId as string | null) ?? null}
          nodes={parentNodes}
          onClose={() => setPendingMove(null)}
          onConfirm={() => {
            const body = pendingMove;
            setPendingMove(null);
            props.onSubmit(body);
          }}
        />
      ) : null}
    </AdminWizardFrame>
  );
}

/** A bodyless wizard's values (deactivate, reactivate): it has no field to fill. */
const NO_VALUES: Record<string, unknown> = {};

/**
 * Deactivate or reactivate, a Review-only wizard (ruling Q9) in place of the
 * row's direct write. Submit hands the write to the page, which closes the
 * wizard; a refusal (an active child, an inactive parent) shows on the list.
 */
export function LocationStatusWizard({
  target,
  onCancel,
  onSubmit,
}: {
  target: AdminLocationDto;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const context = { body: NO_VALUES, params: { id: target.id }, targetName: target.name, organizationName: "" };
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
      <AdminWizardFrame title={`Deactivate ${target.name}`}>
        <WizardShell
          key={`deactivate-${target.id}`}
          {...shared}
          entry={wizardEntry("location.deactivate")}
          params={{ id: target.id }}
          summary={wizardEntry("location.deactivate").summary(context)}
        />
      </AdminWizardFrame>
    );
  }
  return (
    <AdminWizardFrame title={`Reactivate ${target.name}`}>
      <WizardShell
        key={`reactivate-${target.id}`}
        {...shared}
        entry={wizardEntry("location.reactivate")}
        params={{ id: target.id }}
        summary={wizardEntry("location.reactivate").summary(context)}
      />
    </AdminWizardFrame>
  );
}
