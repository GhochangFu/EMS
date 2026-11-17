import { expect } from "vitest";

import { anomalyFindingHref, forecastFindingHref } from "@bms/shared/contracts";
import type { MlFindingAsset } from "@bms/shared/contracts";

import { detectorLabel } from "./anomaly-series";
import { assetHistoryPath, rangeToSearch } from "./asset-history-range";
import { F5_TOOLTIP, pickScope, resolveSegments, safeAssetHref, scopeKey } from "./ml-findings";

/**
 * `E1.9b` (ADR 0135 Amendment 8 decisions 8 and 14; plan T2.2, R-g) — the pure helpers behind the
 * findings card and the ML pages' filter. `ml-findings.test.ts` is the Vitest entry point.
 */

const ORG = "aaaaaaaa-1111-4111-8111-000000000001";
const SITE = "bbbbbbbb-1111-4111-8111-000000000001";
const GROUP = "cccccccc-1111-4111-8111-000000000001";
const ASSET_ID = "dddddddd-1111-4111-8111-000000000001";

const ASSET: MlFindingAsset = {
  ref: "A1",
  assetId: ASSET_ID,
  label: "PX-7 · Harbour Lane RTU",
  href: `/asset-history/${ASSET_ID}?points=temp_c`,
};

/** `pickScope` keeps only the keys asked for, and only those that are set. */
export function pickScopeKeepsTheKeysAskedFor(): void {
  const filter = { organizationId: ORG, locationId: SITE, assetGroupId: GROUP, assetId: ASSET_ID };
  expect(pickScope(filter, ["organizationId", "locationId"])).toEqual({ organizationId: ORG, locationId: SITE });
  expect(pickScope({ assetGroupId: GROUP }, ["organizationId", "locationId"])).toEqual({});
  expect(pickScope({ locationId: SITE }, ["organizationId", "locationId"])).toEqual({ locationId: SITE });
}

/** `scopeKey` is one stable string per scope: the same keys give the same string in any order, and any change differs. */
export function scopeKeyIsStable(): void {
  expect(scopeKey({ organizationId: ORG, locationId: SITE })).toBe(scopeKey({ locationId: SITE, organizationId: ORG }));
  const keys = new Set([
    scopeKey({}),
    scopeKey({ organizationId: ORG }),
    scopeKey({ locationId: ORG }),
    scopeKey({ organizationId: ORG, locationId: SITE }),
    scopeKey({ assetGroupId: GROUP }),
    scopeKey({ assetId: ASSET_ID }),
  ]);
  expect(keys.size).toBe(6);
}

/** Only an `/asset-history/` path with no `//` after its first character is a link. */
export function safeAssetHrefAllowsOnlyTheHistoryPage(): void {
  expect(safeAssetHref(ASSET.href)).toBe(ASSET.href);
  expect(safeAssetHref(`/asset-history/${ASSET_ID}`)).toBe(`/asset-history/${ASSET_ID}`);
  for (const bad of [
    "javascript:alert(1)",
    "//example.test/x",
    "https://example.test/asset-history/x",
    "/asset-history//example.test",
    "/alarms",
    " /asset-history/x",
    "",
  ]) {
    expect(safeAssetHref(bad)).toBeNull();
  }
}

/** A reference resolves to its asset's label and safe link; an unknown one is the text "an asset". */
export function resolveSegmentsPutsTheAssetsBack(): void {
  const unsafe: MlFindingAsset = { ...ASSET, ref: "A2", label: "PX-9 · Harbour Lane RTU", href: "javascript:alert(1)" };
  expect(
    resolveSegments(
      [{ text: "Strongest signal: " }, { assetRef: "A1" }, { text: " and " }, { assetRef: "A2" }, { text: ", " }, { assetRef: "A7" }],
      [ASSET, unsafe],
    ),
  ).toEqual([
    { text: "Strongest signal: " },
    { label: "PX-7 · Harbour Lane RTU", href: ASSET.href },
    { text: " and " },
    { label: "PX-9 · Harbour Lane RTU", href: null },
    { text: ", " },
    { text: "an asset" },
  ]);
}

/** The F5 tooltip, word for word (plan T2.2). */
export function theF5TooltipIsFixed(): void {
  expect(F5_TOOLTIP).toBe(
    "The alarm engine checks every reading. A forecast is an hourly average, so a short spike can raise an alarm the forecast does not show, and the reverse.",
  );
}

/**
 * R-g, the drift gate: the shared link builders the API uses equal the web's own links — the
 * Forecasts table's `assetHistoryPath` + `points=`, and the Anomalies row's `historyHref` window.
 */
export function theSharedLinksEqualTheWebsOwn(): void {
  expect(forecastFindingHref(ASSET_ID, ["temp_c"])).toBe(
    `${assetHistoryPath(ASSET_ID)}?${new URLSearchParams({ points: "temp_c" }).toString()}`,
  );
  const t = Date.parse("2026-11-16T09:00:00.000Z");
  const day = 86_400_000;
  for (const asOf of [t + 2 * day, t + 3_600_000]) {
    const points = ["temp_c", "door_open"];
    const expected = `${assetHistoryPath(ASSET_ID)}?${rangeToSearch({
      range: "custom",
      from: new Date(t - day).toISOString(),
      to: new Date(Math.min(t + day, asOf)).toISOString(),
      compare: false,
      points,
      fn: "avg",
    }).toString()}`;
    expect(anomalyFindingHref(ASSET_ID, t, asOf, points)).toBe(expected);
  }
  // The A4 sentences name the Baseline detector by the word the web uses for it.
  expect(detectorLabel("baseline_mad")).toBe("Baseline");
}
