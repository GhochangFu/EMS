import { expect } from "vitest";

import { manualReadingsBodySchema, copilotManualReadingsModelBodySchema } from "./telemetry-entry";
import { copilotTelemetryImportModelBodySchema, copilotTelemetryImportPreviewSchema } from "./telemetry-import";

/**
 * `F4.283` (ADR 0099 Amendment 8, Q18, Q21; ADR 0030) — the telemetry write
 * bodies, moved from `apps/api`, and the two copilot model bodies that fix
 * `conflictPolicy: "reject"`. Vitest entry point: the sibling `.test.ts`.
 */

const ROW = {
  assetId: "22222222-2222-4222-8222-222222222222",
  pointKey: "kw",
  value: 12.5,
  time: "2026-10-20T09:00:00.000Z",
};

const FILE = { kind: "attachment", index: 1 } as const;

export function theImportModelBodyAcceptsReject(): void {
  expect(copilotTelemetryImportModelBodySchema.safeParse({ conflictPolicy: "reject", file: FILE }).success).toBe(true);
}

export function theImportModelBodyRefusesOverwrite(): void {
  expect(copilotTelemetryImportModelBodySchema.safeParse({ conflictPolicy: "overwrite", file: FILE }).success).toBe(false);
}

export function theImportModelBodyRefusesIndexZero(): void {
  expect(copilotTelemetryImportModelBodySchema.safeParse({ file: { kind: "attachment", index: 0 } }).success).toBe(false);
}

export function theImportModelBodyRefusesIndexFour(): void {
  expect(copilotTelemetryImportModelBodySchema.safeParse({ file: { kind: "attachment", index: 4 } }).success).toBe(false);
}

export function theReadingsModelBodyAcceptsReject(): void {
  expect(copilotManualReadingsModelBodySchema.safeParse({ rows: [ROW], conflictPolicy: "reject" }).success).toBe(true);
}

export function theReadingsModelBodyRefusesOverwrite(): void {
  expect(copilotManualReadingsModelBodySchema.safeParse({ rows: [ROW], conflictPolicy: "overwrite" }).success).toBe(false);
}

export function theRouteReadingsBodyStillRefusesSourceKind(): void {
  expect(manualReadingsBodySchema.safeParse({ rows: [ROW], sourceKind: "manual" }).success).toBe(false);
}

export function theRouteReadingsBodyStillAcceptsOverwrite(): void {
  expect(manualReadingsBodySchema.safeParse({ rows: [ROW], conflictPolicy: "overwrite" }).success).toBe(true);
}

const rejected = (n: number) => Array.from({ length: n }, (_, i) => ({ rowNumber: i + 2, field: null, reason: "bad" }));

export function thePreviewKeepsTwentyRejectedRows(): void {
  const preview = { totalRows: 30, acceptedCount: 10, rejectedCount: 20, rejected: rejected(20), mappingsToCreate: [] };
  expect(copilotTelemetryImportPreviewSchema.safeParse(preview).success).toBe(true);
}

export function thePreviewRefusesATwentyFirstRejectedRow(): void {
  const preview = { totalRows: 30, acceptedCount: 9, rejectedCount: 21, rejected: rejected(21), mappingsToCreate: [] };
  expect(copilotTelemetryImportPreviewSchema.safeParse(preview).success).toBe(false);
}
