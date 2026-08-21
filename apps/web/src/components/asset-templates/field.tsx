import type { ReactNode } from "react";

/**
 * A labelled form field, shared by the authoring tabs (`F2.5`, ADR 0038).
 *
 * Extracted because the same component was written three times — byte for byte
 * in `kpis-tab.tsx` and `alarms-tab.tsx`, and once more in `details-tab.tsx`
 * with the optional `hint` this version keeps. AGENTS.md §4.2 asks for one
 * component per file; three copies of one component is the same rule read from
 * the other side.
 *
 * The duplication was not only untidy. Each copy is a place the field label
 * styling, the error colour and the error-hides-hint rule can drift, and none
 * of it is reachable by a test — `apps/web`'s Vitest project runs
 * `environment: "node"` over `src/**\/*.test.ts`, so a `.tsx` is invisible to
 * every gate in this repository. One copy is one place to be wrong.
 *
 * Presentation only, deliberately. Nothing here decides anything, which is why
 * it has no spec — the rules that produce `error` live in `src/lib/`.
 */
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  /** Shown only when there is no error — an error is the more useful message. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-bms-muted">
        {label}
      </span>
      {children}
      {error ? <span className="block text-[11px] text-red-700">{error}</span> : null}
      {!error && hint ? <span className="block text-[11px] text-bms-muted">{hint}</span> : null}
    </label>
  );
}
