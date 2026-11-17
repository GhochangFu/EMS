import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { MlFindingsCard as MlFindingsCardData, MlFindingsKind, MlFindingsSummaryResponse } from "@bms/shared/contracts";

import * as mlApi from "../../api/ml";
import { F5_TOOLTIP } from "../../lib/ml-findings";
import type { ScopeFilter } from "../../lib/scope-filter";
import { ML_FINDINGS_HEADING, MlFindingsCard } from "./ml-findings-card";

/**
 * `E1.9b` (ADR 0135 Amendment 8 decisions 1, 2 and 14; plan T2.4) — the "Findings — advisory"
 * card. The read is stubbed at `fetchMlFindingsSummary`; every name is made up.
 * `ml-findings-card.test.tsx` is the Vitest entry point.
 */

const ORG_B = "aaaaaaaa-2222-4222-8222-000000000001";
const ORG_C = "aaaaaaaa-2222-4222-8222-000000000002";
const ASSET_1 = "dddddddd-2222-4222-8222-000000000001";
const ASSET_2 = "dddddddd-2222-4222-8222-000000000002";
const ASSET_3 = "dddddddd-2222-4222-8222-000000000003";
const ASSET_4 = "dddddddd-2222-4222-8222-000000000004";
const ASSET_5 = "dddddddd-2222-4222-8222-000000000005";
const HREF_1 = `/asset-history/${ASSET_1}?points=temp_c`;
const HREF_2 = `/asset-history/${ASSET_2}?points=temp_c`;

const F1 = "3 forecast points, issued at 16 Nov 14:05; 0 stale.";

/** The API's order is kept: ORGC first proves the card does not sort again. */
const CARD_C: MlFindingsCardData = {
  organizationId: ORG_C,
  organizationCode: "ORGC",
  organizationName: "Cedar Point Mills",
  facts: [
    { id: "F1", segments: [{ text: F1 }] },
    {
      id: "F2",
      segments: [
        { text: "temp_c: coldest expected -18.5 °C at " },
        { assetRef: "A1" },
        { text: " (16 Nov 18:00); warmest -17 °C at " },
        { assetRef: "A2" },
        { text: " (17 Nov 02:00)." },
      ],
    },
    {
      id: "F5",
      segments: [
        { text: "Advisory: " },
        { assetRef: "A1" },
        { text: " temp_c is expected to go above the limit of rule Freezer high (-15) at 17 Nov 01:00." },
      ],
    },
    {
      id: "F4",
      segments: [
        { text: "temp_c: least certain is " },
        { assetRef: "A3" },
        { text: ", band 2 wide at 17 Nov 03:00; also " },
        { assetRef: "A4" },
        { text: "." },
      ],
    },
  ],
  assets: [
    { ref: "A1", assetId: ASSET_1, label: "FZ-1 · Birch Row RTU", href: HREF_1 },
    { ref: "A2", assetId: ASSET_2, label: "FZ-2 · Birch Row RTU", href: HREF_2 },
    { ref: "A3", assetId: ASSET_3, label: "FZ-3 · Birch Row RTU", href: "javascript:alert(1)" },
    { ref: "A4", assetId: ASSET_4, label: "FZ-4 · Birch Row RTU", href: "//example.test/x" },
    // Listed but named by no line: it must not be drawn, let alone linked.
    { ref: "A5", assetId: ASSET_5, label: "FZ-5 · Birch Row RTU", href: `/asset-history/${ASSET_5}` },
  ],
};

const CARD_B: MlFindingsCardData = {
  organizationId: ORG_B,
  organizationCode: "ORGB",
  organizationName: "Birch Valley Water",
  facts: [{ id: "F_NONE", segments: [{ text: "No forecast points for this organization." }] }],
  assets: [],
};

const SUMMARY: MlFindingsSummaryResponse = { asOf: "2026-11-16T09:00:00.000Z", cards: [CARD_C, CARD_B] };

