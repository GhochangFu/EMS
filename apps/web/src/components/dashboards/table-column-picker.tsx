import type { MetricCatalogKey } from "@bms/shared";
import { METRIC_CATALOG } from "@bms/shared";

import { moveArrayItem } from "../../lib/template-dashboard-form";

type TableColumnPickerProps = {
  /** The dataset this table binds. Its declared columns are the only legal choices. */
  catalogKey: MetricCatalogKey;
  chosen: readonly string[];
  onChange: (columns: string[]) => void;
};

/**
 * `F3.35` Stage B — the column picker ADR 0048 decision 2 requires.
 *
 * *"A table widget needs a column picker as well as a source picker, because a dataset declares
 * more columns than a six-row card should show."*
 *
 * **The legal set comes from `METRIC_CATALOG`, the same record the write path reads.** So an
 * option offered here cannot be one `eachTableColumnIsDeclared` answers 400 for — the identical
 * relationship `MetricSourcePicker` has with `WIDGET_SOURCE_SHAPES`, and for the identical
 * reason: a builder that offers what the API refuses teaches an author to distrust the form.
 *
 * **Nothing chosen means every column**, matching `tableConfigSchema` and `projectColumns`. The
 * empty state therefore reads "showing all", never "showing none" — a picker whose empty state
 * looked like a broken card would push every author into selecting all six by hand.
 *
 * **Order is editable, because the order IS the projection.** `projectColumns` renders columns
 * in the order this array gives, so without the arrows the picker could express *which* columns
 * but never *which first* — and on a six-column dataset in a three-column card, which comes
 * first is most of the decision. `moveArrayItem` is `template-dashboard-form.ts`'s, already used
 * for a template's `featured` list; a second implementation of "swap with my neighbour" is the
 * duplication §4 forbids.
 */
export function TableColumnPicker({ catalogKey, chosen, onChange }: TableColumnPickerProps) {
  const entry = METRIC_CATALOG[catalogKey];
  if (entry.shape !== "dataset") {
    // Unreachable through the builder — `WIDGET_SOURCE_SHAPES.table` is `["dataset"]`, so a
    // table cannot hold a metric binding. Rendered as null rather than asserted because a
    // stored dashboard written before that rule existed must still open in the inspector for
    // the author to repair it, not crash the page they would repair it on.
    return null;
  }
  const declared = entry.columns;

  function toggle(column: string): void {
    onChange(
      chosen.includes(column)
        ? chosen.filter((held) => held !== column)
        : // Appended, not spliced into declared order: checking a box is the author saying
          // "and then this one".
          [...chosen, column],
    );
  }

  return (
    <div className="space-y-1.5 rounded border border-dashed border-gray-300 p-2">
      <p className="text-[11px] font-medium text-bms-muted">Columns</p>

      {chosen.length === 0 ? (
        <p className="text-[11px] leading-snug text-bms-muted">
          Showing every column. Tick one or more to narrow the card.
        </p>
      ) : (
        <ol className="space-y-1">
          {chosen.map((column, index) => (
            <li
              key={column}
              className="flex items-center justify-between rounded border border-gray-100 px-2 py-1 text-xs"
            >
              <span>{column}</span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onChange(moveArrayItem(chosen, index, -1))}
                  disabled={index === 0}
                  aria-label={`Move ${column} earlier`}
                  className="px-1 text-bms-muted disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => onChange(moveArrayItem(chosen, index, 1))}
                  disabled={index === chosen.length - 1}
                  aria-label={`Move ${column} later`}
                  className="px-1 text-bms-muted disabled:opacity-30"
                >
                  ↓
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <ul className="space-y-0.5">
        {declared.map((column) => (
          <li key={column}>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={chosen.includes(column)}
                onChange={() => toggle(column)}
                aria-label={column}
              />
              <span>{column}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
