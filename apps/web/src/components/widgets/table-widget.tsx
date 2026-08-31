import type { DatasetRow, TableConfig, WidgetStatus } from "../../lib/widget-catalog";
import { projectColumns, tableCellText } from "../../lib/table-widget-cells";
import { metricCatalogColumnLabel } from "../../lib/metric-catalog";
import { WidgetFrame } from "./widget-frame";

type TableWidgetProps = {
  title: string;
  status: WidgetStatus;
  stale?: boolean;
  config: TableConfig;
  /** Every column the bound dataset declares, as the resolve returned them. */
  columns: readonly string[];
  rows: readonly DatasetRow[];
  /** The resolve hit `MAX_DATASET_ROWS` and cut the answer off. */
  truncated: boolean;
};

/**
 * `table` — the fifth widget type (`F3.35` Stage B, ADR 0048 decision 5).
 *
 * **A plain `<table>`, and ADR 0048's Dependencies section rules that deliberately**: the
 * natural reading of "a table widget" is a data-grid library, and this row adds no npm package.
 * A six-row card with a column picker needs no virtualisation, no column resizing and no sort —
 * `F3.1d` answered the same question for the canvas by not needing one either. If a later row
 * concludes it does need a grid, that is a §9.4 gate and its own ADR, not a quiet import here.
 *
 * **The projection happens here, not in a query** (decision 2). The resolve returns every
 * declared column and this renderer picks; no column name travels in a request and no SQL is
 * built from one. `projectColumns` is the pure half and is tested directly.
 *
 * **Horizontal scroll lives on the wrapper, not the page.** A six-column dataset in a
 * three-column-wide card must scroll inside its own box; a table that widens its container
 * would push the whole canvas sideways and move every other widget.
 */
export function TableWidget({
  title,
  status,
  stale,
  config,
  columns,
  rows,
  truncated,
}: TableWidgetProps) {
  const shown = projectColumns(columns, config.columns);

  return (
    <WidgetFrame title={title} status={status} stale={stale}>
      {shown.length === 0 ? (
        // Not an error state and not `WidgetFrame`'s "no data": the widget resolved, and the
        // answer is that nothing is showable. That happens when the bound dataset declares no
        // column the config still names — a released catalog change can do it to a stored
        // config — and saying so is what stops it reading as a broken card.
        <p className="p-3 text-xs text-bms-muted">
          No columns to show. Edit this widget and choose at least one.
        </p>
      ) : (
        <div className="h-full overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-white">
              <tr>
                {shown.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="whitespace-nowrap border-b border-gray-200 px-2 py-1.5 font-medium text-bms-muted"
                  >
                    {metricCatalogColumnLabel(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={shown.length} className="px-2 py-3 text-bms-muted">
                    Nothing to show right now.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  // Index keys, and the dataset is why: a resolved row carries no id — the
                  // catalog declares presentation columns only — so there is no stable
                  // identity to key on. The list is replaced wholesale on every refresh and
                  // never reordered in place, which is the case where an index key is correct.
                  <tr key={index} className="border-b border-gray-100 last:border-0">
                    {shown.map((column) => (
                      <td key={column} className="whitespace-nowrap px-2 py-1.5 text-bms-ink">
                        {tableCellText(row[column])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {truncated ? (
            <p className="px-2 py-1.5 text-[11px] text-bms-muted">
              Showing the first {rows.length} rows.
            </p>
          ) : null}
        </div>
      )}
    </WidgetFrame>
  );
}
