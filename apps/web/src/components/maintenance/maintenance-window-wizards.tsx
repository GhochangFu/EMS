import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { type CatalogEntry, catalogEntry } from "@bms/shared/copilot";
import {
  type CloseMaintenanceWindowBody,
  type CreateMaintenanceWindowBody,
  type ExtendMaintenanceWindowBody,
  MAINTENANCE_WINDOW_MAX_MS,
  type MaintenanceWindowItem,
  type MaintenanceWindowTarget,
  maintenanceWindowTargetSchema,
} from "@bms/shared/contracts";

import { fetchAdminAssets } from "../../api/admin/assets";
import { fetchAdminLocations } from "../../api/admin/locations";
import { fetchMaintenanceSchedules } from "../../api/maintenance";
import {
  cancelMaintenanceWindow,
  createMaintenanceWindow,
  endMaintenanceWindow,
  extendMaintenanceWindow,
} from "../../api/maintenance-windows";
import { fetchRules } from "../../api/rules";
import { fetchWorkOrders } from "../../api/work-orders";
import { alarmBarFeed } from "../../lib/alarm-bar-feed";
import { apiErrorMessage } from "../../lib/api-error-message";
import { wizardBody, type WizardStep } from "../../lib/wizard-steps";
import { AdminWizardFrame, fieldClass, labelClass } from "../admin/admin-wizard-frame";
import { WizardShell } from "../wizard/wizard-shell";

/**
 * `F4.359` U15 (ADR 0131 decisions 2 and 16; plan ruling Q6; ADR 0099 Amendment 19) — the four
 * maintenance-window wizards on the shared `WizardShell`: create (`maintenanceWindow.create`,
 * Window → Targets → Link → Review), extend (New end → Review), and end and cancel (Reason →
 * Review). Each `<WizardShell>` writes the literal `entry={maintenanceWindowWizardEntry("<id>")}`
 * (the stepper gate's form) and the three row wizards name their window in `params`.
 *
 * Each submit sends the plain request (no `X-Copilot-Change` header), invalidates
 * `["maintenance-windows"]` — every list and the alarm bar's maintenance read — and asks the alarm
 * bar's feed for a fresh read, since a window changes which alarms it counts. A refusal (a 409
 * for a window that changed state meanwhile) stays in the wizard with the route's sentence, and
 * the lists are refetched so the page shows the window's state now.
 */

/** The catalog entry, or a build defect (the `rtu-wizards.tsx` rule). */
export function maintenanceWindowWizardEntry(id: string): CatalogEntry {
  const entry = catalogEntry(id);
  if (!entry) throw new Error(`F4.359: the catalog has no entry "${id}"`);
  return entry;
}

/** Which wizard the page has open: a create, or an action on one window. */
export type MaintenanceWindowDialog =
  | { readonly kind: "create" }
  | { readonly kind: "extend" | "end" | "cancel"; readonly window: MaintenanceWindowItem };

const DAY_MS = 24 * 60 * 60 * 1000;
/** The 7-day bound in days, from the contract's one constant. */
export const WINDOW_MAX_DAYS = MAINTENANCE_WINDOW_MAX_MS / DAY_MS;
/** Decision 2 at creation: the Window step's refusal. */
export const WINDOW_LENGTH_RULE = `A maintenance window may run at most ${WINDOW_MAX_DAYS} days: choose an end at most ${WINDOW_MAX_DAYS} days after the start.`;
/** Decision 2 at an extension: the New end step's refusal. */
export const EXTEND_LENGTH_RULE = `A maintenance window may be extended to at most ${WINDOW_MAX_DAYS} days from now.`;
/** The Review line of an end and a cancel. */
export const WINDOW_CANNOT_BE_UNDONE = "This cannot be undone.";
/** The route's bound on targets in one window (`createMaintenanceWindowBodySchema`). */
const MAX_TARGETS = 200;
/** The route's grace for a start a little in the past (`maintenance-window-period.ts`). */
const START_GRACE_MS = 60_000;
/** At most this many matches per kind are listed; the search narrows the rest. */
const MATCHES_SHOWN = 50;
const WINDOWS_KEY = ["maintenance-windows"] as const;

const pad = (n: number): string => String(n).padStart(2, "0");

