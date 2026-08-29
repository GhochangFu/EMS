import type { ReactNode } from "react";

import type { WidgetStatus } from "../../lib/widget-catalog";

type WidgetFrameProps = {
  title: string;
  status: WidgetStatus;
  children: ReactNode;
};

/**
 * The card every widget renders inside — matches `kpi-tile.tsx`'s border,
 * background and shadow (AGENTS.md §5) — plus the three non-ready states, in
 * `load-trend-chart.tsx`'s language. `children` render only on `"ready"`.
 *
 * Written once so the `widgetTitle(...)` fallback and the three non-ready
 * states are not repeated across four renderers — a `ValueTileWidget` is the
 * one exception: it composes `KpiTile`, which is already its own frame (see
 * that file's docblock for why it does not use this one).
 */
export function WidgetFrame({ title, status, children }: WidgetFrameProps) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <h3 className="mb-2 truncate text-[11px] font-medium uppercase tracking-wide text-bms-muted">{title}</h3>
      {status === "loading" ? (
        <div className="flex flex-1 items-center justify-center text-sm text-bms-muted">Loading…</div>
      ) : status === "error" ? (
        <div className="flex flex-1 items-center justify-center text-sm text-red-700">Could not load widget.</div>
      ) : status === "empty" ? (
        <div className="flex flex-1 items-center justify-center text-sm text-bms-muted">No data bound.</div>
      ) : (
        children
      )}
    </div>
  );
}
