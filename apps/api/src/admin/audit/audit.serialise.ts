import type { AuditLogEntryDto } from "@bms/shared";

/**
 * Export serialisation for the audit read API (ADR 0021).
 *
 * Pure functions with no Nest or database dependency, so the escaping rules —
 * the part most likely to be subtly wrong — are testable without a container.
 */

/**
 * One `bms.audit_log` row, joined to its actor's email.
 *
 * An alias rather than a copy: a structural duplicate would compile today and
 * drift silently the first time the shared DTO gains a field.
 */
export type AuditRow = AuditLogEntryDto;

/** Column order for both export formats. Snake_case to match the table. */
export const AUDIT_EXPORT_COLUMNS = [
  "id",
  "created_at",
  "actor_id",
  "actor_email",
  "action",
  "entity_type",
  "entity_id",
  "reason",
  "payload",
] as const;

/**
 * Characters that make Excel/Sheets treat a CSV cell as a formula.
 *
 * TAB and CR are in OWASP's set alongside the obvious four: both are stripped
 * as leading whitespace on import, exposing whatever follows them.
 */
const FORMULA_LEADERS = ["=", "+", "-", "@", "\t", "\r"];

function cellValue(row: AuditRow, column: (typeof AUDIT_EXPORT_COLUMNS)[number]): string {
  switch (column) {
    case "id":
      return row.id;
    case "created_at":
      return row.createdAt;
    case "actor_id":
      return row.actorId ?? "";
    case "actor_email":
      return row.actorEmail ?? "";
    case "action":
      return row.action;
    case "entity_type":
      return row.entityType;
    case "entity_id":
      return row.entityId ?? "";
    case "reason":
      return row.reason ?? "";
    case "payload":
      return row.payload === null || row.payload === undefined
        ? ""
        : JSON.stringify(row.payload);
  }
}

/**
 * Row shaping without escaping — for `xlsx`, which writes these as string cells.
 * A leading `=` in a string cell is stored as text, not a formula, so the guard
 * below is a CSV concern only: it is Excel's *import* parser that reinterprets.
 */
export function toSheetRows(rows: AuditRow[]): string[][] {
  return [
    [...AUDIT_EXPORT_COLUMNS],
    ...rows.map((row) => AUDIT_EXPORT_COLUMNS.map((column) => cellValue(row, column))),
  ];
}

function escapeCell(value: string): string {
  // `reason` and `payload` carry user-supplied text and these files get opened
  // in a spreadsheet. Prefixing with an apostrophe makes the cell literal text.
  const guarded = FORMULA_LEADERS.some((lead) => value.startsWith(lead)) ? `'${value}` : value;
  if (/["\n\r,]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** CSV with a header row, LF line endings, always terminated by a newline. */
export function toCsv(rows: AuditRow[]): string {
  const lines = [
    AUDIT_EXPORT_COLUMNS.join(","),
    ...rows.map((row) =>
      AUDIT_EXPORT_COLUMNS.map((column) => escapeCell(cellValue(row, column))).join(","),
    ),
  ];
  return `${lines.join("\n")}\n`;
}