/** A `datetime-local` input's value for `date`, in the browser's zone. */
export function localInputOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The ISO instant of a `datetime-local` value; `undefined` when empty or not a time. */
export function isoOfLocalInput(text: string): string | undefined {
  if (text.trim() === "") return undefined;
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** An optional text: `undefined` (not sent) when blank. */
const optional = (text: string): string | undefined => (text.trim() === "" ? undefined : text);

/** Amendment 19 decision 1: a window is named by its reason, cut at 80 characters. */
function windowName(reason: string): string {
  return reason.length > 80 ? `${reason.slice(0, 79)}…` : reason;
}

/** The fields a row entry's summary reads about its window. */
function summaryWindow(item: MaintenanceWindowItem) {
  return {
    reason: item.reason,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    targetLabels: item.targets.map((target) => target.label),
    locationLabels: item.targets.filter((target) => target.kind === "location").map((target) => target.label),
    coveredAssetCount: item.assetIds.length,
  };
}

/** One write: on success the lists and the bar refresh and the wizard closes; on a refusal the lists refetch. */
function useWindowWrite(write: (body: Record<string, unknown>) => Promise<unknown>, onClose: () => void) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: write,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...WINDOWS_KEY] });
      alarmBarFeed()?.refreshNow();
      onClose();
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: [...WINDOWS_KEY] });
    },
  });
  return {
    submit: (body: Record<string, unknown>) => mutation.mutate(body),
    pending: mutation.isPending,
    error: mutation.error ? apiErrorMessage(mutation.error) : null,
  };
}

type CreateForm = {
  reason: string;
  startNow: boolean;
  start: string;
  end: string;
  targets: MaintenanceWindowTarget[];
  workOrderId: string;
  maintenanceScheduleId: string;
};

const EMPTY_CREATE: CreateForm = {
  reason: "",
  startNow: true,
  start: "",
  end: "",
  targets: [],
  workOrderId: "",
  maintenanceScheduleId: "",
};

/** The create body: "Now" leaves `startsAt` out (the route reads its absence as now). */
function createValues(form: CreateForm): Record<string, unknown> {
  return {
    reason: form.reason,
    startsAt: form.startNow ? undefined : isoOfLocalInput(form.start),
    endsAt: isoOfLocalInput(form.end),
    targets: form.targets,
    workOrderId: optional(form.workOrderId),
    maintenanceScheduleId: optional(form.maintenanceScheduleId),
  };
}

/** A copilot `fill_step` written into the create form. A field the fill did not carry keeps its value. */
function createFormWithValues(form: CreateForm, values: Readonly<Record<string, unknown>>): CreateForm {
  const next = { ...form };
  if (typeof values.reason === "string") next.reason = values.reason;
  if (typeof values.startsAt === "string" && isoOfLocalInput(values.startsAt) !== undefined) {
    next.startNow = false;
    next.start = localInputOf(new Date(values.startsAt));
  }
  if (typeof values.endsAt === "string" && isoOfLocalInput(values.endsAt) !== undefined) {
    next.end = localInputOf(new Date(values.endsAt));
  }
  const targets = maintenanceWindowTargetSchema.array().safeParse(values.targets);
  if (targets.success) next.targets = targets.data;
  if (typeof values.workOrderId === "string") next.workOrderId = values.workOrderId;
  if (typeof values.maintenanceScheduleId === "string") next.maintenanceScheduleId = values.maintenanceScheduleId;
  return next;
}

/** Decision 2 on the Window step: the sentence that keeps it, or `null`. */
function windowBlocker(form: CreateForm, now: number): string | null {
  const end = isoOfLocalInput(form.end);
  if (end === undefined) return "Choose when the window ends.";
  const start = form.startNow ? now : isoOfLocalInput(form.start);
  if (start === undefined) return "Choose when the window starts, or pick Now.";
  const startMs = typeof start === "number" ? start : Date.parse(start);
  const endMs = Date.parse(end);
  if (startMs < now - START_GRACE_MS) return "A maintenance window cannot start in the past.";
  if (endMs <= startMs) return "A maintenance window must end after its start.";
  if (endMs - startMs > MAINTENANCE_WINDOW_MAX_MS) return WINDOW_LENGTH_RULE;
  return null;
}

const targetId = (target: MaintenanceWindowTarget): string =>
  target.kind === "asset" ? target.assetId : target.kind === "location" ? target.locationId : target.ruleId;

