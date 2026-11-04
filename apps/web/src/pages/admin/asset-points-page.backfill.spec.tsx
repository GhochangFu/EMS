import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AssetPointCalcConfigDto, CalcBackfillRunDto } from "@bms/shared";

import * as api from "../../api/admin/asset-points";
import * as assetsAdminApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as pointKeysApi from "../../api/admin/point-keys";
import * as rtusApi from "../../api/admin/rtus";
import * as assetsApi from "../../api/assets";
import * as copilotApi from "../../api/copilot";
import * as systemStatusApi from "../../api/system-status";
import { standaloneConfigFor } from "../../lib/calc-point-draft";
import type { AuthUser } from "../../stores/auth-store";
import { AssetPointsAdminPage } from "./asset-points-page";

/**
 * `F4.311` PR 6b (ADR 0109 decision 7) — the asset points page's backfill
 * progress: a line per calculated point from its latest run, on a standalone
 * item and on an override item alike (owner ruling 1), and the calc-points
 * read polling every 5 s only while a run is queued or running. Each claim
 * is one exported function; `asset-points-page.backfill.test.tsx` is the
 * Vitest entry point. The wording itself is `calc-point-draft.spec.ts`'s.
 */

const admin = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
const ASSET = "f4311000-0000-4000-8000-0000000000c1";

const RUNS = {
  formula: "{kw} * 2",
  formulaDialect: "bms-calc-v1" as const,
  calcTrigger: "scheduled" as const,
  calcIntervalSeconds: 300,
  maxInputAgeSeconds: 600,
};

function run(patch: Partial<CalcBackfillRunDto> = {}): CalcBackfillRunDto {
  return {
    id: "run-1",
    status: "running",
    fromAt: "2026-10-01T00:00:00.000Z",
    toAt: "2026-11-01T00:00:00.000Z",
    doneThrough: "2026-10-04T00:00:00.000Z",
    writtenRows: 12480,
    error: null,
    createdAt: "2026-11-01T00:05:00.000Z",
    finishedAt: null,
    ...patch,
  };
}

const RUNNING = run();
const QUEUED = run({ status: "queued", doneThrough: null, writtenRows: 0 });
const DONE = run({ status: "done", doneThrough: "2026-11-01T00:00:00.000Z", finishedAt: "2026-11-01T00:09:00.000Z" });
const FAILED = run({ status: "failed", error: "no worker" });

function standaloneItem(backfill: CalcBackfillRunDto | null): AssetPointCalcConfigDto {
  return { ...standaloneConfigFor("pf"), label: "Power factor", assetPointId: "ap-pf", override: RUNS, effective: RUNS, backfill };
}

function overrideItem(backfill: CalcBackfillRunDto | null): AssetPointCalcConfigDto {
  return {
    ...standaloneConfigFor("kwh"),
    kind: "override",
    templatePointId: "tp-kwh",
    label: "Metered energy",
    template: RUNS,
    effective: RUNS,
    backfill,
  };
}

type CalcList = Awaited<ReturnType<typeof api.fetchAdminAssetCalcPoints>>;

function stubApi(...lists: CalcList[]): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockRejectedValue(new Error("not under test"));
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([] as never);
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({ items: [] } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsAdminApi, "fetchAdminAssets").mockResolvedValue({ items: [] } as never);
  vi.spyOn(assetsAdminApi, "fetchAdminAssetSummary").mockResolvedValue({
    id: ASSET,
    code: "PMP-1",
    name: "Pump one",
    locationId: null,
    locationName: null,
    rtuId: null,
    rtuDisplayName: null,
    organizationId: null,
    organizationCode: null,
  } as never);
  const read = vi.spyOn(api, "fetchAdminAssetCalcPoints");
  // Each read answers the next list; the last one repeats.
  lists.forEach((list, index) =>
    index === lists.length - 1 ? read.mockResolvedValue(list) : read.mockResolvedValueOnce(list),
  );
  vi.spyOn(api, "fetchAdminAssetPoints").mockResolvedValue({ items: [] } as never);
  vi.spyOn(pointKeysApi, "fetchAdminPointKeys").mockResolvedValue({ items: [] } as never);
}