function renderCard(props: { kinds?: readonly MlFindingsKind[]; scope?: ScopeFilter; enabled?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MlFindingsCard kinds={props.kinds ?? ["forecasts"]} scope={props.scope ?? {}} enabled={props.enabled} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

function section(): HTMLElement {
  return screen.getByRole("region", { name: ML_FINDINGS_HEADING });
}

/** Two cards in the API's order, each titled `<code> · <name>` with the Advisory pill, under the heading. */
export async function twoCardsInTheApisOrder(): Promise<void> {
  const spy = vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  renderCard({ scope: { organizationId: ORG_C } });
  await screen.findByText("ORGC · Cedar Point Mills");
  expect(spy).toHaveBeenCalledWith("forecasts", { organizationId: ORG_C });
  expect(ML_FINDINGS_HEADING).toBe("Findings — advisory");
  expect(within(section()).getByRole("heading", { name: "Findings — advisory" })).toBeInTheDocument();
  const titles = within(section())
    .getAllByRole("heading")
    .map((h) => h.textContent);
  expect(titles).toEqual(["Findings — advisory", "ORGC · Cedar Point Mills", "ORGB · Birch Valley Water"]);
  const pills = within(section()).getAllByText("Advisory");
  expect(pills).toHaveLength(2);
  for (const pill of pills) {
    expect(pill.className).toContain("text-info-ink");
  }
}

/** Each fact line reads its sentence with every asset reference put back by label. */
export async function eachFactLineReadsItsText(): Promise<void> {
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  renderCard();
  await screen.findByText("ORGC · Cedar Point Mills");
  const items = within(section())
    .getAllByRole("listitem")
    .map((li) => li.textContent);
  expect(items).toEqual([
    F1,
    "temp_c: coldest expected -18.5 °C at FZ-1 · Birch Row RTU (16 Nov 18:00); warmest -17 °C at FZ-2 · Birch Row RTU (17 Nov 02:00).",
    "Advisory: FZ-1 · Birch Row RTU temp_c is expected to go above the limit of rule Freezer high (-15) at 17 Nov 01:00.",
    "temp_c: least certain is FZ-3 · Birch Row RTU, band 2 wide at 17 Nov 03:00; also FZ-4 · Birch Row RTU.",
    "No forecast points for this organization.",
  ]);
}

/**
 * A named asset is a link to its card's `href`; an unsafe `href` is plain text; an asset only
 * listed is not drawn; an F5 line carries the tooltip.
 */
export async function assetReferencesLinkOnlyToSafeHrefs(): Promise<void> {
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  renderCard();
  await screen.findByText("ORGC · Cedar Point Mills");
  const links = within(section()).getAllByRole("link");
  expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
    ["FZ-1 · Birch Row RTU", HREF_1],
    ["FZ-2 · Birch Row RTU", HREF_2],
    ["FZ-1 · Birch Row RTU", HREF_1],
  ]);
  for (const unsafe of ["FZ-3 · Birch Row RTU", "FZ-4 · Birch Row RTU"]) {
    const node = within(section()).getByText(unsafe);
    expect(node.closest("a")).toBeNull();
  }
  expect(section().innerHTML).not.toContain("javascript:");
  expect(section().innerHTML).not.toContain("example.test");
  expect(within(section()).queryByText("FZ-5 · Birch Row RTU")).toBeNull();
  const lines = within(section()).getAllByRole("listitem");
  expect(lines[2]?.getAttribute("title")).toBe(F5_TOOLTIP);
  expect(lines[1]?.getAttribute("title")).toBeNull();
  // The first line names no asset, so it holds no link.
  expect(within(lines[0] as HTMLElement).queryByRole("link")).toBeNull();
}

/** Decision 1: never an alarm or severity colour anywhere in the section. */
export async function noAlarmColourInTheSection(): Promise<void> {
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  renderCard();
  await screen.findByText("ORGC · Cedar Point Mills");
  const classes = [section(), ...Array.from(section().querySelectorAll("*"))].map((el) => el.getAttribute("class") ?? "");
  expect(classes.some((c) => c.length > 0)).toBe(true);
  for (const cls of classes) {
    expect(cls).not.toMatch(/critical|warning|severity|ok-/);
  }
}

