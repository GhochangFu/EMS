import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import type {
  MaintenanceGenerationMode,
  MaintenanceScheduleCategory,
  MaintenanceScheduleItem,
  WorkOrderPriority,
} from "@bms/shared";

import type { AssetRow } from "../api/assets";
import {
  convertMaintenanceSchedule,
  createMaintenanceSchedule,
  fetchMaintenanceSchedules,
  updateMaintenanceSchedule,
} from "../api/maintenance";

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
const generationModes: MaintenanceGenerationMode[] = [
  "manual",
  "calendar",
  "runtime",
  "condition",
  "predictive",
];

const priorityLabels: Record<WorkOrderPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const categoryLabels: Record<MaintenanceScheduleCategory, string> = {
  preventive: "Preventive maintenance",
  predictive: "Predictive maintenance",
  condition_based: "Condition-based maintenance",
  compliance: "Compliance / statutory",
  amc: "AMC / vendor contract",
  calibration: "Calibration",
  runtime_based: "Runtime-based",
  seasonal: "Seasonal",
  inspection_round: "Inspection rounds",
  corrective_follow_up: "Corrective follow-up",
  deferred_backlog: "Deferred backlog",
  shutdown_outage: "Shutdown / outage",
  energy_optimization: "Energy optimization",
  safety_critical: "Safety-critical",
};

const generationModeLabels: Record<MaintenanceGenerationMode, string> = {
  manual: "Manual",
  calendar: "Calendar",
  runtime: "Runtime",
  condition: "Condition",
  predictive: "Predictive",
};

function priorityStyle(priority: WorkOrderPriority): string {
  switch (priority) {
    case "critical":
      return "border-red-200 bg-red-100 text-red-800";
    case "high":
      return "border-orange-200 bg-orange-100 text-orange-800";
    case "medium":
      return "border-amber-200 bg-amber-100 text-amber-900";
    case "low":
      return "border-gray-200 bg-gray-100 text-gray-700";
  }
}

function dueStateStyle(item: MaintenanceScheduleItem): string {
  if (item.dueState === "overdue") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-bms-green/20 bg-bms-green/10 text-bms-green";
}

