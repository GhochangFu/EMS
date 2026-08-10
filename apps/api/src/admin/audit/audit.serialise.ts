import type { AuditLogEntryDto } from "@bms/shared";

import { csvDocument, csvTextCell } from "../../serialise/csv";

/**
 * Export serialisation for the audit read API (ADR 0021).
 *
 * Pure functions with no Nest or database dependency, so the escaping rules —
 * the part most likely to be subtly wrong — are testable without a container.
 *
 * The escaping itself moved to `src/serialise/csv.ts` under ADR 0026, because the
 * Energy Consumption export had no formula guard at all and a second copy was the
 * wrong fix. **This call site keeps blanket semantics**: every one of the nine
 * columns below is string-shaped — UUIDs, timestamps, action names, free text,
 * JSON — so there is no numeric cell here to exempt, and the numeric carve-out
 * that ADR 0026 gives the reports export does not apply. The two exports are
 * consistent, not identical.
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
 * is a CSV concern only: it is Excel's *import* parser that reinterprets.
 */
export function toSheetRows(rows: AuditRow[]): string[][] {
  return [
    [...AUDIT_EXPORT_COLUMNS],
    ...rows.map((row) => AUDIT_EXPORT_COLUMNS.map((column) => cellValue(row, column))),
  ];
}

/** CSV with a header row, LF line endings, always terminated by a newline. */
export function toCsv(rows: AuditRow[]): string {
  return csvDocument([
    AUDIT_EXPORT_COLUMNS.map((column) => csvTextCell(column)),
    ...rows.map((row) => AUDIT_EXPORT_COLUMNS.map((column) => csvTextCell(cellValue(row, column)))),
  ]);
}
