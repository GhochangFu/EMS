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
      {renderBody(status, children)}
    </div>
  );
}

/**
 * A `switch` with a compiler-held exhaustiveness gate, not the if/else chain
 * this replaced — the chain's final `else` rendered `children` (the chart)
 * for anything that was not `"loading"`/`"error"`/`"empty"`, so a fifth
 * `WidgetStatus` member would fall through and draw the chart where a
 * placeholder belongs, with nothing to catch it. The `never` assignment
 * below fails the build on a missing `case` instead.
 */
function renderBody(status: WidgetStatus, children: ReactNode): ReactNode {
  switch (status) {
    case "loading":
      return <div className="flex flex-1 items-center justify-center text-sm text-bms-muted">Loading…</div>;
    case "error":
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-red-700">Could not load widget.</div>
      );
    case "empty":
      return <div className="flex flex-1 items-center justify-center text-sm text-bms-muted">No data bound.</div>;
    case "ready":
      return children;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
