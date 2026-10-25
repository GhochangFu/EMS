import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type {
  MaintenanceScheduleCategory,
  MaintenanceScheduleItem,
  WorkOrderPriority,
} from "@bms/shared";

import type { AssetRow } from "../api/assets";
import { fetchMaintenanceSchedules } from "../api/maintenance";
// The three label maps left this file in `F2.19` (ADR 0038 Amendment 5 Part B).
// The Maintenance tab is the second surface that renders these twenty-three
// strings, and two copies of one vocabulary's labels drift — a category renamed
// on one screen and not the other says one code means two things. The wording
// is unchanged; it is this panel's, now shared.
import {
  MAINTENANCE_CATEGORY_LABELS,
  MAINTENANCE_GENERATION_MODE_LABELS,
  WORK_ORDER_PRIORITY_LABELS,
} from "../lib/maintenance-labels";
import { MaintenanceScheduleConvertWizard } from "./maintenance-schedule-convert-wizard";
import { MaintenanceScheduleToggleWizard } from "./maintenance-schedule-toggle-wizard";
import { MaintenanceScheduleWizard } from "./maintenance-schedule-wizard";

type MaintenanceSchedulesPanelProps = {
  assetOptions: AssetRow[];
};

type DueFilter = "all" | "overdue" | "upcoming";
type PriorityFilter = WorkOrderPriority | "all";
type CategoryFilter = MaintenanceScheduleCategory | "all";

const priorities: WorkOrderPriority[] = ["low", "medium", "high", "critical"];
const categoryOptions: MaintenanceScheduleCategory[] = [
  "preventive",
  "predictive",
  "condition_based",
  "compliance",
  "amc",
  "calibration",
  "runtime_based",
  "seasonal",
  "inspection_round",
  "corrective_follow_up",
  "deferred_backlog",
  "shutdown_outage",
  "energy_optimization",
  "safety_critical",
];

/** Exported for `maintenance-schedules-panel.spec.tsx` (F3.65b owner ruling R-f: high and medium differ). */
export function priorityStyle(priority: WorkOrderPriority): string {
  switch (priority) {
    case "critical":
      return "border-critical-line bg-critical-wash-strong text-critical-ink-strong";
    case "high":
      return "border-warning bg-warning-wash-strong text-warning-ink";
    case "medium":
      return "border-warning-line bg-warning-wash text-warning-ink";
    case "low":
      return "border-line bg-well-deep text-neutral-ink";
  }
}

function dueStateStyle(item: MaintenanceScheduleItem): string {
  if (item.dueState === "overdue") {
    return "border-critical-line bg-critical-wash text-critical-ink";
  }
  return "border-accent/20 bg-accent/10 text-accent-strong";
}

function categoryStyle(category: MaintenanceScheduleCategory): string {
  switch (category) {
    case "safety_critical":
    case "compliance":
      return "border-critical-line bg-critical-wash text-critical-ink";
    case "predictive":
    case "condition_based":
    case "runtime_based":
      return "border-info-line bg-info-wash text-info-ink";
    case "energy_optimization":
      return "border-accent/20 bg-accent/10 text-accent-strong";
    default:
      return "border-line bg-surface text-ink-muted";
  }
}

