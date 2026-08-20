import type { TelemetryEntryRow, TelemetryWriteResponse } from "@bms/shared";

const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Converts an `<input type="datetime-local">` value — which carries no
 * timezone — to an absolute UTC instant, using an explicit offset rather than
 * handing the raw string to `new Date()` (which resolves it against
 * whichever process's local timezone reads it; the same defect class Phase A
 * already fixed in the notify payload).
 *
 * `offsetMinutes` follows `Date.prototype.getTimezoneOffset()`'s convention:
 * UTC = local + offsetMinutes.
 */
export function localDateTimeToIso(value: string, offsetMinutes: number): string {
  const match = LOCAL_DATETIME_RE.exec(value);
  if (!match) {
    throw new Error(`not a valid datetime-local value: "${value}"`);
  }
  const [, year, month, day, hour, minute, second] = match;
  const epochMs =
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second ?? 0)) +
    offsetMinutes * 60_000;
  return new Date(epochMs).toISOString();
}

/** Formats an injected `Date` as an `<input type="datetime-local">` value, in its own local fields. */
export function defaultLocalDateTime(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}`
  );
}

/**
 * The offset to pass to `localDateTimeToIso` for a given `datetime-local`
 * value — derived from the *entered* wall-clock fields, not from `new
 * Date().getTimezoneOffset()` at submit time. A backfilled reading and
 * today's date can straddle a DST boundary in a zone that observes it, so
 * "now"'s offset is not always the entered instant's offset.
 */
export function offsetForLocalDateTime(value: string): number {
  const match = LOCAL_DATETIME_RE.exec(value);
  if (!match) {
    throw new Error(`not a valid datetime-local value: "${value}"`);
  }
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? 0),
  ).getTimezoneOffset();
}

export type ManualReadingFormValues = {
  assetId: string;
  pointKey: string;
  value: string;
  unit: string;
  time: string;
};

/**
 * Omits `unit` from the payload unless the operator edited it away from the
 * catalog default — sending the catalog default explicitly on a point whose
 * mapping already carries its own unit rejects every row (the write path
 * prefers an existing mapping's unit over the catalog's).
 */
export function buildManualReadingRow(
  form: ManualReadingFormValues,
  catalogUnit: string | null,
  offsetMinutes: number,
): TelemetryEntryRow {
  const row: TelemetryEntryRow = {
    assetId: form.assetId,
    pointKey: form.pointKey,
    value: Number(form.value),
    time: localDateTimeToIso(form.time, offsetMinutes),
  };
  const unit = form.unit.trim();
  if (unit !== "" && (catalogUnit === null || unit !== catalogUnit)) {
    row.unit = unit;
  }
  return row;
}

/** A confirmation line for the response — never claims success on `written: 0`. */
export function describeWriteOutcome(response: TelemetryWriteResponse): string {
  const { result, rejected } = response;
  if (result.written === 0) {
    return rejected.length > 0
      ? `No readings were written — ${rejected.length} row${rejected.length === 1 ? "" : "s"} rejected.`
      : "No readings were written.";
  }
  const parts = [`${result.written} reading${result.written === 1 ? "" : "s"} written`];
  if (result.assetPointsCreated > 0) {
    parts.push(`${result.assetPointsCreated} new mapping${result.assetPointsCreated === 1 ? "" : "s"} created`);
  }
  if (rejected.length > 0) {
    parts.push(`${rejected.length} row${rejected.length === 1 ? "" : "s"} rejected`);
  }
  return `${parts.join(", ")}.`;
}

export type ManualReadingFormErrors = Partial<Record<"assetId" | "pointKey" | "value" | "time", string>>;

/**
 * Client-side format checks only — required fields, parseable value/time.
 * Deliberately does NOT re-implement server semantic rules (future skew,
 * retention horizon, catalog membership, unit agreement); those stay
 * server-owned and surface via `rejected[].reason`.
 */
export function validateManualReadingForm(form: ManualReadingFormValues): ManualReadingFormErrors {
  const errors: ManualReadingFormErrors = {};
  if (!form.assetId) {
    errors.assetId = "Asset is required.";
  }
  if (!form.pointKey) {
    errors.pointKey = "Point key is required.";
  }
  if (form.value.trim() === "" || !Number.isFinite(Number(form.value))) {
    errors.value = "Enter a numeric value.";
  }
  if (!LOCAL_DATETIME_RE.test(form.time)) {
    errors.time = "Enter a valid date and time.";
  }
  return errors;
}
