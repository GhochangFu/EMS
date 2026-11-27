import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type {
  MlFindingsCard as MlFindingsCardData,
  MlFindingsKind,
  MlFindingsParagraphResponse,
  MlFindingsSummaryResponse,
} from "@bms/shared/contracts";

import * as mlApi from "../../api/ml";
import { ApiError } from "../../lib/api-error";
import { F5_TOOLTIP } from "../../lib/ml-findings";
import type { ScopeFilter } from "../../lib/scope-filter";
import {
  ML_FINDINGS_HEADING,
  ML_PARAGRAPH_LABEL,
  ML_SUMMARY_COMPACT_NOTE,
  ML_SUMMARY_NOTE,
  MlFindingsCard,
} from "./ml-findings-card";

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
    { ref: "A1", assetId: ASSET_1, code: "FZ-1", label: "FZ-1 · Birch Row RTU", href: HREF_1 },
    { ref: "A2", assetId: ASSET_2, code: "FZ-2", label: "FZ-2 · Birch Row RTU", href: HREF_2 },
    { ref: "A3", assetId: ASSET_3, code: "FZ-3", label: "FZ-3 · Birch Row RTU", href: "javascript:alert(1)" },
    { ref: "A4", assetId: ASSET_4, code: "FZ-4", label: "FZ-4 · Birch Row RTU", href: "//example.test/x" },
    // Listed but named by no line: it must not be drawn, let alone linked.
    { ref: "A5", assetId: ASSET_5, code: "FZ-5", label: "FZ-5 · Birch Row RTU", href: `/asset-history/${ASSET_5}` },
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

type CardProps = {
  kinds?: readonly MlFindingsKind[];
  scope?: ScopeFilter;
  enabled?: boolean;
  paragraph?: boolean;
  compact?: boolean;
};

