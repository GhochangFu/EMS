/**
 * `F4.362` review — the one order a window's targets are listed in: by kind, then label, then id. The
 * page's list (`MaintenanceWindowsService`) and the Copilot's window target (`copilot-maintenance-window-targets.ts`)
 * both sort with it, so the card's sentence and the page Review's name the targets in the same order.
 */
export function compareWindowTargets(
  a: { readonly kind: string; readonly label: string; readonly id: string },
  b: { readonly kind: string; readonly label: string; readonly id: string },
): number {
  return a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
}
