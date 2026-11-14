import { validateExtension, validateWindowPeriod } from "../maintenance-windows/maintenance-window-period";
import { CANCEL_NOT_FUTURE, END_NOT_ACTIVE, EXTEND_NOT_ACTIVE } from "../maintenance-windows/maintenance-windows.service";
import type { MaintenanceWindowCard } from "./copilot-maintenance-window-targets";
import type { ResolvedTarget } from "./copilot-target-resolver";
import { PROPOSE_TARGET_ERROR } from "./copilot-template-lifecycle";

/**
 * `F4.359` PR 6 (ADR 0099 Amendment 19 decision 8; the `F4.284` DC6 precedent,
 * `copilot-propose-operations.ts`) — the propose step's checks for the four
 * maintenance-window entries. Pure: they read the body, what the target resolver
 * read (`copilot-maintenance-window-targets.ts`) and the turn's clock.
 *
 * A change the route would refuse is refused here with the route's own
 * sentence, so no card is shown that could never apply: an extend or an end of
 * a window that is not active, a cancel of one that is not future, and a period
 * the route's rule (`maintenance-window-period.ts`) refuses. The route stays the
 * guard at Confirm: it reads the state again on the database clock and answers
 * its 409. A row entry whose target carries no window fails closed.
 */
export const MAINTENANCE_WINDOW_ENTRY_IDS: ReadonlySet<string> = new Set([
  "maintenanceWindow.create",
  "maintenanceWindow.extend",
  "maintenanceWindow.end",
  "maintenanceWindow.cancel",
]);

/**
 * `F4.362` leftover 1: a create's `cardBody` is its targets' names (the entry's `cardOnly` key
 * `targetLabels`), which the card's Targets row shows in place of the raw ids.
 */
export type MaintenanceWindowCheck = { ok: true; cardBody?: Record<string, unknown> } | { ok: false; error: string };

const refuse = (error: string | null): MaintenanceWindowCheck => (error === null ? { ok: true } : { ok: false, error });

const dateOf = (value: unknown): Date | null => (typeof value === "string" ? new Date(value) : null);

/** The checks for one entry; an entry this file does not name passes. */
export function checkMaintenanceWindow(
  entryId: string,
  body: Readonly<Record<string, unknown>>,
  target: ResolvedTarget,
  now: Date,
): MaintenanceWindowCheck {
  if (!MAINTENANCE_WINDOW_ENTRY_IDS.has(entryId)) return { ok: true };
  if (entryId === "maintenanceWindow.create") {
    const endsAt = dateOf(body.endsAt);
    if (endsAt === null) return refuse(PROPOSE_TARGET_ERROR);
    const refused = refuse(validateWindowPeriod({ now, startsAt: dateOf(body.startsAt) ?? now, endsAt }));
    if (!refused.ok) return refused;
    return { ok: true, cardBody: { targetLabels: [...(target.maintenanceWindow?.targetLabels ?? [])] } };
  }
  const window = target.maintenanceWindow;
  if (window === undefined || window.state === null) return refuse(PROPOSE_TARGET_ERROR);
  switch (entryId) {
    case "maintenanceWindow.extend": {
      if (window.state !== "active") return refuse(EXTEND_NOT_ACTIVE);
      const endsAt = dateOf(body.endsAt);
      const currentEndsAt = dateOf(window.endsAt);
      if (endsAt === null || currentEndsAt === null) return refuse(PROPOSE_TARGET_ERROR);
      return refuse(validateExtension({ now, endsAt, currentEndsAt }));
    }
    case "maintenanceWindow.end":
      return refuse(window.state === "active" ? null : END_NOT_ACTIVE);
    default:
      return refuse(window.state === "future" ? null : CANCEL_NOT_FUTURE);
  }
}

/** The summary input the window entries read: the card data, without the state. */
export function maintenanceWindowSummaryInput(target: ResolvedTarget): { maintenanceWindow?: Omit<MaintenanceWindowCard, "state"> } {
  if (target.maintenanceWindow === undefined) return {};
  const { state: _state, ...card } = target.maintenanceWindow;
  return { maintenanceWindow: card };
}
