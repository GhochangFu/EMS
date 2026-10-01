import type { WidgetStatus } from "../../lib/widget-catalog";
import { StateLegend } from "../control-room/state-legend";

/**
 * `F3.73` (plan D9) — the severity and state legend. It reads the vocabulary itself, so the
 * site-widgets read adds nothing to it.
 *
 * **`F3.77` plan D2 — one 64 px row, no `WidgetFrame`.** The frame's chrome (`p-3`, the `h3`,
 * `mb-2`) takes about 48.5 px, which would leave the pills about 15 px of a 1-row cell. The title
 * is drawn inline, in the frame's label style, before the pills. The legend ignores `status` by
 * design: it binds nothing and reads only the severity vocabulary, so a loading, error or empty
 * placeholder would hide a key that is true whatever the widget's data. `status` stays on the
 * props only so the two dispatchers keep one call shape for every widget.
 */
export function StateLegendWidget({ title }: { title: string; status: WidgetStatus }) {
  return (
    <div className="surface-raised flex h-full items-center gap-3 overflow-hidden px-3">
      <span className="shrink-0 truncate text-[11px] font-medium uppercase tracking-wide text-ink-muted">{title}</span>
      <StateLegend />
    </div>
  );
}
