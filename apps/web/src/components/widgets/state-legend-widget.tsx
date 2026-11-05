import type { WidgetStatus } from "../../lib/widget-catalog";
import { StateLegend } from "../control-room/state-legend";

/**
 * `F3.73` (plan D9) — the severity and state legend. It reads the vocabulary itself, so the
 * site-widgets read adds nothing to it.
 *
 * **`F3.77` plan D2 — one compact row, no `WidgetFrame`.** The frame's chrome (`p-3`, the `h3`,
 * `mb-2`) takes about 48.5 px, which would make the legend's band that much taller than its pills
 * (a view canvas fits each band to its content since the `F3.77` follow-up). The title is drawn
 * inline, in the frame's label style, before the pills. A long title gives way: it may
 * shrink and truncates. The legend ignores `status` by
 * design: it binds nothing and reads only `/vocabularies` (the severities and, since `F4.309`, the
 * switching states), so a loading, error or empty
 * placeholder would hide a key that is true whatever the widget's data. `status` stays on the
 * props only so the two dispatchers keep one call shape for every widget.
 *
 * `F4.309` — `StateLegend` draws two sibling groups (the states, then the switching states when
 * there are any). The pills' wrapper may shrink and wraps, and so does the row, so a narrow cell
 * moves pills onto a second line instead of clipping them (a view canvas sizes its rows to
 * content; review M1).
 */
export function StateLegendWidget({ title }: { title: string; status: WidgetStatus }) {
  return (
    <div className="surface-raised flex h-full flex-wrap items-center gap-x-3 gap-y-1 overflow-hidden px-3 py-1">
      <span className="min-w-0 truncate text-[11px] font-medium uppercase tracking-wide text-ink-muted">{title}</span>
      {/* `F4.309` — the "Switching states" group sits beside "State legend", and wraps under it when narrow. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <StateLegend />
      </div>
    </div>
  );
}
