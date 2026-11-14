import type { ShownRow } from "./copilot-diff";
import { localTime } from "./maintenance-window-time";

/**
 * `F4.362` leftover 1 (AWS check, 2026-11-14) — the rows a maintenance-window Copilot card shows in place of
 * the raw body values, as the page's Review does (`maintenance-window-wizards.tsx`, `review.shown`): each time
 * in the browser's zone, labelled, and a create's targets by the names the server stored beside the body (the
 * entry's card-only `targetLabels`). A create stored without names keeps its raw Targets row. The body the
 * Confirm sends is unchanged. Any other entry gets no rows.
 */

/**
 * The card's `shown` rows for `body`. No "Now" value: the card reads no current record for a window
 * (`fetchCopilotCurrent` has no window case), and the summary names the extend's current end.
 */
export function maintenanceWindowCardShown(catalogId: string, body: Readonly<Record<string, unknown>>): Record<string, ShownRow> {
  if (!catalogId.startsWith("maintenanceWindow.")) return {};
  const shown: Record<string, ShownRow> = {};
  const time = (field: string, label: string): void => {
    const value = body[field];
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return;
    shown[field] = { label, after: localTime(value) };
  };
  time("startsAt", "Start");
  time("endsAt", "End");
  const labels = body.targetLabels;
  if (Array.isArray(labels) && labels.length > 0 && labels.every((label): label is string => typeof label === "string")) {
    shown.targets = { label: "Targets", after: labels.join(", ") };
  }
  return shown;
}
