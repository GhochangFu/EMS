import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { AdminLocationDto } from "@bms/shared";

import { fetchReportSchedules } from "../../api/reports";
import { apiErrorMessage } from "../../lib/api-error-message";
import { ancestorIds } from "../../lib/location-tree";

type LocationMoveDialogProps = {
  node: { id: string; name: string; organizationId: string };
  /** The node's parent now; `null` for a root. */
  fromParentId: string | null;
  /** The parent the administrator picked; `null` moves the node to the top level. */
  toParentId: string | null;
  /** The organization's active nodes — the chains and the names are read from them. */
  nodes: readonly AdminLocationDto[];
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * `F2.10` (ADR 0098 Drafter choice 12, ruling 16, B3, B7) — asks before a location moves.
 *
 * A move changes who can read the node and everything under it, at once: a grant on the old
 * parent or its ancestors stops covering it, a grant on the new ones starts to. The dialog names
 * only the difference of the two chains: an ancestor on both (a move inside one root) neither
 * loses nor gains the node. It also names the report schedules on the gained ancestors, which
 * will start to render the moved subtree (B3: no API for this list — the web filters
 * `GET /reports/schedules` by the gained ids). A move that gains no ancestor — to the top level
 * (O4), or up inside one root — reads nothing.
 *
 * Confirm (`Move`) waits for the schedule read and is enabled after it succeeds or fails (B7);
 * while it waits its name is "Checking schedules…" (`F4.168`).
 * The `confirm-dialog.tsx` shape: a portal into `document.body` at `z-[60]`, above the edit
 * modal's `z-50`; Escape and Cancel close. Its own component because it holds a query.
 */
export function LocationMoveDialog({
  node,
  fromParentId,
  toParentId,
  nodes,
  onConfirm,
  onClose,
}: LocationMoveDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const chain = (parentId: string | null): string[] =>
    parentId === null ? [] : [parentId, ...ancestorIds(nodes, parentId)];
  const names = (ids: string[]): string =>
    ids.map((id) => byId.get(id)?.name).filter((name): name is string => Boolean(name)).join(", ");

  const oldChain = chain(fromParentId);
  const newChain = chain(toParentId);
  const newParentName = toParentId === null ? null : (byId.get(toParentId)?.name ?? null);
  const title =
    toParentId === null
      ? `Move ${node.name} to the top level`
      : `Move ${node.name} under ${newParentName ?? "the new parent"}`;

  const newSet = new Set(newChain);
  const oldSet = new Set(oldChain);
  const lost = oldChain.filter((id) => !newSet.has(id));
  const gained = newChain.filter((id) => !oldSet.has(id));

  const readsSchedules = gained.length > 0;
  const schedulesQ = useQuery({
    queryKey: ["reports", "schedules"],
    queryFn: fetchReportSchedules,
    enabled: readsSchedules,
  });
  // A disabled query stays `isPending` for ever, so the read only counts when it runs.
  const checking = readsSchedules && schedulesQ.isPending;

  const covering = new Set(gained);
  const matches = readsSchedules
    ? (schedulesQ.data ?? [])
        .filter(
          (s) =>
            s.organizationId === node.organizationId &&
            s.locationIds.some((id) => covering.has(id)),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const lostNames = names(lost);
  const gainedNames = names(gained);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim/30 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md space-y-3 surface-dialog p-4"
      >
        <h2 className="font-condensed text-base font-bold text-ink">{title}</h2>
        <div className="max-w-prose space-y-1 text-xs text-ink-muted">
          <p>
            {fromParentId === null
              ? `${node.name} was at the top level.`
              : lostNames
                ? `Users granted ${lostNames} lose access to ${node.name} and every node under it.`
                : `No user loses access to ${node.name}.`}
          </p>
          <p>
            {toParentId === null
              ? `${node.name} will be at the top level.`
              : gainedNames
                ? `Users granted ${gainedNames} gain it.`
                : `No user gains access to ${node.name}.`}
          </p>
          <p>The change applies at once.</p>
        </div>
        <div className="max-w-prose text-xs text-ink-muted">
          {checking ? (
            <p>Checking report schedules…</p>
          ) : readsSchedules && schedulesQ.isError ? (
            <p className="text-critical-ink">
              {`Report schedules could not be read. ${apiErrorMessage(schedulesQ.error)}`}
            </p>
          ) : matches.length === 0 ? (
            <p>No report schedule gains it.</p>
          ) : (
            <>
              <p>These report schedules will include it from their next run:</p>
              <ul className="mt-1 list-disc pl-4">
                {matches.map((s) => (
                  <li key={s.id}>{s.name}</li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" autoFocus onClick={onClose} className="surface-button px-3 py-1.5">
            Cancel
          </button>
          {/* `F4.168` — disabled while pending, so the name says why and `aria-busy` is set. */}
          <button
            type="button"
            disabled={checking}
            aria-busy={checking}
            onClick={onConfirm}
            className="surface-button-primary bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-50"
          >
            {checking ? "Checking schedules…" : "Move"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