function renderCard(props: CardProps = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MlFindingsCard
          kinds={props.kinds ?? ["forecasts"]}
          scope={props.scope ?? {}}
          enabled={props.enabled}
          paragraph={props.paragraph}
          compact={props.compact}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

/** Every case starts with a paragraph read that answers no cards; a case that needs more says so. */
export function stubNoParagraph(): void {
  vi.spyOn(mlApi, "fetchMlFindingsParagraph").mockResolvedValue({ cards: [] });
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

/** Each fact line reads its sentence with every asset reference put back as its code chip (`E1.9g`). */
export async function eachFactLineReadsItsText(): Promise<void> {
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  renderCard();
  await screen.findByText("ORGC · Cedar Point Mills");
  const items = within(section())
    .getAllByRole("listitem")
    .map((li) => li.textContent);
  expect(items).toEqual([
    F1,
    "temp_c: coldest expected -18.5 °C at FZ-1 (16 Nov 18:00); warmest -17 °C at FZ-2 (17 Nov 02:00).",
    "Advisory: FZ-1 temp_c is expected to go above the limit of rule Freezer high (-15) at 17 Nov 01:00.",
    "temp_c: least certain is FZ-3, band 2 wide at 17 Nov 03:00; also FZ-4.",
    "No forecast points for this organization.",
  ]);
}

/**
 * A named asset is a link to its card's `href`, drawn as its code with the full label as its title
 * (`E1.9g`); an unsafe `href` is plain text with the same title; an asset only listed is not drawn;
 * an F5 line carries the tooltip.
 */
export async function assetReferencesLinkOnlyToSafeHrefs(): Promise<void> {
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  renderCard();
  await screen.findByText("ORGC · Cedar Point Mills");
  const links = within(section()).getAllByRole("link");
  expect(links.map((a) => [a.textContent, a.getAttribute("title"), a.getAttribute("href")])).toEqual([
    ["FZ-1", "FZ-1 · Birch Row RTU", HREF_1],
    ["FZ-2", "FZ-2 · Birch Row RTU", HREF_2],
    ["FZ-1", "FZ-1 · Birch Row RTU", HREF_1],
  ]);
  for (const unsafe of ["FZ-3", "FZ-4"]) {
    const node = within(section()).getByText(unsafe);
    expect(node.closest("a")).toBeNull();
    expect(node.getAttribute("title")).toBe(`${unsafe} · Birch Row RTU`);
  }
  expect(section().innerHTML).not.toContain("javascript:");
  expect(section().innerHTML).not.toContain("example.test");
  expect(within(section()).queryByText("FZ-5")).toBeNull();
  expect(section().innerHTML).not.toContain("FZ-5");
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

// ---------------------------------------------------------------------------------------------
// `E1.9d` (ADR 0135 Amendment 8 decisions 5, 13 and 14; plan T4.3, R-n) — the AI paragraph slot.
// ---------------------------------------------------------------------------------------------

const SITE_D = "bbbbbbbb-2222-4222-8222-000000000001";

/** ORGC's paragraph names A1 (linked like its fact line), A3 (unsafe href) and A9 (not on the card). */
const OK_C: MlFindingsParagraphResponse = {
  cards: [
    {
      organizationId: ORG_C,
      state: "ok",
      segments: [
        { text: "Over the next two days the coldest point is at " },
        { assetRef: "A1" },
        { text: "; the band is widest at " },
        { assetRef: "A3" },
        { text: ", and " },
        { assetRef: "A9" },
        { text: " has 3 stale points." },
      ],
      assets: CARD_C.assets,
    },
    { organizationId: ORG_B, state: "none", segments: [], assets: [] },
  ],
};

const OK_TEXT =
  "Over the next two days the coldest point is at FZ-1; the band is widest at FZ-3, and an asset has 3 stale points.";

function paragraphNode(): HTMLElement | null {
  return screen.queryByText(ML_PARAGRAPH_LABEL)?.closest<HTMLElement>("[data-ml-paragraph]") ?? null;
}

/** The section's markup without React's per-render `useId` values. */
function sectionMarkup(): string {
  return section().innerHTML.replace(/ id="[^"]*"/g, "");
}

/** Lets every settled promise and React update land. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

/**
 * The block shows only for `ok`: labelled "AI summary · advisory" (`E1.9g`), inside its organization's card,
 * above the facts; the `none` card gets nothing. The read sends the card's kind and scope.
 */
export async function theLabelShowsOnlyForOk(): Promise<void> {
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  const spy = vi.spyOn(mlApi, "fetchMlFindingsParagraph").mockResolvedValue(OK_C);
  renderCard({ scope: { organizationId: ORG_C } });
  const label = await screen.findByText(ML_PARAGRAPH_LABEL);
  expect(ML_PARAGRAPH_LABEL).toBe("AI summary · advisory");
  expect(spy).toHaveBeenCalledWith("forecasts", { organizationId: ORG_C });
  expect(screen.getAllByText(ML_PARAGRAPH_LABEL)).toHaveLength(1);
  // One sentence: the headline alone, then the note.
  expect(paragraphNode()?.textContent).toBe(`${ML_PARAGRAPH_LABEL}${OK_TEXT}${ML_SUMMARY_NOTE}`);
  const firstFact = within(section()).getAllByRole("listitem")[0] as HTMLElement;
  expect(label.compareDocumentPosition(firstFact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const cardB = screen.getByRole("heading", { name: "ORGB · Birch Valley Water" });
  // ORGC's block comes before ORGB's card: it sits in ORGC's card, not after the last one.
  expect(label.compareDocumentPosition(cardB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

/**
 * Decision 5, fail closed: `none`, `pending`, a failed read and a card with no entry leave the
 * section exactly as the facts alone draw it — no banner, no spinner, no error text.
 */
export async function noneOrPendingOrFailureAddsNothing(): Promise<void> {
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  const spy = vi.spyOn(mlApi, "fetchMlFindingsParagraph").mockResolvedValue({ cards: [] });
  renderCard();
  await screen.findByText("ORGC · Cedar Point Mills");
  await waitFor(() => expect(spy).toHaveBeenCalled());
  await settle();
  const baseline = sectionMarkup();
  cleanup();

  const answers: Array<() => Promise<MlFindingsParagraphResponse>> = [
    () => Promise.resolve({ cards: [{ organizationId: ORG_C, state: "none", segments: [], assets: [] }] }),
    () => Promise.resolve({ cards: [{ organizationId: ORG_C, state: "pending", segments: [], assets: [] }] }),
    () => Promise.resolve({ cards: [{ organizationId: ORG_C, state: "ok", segments: [], assets: [] }] }),
    // An entry for an organization that has no card here: no card gets it.
    () => Promise.resolve({ cards: [{ organizationId: ASSET_5, state: "ok", segments: [{ text: "Quiet." }], assets: [] }] }),
    // A 403 is final (no retry), so the read has failed by the time the markup is compared.
    () => Promise.reject(new Error("ml findings paragraph 403")),
  ];
  for (const next of answers) {
    spy.mockReset();
    spy.mockImplementation(next);
    renderCard();
    await screen.findByText("ORGC · Cedar Point Mills");
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await settle();
    expect(sectionMarkup()).toBe(baseline);
    expect(screen.queryByText(ML_PARAGRAPH_LABEL)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    cleanup();
  }
}

/** The facts are on screen while the paragraph read is still unanswered. */
export async function theFactsDoNotWaitForTheParagraph(): Promise<void> {
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  const spy = vi.spyOn(mlApi, "fetchMlFindingsParagraph").mockReturnValue(new Promise(() => undefined));
  renderCard();
  await screen.findByText("ORGC · Cedar Point Mills");
  await waitFor(() => expect(spy).toHaveBeenCalled());
  expect(within(section()).getAllByRole("listitem")).toHaveLength(5);
  expect(screen.queryByText(ML_PARAGRAPH_LABEL)).toBeNull();
  expect(screen.queryByText(/Loading/)).toBeNull();
}

/**
 * Decision 14 and the `E1.9c` security review: a reference in the paragraph is put back from the
 * paragraph card's **own** `assets` (built on the server from the facts it was written from), never
 * from the summary card's — a new ML cycle can renumber `A1` between the two reads. When the lists
 * agree it is the same link the fact line carries. An unsafe `href` and a reference the list does
 * not hold are plain text; an `href` or a label on the paragraph's segment itself is never used.
 */
export async function paragraphReferencesUseTheParagraphsOwnAssets(): Promise<void> {
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  const spy = vi.spyOn(mlApi, "fetchMlFindingsParagraph").mockResolvedValue(OK_C);
  renderCard();
  await screen.findByText(ML_PARAGRAPH_LABEL);
  const same = within(paragraphNode() as HTMLElement).getAllByRole("link");
  const factLink = within(within(section()).getAllByRole("listitem")[1] as HTMLElement).getAllByRole("link")[0];
  expect(same.map((a) => a.getAttribute("href"))).toEqual([factLink?.getAttribute("href")]);
  cleanup();

  const smuggledA1 = { assetRef: "A1", href: `/asset-history/${ASSET_5}?points=evil` };
  const smuggledA9 = { assetRef: "A9", href: `/asset-history/${ASSET_5}`, label: "FZ-9 · Smuggled" };
  // The paragraph's facts are a newer cycle: its A1 is the summary's A2, and its A3 is unsafe.
  const renumbered: MlFindingsParagraphResponse = {
    cards: [
      {
        organizationId: ORG_C,
        state: "ok",
        segments: [
          { text: "Over the next two days the coldest point is at " },
          smuggledA1,
          { text: "; the band is widest at " },
          { assetRef: "A3" },
          { text: ", and " },
          smuggledA9,
          { text: " has 3 stale points." },
        ],
        assets: [
          { ref: "A1", assetId: ASSET_2, code: "FZ-2", label: "FZ-2 · Birch Row RTU", href: HREF_2 },
          { ref: "A3", assetId: ASSET_3, code: "FZ-3", label: "FZ-3 · Birch Row RTU", href: "//example.test/x" },
        ],
      },
    ],
  };
  spy.mockResolvedValue(renumbered);
  renderCard();
  await screen.findByText(ML_PARAGRAPH_LABEL);
  const block = paragraphNode() as HTMLElement;
  expect(block.textContent).toBe(`${ML_PARAGRAPH_LABEL}${OK_TEXT.replace("FZ-1", "FZ-2")}${ML_SUMMARY_NOTE}`);
  const links = within(block).getAllByRole("link");
  expect(links.map((a) => [a.textContent, a.getAttribute("title"), a.getAttribute("href")])).toEqual([
    ["FZ-2", "FZ-2 · Birch Row RTU", HREF_2],
  ]);
  expect(within(block).getByText("FZ-3").closest("a")).toBeNull();
  expect(within(block).getByText("an asset").closest("a")).toBeNull();
  expect(block.innerHTML).not.toContain("evil");
  expect(block.innerHTML).not.toContain("example.test");
  expect(block.innerHTML).not.toContain(ASSET_5);
  expect(block.textContent).not.toContain("Smuggled");
  // The summary's own facts are untouched: its A1 is still FZ-1.
  const summaryLink = within(within(section()).getAllByRole("listitem")[1] as HTMLElement).getAllByRole("link")[0];
  expect(summaryLink?.getAttribute("href")).toBe(HREF_1);
}

/** `paragraph={false}` makes no paragraph request; neither does a summary of empty cards only. */
export async function noParagraphRequestWhenOffOrEmpty(): Promise<void> {
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  const spy = vi.spyOn(mlApi, "fetchMlFindingsParagraph").mockResolvedValue(OK_C);
  renderCard({ paragraph: false });
  await screen.findByText("ORGC · Cedar Point Mills");
  await settle();
  expect(spy).not.toHaveBeenCalled();
  expect(screen.queryByText(ML_PARAGRAPH_LABEL)).toBeNull();
  cleanup();

  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue({ ...SUMMARY, cards: [CARD_B] });
  renderCard();
  await screen.findByText("ORGB · Birch Valley Water");
  await settle();
  expect(spy).not.toHaveBeenCalled();
}

/**
 * R-n: while a card is `pending` the read asks again every 4 s, at most 6 times; then it waits
 * for the 15-minute refetch. Fake timers.
 */
export async function pendingAsksAgainAtMostSixTimes(): Promise<void> {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  const spy = vi
    .spyOn(mlApi, "fetchMlFindingsParagraph")
    .mockResolvedValue({ cards: [{ organizationId: ORG_C, state: "pending", segments: [], assets: [] }] });
  renderCard();
  await screen.findByText("ORGC · Cedar Point Mills");
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  for (let ask = 1; ask <= 6; ask += 1) {
    await act(() => vi.advanceTimersByTimeAsync(4_000));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1 + ask));
  }
  await act(() => vi.advanceTimersByTimeAsync(4_000 * 20));
  expect(spy).toHaveBeenCalledTimes(7);
  await act(() => vi.advanceTimersByTimeAsync(900_000));
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(8));
  expect(screen.queryByText(ML_PARAGRAPH_LABEL)).toBeNull();
}

/** R-n: once the paragraph is written the block shows and the quick asks stop. */
export async function pendingThenOkShowsAndStops(): Promise<void> {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  const spy = vi
    .spyOn(mlApi, "fetchMlFindingsParagraph")
    .mockResolvedValueOnce({ cards: [{ organizationId: ORG_C, state: "pending", segments: [], assets: [] }] })
    .mockResolvedValue(OK_C);
  renderCard();
  await screen.findByText("ORGC · Cedar Point Mills");
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(ML_PARAGRAPH_LABEL)).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(4_000));
  expect(await screen.findByText(ML_PARAGRAPH_LABEL)).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(4_000 * 10));
  expect(spy).toHaveBeenCalledTimes(2);
}

const ANOMALY_C: MlFindingsCardData = {
  organizationId: ORG_C,
  organizationCode: "ORGC",
  organizationName: "Cedar Point Mills",
  facts: [
    { id: "A1", segments: [{ text: "9 unusual hours in the last 7 days, on 2 of 5 scored assets." }] },
    { id: "A2", segments: [{ text: "Strongest signal: " }, { assetRef: "A1" }, { text: " — 4 hours marked by both methods." }] },
    { id: "A3", segments: [{ assetRef: "A2" }, { text: ": 3 unusual hours, last 16 Nov 08:00; points kw." }] },
  ],
  assets: [
    { ref: "A1", assetId: ASSET_2, code: "FZ-2", label: "FZ-2 · Birch Row RTU", href: HREF_2 },
    { ref: "A2", assetId: ASSET_1, code: "FZ-1", label: "FZ-1 · Birch Row RTU", href: HREF_1 },
  ],
};

const F5_LINE =
  "Advisory: FZ-1 temp_c is expected to go above the limit of rule Freezer high (-15) at 17 Nov 01:00.";

function stubBothKinds(paragraph: (kind: MlFindingsKind) => MlFindingsParagraphResponse) {
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockImplementation((kind) =>
    Promise.resolve(kind === "forecasts" ? { ...SUMMARY, cards: [CARD_C] } : { ...SUMMARY, cards: [ANOMALY_C] }),
  );
  return vi.spyOn(mlApi, "fetchMlFindingsParagraph").mockImplementation((kind) => Promise.resolve(paragraph(kind)));
}

/**
 * Decision 13, compact: one card per organization for both kinds; F5 instead of F1 and A2 instead
 * of A1 when there is no paragraph; "Open forecasts" and "Open anomalies" carry the scope.
 */
export async function compactShowsTheTopLinesAndThePageLinks(): Promise<void> {
  stubBothKinds(() => ({ cards: [{ organizationId: ORG_C, state: "none", segments: [], assets: [] }] }));
  renderCard({ kinds: ["forecasts", "anomalies"], scope: { organizationId: ORG_C, locationId: SITE_D }, compact: true });
  await screen.findByText(/Strongest signal/);
  expect(screen.getAllByText("ORGC · Cedar Point Mills")).toHaveLength(1);
  expect(within(section()).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
    F5_LINE,
    "Strongest signal: FZ-2 — 4 hours marked by both methods.",
  ]);
  expect(within(section()).getAllByRole("listitem")[0]?.getAttribute("title")).toBe(F5_TOOLTIP);
  expect(screen.queryByText(F1)).toBeNull();
  expect(screen.queryByText(/on 2 of 5 scored assets/)).toBeNull();
  const forecasts = within(section()).getByRole("link", { name: "Open forecasts" });
  expect(forecasts.getAttribute("href")).toBe(`/forecasts?organizationId=${ORG_C}&locationId=${SITE_D}`);
  const anomalies = within(section()).getByRole("link", { name: "Open anomalies" });
  expect(anomalies.getAttribute("href")).toBe(`/anomalies?organizationId=${ORG_C}&locationId=${SITE_D}`);
  expect(screen.queryByText(ML_PARAGRAPH_LABEL)).toBeNull();
}

/** Compact: a kind with an `ok` paragraph shows the paragraph in place of its top lines. */
export async function compactPrefersTheParagraph(): Promise<void> {
  stubBothKinds((kind) =>
    kind === "anomalies"
      ? {
          cards: [
            {
              organizationId: ORG_C,
              state: "ok",
              segments: [{ assetRef: "A1" }, { text: " shows 4 hours marked by both methods." }],
              assets: ANOMALY_C.assets,
            },
          ],
        }
      : { cards: [{ organizationId: ORG_C, state: "none", segments: [], assets: [] }] },
  );
  renderCard({ kinds: ["forecasts", "anomalies"], scope: { organizationId: ORG_C }, compact: true });
  await screen.findByText(ML_PARAGRAPH_LABEL);
  const block = paragraphNode() as HTMLElement;
  expect(block.textContent).toBe(`${ML_PARAGRAPH_LABEL}FZ-2 shows 4 hours marked by both methods.${ML_SUMMARY_COMPACT_NOTE}`);
  expect(within(block).getByRole("link").getAttribute("href")).toBe(HREF_2);
  expect(screen.queryByText(/Strongest signal/)).toBeNull();
  expect(within(section()).getAllByRole("listitem").map((li) => li.textContent)).toEqual([F5_LINE]);
  expect(within(section()).getByRole("link", { name: "Open anomalies" }).getAttribute("href")).toBe(
    `/anomalies?organizationId=${ORG_C}`,
  );
}

/** Decision 1 / §5: with a paragraph, and in compact, still no alarm or severity colour. */
export async function noAlarmColourWithTheParagraph(): Promise<void> {
  for (const compact of [false, true]) {
    stubBothKinds(() => OK_C);
    renderCard({ kinds: ["forecasts", "anomalies"], compact });
    await screen.findAllByText(ML_PARAGRAPH_LABEL);
    const classes = [section(), ...Array.from(section().querySelectorAll("*"))].map((el) => el.getAttribute("class") ?? "");
    for (const cls of classes) {
      expect(cls).not.toMatch(/critical|warning|severity|ok-|alarm|danger/);
    }
    cleanup();
    vi.restoreAllMocks();
  }
}

// ---------------------------------------------------------------------------------------------
// `E1.9d` review fixes: a bounded poll after an error, no stale paragraph, a malformed answer.
// ---------------------------------------------------------------------------------------------

const PENDING_C: MlFindingsParagraphResponse = {
  cards: [{ organizationId: ORG_C, state: "pending", segments: [], assets: [] }],
};

/**
 * Review fix 1: one `pending` answer, then the route fails (a 5xx, then a 403). The read must
 * not keep asking every 4 s: an error falls back to the 15-minute refetch, and a 4xx is not retried.
 */
export async function anErrorAfterPendingStopsTheQuickAsks(): Promise<void> {
  const cases = [
    { error: new ApiError("ml findings paragraph 500", 500), atMost: 5 },
    { error: new ApiError("ml findings paragraph 403", 403), atMost: 2 },
  ];
  for (const { error, atMost } of cases) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
    const spy = vi.spyOn(mlApi, "fetchMlFindingsParagraph").mockResolvedValueOnce(PENDING_C).mockRejectedValue(error);
    renderCard();
    await screen.findByText("ORGC · Cedar Point Mills");
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    for (let step = 0; step < 20; step += 1) {
      await act(() => vi.advanceTimersByTimeAsync(4_000));
    }
    const settled = spy.mock.calls.length;
    expect(settled, error.message).toBeLessThanOrEqual(atMost);
    expect(settled, error.message).toBeGreaterThanOrEqual(2);
    for (let step = 0; step < 20; step += 1) {
      await act(() => vi.advanceTimersByTimeAsync(4_000));
    }
    expect(spy.mock.calls.length, error.message).toBe(settled);
    expect(screen.queryByText(ML_PARAGRAPH_LABEL)).toBeNull();
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
}

/** Review fix 1: a new scope is a new count — its first `pending` is asked again at 4 s. */
export async function aNewScopeStartsItsCountAtZero(): Promise<void> {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
  const spy = vi.spyOn(mlApi, "fetchMlFindingsParagraph").mockResolvedValue(PENDING_C);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (scope: ScopeFilter) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MlFindingsCard kinds={["forecasts"]} scope={scope} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(view({ organizationId: ORG_C }));
  await screen.findByText("ORGC · Cedar Point Mills");
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  for (let step = 0; step < 10; step += 1) {
    await act(() => vi.advanceTimersByTimeAsync(4_000));
  }
  expect(spy).toHaveBeenCalledTimes(7);

  rerender(view({ organizationId: ORG_C, locationId: SITE_D }));
  const askedForSite = () => spy.mock.calls.filter((call) => call[1].locationId === SITE_D).length;
  await waitFor(() => expect(askedForSite()).toBe(1));
  await act(() => vi.advanceTimersByTimeAsync(4_000));
  await waitFor(() => expect(askedForSite()).toBe(2));
}

/**
 * Review fix 2: a later summary with only the "none" line for the organization hides the old
 * paragraph — in the full card and in compact (where the "none" line shows instead).
 */
export async function aSummaryWithNothingHidesTheOldParagraph(): Promise<void> {
  const emptied: MlFindingsCardData = { ...CARD_C, facts: [{ id: "F_NONE", segments: [{ text: "No forecast points in this selection." }] }] };
  for (const compact of [false, true]) {
    const summary = vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue({ ...SUMMARY, cards: [CARD_C] });
    vi.spyOn(mlApi, "fetchMlFindingsParagraph").mockResolvedValue(OK_C);
    const client = renderCard({ compact });
    await screen.findByText(ML_PARAGRAPH_LABEL);
    summary.mockResolvedValue({ ...SUMMARY, cards: [emptied] });
    await act(() => client.invalidateQueries({ queryKey: ["ml-findings", "summary"] }));
    await screen.findByText("No forecast points in this selection.");
    await settle();
    expect(screen.queryByText(ML_PARAGRAPH_LABEL), `compact: ${compact}`).toBeNull();
    expect(section().textContent).not.toContain("coldest point");
    cleanup();
    vi.restoreAllMocks();
  }
}

/**
 * Review fix 3: a malformed paragraph card (no `assets`, a `null` segment, an object as text)
 * draws the facts and no paragraph, and throws nothing.
 */
export async function aMalformedParagraphDrawsTheFactsOnly(): Promise<void> {
  const malformed = [
    { organizationId: ORG_C, state: "ok", segments: [{ text: "No assets list." }] },
    { organizationId: ORG_C, state: "ok", segments: [null], assets: [] },
    { organizationId: ORG_C, state: "ok", segments: [{ text: { a: 1 } }], assets: [] },
  ];
  for (const card of malformed) {
    vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(SUMMARY);
    const spy = vi.spyOn(mlApi, "fetchMlFindingsParagraph").mockResolvedValue({ cards: [card] } as never);
    renderCard();
    await screen.findByText("ORGC · Cedar Point Mills");
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await settle();
    expect(within(section()).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByText(ML_PARAGRAPH_LABEL)).toBeNull();
    expect(section().textContent).not.toContain("No assets list.");
    cleanup();
    vi.restoreAllMocks();
  }
}
