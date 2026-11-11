import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DragEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ASSET_LABEL_SEPARATOR,
  assetLabelParts,
  type BoardWorkOrderStatus,
  type WorkOrderListItem,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from "@bms/shared";

import { fetchAssets } from "../api/assets";
import { fetchWorkOrders, reorderWorkOrders, type ReorderWorkOrderItem } from "../api/work-orders";
import { PageHeader } from "../components/page-header";
import { WorkOrderCloseWizard } from "../components/work-orders/work-order-close-wizard";
import { WorkOrderStatusWizard } from "../components/work-orders/work-order-status-wizard";
import { APPROVE_AND_CLOSE_LABEL, priorities, priorityLabels, statusLabels } from "../components/work-orders/work-order-labels";
import { WorkOrderWizard } from "../components/work-orders/work-order-wizard";
import { canApproveWorkOrders } from "../lib/admin-access";
import { apiErrorMessage } from "../lib/api-error-message";
import { AppShell } from "../layouts/app-shell";
import type { AuthUser } from "../stores/auth-store";

type WorkOrdersPageProps = {
  user: AuthUser;
};

type StatusFilter = WorkOrderStatus | "all";
type PriorityFilter = WorkOrderPriority | "all";
type KanbanColumn = {
  key: BoardWorkOrderStatus;
  label: string;
  kpiLabel: string;
  kpiTone?: "warning" | "info" | "success";
};
type DragState = {
  id: string;
  fromStatus: BoardWorkOrderStatus;
};
type DropTarget = {
  status: BoardWorkOrderStatus;
  index: number;
};

/** The five columns, in board order: what a reorder body may carry (ADR 0122 decision 6.8). */
const boardStatuses: BoardWorkOrderStatus[] = [
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "closed",
];

/** The status filter's choices: the five columns, then *Cancelled*, which is on no column. */
const filterStatuses: WorkOrderStatus[] = [...boardStatuses, "cancelled"];

/** A cancelled ticket is on no column: it is neither dragged nor sent in a reorder. */
function isOnBoard(row: WorkOrderListItem): row is WorkOrderListItem & { status: BoardWorkOrderStatus } {
  return row.status !== "cancelled";
}

/** Exported for `work-orders-page.spec.tsx`: why a drop on Done was not taken. */
export const APPROVE_NEEDS_RESOLVED = "Only a resolved work order can be approved and closed";
export const APPROVE_NEEDS_ADMIN = "Approving and closing a work order requires an administrator role";

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

// F4.209: a stable empty list, so the `[rows]` effect does not fire (and set state) on every render while the list has no data.
const NO_ROWS: WorkOrderListItem[] = [];

/** `F4.316` (ADR 0111): the label's `· where` part — the RTU's name, or the location's without one. */
function whereOf(r: WorkOrderListItem): string | null {
  return assetLabelParts({ code: r.assetCode, rtuName: r.assetRtuName, locationName: r.assetLocationName }).where;
}

/** The wrapping `· where` span, or nothing when the asset has neither an RTU nor a location. */
function WhereSpan({ where }: { where: string | null }) {
  return where === null ? null : (
    <span className="whitespace-normal">
      {ASSET_LABEL_SEPARATOR}
      {where}
    </span>
  );
}

function statusStyle(status: WorkOrderStatus): string {
  switch (status) {
    case "closed":
    case "cancelled":
      return "border-line bg-well-deep text-neutral-ink";
    case "resolved":
      return "border-accent/20 bg-ok-wash text-ok-ink";
    case "in_progress":
      return "border-info-line bg-info-wash text-info-ink";
    case "assigned":
      return "border-info-line bg-info-wash text-info-ink";
    case "open":
      return "border-warning-line bg-warning-wash-strong text-warning-ink";
  }
}

/** Exported for `work-orders-page.spec.tsx` (F3.65b owner ruling R-f: high and medium differ). */
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

function kpiToneStyle(tone?: KanbanColumn["kpiTone"]): string {
  switch (tone) {
    case "warning":
      return "after:bg-warning";
    case "info":
      return "after:bg-info";
    case "success":
      return "after:bg-ok";
    default:
      return "after:bg-ok";
  }
}

/** Exported for `work-orders-page.spec.tsx` (F3.65b owner ruling R-f: high and medium differ). */
export function priorityRailStyle(priority: WorkOrderPriority): string {
  switch (priority) {
    case "critical":
      return "border-l-critical";
    case "high":
      return "border-l-warning";
    case "medium":
      return "border-l-warning/50";
    case "low":
      return "border-l-info";
  }
}

