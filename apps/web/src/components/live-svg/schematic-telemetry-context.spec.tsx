import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { TelemetryReading } from "@bms/shared";

import {
  SchematicTelemetryProvider,
  useSchematicTelemetryByCode,
} from "./schematic-telemetry-context";

/**
 * `F4.176` (ADR 0074 Amendment 2) — what the **real**
 * `SchematicTelemetryProvider` asks the network for when it mounts.
 *
 * Before this row it read `GET /telemetry/points/:ref/recent` once per
 * (asset, point key) pair, twice — a serial hydrate loop and a concurrent
 * `prefetchQuery` loop — which on the SMOC view was 43 × 34 × 2 = 2,924
 * requests. Every other spec that renders a control-room page mocks this
 * provider away, so none of them could see it.
 *
 * `fetch` is stubbed whole: every URL is recorded and answered, and nothing
 * falls through to the real `fetch` (an unstubbed call reaches `:4000`).
 * `socket.io-client` is mocked in the `.test.tsx` wrapper.
 *
 * Assertions live here; `schematic-telemetry-context.test.tsx` is the vitest
 * entry point (ADR 0014).
 */

/** 51 codes — one past the per-request cap of 50 — so the chunking is visible. */
const CODES = Array.from({ length: 51 }, (_, i) => `A${i + 1}`);
const POINT_KEYS = ["kw"] as const;

function idOf(code: string): string {
  const n = Number(code.slice(1));
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";

function assetRow(code: string) {
  return {
    id: idOf(code),
    code,
    name: `Asset ${code}`,
    siteName: "Test site",
    domain: "electrical",
    locationId: LOCATION_ID,
    locationName: "Test site",
    rtuId: null,
    rtuDisplayName: null,
    telemetrySource: null,
    active: true,
    templateId: null,
  };
}

type Harness = { urls: string[]; latestItems: TelemetryReading[] };

/**
 * Records every URL and answers it: `/assets` with the rows, `/points/latest`
 * with `latestItems`, and anything else — `/recent` included — with `[]`,
 * which `/recent`'s schema accepts. Nothing reaches the real network.
 */
function stubNetwork(latestItems: TelemetryReading[]): Harness {
  const harness: Harness = { urls: [], latestItems };
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    harness.urls.push(url);
    if (url.includes("/api/v1/assets")) {
      return new Response(JSON.stringify(CODES.map(assetRow)), { status: 200 });
    }
    if (url.includes("/api/v1/telemetry/points/latest")) {
      return new Response(JSON.stringify({ items: harness.latestItems }), { status: 200 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  });
  return harness;
}

function Consumer({ code }: { code: string }) {
  const { slice } = useSchematicTelemetryByCode(code);
  return <span data-testid={code}>{slice.kw === null ? "empty" : String(slice.kw)}</span>;
}

function renderProvider(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SchematicTelemetryProvider assetCodes={CODES} pointKeys={POINT_KEYS}>
        <Consumer code="A1" />
        <Consumer code="A2" />
      </SchematicTelemetryProvider>
    </QueryClientProvider>,
  );
}

const latestUrls = (h: Harness): URL[] =>
  h.urls.filter((u) => u.includes("/api/v1/telemetry/points/latest")).map((u) => new URL(u));

/** One reading for A1 only, stamped now so it is fresh. */
function a1Reading(): TelemetryReading {
  return { time: new Date().toISOString(), assetId: idOf("A1"), pointKey: "kw", value: 42, unit: "kW" };
}

/**
 * Wait until A1 shows the value from the batched read — the only signal that
 * hydration has finished. A `findBy` on the element alone would resolve on the
 * first render, before any data.
 */
async function waitForHydration(): Promise<void> {
  await waitFor(
    () => {
      expect(within(screen.getByTestId("A1")).getByText("42")).toBeTruthy();
    },
    { timeout: 3_000 },
  );
}

/**
 * **Zero `/recent` reads.** It waits for the first telemetry read of any kind,
 * not for A1's value, so on the old provider it fails on the count rather than
 * on a timeout. Both old loops start in effects of the same commit, so once
 * one telemetry URL is recorded the prefetch loop's would be too. Restoring
 * either loop reddens this case.
 */
export async function aMountReadsNoPerPointRecent(): Promise<void> {
  const h = stubNetwork([a1Reading()]);
  renderProvider();
  await waitFor(
    () => {
      expect(h.urls.some((u) => u.includes("/api/v1/telemetry/points/"))).toBe(true);
    },
    { timeout: 3_000 },
  );
  const recent = h.urls.filter((u) => u.includes("/recent"));
  expect(recent, `expected no /recent reads, got ${recent.length}`).toHaveLength(0);
}

/**
 * 51 tracked assets → exactly two `/points/latest` reads, each naming at most
 * 50 ids, together naming all 51 once, with the provider's point keys.
 * Removing the chunking sends one read of 51, which the API refuses.
 */
export async function aMountBatchesTheLatestReadByFifty(): Promise<void> {
  const h = stubNetwork([a1Reading()]);
  renderProvider();
  await waitForHydration();
  const reads = latestUrls(h);
  expect(reads).toHaveLength(2);
  for (const url of reads) {
    expect(url.searchParams.getAll("assetIds").length).toBeLessThanOrEqual(50);
    expect(url.searchParams.getAll("pointKeys")).toEqual([...POINT_KEYS]);
  }
  const named = reads.flatMap((url) => url.searchParams.getAll("assetIds")).sort();
  expect(named).toEqual(CODES.map(idOf).sort());
}

/** The positive claim: A1's reading from the batched read reaches its consumer. */
export async function aReturnedReadingReachesItsSlice(): Promise<void> {
  stubNetwork([a1Reading()]);
  renderProvider();
  await waitForHydration();
  expect(screen.getByTestId("A1").textContent).toBe("42");
}

/**
 * A2 has no pair in the response, so its field stays empty — never a default
 * such as 0. Checked after A1's value landed, so hydration has run.
 */
export async function anAbsentPairLeavesItsFieldEmpty(): Promise<void> {
  stubNetwork([a1Reading()]);
  renderProvider();
  await waitForHydration();
  expect(screen.getByTestId("A2").textContent).toBe("empty");
}