function renderPage(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/admin/assets/${ASSET}/points`]}>
        <Routes>
          <Route path="/admin/assets/:assetId/points" element={<AssetPointsAdminPage user={admin} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

/** The row holding `label`, found once the calc list has arrived. */
async function rowOf(label: string): Promise<HTMLElement> {
  return (await screen.findByText(label)).closest("div")!;
}

/** The calc-points read's `refetchInterval`, evaluated against its query as TanStack Query does. */
function pollOf(client: QueryClient): unknown {
  const query = client.getQueryCache().find({ queryKey: ["admin", "asset-calc-points", ASSET] });
  const interval = query?.observers[0]?.options.refetchInterval;
  expect(query, "control: the page observes the calc-points read").toBeDefined();
  return typeof interval === "function" ? interval(query as never) : interval;
}

export async function aRunningStandaloneRunShowsItsDaysAndRows(): Promise<void> {
  stubApi({ mode: "standalone", items: [standaloneItem(RUNNING)] });
  renderPage();
  expect(within(await rowOf("Power factor")).getByText("Backfill: 3 of 31 days, 12,480 rows")).toBeTruthy();
}

export async function aQueuedStandaloneRunSaysQueued(): Promise<void> {
  stubApi({ mode: "standalone", items: [standaloneItem(QUEUED)] });
  renderPage();
  expect(within(await rowOf("Power factor")).getByText("Backfill: queued")).toBeTruthy();
}

export async function aDoneOverrideRunSaysDone(): Promise<void> {
  stubApi({ mode: "template", items: [overrideItem(DONE)] });
  renderPage();
  expect(within(await rowOf("Metered energy")).getByText("Backfill done: 31 days, 12,480 rows")).toBeTruthy();
}

export async function aFailedOverrideRunShowsItsStoredError(): Promise<void> {
  stubApi({ mode: "template", items: [overrideItem(FAILED)] });
  renderPage();
  expect(within(await rowOf("Metered energy")).getByText("Backfill failed: no worker")).toBeTruthy();
}

export async function aPointWithNoRunHasNoBackfillLine(): Promise<void> {
  stubApi({ mode: "standalone", items: [standaloneItem(null)] });
  renderPage();
  expect(within(await rowOf("Power factor")).queryByText(/^Backfill/)).toBeNull();
}

export async function anActiveRunPollsTheListEveryFiveSeconds(): Promise<void> {
  stubApi({ mode: "standalone", items: [standaloneItem(RUNNING)] });
  const client = renderPage();
  await rowOf("Power factor");
  expect(pollOf(client)).toBe(5000);
}

export async function noActiveRunLeavesThePollOff(): Promise<void> {
  stubApi({ mode: "template", items: [overrideItem(DONE)] });
  const client = renderPage();
  await rowOf("Metered energy");
  expect(pollOf(client)).toBe(false);
}

/** The poll that carried a run to `done` stops on the read that says so. */
export async function thePollStopsOnceTheRunIsDone(): Promise<void> {
  stubApi(
    { mode: "standalone", items: [standaloneItem(RUNNING)] },
    { mode: "standalone", items: [standaloneItem(DONE)] },
  );
  const client = renderPage();
  await rowOf("Power factor");
  expect(pollOf(client), "control: polling while running").toBe(5000);
  await client.refetchQueries({ queryKey: ["admin", "asset-calc-points", ASSET] });
  await screen.findByText("Backfill done: 31 days, 12,480 rows");
  await waitFor(() => expect(pollOf(client)).toBe(false));
}

/**
 * `F4.311` PR 6b review — a read that fails stops the poll, even though the
 * query keeps the last list (whose run is still `running`): a dead endpoint
 * is not re-read every 5 s forever.
 */
export async function aFailedReadStopsThePoll(): Promise<void> {
  stubApi({ mode: "standalone", items: [standaloneItem(RUNNING)] });
  const client = renderPage();
  await rowOf("Power factor");
  expect(pollOf(client), "control: polling while running").toBe(5000);
  vi.mocked(api.fetchAdminAssetCalcPoints).mockRejectedValue(new Error("not under test"));
  await client.refetchQueries({ queryKey: ["admin", "asset-calc-points", ASSET] });
  await waitFor(() =>
    expect(client.getQueryState(["admin", "asset-calc-points", ASSET])?.status, "control: the read failed").toBe("error"),
  );
  expect(pollOf(client)).toBe(false);
}