/** A pending read says it is loading. */
export async function aPendingReadSaysLoading(): Promise<void> {
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockReturnValue(new Promise(() => undefined));
  renderCard();
  expect(await screen.findByText("Loading findings…")).toBeInTheDocument();
  expect(within(section()).getByRole("heading", { name: "Findings — advisory" })).toBeInTheDocument();
}

/** A failed read with no data is one muted sentence, not an alert. */
export async function aFailedReadIsOneMutedSentence(): Promise<void> {
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockRejectedValue(new Error("ml findings summary 403"));
  renderCard();
  const line = await screen.findByText("Could not load the findings.");
  expect(line.className).toContain("text-ink-muted");
  expect(screen.queryByRole("alert")).toBeNull();
}

/** `enabled: false` makes no request. */
export async function disabledMakesNoRequest(): Promise<void> {
  const spy = vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  renderCard({ enabled: false });
  await screen.findByText("Loading findings…");
  await new Promise((r) => setTimeout(r, 20));
  expect(spy).not.toHaveBeenCalled();
}

/** `cards: []` draws no section at all; the summary is read again every 15 minutes. */
export async function noCardsDrawsNothing(): Promise<void> {
  const spy = vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue({ asOf: SUMMARY.asOf, cards: [] });
  const client = renderCard({ kinds: ["anomalies"], scope: { locationId: ASSET_1 } });
  await waitFor(() => expect(spy).toHaveBeenCalledWith("anomalies", { locationId: ASSET_1 }));
  await waitFor(() => expect(screen.queryByText("Loading findings…")).toBeNull());
  expect(screen.queryByRole("region", { name: ML_FINDINGS_HEADING })).toBeNull();
  expect(screen.queryByText("Findings — advisory")).toBeNull();
  const query = client.getQueryCache().findAll({ queryKey: ["ml-findings", "summary", "anomalies"] })[0];
  expect((query?.options as { readonly refetchInterval?: unknown } | undefined)?.refetchInterval).toBe(900_000);
}

/**
 * Two kinds (the control-room use): each card names its kind under the title, and a failed read
 * names the kind it is for; one kind's failure leaves the other's cards drawn.
 */
export async function twoKindsNameTheirKind(): Promise<void> {
  const spy = vi
    .spyOn(mlApi, "fetchMlFindingsSummary")
    .mockImplementation((kind) =>
      kind === "forecasts"
        ? Promise.resolve({ ...SUMMARY, cards: [CARD_B] })
        : Promise.reject(new Error("ml findings summary 403")),
    );
  renderCard({ kinds: ["forecasts", "anomalies"] });
  await screen.findByText("ORGB · Birch Valley Water");
  expect(spy.mock.calls.map((call) => call[0])).toEqual(["forecasts", "anomalies"]);
  expect(within(section()).getByText("Forecasts")).toBeInTheDocument();
  const failed = await within(section()).findByText("Could not load the anomaly findings.");
  expect(failed.className).toContain("text-ink-muted");
  expect(screen.queryByText("Could not load the findings.")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
}

/** Two kinds, one still pending: its loading line names its kind. */
export async function twoKindsPendingNamesTheKind(): Promise<void> {
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockImplementation((kind) =>
    kind === "anomalies" ? Promise.resolve(SUMMARY) : new Promise(() => undefined),
  );
  renderCard({ kinds: ["forecasts", "anomalies"] });
  expect(await screen.findByText("Loading forecast findings…")).toBeInTheDocument();
  await screen.findByText("ORGC · Cedar Point Mills");
  expect(within(section()).getAllByText("Anomalies").length).toBeGreaterThan(0);
  expect(screen.queryByText("Loading findings…")).toBeNull();
}
