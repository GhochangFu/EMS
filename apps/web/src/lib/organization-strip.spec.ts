import { expect } from "vitest";

import type { OrganizationStripSourceDto, OrganizationStripTileDto } from "@bms/shared";

import { stripTileProps, STRIP_STALE_MS } from "./organization-strip";

/**
 * `F4.317` task 5.2 — the strip's tile rules (ADR 0112 decisions 5 to 8), one case per rule. Every
 * fixture is a tile as the API answers it; `node` environment.
 */

const RECEIVED_AT = "2026-11-06T10:00:00.000Z";
const AT = Date.parse(RECEIVED_AT);

type Resolved = NonNullable<OrganizationStripSourceDto["resolved"]>;

function metric(key: string, value: number | null, extra: Record<string, unknown> = {}): Resolved {
  return { shape: "metric", key, value, unit: null, ...extra } as Resolved;
}

function source(catalogKey: string, sortOrder: number, resolved: Resolved | null): OrganizationStripSourceDto {
  return { catalogKey, sortOrder, resolved } as OrganizationStripSourceDto;
}

function tile(
  sources: OrganizationStripSourceDto[],
  config: OrganizationStripTileDto["config"] = {},
  title = "Tile",
): OrganizationStripTileDto {
  return { key: "k", title, gridX: 0, gridY: 0, gridW: 3, gridH: 2, config, sources };
}

/** S1 — the primary is the lowest sortOrder, whatever the array order. */
export function thePrimaryIsTheLowestSortOrder(): void {
  const t = tile([
    source("alarms.critical.count", 1, metric("alarms.critical.count", 7)),
    source("alarms.active.count", 0, metric("alarms.active.count", 12)),
  ]);
  expect(stripTileProps(t, RECEIVED_AT, AT).value).toBe("12");
}

/** S2 — the compare value is the primary's prior, shown as a delta when the tile asks. */
export function thePriorBecomesTheDelta(): void {
  const source0 = source("sustainability.total", 0, metric("sustainability.total", 110, { prior: { asOf: RECEIVED_AT, value: 100 } }));
  const asking = stripTileProps(tile([source0], { compareToPrevious: true }), RECEIVED_AT, AT);
  expect(asking.hint).toBe("↑ 10.0% vs yesterday");
  const notAsking = stripTileProps(tile([source0], {}), RECEIVED_AT, AT);
  expect(notAsking.hint).toBeUndefined();
}

/** S3 — tile 3: a critical count above zero is the note and a critical tone. */
export function aCriticalCountIsTheNoteAndTheTone(): void {
  const props = stripTileProps(
    tile([
      source("alarms.active.count", 0, metric("alarms.active.count", 5)),
      source("alarms.critical.count", 1, metric("alarms.critical.count", 2)),
    ]),
    RECEIVED_AT,
    AT,
  );
  expect(props.note).toBe("2 critical");
  expect(props.tone).toBe("critical");
}

/** S4 — open alarms with none critical: warning tone, no note; none open: default tone. */
export function openWithNoCriticalIsAWarning(): void {
  const two = (open: number) =>
    tile([
      source("alarms.active.count", 0, metric("alarms.active.count", open)),
      source("alarms.critical.count", 1, metric("alarms.critical.count", 0)),
    ]);
  const some = stripTileProps(two(3), RECEIVED_AT, AT);
  expect(some.tone).toBe("warning");
  expect(some.note).toBeUndefined();
  expect(stripTileProps(two(0), RECEIVED_AT, AT).tone).toBe("default");
}

/** S5 — a tile that is not the alarm tile never takes the alarm tone. */
export function onlyTheAlarmTileTakesTheAlarmTone(): void {
  const props = stripTileProps(tile([source("workorders.open.count", 0, metric("workorders.open.count", 9))]), RECEIVED_AT, AT);
  expect(props.tone).toBe("default");
}

/** S6 — sites.live.count reads live / total, with no coverage note. */
export function sitesLiveReadsLiveOverTotal(): void {
  const props = stripTileProps(
    tile([source("sites.live.count", 0, metric("sites.live.count", 4, { coverage: { fresh: 4, carrying: 16 } }))]),
    RECEIVED_AT,
    AT,
  );
  expect(props.value).toBe("4 / 16");
  expect(props.note).toBeUndefined();
}

/** S7 — a zero live count over zero locations still reads "0 / 0", not "—". */
export function sitesLiveZeroReadsZeroOverZero(): void {
  const props = stripTileProps(
    tile([source("sites.live.count", 0, metric("sites.live.count", 0, { coverage: { fresh: 0, carrying: 0 } }))]),
    RECEIVED_AT,
    AT,
  );
  expect(props.status).toBe("ready");
  expect(props.value).toBe("0 / 0");
}

/** S8 — stale when the read is older than the bound; fresh at the bound. */
export function aReadPastTheBoundIsStale(): void {
  const t = tile([source("assets.offline.count", 0, metric("assets.offline.count", 1))]);
  expect(stripTileProps(t, RECEIVED_AT, AT + STRIP_STALE_MS).stale).toBe(false);
  expect(stripTileProps(t, RECEIVED_AT, AT + STRIP_STALE_MS + 1).stale).toBe(true);
}

/** S9 — an unresolved binding is "—" with "Not available"; a null value is "—" with "No data". */
export function aMissingValueIsADashWithAReason(): void {
  const unresolved = stripTileProps(tile([source("pue.ratio", 0, null)]), RECEIVED_AT, AT);
  expect(unresolved.status).toBe("empty");
  expect(unresolved.hint).toBe("Not available");
  const nullValue = stripTileProps(tile([source("pue.ratio", 0, metric("pue.ratio", null))]), RECEIVED_AT, AT);
  expect(nullValue.status).toBe("empty");
  expect(nullValue.hint).toBe("No data");
  expect(nullValue.stale).toBe(false);
}

/** S10 — a tile with no source at all is "—" with "Not available". */
export function aTileWithNoSourceIsADash(): void {
  const props = stripTileProps(tile([]), RECEIVED_AT, AT);
  expect(props.status).toBe("empty");
  expect(props.hint).toBe("Not available");
}

/** S11 — a cost tile renders in the resolve's currency. */
export function aCostTileUsesTheResolvesCurrency(): void {
  const props = stripTileProps(
    tile([source("sustainability.total", 0, metric("sustainability.total", 1500, { currency: "INR" }))]),
    RECEIVED_AT,
    AT,
  );
  expect(props.value).toMatch(/₹|INR/);
}

/** S12 — a roll-up tile notes "N of M assets" only when fresh < carrying; a bare sites count is just the count. */
export function aRollUpShowsItsCoverageOnlyWhenPartial(): void {
  const partial = stripTileProps(
    tile([source("sustainability.total", 0, metric("sustainability.total", 5, { coverage: { fresh: 4, carrying: 6 } }))]),
    RECEIVED_AT,
    AT,
  );
  expect(partial.note).toBe("4 of 6 assets");
  const full = stripTileProps(
    tile([source("sustainability.total", 0, metric("sustainability.total", 5, { coverage: { fresh: 6, carrying: 6 } }))]),
    RECEIVED_AT,
    AT,
  );
  expect(full.note).toBeUndefined();
  const bare = stripTileProps(tile([source("sites.live.count", 0, metric("sites.live.count", 4))]), RECEIVED_AT, AT);
  expect(bare.value).toBe("4");
}
