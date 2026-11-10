import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect } from "vitest";

import type { GeneratedSiteAssetDto } from "@bms/shared";

import type { SiteLiveReadings } from "../../hooks/use-site-live-readings";
import { GeneratedSiteAssetCard } from "./generated-site-asset-card";

/**
 * `F4.350` (ADR 0075 Amendment 3) — an asset card judges its pill and its point rows on the asset's own
 * window (`freshnessWindowSeconds`), not a fixed 25 s. Assertions live here; the sibling `.test.tsx` is
 * the Vitest entry point (ADR 0014).
 *
 * The readings object is a hand-built `SiteLiveReadings`, so the case pins the card's own rule: the
 * sample is 55 s old at the card's `nowMs`, which a 60 s device (150 s window) reads Live and the old
 * fixed 25 s read Stale.
 */

const NOW = Date.parse("2026-11-10T10:00:00.000Z");
const SAMPLE_AT = NOW - 55_000;

function asset(freshnessWindowSeconds: number | undefined): GeneratedSiteAssetDto {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    code: "WBL-ROOM-1",
    name: "Room 1",
    assetRtuName: "RTU 1",
    assetLocationName: "Site",
    domain: "hvac",
    latestTelemetryAt: new Date(SAMPLE_AT).toISOString(),
    freshness: "live",
    ...(freshnessWindowSeconds === undefined ? {} : { freshnessWindowSeconds }),
    points: [
      {
        pointKey: "temp_c",
        name: "Temperature",
        unit: "C",
        headlineRank: 1,
        latest: { value: 21.5, time: new Date(SAMPLE_AT).toISOString() },
      },
    ],
  };
}

const readings: SiteLiveReadings = {
  nowMs: NOW,
  pointLatest: (_assetId, point) =>
    point.pointKey === "temp_c" ? { value: 21.5, time: new Date(SAMPLE_AT).toISOString(), atMs: SAMPLE_AT } : null,
  assetLastSeenMs: () => SAMPLE_AT,
};

function renderCard(freshnessWindowSeconds: number | undefined): { pill: string; dimmed: boolean } {
  render(
    <MemoryRouter>
      <GeneratedSiteAssetCard asset={asset(freshnessWindowSeconds)} readings={readings} />
    </MemoryRouter>,
  );
  const pill = screen.getByTestId("asset-status").textContent ?? "";
  const dimmed = (screen.getByTestId("point-value").className ?? "").includes("opacity-50");
  cleanup();
  return { pill, dimmed };
}

/** A 60 s device (150 s window), sample 55 s old: Live, row not dimmed. */
export function aSixtySecondDeviceIsLiveAtFiftyFiveSeconds(): void {
  expect(renderCard(150)).toEqual({ pill: "Live", dimmed: false });
}

/** No window from the API (an older response): the 25 s floor, the rule before the amendment. */
export function noWindowKeepsTheFloor(): void {
  expect(renderCard(undefined)).toEqual({ pill: "Stale", dimmed: true });
}

/** A 2 s device (25 s window) with the same 55 s old sample is Stale. */
export function aFastDeviceIsStaleAtFiftyFiveSeconds(): void {
  expect(renderCard(25)).toEqual({ pill: "Stale", dimmed: true });
}
