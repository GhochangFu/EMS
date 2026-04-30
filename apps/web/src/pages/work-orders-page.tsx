import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DragEvent, FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type {
  WorkOrderListItem,
  WorkOrderPriority,
  WorkOrderStatus,
} from "@bms/shared";

import { fetchAssets } from "../api/assets";
import {
  closeWorkOrder,
  createWorkOrder,
  fetchWorkOrders,
  reorderWorkOrders,
  updateWorkOrderStatus,
  type ReorderWorkOrderItem,
} from "../api/work-orders";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";

type WorkOrdersPageProps = {
  user: AuthUser;
};

type StatusFilter = WorkOrderStatus | "all";
type PriorityFilter = WorkOrderPriority | "all";
type KanbanColumn = {
  key: WorkOrderStatus;
  label: string;
  kpiLabel: string;
  kpiTone?: "warning" | "info" | "success";
};
type DragState = {
  id: string;
  fromStatus: WorkOrderStatus;
};
type DropTarget = {
  status: WorkOrderStatus;
  index: number;
};

const statuses: WorkOrderStatus[] = [
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "closed",
];

const priorities: WorkOrderPriority[] = ["low", "medium", "high", "critical"];

const statusLabels: Record<WorkOrderStatus, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

const priorityLabels: Record<WorkOrderPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const kanbanColumns: KanbanColumn[] = [
  { key: "open", label: "Open", kpiLabel: "Open WO", kpiTone: "warning" },
  { key: "assigned", label: "Assigned", kpiLabel: "Assigned" },
  { key: "in_progress", label: "In Progress", kpiLabel: "In Progress" },
  {
    key: "resolved",
    label: "Review",
    kpiLabel: "Awaiting Review",
    kpiTone: "info",
  },
  {
    key: "closed",
    label: "Done",
    kpiLabel: "Completed",
    kpiTone: "success",
  },
];

function statusStyle(status: WorkOrderStatus): string {
  switch (status) {
    case "closed":
      return "border-gray-200 bg-gray-100 text-gray-700";
    case "resolved":
      return "border-emerald-200 bg-emerald-100 text-emerald-800";
    case "in_progress":
      return "border-sky-200 bg-sky-100 text-sky-800";
    case "assigned":
      return "border-indigo-200 bg-indigo-100 text-indigo-800";
    case "open":
      return "border-amber-200 bg-amber-100 text-amber-900";
  }
}

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

function kpiToneStyle(tone?: KanbanColumn["kpiTone"]): string {
  switch (tone) {
    case "warning":
      return "after:bg-amber-500";
    case "info":
      return "after:bg-sky-500";
    case "success":
      return "after:bg-bms-green";
    default:
      return "after:bg-bms-green";
  }
}

function priorityRailStyle(priority: WorkOrderPriority): string {
  switch (priority) {
    case "critical":
      return "border-l-red-600";
    case "high":
      return "border-l-orange-500";
    case "medium":
      return "border-l-amber-500";
    case "low":
      return "border-l-sky-500";
  }
}

function nextStatusOptions(status: WorkOrderStatus): WorkOrderStatus[] {
  if (status === "closed") {
    return ["closed"];
  }
  return statuses.filter((candidate) => candidate !== "closed");
}