export function WorkOrdersPage({ user }: WorkOrdersPageProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [assetFilter, setAssetFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  // `F4.284` (ADR 0099 decision 6): the create, status and close forms are `WizardShell`s; `null` is closed.
  const [createInitial, setCreateInitial] = useState<Record<string, unknown> | null>(null);
  const [editTarget, setEditTarget] = useState<WorkOrderListItem | null>(null);
  // `E3.1` (ADR 0122 ruling P1): a card dropped on Review opens the status wizard on `resolved`.
  const [editInitialStatus, setEditInitialStatus] = useState<WorkOrderStatus | undefined>(undefined);
  const [closeTarget, setCloseTarget] = useState<WorkOrderListItem | null>(null);
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
    queryFn: () => fetchAssets(),
  });

  useEffect(() => {
    const queryAlarmId = searchParams.get("alarmId");
    const queryAssetId = searchParams.get("assetId");
    if (!queryAlarmId || !queryAssetId) {
      return;
    }
    const description = searchParams.get("description");
    setCreateInitial({
      alarmId: queryAlarmId,
      assetId: queryAssetId,
      title: searchParams.get("title") ?? "Investigate alarm",
      ...(description ? { description } : {}),
      priority: "high",
    });
  }, [searchParams]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["work-orders", "list"] });

  const reorderM = useMutation({
    // `F4.284` (DC2): the canvas entry `workOrder.reorder` — the stepper gate reads this call.
    mutationFn: (items: ReorderWorkOrderItem[]) => reorderWorkOrders(items),
    onSuccess: () => {
      setDragError(null);
      void qc.invalidateQueries({ queryKey: ["work-orders", "list"] });
    },
    onError: (err: unknown) => {
      setDragError(apiErrorMessage(err));
      void qc.invalidateQueries({ queryKey: ["work-orders", "list"] });
    },
  });

  const rows = workOrdersQ.data?.items ?? NO_ROWS;
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
      kanbanColumns.reduce<Record<BoardWorkOrderStatus, WorkOrderListItem[]>>(
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
  // `E3.1` (ADR 0122 decision 6.8): cancelled tickets are on no column; the *Cancelled*
  // filter lists them below the filters, in place of the board.
  const cancelledRows = useMemo(() => filteredRows.filter((row) => row.status === "cancelled"), [filteredRows]);
  const mayApprove = canApproveWorkOrders(user.role);

  function openCreate(): void {
    setCreateInitial(assetOptions[0] ? { assetId: assetOptions[0].id } : {});
  }

  function closeCreate(): void {
    setCreateInitial(null);
    navigate("/work-orders", { replace: true });
  }

  function openStatusEditor(row: WorkOrderListItem): void {
    setEditInitialStatus(undefined);
    setEditTarget(row);
  }

  function openClose(row: WorkOrderListItem): void {
    setCloseTarget(row);
    setCloseSortOrder(undefined);
  }

  function buildReorderItems(
    order: string[],
    overrides: Map<string, BoardWorkOrderStatus>,
  ): ReorderWorkOrderItem[] {
    const nextByStatus: Record<BoardWorkOrderStatus, ReorderWorkOrderItem[]> = {
      open: [],
      assigned: [],
      in_progress: [],
      resolved: [],
      closed: [],
    };
    for (const id of order) {
      const row = rowById.get(id);
      // A cancelled row is never sent: the reorder route refuses the whole batch for one
      // `cancelled` item (400), which would break every drag on the board.
      if (!row || !isOnBoard(row)) {
        continue;
      }
      const status = overrides.get(id) ?? row.status;
      nextByStatus[status].push({ id, status, sortOrder: 0 });
    }
    return boardStatuses.flatMap((status) =>
      nextByStatus[status].map((item, index) => ({
        ...item,
        sortOrder: index * 1000,
      })),
    );
  }

  function nextLocalOrder(
    draggedId: string,
    targetStatus: BoardWorkOrderStatus,
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
    if (!isOnBoard(row)) {
      return;
    }
    setDragState({ id: row.id, fromStatus: row.status });
    setDropTarget({ status: row.status, index: 0 });
  }

  function handleDragOver(
    e: DragEvent<HTMLElement>,
    status: BoardWorkOrderStatus,
    index: number,
  ): void {
    if (!dragState) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ status, index });
  }

  function handleDrop(status: BoardWorkOrderStatus, index: number): void {
    if (!dragState) {
      return;
    }
    const dragged = rowById.get(dragState.id);
    setDragState(null);
    setDropTarget(null);
    if (!dragged || !isOnBoard(dragged)) {
      return;
    }

    // `E3.1` (ADR 0122 decisions 6.2 and 6.5): a drop on Done is the approval. Only an
    // approver may make it and only a resolved ticket takes it; the route would refuse
    // anything else, so the drop says why and opens nothing.
    if (status === "closed" && dragged.status !== "closed") {
      if (!mayApprove) {
        setDragError(APPROVE_NEEDS_ADMIN);
        return;
      }
      if (dragged.status !== "resolved") {
        setDragError(APPROVE_NEEDS_RESOLVED);
        return;
      }
      setDragError(null);
      setCloseTarget(dragged);
      setCloseSortOrder(index * 1000);
      return;
    }

    // `E3.1` (ADR 0122 ruling P1): resolve always goes through its form, which carries
    // the checklist gate and the root cause. The reorder route refuses this move (400),
    // so the drop opens the status wizard on `resolved` and sends no reorder.
    // A closed card keeps its old path: the reorder route refuses to reopen it.
    if (status === "resolved" && dragged.status !== "resolved" && dragged.status !== "closed") {
      setEditInitialStatus("resolved");
      setEditTarget(dragged);
      return;
    }

    const nextOrder = nextLocalOrder(dragged.id, status, index);
    const overrides = new Map<string, BoardWorkOrderStatus>([[dragged.id, status]]);
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
        <span className="text-ink">
          Operations · Maintenance Kanban · audited work-order state changes
        </span>
      }
    >
      <div className="mx-auto max-w-[1320px] space-y-4 pb-8">
        <PageHeader
          eyebrow="R.mt"
          title="Maintenance Kanban · Work Orders"
          subtitle="Preventive · corrective · predictive · AMC · compliance"
          actions={
            <>
            <button
              type="button"
              className="surface-button px-3 py-2 text-xs font-semibold"
            >
              Filter
            </button>
            <button
              type="button"
              className="surface-button px-3 py-2 text-xs font-semibold"
            >
              Export
            </button>
            <button
              type="button"
              className="surface-button-primary bg-accent px-4 py-2 text-xs font-semibold text-on-accent hover:bg-accent-strong"
              onClick={openCreate}
            >
              + New WO
            </button>
            </>
          }
        />

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {kanbanColumns.map((column) => (
            <div
              key={column.key}
              className={`relative overflow-hidden surface-raised surface-kpi p-4 after:absolute ${kpiToneStyle(column.kpiTone)}`}
            >
              <div className="flex items-center gap-2 text-3xs font-bold uppercase tracking-[0.14em] text-ink-muted">
                <span className="grid h-6 w-6 place-items-center rounded bg-accent/10 text-accent">
                  WO
                </span>
                {column.kpiLabel}
              </div>
              <div className="mt-3 font-condensed text-2xl font-bold text-ink">
                {rowsByStatus[column.key].length}
              </div>
              <div className="mt-1 text-xs text-ink-muted">
                {column.key === "closed"
                  ? "Completed in current list"
                  : "Active maintenance queue"}
              </div>
            </div>
          ))}
        </section>

        <section className="grid gap-3 surface-raised p-3 md:grid-cols-4">
          <label className="text-xs font-medium text-ink-muted">
            Status
            <select
              className="mt-1 w-full surface-field px-2 py-2 text-sm text-ink"
              value={statusFilter}
              onChange={(ev) => setStatusFilter(ev.target.value as StatusFilter)}
            >
              <option value="all">All statuses</option>
              {filterStatuses.map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </label>
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
            Priority
            <select
              className="mt-1 w-full surface-field px-2 py-2 text-sm text-ink"
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
          <div className="rounded bg-canvas px-3 py-2 text-xs text-ink-muted">
            <div className="font-condensed text-lg font-bold text-ink">
              {filteredRows.length}
            </div>
            Matching work orders
          </div>
        </section>

        {workOrdersQ.isLoading ? (
          <p className="text-sm text-ink-muted">Loading work orders…</p>
        ) : workOrdersQ.isError ? (
          <p className="text-sm text-critical-ink">Could not load work orders.</p>
        ) : statusFilter === "cancelled" ? (
          <section aria-label="Cancelled work orders" className="surface-raised p-3">
            {cancelledRows.length === 0 ? (
              <p className="text-sm text-ink-muted">No cancelled work orders.</p>
            ) : (
              <ul className="divide-y divide-line">
                {cancelledRows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <div className="font-mono text-3xs text-ink-muted">{row.reference}</div>
                      <div className="text-sm font-semibold text-ink">{row.title}</div>
                      <div className="text-3xs text-ink-muted">
                        {row.assetName} · {row.siteName}
                      </div>
                    </div>
                    <span className={`rounded border px-2 py-0.5 text-3xs font-bold uppercase ${statusStyle(row.status)}`}>
                      {statusLabels[row.status]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <div className="grid gap-3 xl:grid-cols-5">
            {kanbanColumns.map((column) => (
              <section
                key={column.key}
                className={`max-h-[60vh] overflow-auto rounded-lg bg-line p-2 transition ${
                  dropTarget?.status === column.key ? "ring-2 ring-focus/40" : ""
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
                <div className="mb-2 flex items-center justify-between px-1 text-2xs font-bold uppercase tracking-wide text-ink-muted">
                  <span>{column.label}</span>
                  <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-3xs text-ink-muted">
                    {rowsByStatus[column.key].length}
                  </span>
                </div>
                <div className="space-y-2">
                  {rowsByStatus[column.key].length === 0 ? (
                    <div className="surface-pressed-sm px-3 py-6 text-center text-xs text-ink-muted">
                      Drop work orders here
                    </div>
                  ) : (
                    rowsByStatus[column.key].map((row, index) => (
                      <article
                        key={row.id}
                        draggable
                        className={`cursor-grab surface-raised-sm border-l-4 p-3 transition active:cursor-grabbing ${
                          dragState?.id === row.id ? "opacity-50" : ""
                        } ${
                          dropTarget?.status === column.key &&
                          dropTarget.index === index
                            ? "ring-2 ring-focus/50"
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
                        <div className="flex items-center justify-between gap-2 font-mono text-3xs text-ink-muted">
                          <span>WO-{row.id.slice(0, 8).toUpperCase()}</span>
                          <span title="Drag to reorder">drag</span>
                        </div>
                        <h2 className="mt-1 text-sm font-semibold text-ink">
                          {row.title}
                        </h2>
                        <p className="mt-1 line-clamp-2 text-xs text-ink-muted">
                          {row.description ?? "No description"}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-1">
                          <span
                            className={`rounded border px-2 py-0.5 text-3xs font-bold uppercase ${priorityStyle(row.priority)}`}
                          >
                            {priorityLabels[row.priority]}
                          </span>
                          <span
                            className={`rounded border px-2 py-0.5 text-3xs font-bold uppercase ${statusStyle(row.status)}`}
                          >
                            {statusLabels[row.status]}
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2 font-mono text-3xs text-ink-muted">
                          {/* F4.316 / ADR 0111: `<code> · <RTU or location>`; the where part wraps, never truncates. */}
                          <span>
                            <span className="whitespace-nowrap">{row.assetCode}</span>
                            <WhereSpan where={whereOf(row)} />
                          </span>
                          <span>{new Date(row.updatedAt).toLocaleDateString()}</span>
                        </div>
                        <div className="mt-1 text-3xs text-ink-muted">
                          {row.assetName} · {row.siteName}
                        </div>
                        {row.alarmId ? (
                          <div className="mt-2 rounded bg-canvas px-2 py-1 font-mono text-3xs text-ink-muted">
                            Alarm {row.alarmId.slice(0, 8)}
                          </div>
                        ) : null}
                        <div className="mt-3 flex justify-end gap-2">
                          <button
                            type="button"
                            className="surface-button px-2 py-1 text-2xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => openStatusEditor(row)}
                            disabled={row.status === "closed"}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="surface-button-primary bg-accent px-2 py-1 text-2xs font-semibold text-on-accent hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => openClose(row)}
                            // `E3.1` (ADR 0122 decision 6.2): the approval, for an approver, on a resolved ticket.
                            disabled={!mayApprove || row.status !== "resolved"}
                            title={
                              // A closed card needs no reason: it is already approved.
                              row.status === "closed" || (mayApprove && row.status === "resolved")
                                ? undefined
                                : mayApprove
                                  ? APPROVE_NEEDS_RESOLVED
                                  : APPROVE_NEEDS_ADMIN
                            }
                          >
                            {APPROVE_AND_CLOSE_LABEL}
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
          <p className="text-xs text-critical-ink" role="alert">
            {dragError === APPROVE_NEEDS_ADMIN || dragError === APPROVE_NEEDS_RESOLVED
              ? dragError
              : `Kanban order was not saved: ${dragError}`}
          </p>
        ) : null}
      </div>

      {createInitial !== null ? (
        <WorkOrderWizard
          assets={assetOptions}
          initial={createInitial}
          onCancel={closeCreate}
          onDone={async () => {
            closeCreate();
            await refresh();
          }}
        />
      ) : null}

      {editTarget ? (
        <WorkOrderStatusWizard
          row={editTarget}
          initialStatus={editInitialStatus}
          onCancel={() => {
            setEditTarget(null);
            setEditInitialStatus(undefined);
          }}
          onDone={async () => {
            setEditTarget(null);
            setEditInitialStatus(undefined);
            await refresh();
          }}
        />
      ) : null}

      {closeTarget ? (
        <WorkOrderCloseWizard
          row={closeTarget}
          {...(closeSortOrder === undefined ? {} : { sortOrder: closeSortOrder })}
          onCancel={() => {
            setCloseTarget(null);
            setCloseSortOrder(undefined);
          }}
          onDone={async () => {
            setCloseTarget(null);
            setCloseSortOrder(undefined);
            await refresh();
          }}
        />
      ) : null}
    </AppShell>
  );
}
