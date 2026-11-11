import { expect } from "vitest";

import type { DropFirst, RtuDropCount } from "@bms/shared";

import { dropsSummary, firstDroppedLabel } from "./device-health-format";

/**
 * `F3.16` / ADR 0127 decision 4 and ADR 0111 — the drops cell's "First" names
 * the earliest drop across reasons, and an asset is named with `assetLabelOf`.
 */

const first = (over: Partial<DropFirst>): DropFirst => ({
  assetId: null,
  assetCode: null,
  assetRtuName: null,
  assetLocationName: null,
  pointKey: null,
  sourceKey: null,
  ...over,
});

/** The earliest `firstAt` wins, whatever the reason order; a tie keeps reason order. */
export function runDropsSummaryEarliestTests(): void {
  const drops: RtuDropCount[] = [
    { reason: "badQuality", count: 2, firstAt: "2026-11-11T09:00:00.000Z", first: first({ sourceKey: "late" }) },
    { reason: "outOfRange", count: 3, firstAt: "2026-11-11T07:00:00.000Z", first: first({ sourceKey: "early" }) },
    { reason: "nonFinite", count: 1, firstAt: "2026-11-11T07:00:00.000Z", first: first({ sourceKey: "tie" }) },
  ];
  expect(dropsSummary(drops)).toEqual({ total: 6, first: "early" });
  // The earliest names nothing: the next earliest that names something.
  const unnamed: RtuDropCount[] = [
    { reason: "badQuality", count: 1, firstAt: "2026-11-11T05:00:00.000Z", first: null },
    { reason: "outOfRange", count: 1, firstAt: "2026-11-11T09:00:00.000Z", first: first({ pointKey: "kw" }) },
  ];
  expect(dropsSummary(unnamed)).toEqual({ total: 2, first: "kw" });
  expect(dropsSummary([])).toEqual({ total: 0, first: null });
}

/** ADR 0111: the asset is `<code> · <RTU>` (else location), then the point key. */
export function runFirstDroppedLabelTests(): void {
  expect(firstDroppedLabel(first({ assetCode: "CH-2", assetRtuName: "RTU-A", assetLocationName: "Plant", pointKey: "kw" }))).toBe(
    "CH-2 · RTU-A · kw",
  );
  expect(firstDroppedLabel(first({ assetCode: "CH-2", assetLocationName: "Plant", pointKey: "kw" }))).toBe("CH-2 · Plant · kw");
  expect(firstDroppedLabel(first({ assetCode: "CH-2", pointKey: "kw" }))).toBe("CH-2 · kw");
  expect(firstDroppedLabel(first({ pointKey: "kw", sourceKey: "s" }))).toBe("kw");
  expect(firstDroppedLabel(first({ sourceKey: "s" }))).toBe("s");
  expect(firstDroppedLabel(null)).toBeNull();
}
