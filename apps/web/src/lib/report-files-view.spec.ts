import { expect } from "vitest";

import type { ReportDeliveryStatus } from "@bms/shared";

import {
  deliveryStatusLabel,
  formatBytes,
  formatLabel,
  periodLabel,
  saveBlockedReason,
} from "./report-files-view";

/**
 * `F3.5a` Unit 10 (ADR 0071 R-14) — the pure report-history view logic.
 *
 * Assertions live here, in the sibling `.spec`; `report-files-view.test.ts`
 * is the Vitest entry point (ADR 0014, §4.6).
 */

const STATUSES: readonly ReportDeliveryStatus[] = ["none", "sent", "skipped_unconfigured", "failed"];
const EXPECTED_LABELS: Record<ReportDeliveryStatus, string> = {
  none: "On demand",
  sent: "Emailed",
  skipped_unconfigured: "Email not configured",
  failed: "Email failed",
};

/** Every delivery status resolves R-14's exact sentence, all four. */
export function everyDeliveryStatusHasItsExactLabel(): void {
  for (const status of STATUSES) {
    expect(deliveryStatusLabel(status)).toBe(EXPECTED_LABELS[status]);
  }
}

/** The two report formats resolve their exact labels. */
export function formatLabelsAreExact(): void {
  expect(formatLabel("pdf")).toBe("PDF");
  expect(formatLabel("xlsx")).toBe("XLSX");
}

/** `formatBytes` at the four measured boundaries. */
export function formatBytesAtTheFourBoundaries(): void {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(1023)).toBe("1023 B");
  expect(formatBytes(1024)).toBe("1.0 KB");
  expect(formatBytes(1_048_576)).toBe("1.0 MB");
}

/** The period label joins the two ISO dates with an en dash. */
export function periodLabelJoinsWithAnEnDash(): void {
  expect(periodLabel({ periodStart: "2026-09-01", periodEnd: "2026-09-07" })).toBe(
    "2026-09-01 – 2026-09-07",
  );
}

/** Each `saveBlockedReason` condition, isolated, produces its own sentence. */
export function saveBlockedReasonPerCondition(): void {
  expect(
    saveBlockedReason({
      hasPreview: true,
      previewError: false,
      needsOrganization: false,
      organizationId: undefined,
      pending: true,
    }),
  ).toBe("Saving…");

  expect(
    saveBlockedReason({
      hasPreview: true,
      previewError: true,
      needsOrganization: false,
      organizationId: undefined,
      pending: false,
    }),
  ).toBe("Fix the preview error first.");

  expect(
    saveBlockedReason({
      hasPreview: false,
      previewError: false,
      needsOrganization: false,
      organizationId: undefined,
      pending: false,
    }),
  ).toBe("Select a valid range first.");

  expect(
    saveBlockedReason({
      hasPreview: true,
      previewError: false,
      needsOrganization: true,
      organizationId: undefined,
      pending: false,
    }),
  ).toBe("Choose an organization to file the report under.");
}

/**
 * Positive control: when none of the four conditions holds, the button is
 * not blocked.
 */
export function saveBlockedReasonIsNullWhenNothingBlocks(): void {
  expect(
    saveBlockedReason({
      hasPreview: true,
      previewError: false,
      needsOrganization: true,
      organizationId: "11111111-1111-4111-8111-111111111111",
      pending: false,
    }),
  ).toBeNull();
}

/**
 * Precedence: when both `previewError` and a missing organization hold at
 * once, the preview-error sentence wins (checked most-blocking-first). Any
 * reordering of the checks reddens this row.
 */
export function previewErrorOutranksTheMissingOrganization(): void {
  expect(
    saveBlockedReason({
      hasPreview: true,
      previewError: true,
      needsOrganization: true,
      organizationId: undefined,
      pending: false,
    }),
  ).toBe("Fix the preview error first.");
}
