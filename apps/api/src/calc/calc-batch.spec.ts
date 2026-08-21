import type { TelemetryReading } from "@bms/shared";

import { collapseLatest, filterToInputs, inputKey } from "./calc-batch";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function reading(overrides: Partial<TelemetryReading>): TelemetryReading {
  return {
    time: "2026-08-20T12:00:00.000Z",
    assetId: "asset-1",
    pointKey: "P",
    value: 1,
    unit: null,
    ...overrides,
  };
}

export function runCalcBatchTests(): void {
  // ---- collapseLatest ----------------------------------------------------------

  const collapsed = collapseLatest([
    reading({ assetId: "A", pointKey: "P", value: 1, time: "2026-08-20T12:00:00.000Z" }),
    reading({ assetId: "A", pointKey: "P", value: 2, time: "2026-08-20T12:00:01.000Z" }),
    reading({ assetId: "A", pointKey: "Q", value: 9, time: "2026-08-20T12:00:00.000Z" }),
  ]);
  assert(collapsed.length === 2, `expected 2 collapsed readings, got ${collapsed.length}`);
  const collapsedAP = collapsed.find((r) => r.assetId === "A" && r.pointKey === "P");
  assert(
    collapsedAP?.value === 2,
    "collapseLatest must keep the later sample per (assetId, pointKey), not the first",
  );

  // ---- filterToInputs is keyed on (assetId, pointKey), not pointKey alone ------

  // Two assets share the point key "SHARED" — only asset A's formula uses it
  // as an input. A reading on asset B for the same key must not pass.
  const inputKeys = new Set([inputKey("A", "SHARED")]);
  const filtered = filterToInputs(
    [
      reading({ assetId: "A", pointKey: "SHARED" }),
      reading({ assetId: "B", pointKey: "SHARED" }),
      reading({ assetId: "A", pointKey: "UNRELATED" }),
    ],
    inputKeys,
  );
  assert(filtered.length === 1, `expected exactly 1 reading to pass the filter, got ${filtered.length}`);
  assert(filtered[0]?.assetId === "A", "the surviving reading must be asset A's");

  const filteredOutUnrelated = filterToInputs([reading({ assetId: "A", pointKey: "UNRELATED" })], inputKeys);
  assert(
    filteredOutUnrelated.length === 0,
    "a reading whose point key is nobody's input must be filtered out entirely",
  );
}