function categoryStyle(category: MaintenanceScheduleCategory): string {
  switch (category) {
    case "safety_critical":
    case "compliance":
      return "border-red-200 bg-red-50 text-red-700";
    case "predictive":
    case "condition_based":
    case "runtime_based":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "energy_optimization":
      return "border-bms-green/20 bg-bms-green/10 text-bms-green";
    default:
      return "border-gray-200 bg-white text-bms-muted";
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

function tomorrowDateInput(): string {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return tomorrow.toISOString().slice(0, 10);
}

/** Manages maintenance schedule templates and generates related work orders. */
export function MaintenanceSchedulesPanel({
  assetOptions,
}: MaintenanceSchedulesPanelProps) {
  const qc = useQueryClient();
  const [assetFilter, setAssetFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [templateAssetId, setTemplateAssetId] = useState("");
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [templateCategory, setTemplateCategory] =
    useState<MaintenanceScheduleCategory>("preventive");
  const [generationMode, setGenerationMode] =
    useState<MaintenanceGenerationMode>("calendar");
  const [ownerTeam, setOwnerTeam] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [complianceRef, setComplianceRef] = useState("");
  const [triggerSummary, setTriggerSummary] = useState("");
  const [safetyCritical, setSafetyCritical] = useState(false);
  const [templatePriority, setTemplatePriority] =
    useState<WorkOrderPriority>("medium");
  const [estimatedMinutes, setEstimatedMinutes] = useState(60);
  const [intervalDays, setIntervalDays] = useState(30);
  const [firstDueDate, setFirstDueDate] = useState(tomorrowDateInput());
  const [createError, setCreateError] = useState<string | null>(null);

  const schedulesQ = useQuery({
    queryKey: [
      "maintenance",
      "schedules",
      assetFilter,
      categoryFilter,
      dueFilter,
      priorityFilter,
    ],
    queryFn: () =>
      fetchMaintenanceSchedules({
        assetId: assetFilter === "all" ? undefined : assetFilter,
        category: categoryFilter === "all" ? undefined : categoryFilter,
        dueState: dueFilter,
        priority: priorityFilter,
        horizonDays: 120,
      }),
  });

  const createM = useMutation({
    mutationFn: createMaintenanceSchedule,
    onSuccess: () => {
      setCreateOpen(false);
      resetCreateForm();
      void qc.invalidateQueries({ queryKey: ["maintenance", "schedules"] });
    },
    onError: (err: Error) => {
      setCreateError(err.message);
    },
  });

  const convertM = useMutation({
    mutationFn: convertMaintenanceSchedule,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["maintenance", "schedules"] });
      void qc.invalidateQueries({ queryKey: ["work-orders", "list"] });
    },
  });

  const updateM = useMutation({
    mutationFn: updateMaintenanceSchedule,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["maintenance", "schedules"] });
    },
  });

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

  function resetCreateForm(): void {
    setTemplateAssetId(filteredAssetOptions[0]?.id ?? assetOptions[0]?.id ?? "");
    setTemplateTitle("");
    setTemplateDescription("");
    setTemplateCategory("preventive");
    setGenerationMode("calendar");
    setOwnerTeam("");
    setVendorName("");
    setComplianceRef("");
    setTriggerSummary("");
    setSafetyCritical(false);
    setTemplatePriority("medium");
    setEstimatedMinutes(60);
    setIntervalDays(30);
    setFirstDueDate(tomorrowDateInput());
    setCreateError(null);
  }

  function openCreate(): void {
    resetCreateForm();
    setCreateOpen(true);
  }

  function submitCreate(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setCreateError(null);
    const dueAt = new Date(`${firstDueDate}T09:00:00`);
    createM.mutate({
      assetId: templateAssetId,
      title: templateTitle.trim(),
      description: templateDescription.trim() || undefined,
      category: templateCategory,
      generationMode,
      ownerTeam: ownerTeam.trim() || undefined,
      vendorName: vendorName.trim() || undefined,
      complianceRef: complianceRef.trim() || undefined,
      triggerSummary: triggerSummary.trim() || undefined,
      safetyCritical,
      priority: templatePriority,
      estimatedMinutes,
      intervalDays,
      firstDueAt: dueAt.toISOString(),
    });
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Overdue", overdueCount, "border-red-200 bg-red-50 text-red-700"],
          ["Upcoming", upcomingCount, "border-bms-green/20 bg-bms-green/10 text-bms-green"],
          ["WO generated", generatedCount, "border-sky-200 bg-sky-50 text-sky-700"],
          ["Safety-critical", safetyCount, "border-orange-200 bg-orange-50 text-orange-700"],
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className={`inline-flex rounded border px-2 py-1 text-[10px] font-bold uppercase ${tone}`}>
              {label}
            </div>
            <div className="mt-3 font-condensed text-2xl font-bold text-bms-ink">
              {value}
            </div>
            <div className="text-xs text-bms-muted">Current filtered scope</div>
          </div>
        ))}
      </section>

      <section className="grid gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm lg:grid-cols-5">
        <label className="text-xs font-medium text-bms-muted">
          Asset
          <select
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm text-bms-ink"
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
        <label className="text-xs font-medium text-bms-muted">
          Category
          <select
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm text-bms-ink"
            value={categoryFilter}
            onChange={(ev) =>
              setCategoryFilter(ev.target.value as CategoryFilter)
            }
          >
            <option value="all">All categories</option>
            {categoryOptions.map((category) => (
              <option key={category} value={category}>
                {categoryLabels[category]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-bms-muted">
          Due state
          <select
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm text-bms-ink"
            value={dueFilter}
            onChange={(ev) => setDueFilter(ev.target.value as DueFilter)}
          >
            <option value="all">All due states</option>
            <option value="overdue">Overdue</option>
            <option value="upcoming">Upcoming</option>
          </select>
        </label>
        <label className="text-xs font-medium text-bms-muted">
          Priority
          <select
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm text-bms-ink"
            value={priorityFilter}
            onChange={(ev) =>
              setPriorityFilter(ev.target.value as PriorityFilter)
            }
          >
            <option value="all">All priorities</option>
            {priorities.map((priority) => (
              <option key={priority} value={priority}>
                {priorityLabels[priority]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="self-end rounded bg-bms-green px-4 py-2 text-sm font-semibold text-white hover:bg-bms-green-dark"
          onClick={openCreate}
        >
          + New Schedule
        </button>
      </section>

      {schedulesQ.isLoading ? (
        <p className="text-sm text-bms-muted">Loading maintenance schedules...</p>
      ) : schedulesQ.isError ? (
        <p className="text-sm text-red-600">Could not load schedules.</p>
      ) : items.length === 0 ? (
        <p className="rounded border border-dashed border-gray-300 bg-white px-3 py-8 text-center text-sm text-bms-muted">
          No maintenance schedules match this filter.
        </p>
      ) : (
        <section className="grid gap-3 xl:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-[10px] text-bms-muted">
                    SCH-{item.id.slice(0, 8).toUpperCase()}
                  </div>
                  <h2 className="mt-1 text-sm font-semibold text-bms-ink">
                    {item.title}
                  </h2>
                </div>
                <span
                  className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${dueStateStyle(item)}`}
                >
                  {dueLabel(item)}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-bms-muted">
                {item.description ?? "No schedule description"}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                <span
                  className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${categoryStyle(item.category)}`}
                >
                  {categoryLabels[item.category]}
                </span>
                <span
                  className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${priorityStyle(item.priority)}`}
                >
                  {priorityLabels[item.priority]}
                </span>
                <span className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-bms-muted">
                  {generationModeLabels[item.generationMode]}
                </span>
              </div>
              <div className="mt-3 grid gap-1 text-[11px] text-bms-muted">
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
                  className="rounded border border-gray-300 px-3 py-1.5 text-xs font-semibold text-bms-ink hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={updateM.isPending}
                  onClick={() =>
                    updateM.mutate({
                      id: item.id,
                      active: false,
                      reason: `Deactivated ${item.title}`,
                    })
                  }
                >
                  Deactivate
                </button>
                <button
                  type="button"
                  className="rounded bg-bms-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-bms-green-dark disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={Boolean(item.activeWorkOrderId) || convertM.isPending}
                  onClick={() =>
                    convertM.mutate({
                      id: item.id,
                      notes: `Generated WO from ${categoryLabels[item.category]}`,
                    })
                  }
                >
                  {item.activeWorkOrderId ? "WO already open" : "Generate WO"}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {convertM.isError ? (
        <p className="text-xs text-red-600" role="alert">
          Could not generate work order: {convertM.error.message}
        </p>
      ) : null}
      {updateM.isError ? (
        <p className="text-xs text-red-600" role="alert">
          Could not update schedule: {updateM.error.message}
        </p>
      ) : null}

      {createOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="schedule-create-title"
        >
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-6 shadow-xl">
            <h2
              id="schedule-create-title"
              className="font-condensed text-lg font-bold text-bms-ink"
            >
              Create maintenance schedule
            </h2>
            <form className="mt-4 space-y-3" onSubmit={submitCreate}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-bms-muted">
                  Asset
                  <select
                    className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-bms-ink"
                    value={templateAssetId}
                    onChange={(ev) => setTemplateAssetId(ev.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Select an asset
                    </option>
                    {filteredAssetOptions.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.code} · {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-bms-muted">
                  Category
                  <select
                    className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-bms-ink"
                    value={templateCategory}
                    onChange={(ev) =>
                      setTemplateCategory(
                        ev.target.value as MaintenanceScheduleCategory,
                      )
                    }
                  >
                    {categoryOptions.map((category) => (
                      <option key={category} value={category}>
                        {categoryLabels[category]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-xs font-medium text-bms-muted">
                Schedule title
                <input
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-bms-ink"
                  value={templateTitle}
                  onChange={(ev) => setTemplateTitle(ev.target.value)}
                  maxLength={255}
                  required
                />
              </label>
              <label className="block text-xs font-medium text-bms-muted">
                Description
                <textarea
                  className="mt-1 min-h-20 w-full rounded border border-gray-300 px-3 py-2 text-sm text-bms-ink"
                  value={templateDescription}
                  onChange={(ev) => setTemplateDescription(ev.target.value)}
                  maxLength={4000}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-xs font-medium text-bms-muted">
                  Generation mode
                  <select
                    className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-bms-ink"
                    value={generationMode}
                    onChange={(ev) =>
                      setGenerationMode(
                        ev.target.value as MaintenanceGenerationMode,
                      )
                    }
                  >
                    {generationModes.map((mode) => (
                      <option key={mode} value={mode}>
                        {generationModeLabels[mode]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-bms-muted">
                  Priority
                  <select
                    className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-bms-ink"
                    value={templatePriority}
                    onChange={(ev) =>
                      setTemplatePriority(ev.target.value as WorkOrderPriority)
                    }
                  >
                    {priorities.map((priority) => (
                      <option key={priority} value={priority}>
                        {priorityLabels[priority]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-bms-muted">
                  First due date
                  <input
                    type="date"
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-bms-ink"
                    value={firstDueDate}
                    onChange={(ev) => setFirstDueDate(ev.target.value)}
                    required
                  />
                </label>
                <label className="block text-xs font-medium text-bms-muted">
                  Interval days
                  <input
                    type="number"
                    min={1}
                    max={730}
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-bms-ink"
                    value={intervalDays}
                    onChange={(ev) => setIntervalDays(Number(ev.target.value))}
                    required
                  />
                </label>
                <label className="block text-xs font-medium text-bms-muted">
                  Estimated minutes
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-bms-ink"
                    value={estimatedMinutes}
                    onChange={(ev) =>
                      setEstimatedMinutes(Number(ev.target.value))
                    }
                    required
                  />
                </label>
                <label className="flex items-end gap-2 rounded border border-gray-200 px-3 py-2 text-xs font-medium text-bms-muted">
                  <input
                    type="checkbox"
                    checked={safetyCritical}
                    onChange={(ev) => setSafetyCritical(ev.target.checked)}
                  />
                  Safety-critical
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-xs font-medium text-bms-muted">
                  Owner team
                  <input
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-bms-ink"
                    value={ownerTeam}
                    onChange={(ev) => setOwnerTeam(ev.target.value)}
                    maxLength={128}
                  />
                </label>
                <label className="block text-xs font-medium text-bms-muted">
                  Vendor / AMC
                  <input
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-bms-ink"
                    value={vendorName}
                    onChange={(ev) => setVendorName(ev.target.value)}
                    maxLength={128}
                  />
                </label>
                <label className="block text-xs font-medium text-bms-muted">
                  Compliance ref
                  <input
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-bms-ink"
                    value={complianceRef}
                    onChange={(ev) => setComplianceRef(ev.target.value)}
                    maxLength={128}
                  />
                </label>
              </div>
              <label className="block text-xs font-medium text-bms-muted">
                Trigger summary
                <textarea
                  className="mt-1 min-h-16 w-full rounded border border-gray-300 px-3 py-2 text-sm text-bms-ink"
                  value={triggerSummary}
                  onChange={(ev) => setTriggerSummary(ev.target.value)}
                  maxLength={2000}
                  placeholder="Example: Generate after 500 fan runtime hours, or when CRAC filter pressure trend degrades."
                />
              </label>
              {createError ? (
                <p className="text-xs text-red-600" role="alert">
                  {createError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded border border-gray-300 px-3 py-2 text-sm font-semibold text-bms-ink hover:bg-gray-50"
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateError(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-bms-green px-4 py-2 text-sm font-semibold text-white hover:bg-bms-green-dark disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={createM.isPending || filteredAssetOptions.length === 0}
                >
                  {createM.isPending ? "Creating..." : "Create schedule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
