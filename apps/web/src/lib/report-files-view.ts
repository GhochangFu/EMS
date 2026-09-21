import type { ReportDeliveryStatus, ReportFileDto, ReportFileFormat } from "@bms/shared";

/**
 * `F3.5a` Unit 10 (ADR 0071 R-14) — pure view logic for the report history.
 *
 * Kept here, not in `report-history.tsx` or `reports-panel.tsx`, so F3.5b's
 * email queue can light up the remaining delivery statuses by changing no
 * component — `deliveryStatusLabel` is the only place any of the four
 * sentences is spelled.
 */

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * 1024;

/**
 * `n` bytes as a short label. Below 1 KiB (`< 1024`) whole bytes; at and
 * above 1 KiB, one decimal place in the largest unit that keeps the number
 * `< 1024`: `67` → `"67 B"`, `1023` → `"1023 B"`, `1024` → `"1.0 KB"`,
 * `1_048_576` → `"1.0 MB"`.
 */
export function formatBytes(n: number): string {
  if (n < BYTES_PER_KB) {
    return `${n} B`;
  }
  if (n < BYTES_PER_MB) {
    return `${(n / BYTES_PER_KB).toFixed(1)} KB`;
  }
  return `${(n / BYTES_PER_MB).toFixed(1)} MB`;
}

/** `2026-09-01 – 2026-09-07` — the two ISO dates joined by an en dash (U+2013). */
export function periodLabel(file: Pick<ReportFileDto, "periodStart" | "periodEnd">): string {
  return `${file.periodStart} – ${file.periodEnd}`;
}

/**
 * R-14's four sentences, exactly. Typed as a `Record` over every
 * `ReportDeliveryStatus` so a fifth status is a compile error rather than a
 * silent `undefined`.
 */
const DELIVERY_STATUS_LABELS: Record<ReportDeliveryStatus, string> = {
  none: "On demand",
  sent: "Emailed",
  skipped_unconfigured: "Email not configured",
  failed: "Email failed",
};

export function deliveryStatusLabel(status: ReportDeliveryStatus): string {
  return DELIVERY_STATUS_LABELS[status];
}

const FORMAT_LABELS: Record<ReportFileFormat, string> = {
  pdf: "PDF",
  xlsx: "XLSX",
};

export function formatLabel(format: ReportFileFormat): string {
  return FORMAT_LABELS[format];
}

/** The inputs `saveBlockedReason` reads, one per condition it checks. */
export type SaveBlockedInput = {
  /** Whether the current range resolved a preview to save. */
  readonly hasPreview: boolean;
  /** Set when the preview request itself failed. */
  readonly previewError: boolean;
  /** True when the caller's role requires an organization choice and none is made. */
  readonly needsOrganization: boolean;
  /** The chosen organization id, if any — required together with `needsOrganization`. */
  readonly organizationId: string | undefined;
  /** True while the save request is in flight. */
  readonly pending: boolean;
};

/**
 * The reason the Save-to-history button is disabled, or `null` when it is
 * not.
 *
 * **Order is load-bearing** (checked most-blocking-first, so exactly one
 * sentence renders when several conditions hold at once): a save already in
 * flight wins over everything else, then a broken preview, then no range
 * resolved yet, then a missing organization choice.
 */
export function saveBlockedReason(input: SaveBlockedInput): string | null {
  if (input.pending) {
    return "Saving…";
  }
  if (input.previewError) {
    return "Fix the preview error first.";
  }
  if (!input.hasPreview) {
    return "Select a valid range first.";
  }
  if (input.needsOrganization && !input.organizationId) {
    return "Choose an organization to file the report under.";
  }
  return null;
}
