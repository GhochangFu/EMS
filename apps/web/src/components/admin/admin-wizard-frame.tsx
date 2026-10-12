import type { ReactNode } from "react";

/**
 * `F3.86` PR 3a (plan §5.2) — the modal the locations and RTUs pages' wizards
 * sit in, and the small helpers both wizard files share. It left
 * `location-wizards.tsx` when `rtu-wizards.tsx` became its second user
 * (AGENTS.md §4.2).
 */

/** The label style of a wizard field. */
export const labelClass = "block text-xs font-semibold text-ink-muted";
/** The input style of a wizard field. */
export const fieldClass = "mt-1 w-full surface-field px-3 py-2 text-sm";

/** The modal around a wizard: a dialog named by its heading (the e2e path locates it by name). */
export function AdminWizardFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto surface-dialog p-4"
      >
        <h2 className="font-condensed text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** A number typed as text: `undefined` when empty, so Review asks for it rather than sending `0`. */
export function numberOf(text: string): number | undefined {
  return text.trim() === "" ? undefined : Number(text);
}

/** A plain object from a fill, or `undefined`. */
export function metaOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