export function WorkOrdersPage({ user }: WorkOrdersPageProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [assetFilter, setAssetFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [alarmId, setAlarmId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<WorkOrderPriority>("medium");
  const [createError, setCreateError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<WorkOrderListItem | null>(null);
  const [nextStatus, setNextStatus] = useState<WorkOrderStatus>("open");
  const [statusReason, setStatusReason] = useState("");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<WorkOrderListItem | null>(null);
  const [closeReason, setCloseReason] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [closeSortOrder, setCloseSortOrder] = useState<number | undefined>(
    undefined,
  );

  const workOrdersQ = useQuery({
    queryKey: ["work-orders", "list"],
    queryFn: () => fetchWorkOrders(100),
  });

  const assetsQ = useQuery({
    queryKey: ["assets", "list"],
    queryFn: fetchAssets,
  });

  useEffect(() => {
    const queryAlarmId = searchParams.get("alarmId");
    const queryAssetId = searchParams.get("assetId");
    if (!queryAlarmId || !queryAssetId) {
      return;
    }
    setAlarmId(queryAlarmId);
    setAssetId(queryAssetId);
    setTitle(searchParams.get("title") ?? "Investigate alarm");
    setDescription(searchParams.get("description") ?? "");
    setPriority("high");
    setCreateError(null);
    setCreateOpen(true);
  }, [searchParams]);

  const createM = useMutation({
    mutationFn: createWorkOrder,
    onSuccess: () => {
      setCreateOpen(false);
      setAlarmId("");
      setTitle("");
      setDescription("");
      setPriority("medium");
      setCreateError(null);
      navigate("/work-orders", { replace: true });
      void qc.invalidateQueries({ queryKey: ["work-orders", "list"] });
    },
    onError: (err: Error) => {
      setCreateError(err.message);
    },
  });

  const statusM = useMutation({
    mutationFn: updateWorkOrderStatus,
    onSuccess: () => {
      setEditTarget(null);
      setStatusReason("");
      setStatusError(null);
      void qc.invalidateQueries({ queryKey: ["work-orders", "list"] });
    },
    onError: (err: Error) => {
      setStatusError(err.message);
    },
  });

  const closeM = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      closeWorkOrder(id, reason, closeSortOrder),
    onSuccess: () => {
      setCloseTarget(null);
      setCloseReason("");
      setCloseError(null);
      setCloseSortOrder(undefined);
      void qc.invalidateQueries({ queryKey: ["work-orders", "list"] });
    },
    onError: (err: Error) => {
      setCloseError(err.message);
    },
  });

  const reorderM = useMutation({
    mutationFn: reorderWorkOrders,
    onSuccess: () => {
      setDragError(null);
      void qc.invalidateQueries({ queryKey: ["work-orders", "list"] });
    },
    onError: (err: Error) => {
      setDragError(err.message);
      void qc.invalidateQueries({ queryKey: ["work-orders", "list"] });
    },
  });

  const rows = workOrdersQ.data?.items ?? [];
  const assetOptions = assetsQ.data ?? [];
  const rowById = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows],
  );
  const orderedRows = useMemo(() => {
    if (localOrder.length === 0) {
      return rows;
    }
    const indexById = new Map(localOrder.map((id, index) => [id, index]));
    return [...rows].sort((a, b) => {
      const aIndex = indexById.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = indexById.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) {
        return aIndex - bIndex;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [localOrder, rows]);

  useEffect(() => {
    if (rows.length === 0) {
      setLocalOrder([]);
      return;
    }
    setLocalOrder((current) => {
      const currentIds = new Set(rows.map((row) => row.id));
      const preserved = current.filter((id) => currentIds.has(id));
      const additions = rows
        .map((row) => row.id)
        .filter((id) => !preserved.includes(id));
      return [...preserved, ...additions];
    });
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      orderedRows.filter((row) => {
        const statusMatch =
          statusFilter === "all" || row.status === statusFilter;
        const assetMatch = assetFilter === "all" || row.assetId === assetFilter;
        const priorityMatch =
          priorityFilter === "all" || row.priority === priorityFilter;
        return statusMatch && assetMatch && priorityMatch;
      }),
    [assetFilter, orderedRows, priorityFilter, statusFilter],
  );
  const rowsByStatus = useMemo(
    () =>
      kanbanColumns.reduce<Record<WorkOrderStatus, WorkOrderListItem[]>>(
        (acc, column) => {
          acc[column.key] = filteredRows.filter(
            (row) => row.status === column.key,
          );
          return acc;
        },
        {
          open: [],
          assigned: [],
          in_progress: [],
          resolved: [],
          closed: [],
        },
      ),
    [filteredRows],
  );

  function openCreate(): void {
    setAssetId(assetOptions[0]?.id ?? "");
    setAlarmId("");
    setTitle("");
    setDescription("");
    setPriority("medium");
    setCreateError(null);
    setCreateOpen(true);
  }

  function closeCreate(): void {
    setCreateOpen(false);
    setCreateError(null);
    navigate("/work-orders", { replace: true });
  }

  function submitCreate(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setCreateError(null);
    createM.mutate({
      assetId,
      alarmId: alarmId || undefined,
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
    });
  }

  function openStatusEditor(row: WorkOrderListItem): void {
    setEditTarget(row);
    setNextStatus(row.status);
    setStatusReason("");
    setStatusError(null);
  }

  function submitStatus(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (!editTarget) {
      return;
    }
    setStatusError(null);
    statusM.mutate({
      id: editTarget.id,
      status: nextStatus,
      reason: statusReason.trim() || undefined,
    });
  }

  function openClose(row: WorkOrderListItem): void {
    setCloseTarget(row);
    setCloseReason("");
    setCloseError(null);
    setCloseSortOrder(undefined);
  }

  function submitClose(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (!closeTarget) {
      return;
    }
    setCloseError(null);
    closeM.mutate({ id: closeTarget.id, reason: closeReason.trim() });
  }

  function buildReorderItems(
    order: string[],
    overrides: Map<string, WorkOrderStatus>,
  ): ReorderWorkOrderItem[] {
    const nextByStatus: Record<WorkOrderStatus, ReorderWorkOrderItem[]> = {
      open: [],
      assigned: [],
      in_progress: [],
      resolved: [],
      closed: [],
    };
    for (const id of order) {
      const row = rowById.get(id);
      if (!row) {
        continue;
      }
      const status = overrides.get(id) ?? row.status;
      nextByStatus[status].push({ id, status, sortOrder: 0 });
    }
    return statuses.flatMap((status) =>
      nextByStatus[status].map((item, index) => ({
        ...item,
        sortOrder: index * 1000,
      })),
    );
  }

  function nextLocalOrder(
    draggedId: string,
    targetStatus: WorkOrderStatus,
    targetIndex: number,
  ): string[] {
    const targetRows = rowsByStatus[targetStatus];
    const targetId = targetRows[targetIndex]?.id;
    const previousId =
      targetIndex > 0 ? targetRows[targetIndex - 1]?.id : undefined;
    const current =
      localOrder.length > 0 ? localOrder : rows.map((row) => row.id);
    const next = current.filter((id) => id !== draggedId);
    if (targetId) {
      const insertAt = next.indexOf(targetId);
      if (insertAt >= 0) {
        next.splice(insertAt, 0, draggedId);
        return next;
      }
    }
    if (previousId) {
      const previousIndex = next.indexOf(previousId);
      if (previousIndex >= 0) {
        next.splice(previousIndex + 1, 0, draggedId);
        return next;
      }
    }
    return [...next, draggedId];
  }

  function handleDragStart(row: WorkOrderListItem): void {
    setDragState({ id: row.id, fromStatus: row.status });
    setDropTarget({ status: row.status, index: 0 });
  }

  function handleDragOver(
    e: DragEvent<HTMLElement>,
    status: WorkOrderStatus,
    index: number,
  ): void {
    if (!dragState) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ status, index });
  }

  function handleDrop(status: WorkOrderStatus, index: number): void {
    if (!dragState) {
      return;
    }
    const dragged = rowById.get(dragState.id);
    setDragState(null);
    setDropTarget(null);
    if (!dragged) {
      return;
    }

    if (status === "closed" && dragged.status !== "closed") {
      setCloseTarget(dragged);
      setCloseReason("");
      setCloseError(null);
      setCloseSortOrder(index * 1000);
      return;
    }

    const nextOrder = nextLocalOrder(dragged.id, status, index);
    const overrides = new Map<string, WorkOrderStatus>([[dragged.id, status]]);
    setLocalOrder(nextOrder);
    setDragError(null);
    reorderM.mutate(buildReorderItems(nextOrder, overrides));
  }

  function handleDragEnd(): void {
    setDragState(null);
    setDropTarget(null);
  }

  return (
    <AppShell
      user={user}
      kpiRibbon={
        <span className="text-bms-ink">
          Operations · Maintenance Kanban · audited work-order state changes
        </span>
      }
    >
      <div className="mx-auto max-w-[1320px] space-y-4 pb-8">
        <header className="flex flex-col gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-condensed text-xl font-bold text-bms-ink sm:text-2xl">
              Maintenance Kanban · Work Orders
            </h1>
            <p className="mt-1 text-sm text-bms-muted">
              Preventive · corrective · predictive · AMC · compliance
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-2 text-xs font-semibold text-bms-ink hover:bg-gray-50"
            >
              Filter
            </button>
            <button
              type="button"
              className="rounded border border-gray-300 px-3 py-2 text-xs font-semibold text-bms-ink hover:bg-gray-50"
            >
              Export
            </button>
            <button
              type="button"
              className="rounded bg-bms-green px-4 py-2 text-xs font-semibold text-white hover:bg-bms-green-dark"
              onClick={openCreate}
            >
              + New WO
            </button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {kanbanColumns.map((column) => (
            <div
              key={column.key}
              className={`relative overflow-hidden rounded-lg border border-gray-200 bg-white p-4 shadow-sm after:absolute after:inset-x-0 after:top-0 after:h-0.5 ${kpiToneStyle(column.kpiTone)}`}
            >
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-bms-muted">
                <span className="grid h-6 w-6 place-items-center rounded bg-bms-green/10 text-bms-green">
                  WO
                </span>
                {column.kpiLabel}
              </div>
              <div className="mt-3 font-condensed text-2xl font-bold text-bms-ink">
                {rowsByStatus[column.key].length}
              </div>
              <div className="mt-1 text-xs text-bms-muted">
                {column.key === "closed"
                  ? "Completed in current list"
                  : "Active maintenance queue"}
              </div>
            </div>
          ))}
        </section>

        <section className="grid gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm md:grid-cols-4">
          <label className="text-xs font-medium text-bms-muted">
            Status
            <select
              className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm text-bms-ink"
              value={statusFilter}
              onChange={(ev) => setStatusFilter(ev.target.value as StatusFilter)}
            >
              <option value="all">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </label>
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
            Priority
            <select
              className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm text-bms-ink"
              value={priorityFilter}
              onChange={(ev) =>
                setPriorityFilter(ev.target.value as PriorityFilter)
              }
            >
              <option value="all">All priorities</option>
              {priorities.map((item) => (
                <option key={item} value={item}>
                  {priorityLabels[item]}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded bg-bms-canvas px-3 py-2 text-xs text-bms-muted">
            <div className="font-condensed text-lg font-bold text-bms-ink">
              {filteredRows.length}
            </div>
            Matching work orders
          </div>
        </section>

        {workOrdersQ.isLoading ? (
          <p className="text-sm text-bms-muted">Loading work orders…</p>
        ) : workOrdersQ.isError ? (
          <p className="text-sm text-red-600">Could not load work orders.</p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-5">
            {kanbanColumns.map((column) => (
              <section
                key={column.key}
                className={`max-h-[60vh] overflow-auto rounded-lg bg-gray-200 p-2 transition ${
                  dropTarget?.status === column.key ? "ring-2 ring-bms-green/40" : ""
                }`}
                onDragOver={(ev) =>
                  handleDragOver(
                    ev,
                    column.key,
                    rowsByStatus[column.key].length,
                  )
                }
                onDrop={() =>
                  handleDrop(column.key, rowsByStatus[column.key].length)
                }
              >
                <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-wide text-bms-muted">
                  <span>{column.label}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[10px] text-bms-muted">
                    {rowsByStatus[column.key].length}
                  </span>
                </div>
                <div className="space-y-2">
                  {rowsByStatus[column.key].length === 0 ? (
                    <div className="rounded border border-dashed border-gray-300 bg-white/70 px-3 py-6 text-center text-xs text-bms-muted">
                      Drop work orders here
                    </div>
                  ) : (
                    rowsByStatus[column.key].map((row, index) => (
                      <article
                        key={row.id}
                        draggable
                        className={`cursor-grab rounded-md border border-gray-200 border-l-4 bg-white p-3 shadow-sm transition active:cursor-grabbing ${
                          dragState?.id === row.id ? "opacity-50" : ""
                        } ${
                          dropTarget?.status === column.key &&
                          dropTarget.index === index
                            ? "ring-2 ring-bms-green/50"
                            : ""
                        } ${priorityRailStyle(row.priority)}`}
                        onDragStart={(ev) => {
                          ev.dataTransfer.effectAllowed = "move";
                          ev.dataTransfer.setData("text/plain", row.id);
                          handleDragStart(row);
                        }}
                        onDragOver={(ev) => handleDragOver(ev, column.key, index)}
                        onDrop={(ev) => {
                          ev.stopPropagation();
                          handleDrop(column.key, index);
                        }}
                        onDragEnd={handleDragEnd}
                      >
                        <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-bms-muted">
                          <span>WO-{row.id.slice(0, 8).toUpperCase()}</span>
                          <span title="Drag to reorder">drag</span>
                        </div>
                        <h2 className="mt-1 text-sm font-semibold text-bms-ink">
                          {row.title}
                        </h2>
                        <p className="mt-1 line-clamp-2 text-xs text-bms-muted">
                          {row.description ?? "No description"}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-1">
                          <span
                            className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${priorityStyle(row.priority)}`}
                          >
                            {priorityLabels[row.priority]}
                          </span>
                          <span
                            className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${statusStyle(row.status)}`}
                          >
                            {statusLabels[row.status]}
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2 font-mono text-[10px] text-bms-muted">
                          <span>{row.assetCode}</span>
                          <span>{new Date(row.updatedAt).toLocaleDateString()}</span>
                        </div>
                        <div className="mt-1 text-[10px] text-bms-muted">
                          {row.assetName} · {row.siteName}
                        </div>
                        {row.alarmId ? (
                          <div className="mt-2 rounded bg-bms-canvas px-2 py-1 font-mono text-[10px] text-bms-muted">
                            Alarm {row.alarmId.slice(0, 8)}
                          </div>
                        ) : null}
                        <div className="mt-3 flex justify-end gap-2">
                          <button
                            type="button"
                            className="rounded border border-gray-300 px-2 py-1 text-[11px] font-semibold text-bms-ink hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => openStatusEditor(row)}
                            disabled={row.status === "closed"}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="rounded bg-bms-green px-2 py-1 text-[11px] font-semibold text-white hover:bg-bms-green-dark disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => openClose(row)}
                            disabled={row.status === "closed"}
                          >
                            Close
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
        {dragError ? (
          <p className="text-xs text-red-600" role="alert">
            Kanban order was not saved: {dragError}
          </p>
        ) : null}
      </div>

      {createOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="work-order-create-title"
        >
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h2
              id="work-order-create-title"
              className="font-condensed text-lg font-bold"
            >
              Create work order
            </h2>
            <form className="mt-4 space-y-3" onSubmit={submitCreate}>
              <label className="block text-xs font-medium text-bms-muted">
                Asset
                <select
                  className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-bms-ink"
                  value={assetId}
                  onChange={(ev) => setAssetId(ev.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select an asset
                  </option>
                  {assetOptions.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.code} · {asset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-bms-muted">
                Title
                <input
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  value={title}
                  onChange={(ev) => setTitle(ev.target.value)}
                  minLength={3}
                  maxLength={255}
                  required
                />
              </label>
              <label className="block text-xs font-medium text-bms-muted">
                Description
                <textarea
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  rows={3}
                  value={description}
                  onChange={(ev) => setDescription(ev.target.value)}
                  maxLength={4000}
                />
              </label>
              <label className="block text-xs font-medium text-bms-muted">
                Priority
                <select
                  className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                  value={priority}
                  onChange={(ev) => setPriority(ev.target.value as WorkOrderPriority)}
                >
                  {priorities.map((item) => (
                    <option key={item} value={item}>
                      {priorityLabels[item]}
                    </option>
                  ))}
                </select>
              </label>
              {alarmId ? (
                <p className="rounded bg-bms-canvas px-3 py-2 font-mono text-[11px] text-bms-muted">
                  Linked alarm: {alarmId}
                </p>
              ) : null}
              {createError ? (
                <p className="text-xs text-red-600" role="alert">
                  {createError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded px-3 py-2 text-sm text-bms-muted hover:bg-gray-100"
                  onClick={closeCreate}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    createM.isPending ||
                    !assetId ||
                    title.trim().length < 3 ||
                    assetsQ.isLoading
                  }
                  className="rounded bg-bms-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {createM.isPending ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="work-order-status-title"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2
              id="work-order-status-title"
              className="font-condensed text-lg font-bold"
            >
              Edit status
            </h2>
            <p className="mt-1 text-xs text-bms-muted">{editTarget.title}</p>
            <form className="mt-4 space-y-3" onSubmit={submitStatus}>
              <label className="block text-xs font-medium text-bms-muted">
                New status
                <select
                  className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                  value={nextStatus}
                  onChange={(ev) => setNextStatus(ev.target.value as WorkOrderStatus)}
                >
                  {nextStatusOptions(editTarget.status).map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-bms-muted">
                Reason
                <textarea
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  rows={3}
                  value={statusReason}
                  onChange={(ev) => setStatusReason(ev.target.value)}
                  placeholder="Optional state-change note"
                  maxLength={2000}
                />
              </label>
              {statusError ? (
                <p className="text-xs text-red-600" role="alert">
                  {statusError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded px-3 py-2 text-sm text-bms-muted hover:bg-gray-100"
                  onClick={() => setEditTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={statusM.isPending}
                  className="rounded bg-bms-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {statusM.isPending ? "Saving…" : "Save status"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {closeTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="work-order-close-title"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2
              id="work-order-close-title"
              className="font-condensed text-lg font-bold"
            >
              Close work order
            </h2>
            <p className="mt-1 text-xs text-bms-muted">{closeTarget.title}</p>
            <form className="mt-4 space-y-3" onSubmit={submitClose}>
              <label className="block text-xs font-medium text-bms-muted">
                Closure reason
                <textarea
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  rows={3}
                  value={closeReason}
                  onChange={(ev) => setCloseReason(ev.target.value)}
                  minLength={3}
                  maxLength={2000}
                  required
                />
              </label>
              {closeError ? (
                <p className="text-xs text-red-600" role="alert">
                  {closeError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded px-3 py-2 text-sm text-bms-muted hover:bg-gray-100"
                  onClick={() => {
                    setCloseTarget(null);
                    setCloseSortOrder(undefined);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={closeM.isPending || closeReason.trim().length < 3}
                  className="rounded bg-bms-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {closeM.isPending ? "Closing…" : "Close work order"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