function dueLabel(item: MaintenanceScheduleItem): string {
  const due = new Date(item.nextDueAt);
  const days = Math.ceil((due.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) {
    return `${Math.abs(days)}d overdue`;
  }
  if (days === 0) {
    return "Due today";
  }
  return `Due in ${days}d`;
}

/**
 * Manages maintenance schedule templates and generates related work orders.
 *
 * `F4.281` (ADR 0099 decision 6, Amendment 8 Q16): the create form and a row's
 * Deactivate (or Activate) are the catalog steppers
 * (`MaintenanceScheduleWizard`, `MaintenanceScheduleToggleWizard`), for every
 * role the routes admit. "Show inactive" (owner ruling DC3) lists deactivated
 * schedules so a person reaches the Activate stepper too. "Generate WO" stays a
 * direct call: the convert route is excluded from the catalog.
 */
export function MaintenanceSchedulesPanel({
  assetOptions,
}: MaintenanceSchedulesPanelProps) {
  const qc = useQueryClient();
  const [assetFilter, setAssetFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [toggleItem, setToggleItem] = useState<MaintenanceScheduleItem | null>(null);

  const schedulesQ = useQuery({
    queryKey: [
      "maintenance",
      "schedules",
      assetFilter,
      categoryFilter,
      dueFilter,
      priorityFilter,
      showInactive,
    ],
    queryFn: () =>
      fetchMaintenanceSchedules({
        assetId: assetFilter === "all" ? undefined : assetFilter,
        category: categoryFilter === "all" ? undefined : categoryFilter,
        dueState: dueFilter,
        priority: priorityFilter,
        horizonDays: 120,
        includeInactive: showInactive,
      }),
  });

  // `F4.284` (ADR 0106 decision 5): "Generate WO" opens the convert wizard (Notes → Review).
  const [convertItem, setConvertItem] = useState<MaintenanceScheduleItem | null>(null);

  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: ["maintenance", "schedules"] });
  };

  const items = schedulesQ.data?.items ?? [];
  const overdueCount = items.filter((item) => item.dueState === "overdue").length;
  const upcomingCount = items.length - overdueCount;
  const generatedCount = items.filter((item) => item.activeWorkOrderId).length;
  const safetyCount = items.filter((item) => item.safetyCritical).length;

  const filteredAssetOptions = useMemo(
    () =>
      assetFilter === "all"
        ? assetOptions
        : assetOptions.filter((asset) => asset.id === assetFilter),
    [assetFilter, assetOptions],
  );

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Overdue", overdueCount, "border-critical-line bg-critical-wash text-critical-ink"],
          ["Upcoming", upcomingCount, "border-accent/20 bg-accent/10 text-accent-strong"],
          ["WO generated", generatedCount, "border-info-line bg-info-wash text-info-ink"],
          ["Safety-critical", safetyCount, "border-warning-line bg-warning-wash text-warning-ink"],
        ].map(([label, value, tone]) => (
          <div key={label} className="surface-raised p-4">
            <div className={`inline-flex rounded border px-2 py-1 text-[10px] font-bold uppercase ${tone}`}>
              {label}
            </div>
            <div className="mt-3 font-condensed text-2xl font-bold text-ink">
              {value}
            </div>
            <div className="text-xs text-ink-muted">Current filtered scope</div>
          </div>
        ))}
      </section>

      <section className="grid gap-3 surface-raised p-3 lg:grid-cols-5">
        <label className="text-xs font-medium text-ink-muted">
          Asset
          <select
            className="mt-1 w-full surface-field px-2 py-2 text-sm text-ink"
            value={assetFilter}
            onChange={(ev) => setAssetFilter(ev.target.value)}
          >
            <option value="all">All assets</option>
            {assetOptions.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.code} · {asset.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-ink-muted">
          Category
          <select
            className="mt-1 w-full surface-field px-2 py-2 text-sm text-ink"
            value={categoryFilter}
            onChange={(ev) =>
              setCategoryFilter(ev.target.value as CategoryFilter)
            }
          >
            <option value="all">All categories</option>
            {categoryOptions.map((category) => (
              <option key={category} value={category}>
                {MAINTENANCE_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-ink-muted">
          Due state
          <select
            className="mt-1 w-full surface-field px-2 py-2 text-sm text-ink"
            value={dueFilter}
            onChange={(ev) => setDueFilter(ev.target.value as DueFilter)}
          >
            <option value="all">All due states</option>
            <option value="overdue">Overdue</option>
            <option value="upcoming">Upcoming</option>
          </select>
        </label>
        <label className="text-xs font-medium text-ink-muted">
          Priority
          <select
            className="mt-1 w-full surface-field px-2 py-2 text-sm text-ink"
            value={priorityFilter}
            onChange={(ev) =>
              setPriorityFilter(ev.target.value as PriorityFilter)
            }
          >
            <option value="all">All priorities</option>
            {priorities.map((priority) => (
              <option key={priority} value={priority}>
                {WORK_ORDER_PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="self-end surface-button-primary bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong"
          onClick={() => setCreateOpen(true)}
        >
          + New Schedule
        </button>
        <label className="flex items-center gap-2 text-xs font-medium text-ink-muted lg:col-span-5">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(ev) => setShowInactive(ev.target.checked)}
          />
          Show inactive
        </label>
      </section>

      {schedulesQ.isLoading ? (
        <p className="text-sm text-ink-muted">Loading maintenance schedules...</p>
      ) : schedulesQ.isError ? (
        <p className="text-sm text-critical-ink">Could not load schedules.</p>
      ) : items.length === 0 ? (
        <p className="surface-pressed px-3 py-8 text-center text-sm text-ink-muted">
          No maintenance schedules match this filter.
        </p>
      ) : (
        <section className="grid gap-3 xl:grid-cols-3">
          {items.map((item) => {
            const generatingThis =
              convertItem?.id === item.id;
            return (
              <article
                key={item.id}
                className="surface-raised p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-[10px] text-ink-muted">
                      SCH-{item.id.slice(0, 8).toUpperCase()}
                    </div>
                    <h2 className="mt-1 text-sm font-semibold text-ink">
                      {item.title}
                    </h2>
                    {item.active ? null : (
                      <span className="text-[10px] font-semibold uppercase text-ink-muted">
                        Inactive
                      </span>
                    )}
                  </div>
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${dueStateStyle(item)}`}
                  >
                    {dueLabel(item)}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-ink-muted">
                  {item.description ?? "No schedule description"}
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${categoryStyle(item.category)}`}
                  >
                    {MAINTENANCE_CATEGORY_LABELS[item.category]}
                  </span>
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${priorityStyle(item.priority)}`}
                  >
                    {WORK_ORDER_PRIORITY_LABELS[item.priority]}
                  </span>
                  <span className="surface-raised-sm px-2 py-0.5 text-[10px] font-semibold text-ink-muted">
                    {MAINTENANCE_GENERATION_MODE_LABELS[item.generationMode]}
                  </span>
                </div>
                <div className="mt-3 grid gap-1 text-[11px] text-ink-muted">
                  <span>
                    {item.assetCode} · {item.assetName} · {item.siteName}
                  </span>
                  <span>
                    {item.intervalDays}d cycle · {item.estimatedMinutes} min
                  </span>
                  {item.ownerTeam ? <span>Owner: {item.ownerTeam}</span> : null}
                  {item.vendorName ? <span>Vendor: {item.vendorName}</span> : null}
                  {item.complianceRef ? (
                    <span>Compliance: {item.complianceRef}</span>
                  ) : null}
                  {item.triggerSummary ? (
                    <span>Trigger: {item.triggerSummary}</span>
                  ) : null}
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className="surface-button px-3 py-1.5 text-xs font-semibold"
                    onClick={() => setToggleItem(item)}
                  >
                    {item.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    type="button"
                    className="surface-button-primary bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!item.active || Boolean(item.activeWorkOrderId) || convertItem !== null}
                    aria-busy={generatingThis}
                    onClick={() => setConvertItem(item)}
                  >
                    {generatingThis
                      ? "Generating WO…"
                      : item.activeWorkOrderId
                        ? "WO already open"
                        : "Generate WO"}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {convertItem !== null ? (
        <MaintenanceScheduleConvertWizard
          item={convertItem}
          defaultNotes={`Generated WO from ${MAINTENANCE_CATEGORY_LABELS[convertItem.category]}`}
          onCancel={() => setConvertItem(null)}
          onDone={async () => {
            setConvertItem(null);
            await Promise.all([
              qc.invalidateQueries({ queryKey: ["maintenance", "schedules"] }),
              qc.invalidateQueries({ queryKey: ["work-orders", "list"] }),
            ]);
          }}
        />
      ) : null}

      {createOpen ? (
        <MaintenanceScheduleWizard
          assetOptions={filteredAssetOptions}
          onCancel={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            refresh();
          }}
        />
      ) : null}
      {toggleItem !== null ? (
        <MaintenanceScheduleToggleWizard
          item={toggleItem}
          onCancel={() => setToggleItem(null)}
          onDone={() => {
            setToggleItem(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
