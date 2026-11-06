import { expect } from "vitest";

import { type CopyFingerprintTab, type CopyFingerprintWidget, copyFingerprint } from "./site-layout-seed-move";

/**
 * `F4.319` (ADR 0113 decision 8, plan D5) — "untouched" is read from content: a stored copy moves
 * only while its fingerprint equals the copy the seed would make now. These cases hold what the
 * fingerprint sees (each edit an administrator can make in the builder changes it) and what it
 * does not (row order, which a database read does not fix).
 */

const TABS: CopyFingerprintTab[] = [
  { tabKey: "overview", label: "Overview", sortOrder: 0, assetGroupId: null },
  { tabKey: "sld", label: "Electrical", sortOrder: 1, assetGroupId: "g-electrical" },
];

const TILE: CopyFingerprintWidget = {
  tabKey: "sld",
  widgetType: "value_tile",
  title: "Frequency",
  gridX: 6,
  gridY: 0,
  gridW: 3,
  gridH: 2,
  config: { unit: "Hz", decimals: 2 },
  points: [{ pointId: "p-1", role: "primary", sortOrder: 0 }],
  sources: [],
};

const RAIL: CopyFingerprintWidget = {
  tabKey: "overview",
  widgetType: "active_alarms_rail",
  title: "Active alarms",
  gridX: 0,
  gridY: 6,
  gridW: 8,
  gridH: 7,
  config: { rows: 8, showSummary: true },
  points: [],
  sources: [{ catalogKey: "alarms.active", params: { a: 1, b: 2 }, sortOrder: 0 }],
};

const base = (): string => copyFingerprint(TABS, [TILE, RAIL]);

export function theFingerprintIgnoresRowOrderAndKeyOrder(): void {
  const reordered = copyFingerprint([...TABS].reverse(), [
    { ...RAIL, config: { showSummary: true, rows: 8 }, sources: [{ ...RAIL.sources[0]!, params: { b: 2, a: 1 } }] },
    TILE,
  ]);
  expect(reordered).toBe(base());
}

export function aMovedOrResizedWidgetChangesIt(): void {
  expect(copyFingerprint(TABS, [{ ...TILE, gridX: 9 }, RAIL])).not.toBe(base());
  expect(copyFingerprint(TABS, [{ ...TILE, gridH: 3 }, RAIL])).not.toBe(base());
}

export function aRetitledOrReconfiguredWidgetChangesIt(): void {
  expect(copyFingerprint(TABS, [{ ...TILE, title: "Hz" }, RAIL])).not.toBe(base());
  expect(copyFingerprint(TABS, [{ ...TILE, config: { unit: "Hz", decimals: 1 } }, RAIL])).not.toBe(base());
}

export function aRemovedOrAddedWidgetChangesIt(): void {
  expect(copyFingerprint(TABS, [TILE])).not.toBe(base());
  expect(copyFingerprint(TABS, [TILE, RAIL, { ...TILE, gridY: 2 }])).not.toBe(base());
}

export function aReboundPointOrSourceChangesIt(): void {
  expect(copyFingerprint(TABS, [{ ...TILE, points: [{ pointId: "p-2", role: "primary", sortOrder: 0 }] }, RAIL])).not.toBe(
    base(),
  );
  expect(
    copyFingerprint(TABS, [TILE, { ...RAIL, sources: [{ ...RAIL.sources[0]!, params: { a: 1, b: 3 } }] }]),
  ).not.toBe(base());
}

export function aRenamedRegroupedOrReorderedTabChangesIt(): void {
  expect(copyFingerprint([TABS[0]!, { ...TABS[1]!, label: "SLD" }], [TILE, RAIL])).not.toBe(base());
  expect(copyFingerprint([TABS[0]!, { ...TABS[1]!, assetGroupId: "g-other" }], [TILE, RAIL])).not.toBe(base());
  expect(copyFingerprint([TABS[0]!, { ...TABS[1]!, sortOrder: 5 }], [TILE, RAIL])).not.toBe(base());
}
