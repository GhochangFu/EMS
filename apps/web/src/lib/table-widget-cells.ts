import type { DatasetRow } from "../components/widgets/dashboard-widget";

/**
 * `F3.35` Stage B — the pure half of `table-widget.tsx`.
 *
 * Here rather than inside the component for the reason `ValueTileWidget`'s docblock gives about
 * `toKpiTileProps`: a presentation decision made inside a `.tsx` renderer is a decision outside
 * the coverage denominator. Both functions below decide something a reader could get wrong, so
 * both are tested directly.
 */

/**
 * Which columns the card actually draws, in the order it draws them.
 *
 * **The author's order wins, and the declared list is the gate.** `config.columns` is a
 * projection an author picked (ADR 0048 decision 2), so its order is a choice and sorting it
 * would silently discard the whole picker. But a name the bound dataset does not declare must
 * not become a column of empty cells: a released catalog change can remove a column while a
 * stored config still names it, and the write-path rule in `dashboards.schema.ts` cannot reach
 * a config that was already saved.
 *
 * **Absent or empty means every declared column**, matching `tableConfigSchema`. That is what
 * makes a newly-created table render its dataset before the author has opened the picker, and
 * what makes a stored table widen rather than blank when the catalog gains a column.
 */
export function projectColumns(
  declared: readonly string[],
  chosen: readonly string[] | undefined,
): readonly string[] {
  if (chosen === undefined || chosen.length === 0) {
    return declared;
  }
  const available = new Set(declared);
  return chosen.filter((column) => available.has(column));
}

/**
 * One cell, as text.
 *
 * **`null` renders as an em dash, never as the string "null" and never as blank.** A dataset
 * cell is `string | number | boolean | null` (`datasetCellSchema`), and every one of those
 * reaches an operator. Blank reads as "this column does not apply to this row"; "null" reads as
 * a bug. An em dash is the same "no value" mark `KpiTile` already uses, so one dashboard does
 * not spell absence two ways.
 *
 * `false` must render as "No" rather than as nothing — `String(false)` is `"false"`, but a
 * boolean that renders blank when false is a column an operator reads as half-empty.
 */
export function tableCellText(cell: DatasetRow[string] | undefined): string {
  if (cell === null || cell === undefined) {
    return "—";
  }
  if (typeof cell === "boolean") {
    return cell ? "Yes" : "No";
  }
  return String(cell);
}