/** `maintenanceWindow.create`: Window, Targets, Link, Review. */
function CreateWindowWizard({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<CreateForm>(EMPTY_CREATE);
  const [search, setSearch] = useState("");
  const write = useWindowWrite((body) => createMaintenanceWindow(body as CreateMaintenanceWindowBody), onClose);
  // The reads the caller's own scope answers: every target it lists, the caller can read.
  const assetsQ = useQuery({ queryKey: ["admin", "assets", "true"], queryFn: () => fetchAdminAssets("true") });
  const locationsQ = useQuery({ queryKey: ["admin", "locations", "true", undefined], queryFn: () => fetchAdminLocations("true") });
  const rulesQ = useQuery({ queryKey: ["rules"], queryFn: fetchRules });
  const workOrdersQ = useQuery({ queryKey: ["work-orders", 100], queryFn: () => fetchWorkOrders(100) });
  const schedulesQ = useQuery({
    queryKey: ["maintenance-schedules", "window-link"],
    queryFn: () => fetchMaintenanceSchedules({ horizonDays: 120 }),
  });
  const assets = assetsQ.data?.items ?? [];
  const locations = locationsQ.data?.items ?? [];
  const rules = rulesQ.data?.items ?? [];
  const values = createValues(form);
  const now = Date.now();

  const chosen = new Set(form.targets.map((target) => `${target.kind}:${targetId(target)}`));
  const toggle = (target: MaintenanceWindowTarget): void => {
    const key = `${target.kind}:${targetId(target)}`;
    setForm({
      ...form,
      targets: chosen.has(key) ? form.targets.filter((t) => `${t.kind}:${targetId(t)}` !== key) : [...form.targets, target],
    });
  };
  const needle = search.trim().toLowerCase();
  const matches = <T,>(items: readonly T[], label: (item: T) => string): T[] =>
    items.filter((item) => needle === "" || label(item).toLowerCase().includes(needle)).slice(0, MATCHES_SHOWN);

  const assetLabel = (asset: (typeof assets)[number]) => `${asset.name} (${asset.code})`;
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const labelOf = (target: MaintenanceWindowTarget): string => {
    if (target.kind === "asset") {
      const asset = assets.find((candidate) => candidate.id === target.assetId);
      return asset ? assetLabel(asset) : target.assetId;
    }
    if (target.kind === "location") return locationById.get(target.locationId)?.name ?? target.locationId;
    return rules.find((rule) => rule.id === target.ruleId)?.name ?? target.ruleId;
  };
  // Decision 3: a location target covers its subtree; the card counts the assets it covers now.
  const chosenLocations = form.targets.flatMap((target) => (target.kind === "location" ? [target.locationId] : []));
  const covered = new Set(chosenLocations);
  for (let grew = true; grew; ) {
    grew = false;
    for (const location of locations) {
      if (location.parentId !== null && covered.has(location.parentId) && !covered.has(location.id)) {
        covered.add(location.id);
        grew = true;
      }
    }
  }
  const organizationName =
    form.targets
      .map((target) =>
        target.kind === "location"
          ? locationById.get(target.locationId)?.organizationName
          : target.kind === "asset"
            ? locationById.get(assets.find((asset) => asset.id === target.assetId)?.locationId ?? "")?.organizationName
            : undefined,
      )
      .find((name) => name !== undefined) ?? "its organization";

  const checkbox = (target: MaintenanceWindowTarget, label: string) => (
    <label key={`${target.kind}:${targetId(target)}`} className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={chosen.has(`${target.kind}:${targetId(target)}`)} onChange={() => toggle(target)} />
      {label}
    </label>
  );

  // Every step's elements are built here, once per render; `renderStep` only picks one.
  const windowStep = (
    <>
      <label className={labelClass}>
        Reason
        <input className={fieldClass} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
      </label>
      <fieldset className="space-y-1">
        <legend className={labelClass}>Start</legend>
        <label className="flex items-center gap-2 text-xs">
          <input type="radio" name="window-start" checked={form.startNow} onChange={() => setForm({ ...form, startNow: true })} />
          Now
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="radio" name="window-start" checked={!form.startNow} onChange={() => setForm({ ...form, startNow: false })} />
          At a time
        </label>
        {form.startNow ? null : (
          <label className={labelClass}>
            Start time
            <input
              type="datetime-local"
              className={fieldClass}
              value={form.start}
              onChange={(event) => setForm({ ...form, start: event.target.value })}
            />
          </label>
        )}
      </fieldset>
      <label className={labelClass}>
        End
        <input
          type="datetime-local"
          className={fieldClass}
          value={form.end}
          aria-describedby="window-end-rule"
          onChange={(event) => setForm({ ...form, end: event.target.value })}
        />
      </label>
      <p id="window-end-rule" className="text-2xs text-ink-muted">{`At most ${WINDOW_MAX_DAYS} days after the start.`}</p>
    </>
  );
  const targetsStep = (
    <>
      <p className="text-xs text-ink-muted">
        {`Alarms on these targets are suppressed while the window is active. A location covers every asset below it. ${form.targets.length} of at most ${MAX_TARGETS} chosen.`}
      </p>
      {form.targets.length > 0 ? <p className="text-xs">{`Chosen: ${form.targets.map(labelOf).join(", ")}`}</p> : null}
      <label className={labelClass}>
        Find a target
        <input className={fieldClass} value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <fieldset className="space-y-1">
        <legend className={labelClass}>Assets</legend>
        {matches(assets, assetLabel).map((asset) => checkbox({ kind: "asset", assetId: asset.id }, assetLabel(asset)))}
      </fieldset>
      <fieldset className="space-y-1">
        <legend className={labelClass}>Locations</legend>
        {matches(locations, (location) => location.name).map((location) =>
          checkbox({ kind: "location", locationId: location.id }, location.name),
        )}
      </fieldset>
      <fieldset className="space-y-1">
        <legend className={labelClass}>Rules</legend>
        {matches(rules, (rule) => rule.name).map((rule) => checkbox({ kind: "rule", ruleId: rule.id }, rule.name))}
      </fieldset>
    </>
  );
  const linkStep = (
    <>
      <p className="text-xs text-ink-muted">Optional: the work order or maintenance schedule this window is for.</p>
      <label className={labelClass}>
        Work order
        <select className={fieldClass} value={form.workOrderId} onChange={(event) => setForm({ ...form, workOrderId: event.target.value })}>
          <option value="">None</option>
          {(workOrdersQ.data?.items ?? []).map((order) => (
            <option key={order.id} value={order.id}>{`${order.reference} — ${order.title}`}</option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Maintenance schedule
        <select
          className={fieldClass}
          value={form.maintenanceScheduleId}
          onChange={(event) => setForm({ ...form, maintenanceScheduleId: event.target.value })}
        >
          <option value="">None</option>
          {(schedulesQ.data?.items ?? []).map((schedule) => (
            <option key={schedule.id} value={schedule.id}>{`${schedule.title} — ${schedule.assetName}`}</option>
          ))}
        </select>
      </label>
    </>
  );

  function renderStep(step: WizardStep): ReactNode {
    if (step.id === "window") return windowStep;
    return step.id === "targets" ? targetsStep : linkStep;
  }

  function stepBlocker(step: WizardStep): string | null {
    if (step.id === "window") return windowBlocker(form, now);
    if (step.id !== "targets") return null;
    if (form.targets.length === 0) return "Choose at least one asset, location or rule.";
    return form.targets.length > MAX_TARGETS ? `A window may name at most ${MAX_TARGETS} targets.` : null;
  }

  return (
    <AdminWizardFrame title="Create maintenance window">
      <WizardShell
        key="create"
        entry={maintenanceWindowWizardEntry("maintenanceWindow.create")}
        params={{}}
        values={values}
        onChange={(next) => setForm(createFormWithValues(form, next))}
        renderStep={renderStep}
        stepBlocker={stepBlocker}
        onSubmit={write.submit}
        onCancel={onClose}
        submitting={write.pending}
        submitError={write.error}
        summary={maintenanceWindowWizardEntry("maintenanceWindow.create").summary({
          body: wizardBody(values),
          params: {},
          targetName: organizationName,
          organizationName,
          maintenanceWindow: {
            reason: form.reason,
            startsAt: typeof values.startsAt === "string" ? values.startsAt : null,
            endsAt: typeof values.endsAt === "string" ? values.endsAt : null,
            targetLabels: form.targets.map(labelOf),
            locationLabels: chosenLocations.map((id) => locationById.get(id)?.name ?? id),
            coveredAssetCount: assets.filter((asset) => covered.has(asset.locationId)).length,
          },
        })}
      />
    </AdminWizardFrame>
  );
}

/** `maintenanceWindow.extend`: New end, Review. */
function ExtendWindowWizard({ item, onClose }: { item: MaintenanceWindowItem; onClose: () => void }) {
  const [form, setForm] = useState({ end: "", reason: "" });
  const write = useWindowWrite((body) => extendMaintenanceWindow(item.id, body as ExtendMaintenanceWindowBody), onClose);
  const values = { endsAt: isoOfLocalInput(form.end), reason: optional(form.reason) };
  const now = Date.now();

  const newEnd = (
    <>
      <p className="text-xs text-ink-muted">{`Now ends ${item.endsAt.slice(0, 16).replace("T", " ")} UTC.`}</p>
      <label className={labelClass}>
        New end
        <input
          type="datetime-local"
          className={fieldClass}
          value={form.end}
          aria-describedby="window-new-end-rule"
          onChange={(event) => setForm({ ...form, end: event.target.value })}
        />
      </label>
      <p id="window-new-end-rule" className="text-2xs text-ink-muted">{`At most ${WINDOW_MAX_DAYS} days from now.`}</p>
      <label className={labelClass}>
        Reason (optional)
        <input className={fieldClass} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
      </label>
    </>
  );

  function stepBlocker(): string | null {
    const end = values.endsAt;
    if (end === undefined) return "Choose the new end.";
    const endMs = Date.parse(end);
    if (endMs <= Date.parse(item.endsAt)) return "The new end must be later than the window's current end.";
    return endMs - now > MAINTENANCE_WINDOW_MAX_MS ? EXTEND_LENGTH_RULE : null;
  }

  return (
    <AdminWizardFrame title="Extend maintenance window">
      <WizardShell
        key={`extend-${item.id}`}
        entry={maintenanceWindowWizardEntry("maintenanceWindow.extend")}
        params={{ id: item.id }}
        values={values}
        onChange={(next) =>
          setForm({
            end: typeof next.endsAt === "string" && isoOfLocalInput(next.endsAt) ? localInputOf(new Date(next.endsAt)) : form.end,
            reason: typeof next.reason === "string" ? next.reason : form.reason,
          })
        }
        renderStep={() => newEnd}
        stepBlocker={stepBlocker}
        onSubmit={write.submit}
        onCancel={onClose}
        submitting={write.pending}
        submitError={write.error}
        current={{ endsAt: item.endsAt }}
        summary={maintenanceWindowWizardEntry("maintenanceWindow.extend").summary({
          body: wizardBody(values),
          params: { id: item.id },
          targetName: windowName(item.reason),
          organizationName: "",
          maintenanceWindow: summaryWindow(item),
        })}
      />
    </AdminWizardFrame>
  );
}

/** `maintenanceWindow.end` (an active window) and `maintenanceWindow.cancel` (a future one): Reason, Review. */
function CloseWindowWizard({
  kind,
  item,
  onClose,
}: {
  kind: "end" | "cancel";
  item: MaintenanceWindowItem;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const close = kind === "end" ? endMaintenanceWindow : cancelMaintenanceWindow;
  const write = useWindowWrite((body) => close(item.id, body as CloseMaintenanceWindowBody), onClose);
  const values = { reason: optional(reason) };
  const context = {
    body: wizardBody(values),
    params: { id: item.id },
    targetName: windowName(item.reason),
    organizationName: "",
    maintenanceWindow: summaryWindow(item),
  };
  const shared = {
    params: { id: item.id },
    values,
    onChange: (next: Record<string, unknown>) => setReason(typeof next.reason === "string" ? next.reason : reason),
    renderStep: () => (
      <label className={labelClass}>
        Reason (optional)
        <input className={fieldClass} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
    ),
    onSubmit: write.submit,
    onCancel: onClose,
    submitting: write.pending,
    submitError: write.error,
    review: { omit: [], detail: <p className="text-xs font-semibold text-critical-ink">{WINDOW_CANNOT_BE_UNDONE}</p> },
  };
  if (kind === "end") {
    return (
      <AdminWizardFrame title="End maintenance window">
        <WizardShell
          key={`end-${item.id}`}
          {...shared}
          entry={maintenanceWindowWizardEntry("maintenanceWindow.end")}
          summary={maintenanceWindowWizardEntry("maintenanceWindow.end").summary(context)}
        />
      </AdminWizardFrame>
    );
  }
  return (
    <AdminWizardFrame title="Cancel maintenance window">
      <WizardShell
        key={`cancel-${item.id}`}
        {...shared}
        entry={maintenanceWindowWizardEntry("maintenanceWindow.cancel")}
        summary={maintenanceWindowWizardEntry("maintenanceWindow.cancel").summary(context)}
      />
    </AdminWizardFrame>
  );
}

/** The wizard the page has open. */
export function MaintenanceWindowWizard({ dialog, onClose }: { dialog: MaintenanceWindowDialog; onClose: () => void }) {
  if (dialog.kind === "create") return <CreateWindowWizard onClose={onClose} />;
  if (dialog.kind === "extend") return <ExtendWindowWizard item={dialog.window} onClose={onClose} />;
  return <CloseWindowWizard kind={dialog.kind} item={dialog.window} onClose={onClose} />;
}
