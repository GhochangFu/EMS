import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import { HEALTH_ANOMALY_CAPTION, healthBadActorsResponseSchema } from "@bms/shared/contracts";
import type { HealthBadActor, HealthBadActorsResponse, HealthLowestScore } from "@bms/shared/contracts";

import * as assetHealthApi from "../../api/asset-health";
import { HEALTH_BAD_ACTORS_TITLE, HealthBadActorsCard } from "./health-bad-actors-card";

/**
 * `E1.8c` T3.1 (ADR 0050 Amendment 5 decisions 4–7; plan §4.6, §4.7, §4.8, R-f, R-j, R-m, R-n) —
 * the *Bad actors — advisory* card. `health-bad-actors-card.test.tsx` is the Vitest entry point and
 * carries the jsdom docblock (ADR 0014, ADR 0042 decision 2). The read is a spy on the client; the
 * fixtures are made-up names.
 */

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";

function assetId(n: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
}

function historyHref(n: number): string {
  return `/asset-history/${assetId(n)}?from=2026-11-16T08%3A00%3A00.000Z&to=2026-11-16T10%3A00%3A00.000Z`;
}

function label(n: number) {
  return {
    assetId: assetId(n),
    assetCode: `PMP-10${n}`,
    assetName: `Pump ${n}`,
    assetRtuName: `Yard RTU ${n}`,
    locationId: LOCATION_ID,
    assetLocationName: "Riverside Plant",
  };
}

function actor(n: number, overrides: Partial<HealthBadActor> = {}): HealthBadActor {
  return {
    ...label(n),
    scoredHours: 168,
    unusualHours: 6,
    strongHours: 3,
    baselineOnlyHours: 2,
    weak: false,
    lastUnusualAt: "2026-11-16T09:00:00.000Z",
    topPoints: ["flow", "pressure"],
    href: historyHref(n),
    ruleScore: 0.93,
    advisoryScore: 0.88,
    ...overrides,
  };
}

function lowest(n: number, overrides: Partial<HealthLowestScore> = {}): HealthLowestScore {
  return {
    ...label(n),
    score: 0.41 + n / 100,
    band: { code: "poor", label: "Poor", minScore: 0.4 },
    scoredTagCount: 4,
    ...overrides,
  };
}

const CAVEAT = "A made-up caveat sentence the API sends.";

function response(overrides: Partial<HealthBadActorsResponse> = {}): HealthBadActorsResponse {
  return healthBadActorsResponseSchema.parse({
    asOf: "2026-11-17T10:00:00.000Z",
    scoredAssetCount: 20,
    lowestScores: [1, 2, 3, 4, 5].map((n) => lowest(n)),
    anomaly: {
      windowDays: 7,
      unusualAssetCount: 8,
      losingAssetCount: 3,
      caveat: CAVEAT,
      items: [5, 3, 1, 4, 2].map((n) => actor(n)),
    },
    ...overrides,
  });
}

function renderCard(props: { organizationId?: string; locationId?: string; showCount?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HealthBadActorsCard {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function answer(data: HealthBadActorsResponse) {
  return vi.spyOn(assetHealthApi, "fetchHealthBadActors").mockResolvedValue(data);
}

/** The anomaly rows, in document order. */
function anomalyRows(): HTMLElement[] {
  return screen.queryAllByTestId("bad-actor-row");
}

const COLOUR = /critical|warning|severity|ok-/;

function expectNoBandOrAlarmColour(root: Element): void {
  for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
    expect(el.getAttribute("class") ?? "", el.outerHTML.slice(0, 120)).not.toMatch(COLOUR);
  }
}

function isInfoPill(el: Element): boolean {
  return el.textContent === "Advisory" && (el.getAttribute("class") ?? "").includes("border-info-line");
}

/** The title, word for word; the Anomaly history tab is the default. */
export async function theTitleAndTheDefaultTab(): Promise<void> {
  answer(response());
  renderCard({ organizationId: ORG_ID });

  expect(await screen.findByRole("heading", { name: HEALTH_BAD_ACTORS_TITLE })).toBeInTheDocument();
  expect(HEALTH_BAD_ACTORS_TITLE).toBe("Bad actors — advisory");
  const tabs = within(await screen.findByRole("tablist")).getAllByRole("tab");
  expect(tabs.map((t) => t.textContent)).toEqual(["Anomaly history", "Lowest health score"]);
  expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  expect(tabs[1]).toHaveAttribute("aria-selected", "false");
  await waitFor(() => expect(anomalyRows()).toHaveLength(5));
  expect(screen.queryByText("Rule score only. Not advisory.")).toBeNull();
}

/** The rows in the API's order, each with its three hour counts, its points and its site. */
export async function fiveRowsInTheApisOrder(): Promise<void> {
  answer(response());
  renderCard();

  await waitFor(() => expect(anomalyRows()).toHaveLength(5));
  const rows = anomalyRows();
  expect(rows.map((r) => within(r).getByRole("link").textContent)).toEqual(
    [5, 3, 1, 4, 2].map((n) => `PMP-10${n} · Yard RTU ${n}`),
  );
  expect(rows[0].textContent).toContain("3 h both methods · 2 h Baseline only · 6 unusual in all");
  expect(rows[0].textContent).toContain("Riverside Plant");
  expect(rows[0].textContent).toContain("flow, pressure");
}

/** A row's link is its `href`, unchanged. */
export async function aRowsLinkIsItsHref(): Promise<void> {
  answer(response());
  renderCard();

  await waitFor(() => expect(anomalyRows()).toHaveLength(5));
  expect(within(anomalyRows()[0]).getByRole("link")).toHaveAttribute("href", historyHref(5));
}

/** An `href` that is not an asset history link the builders make renders as plain text. */
export async function anUnsafeHrefIsPlainText(): Promise<void> {
  answer(
    response({
      anomaly: {
        windowDays: 7,
        unusualAssetCount: 2,
        losingAssetCount: 0,
        caveat: null,
        items: [actor(1, { href: "javascript:alert(1)" }), actor(2, { href: "//example.test/x" })],
      },
    }),
  );
  const { container } = renderCard();

  await waitFor(() => expect(anomalyRows()).toHaveLength(2));
  for (const row of anomalyRows()) {
    expect(within(row).queryByRole("link")).toBeNull();
  }
  expect(screen.getByText("PMP-101 · Yard RTU 1")).toBeInTheDocument();
  expect(screen.getByText("PMP-102 · Yard RTU 2")).toBeInTheDocument();
  expect(container.innerHTML).not.toContain("javascript:");
  expect(container.innerHTML).not.toContain("example.test");
}

/** A weak row says `Weak signal`; a strong row does not. */
export async function aWeakRowSaysWeakSignal(): Promise<void> {
  answer(
    response({
      anomaly: {
        windowDays: 7,
        unusualAssetCount: 2,
        losingAssetCount: 1,
        caveat: null,
        items: [actor(1), actor(2, { strongHours: 0, baselineOnlyHours: 6, unusualHours: 6, weak: true })],
      },
    }),
  );
  renderCard();

  await waitFor(() => expect(anomalyRows()).toHaveLength(2));
  const [strong, weak] = anomalyRows();
  expect(weak.textContent).toContain("Weak signal");
  expect(strong.textContent).not.toContain("Weak signal");
}

/** Both scores: the arrow line at the card's precision. `ruleScore: null`: no score text at all. */
export async function theScoreLineOnlyWithBothScores(): Promise<void> {
  answer(
    response({
      anomaly: {
        windowDays: 7,
        unusualAssetCount: 2,
        losingAssetCount: 1,
        caveat: null,
        items: [actor(1), actor(2, { ruleScore: null, advisoryScore: null })],
      },
    }),
  );
  renderCard();

  await waitFor(() => expect(anomalyRows()).toHaveLength(2));
  const [scored, unscored] = anomalyRows();
  expect(scored.textContent).toContain("Score 93% → 88% with anomaly history");
  expect(unscored.textContent).not.toMatch(/Score|%/);
}

/** The caveat is the API's string; the caption is the shared constant, with the info pill beside it. */
export async function theCaveatAndTheCaption(): Promise<void> {
  answer(response());
  renderCard();

  expect(await screen.findByText(CAVEAT)).toBeInTheDocument();
  const caption = screen.getByText(HEALTH_ANOMALY_CAPTION);
  const pill = Array.from(caption.parentElement?.querySelectorAll("span") ?? []).find(isInfoPill);
  expect(pill, "the info pill beside the caption").toBeTruthy();
}

/**
 * R-n — every anomaly row has its own `info` pill; the card header has none (the second tab holds
 * rule scores, and a header pill would label them advisory).
 */
export async function eachRowHasTheInfoPillAndTheHeaderNone(): Promise<void> {
  answer(response());
  renderCard();

  await waitFor(() => expect(anomalyRows()).toHaveLength(5));
  for (const row of anomalyRows()) {
    const pills = Array.from(row.querySelectorAll("span")).filter((el) => el.textContent === "Advisory");
    expect(pills).toHaveLength(1);
    expect(isInfoPill(pills[0])).toBe(true);
  }
  const header = screen.getByRole("heading", { name: HEALTH_BAD_ACTORS_TITLE }).parentElement?.parentElement as HTMLElement;
  expect(Array.from(header.querySelectorAll("span")).filter((el) => el.textContent === "Advisory")).toEqual([]);
}

/** The Lowest tab: rule scores, history links, bands, tag counts, and nothing that says Advisory. */
export async function theLowestTabIsNotAdvisory(): Promise<void> {
  answer(response());
  renderCard();

  fireEvent.click(await screen.findByRole("tab", { name: "Lowest health score" }));
  expect(screen.getByRole("tab", { name: "Lowest health score" })).toHaveAttribute("aria-selected", "true");
  const panel = screen.getByRole("tabpanel");
  expect(within(panel).getByText("Rule score only. Not advisory.")).toBeInTheDocument();
  expect(anomalyRows()).toEqual([]);
  const rows = within(panel).getAllByTestId("lowest-score-row");
  expect(rows).toHaveLength(5);
  expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", `/asset-history/${assetId(1)}`);
  expect(rows[0].textContent).toContain("PMP-101 · Yard RTU 1");
  expect(rows[0].textContent).toContain("Riverside Plant");
  expect(rows[0].textContent).toContain("42%");
  expect(rows[0].textContent).toContain("Poor · ≥ 40%");
  expect(rows[0].textContent).toContain("4 scored tags");
  // The whole panel, not leaf nodes: a `StatusPill` is a span with a dot child, so a leaf-only
  // walk skipped it and an Advisory pill on the Lowest tab passed (code review, E1.8c).
  expect(within(panel).queryAllByText("Advisory")).toEqual([]);
  expect((panel.textContent ?? "").replace("Rule score only. Not advisory.", "")).not.toMatch(/advisory/i);
  expect(screen.queryByText(HEALTH_ANOMALY_CAPTION)).toBeNull();
}

/** No band, alarm or severity colour class anywhere in the card, on either tab. */
export async function noBandOrAlarmColourClass(): Promise<void> {
  answer(
    response({
      anomaly: {
        windowDays: 7,
        unusualAssetCount: 2,
        losingAssetCount: 1,
        caveat: CAVEAT,
        items: [actor(1), actor(2, { strongHours: 0, baselineOnlyHours: 6, weak: true })],
      },
    }),
  );
  const { container } = renderCard({ showCount: true });

  await waitFor(() => expect(anomalyRows()).toHaveLength(2));
  expectNoBandOrAlarmColour(container);
  fireEvent.click(screen.getByRole("tab", { name: "Lowest health score" }));
  expect(await screen.findByText("Rule score only. Not advisory.")).toBeInTheDocument();
  expectNoBandOrAlarmColour(container);
}

/** Pending: `Loading…`, the title drawn. */
export async function aPendingReadSaysLoading(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchHealthBadActors").mockReturnValue(new Promise(() => {}));
  renderCard();

  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Loading…")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: HEALTH_BAD_ACTORS_TITLE })).toBeInTheDocument();
}

/** A rejected read: one muted sentence, not an alert. */
export async function aRejectedReadIsAMutedSentence(): Promise<void> {
  vi.spyOn(assetHealthApi, "fetchHealthBadActors").mockRejectedValue(new Error("asset-health/bad-actors 500"));
  const { container } = renderCard();

  const line = await screen.findByText("Could not load this list.");
  expect(line.className).toContain("text-ink-muted");
  expect(screen.queryByRole("tablist")).toBeNull();
  expectNoBandOrAlarmColour(container);
}

/** `anomaly: null`: only the Lowest content, no tab strip, no anomaly words. */
export async function anomalyNullShowsOnlyTheLowestContent(): Promise<void> {
  answer(response({ anomaly: null }));
  renderCard({ showCount: true });

  expect(await screen.findByText("Rule score only. Not advisory.")).toBeInTheDocument();
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.getAllByTestId("lowest-score-row")).toHaveLength(5);
  expect(screen.queryByText(/No unusual hours/)).toBeNull();
  expect(screen.queryByText(HEALTH_ANOMALY_CAPTION)).toBeNull();
  expect(screen.queryByText(/lose points/)).toBeNull();
  // Rule scores only: no Advisory pill and no advisory word beyond the "Not advisory" line.
  expect(screen.queryAllByText("Advisory")).toEqual([]);
  for (const row of screen.getAllByTestId("lowest-score-row")) {
    expect(row.textContent ?? "").not.toMatch(/advisory/i);
  }
}

/** `anomaly: null` and no lowest row: the card is not drawn at all. */
export async function anomalyNullAndNoLowestDrawsNothing(): Promise<void> {
  const spy = answer(response({ anomaly: null, lowestScores: [] }));
  const { container } = renderCard();

  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(container.innerHTML).toBe(""));
}

/** `items: []`: the anomaly half answered and no asset has an unusual hour. */
export async function noItemsSaysNoUnusualHours(): Promise<void> {
  answer(
    response({
      anomaly: { windowDays: 7, unusualAssetCount: 0, losingAssetCount: 0, caveat: null, items: [] },
    }),
  );
  renderCard();

  expect(await screen.findByText("No unusual hours in the last 7 days.")).toBeInTheDocument();
  expect(screen.getByRole("tablist")).toBeInTheDocument();
}

/** `showCount` draws the 4.8 line with its pill; without it there is no count line. */
export async function showCountDrawsTheCountLine(): Promise<void> {
  const sentence = "3 of 20 scored assets lose points to anomaly history · advisory";
  answer(response());
  const first = renderCard({ showCount: true });
  const line = (await screen.findByText(sentence)).closest("[data-testid='bad-actors-count-line']") as HTMLElement;
  expect(line).not.toBeNull();
  expect(Array.from(line.querySelectorAll("span")).some(isInfoPill)).toBe(true);
  first.unmount();

  answer(response());
  renderCard();
  await waitFor(() => expect(anomalyRows()).toHaveLength(5));
  expect(screen.queryByText(sentence)).toBeNull();
  expect(screen.queryByTestId("bad-actors-count-line")).toBeNull();
}

/** The read carries the card's own scope. */
export async function theReadCarriesTheCardsScope(): Promise<void> {
  const spy = answer(response());
  renderCard({ organizationId: ORG_ID, locationId: LOCATION_ID });

  await waitFor(() => expect(anomalyRows()).toHaveLength(5));
  expect(spy.mock.calls).toEqual([[{ organizationId: ORG_ID, locationId: LOCATION_ID }]]);
}


/**
 * The tabs follow the WAI-ARIA tabs pattern, as `dashboard-tab-strip.tsx` does (code review,
 * E1.8c): only the selected tab is in the Tab order; ArrowRight/ArrowLeft wrap, Home and End jump,
 * and each selects and focuses.
 */
export async function theTabsMoveWithArrowKeys(): Promise<void> {
  answer(response());
  renderCard();

  const anomalyTab = await screen.findByRole("tab", { name: "Anomaly history" });
  const lowestTab = screen.getByRole("tab", { name: "Lowest health score" });
  expect(anomalyTab).toHaveAttribute("tabindex", "0");
  expect(lowestTab).toHaveAttribute("tabindex", "-1");

  anomalyTab.focus();
  fireEvent.keyDown(anomalyTab, { key: "ArrowRight" });
  expect(lowestTab).toHaveAttribute("aria-selected", "true");
  expect(lowestTab).toHaveFocus();
  expect(lowestTab).toHaveAttribute("tabindex", "0");

  fireEvent.keyDown(lowestTab, { key: "ArrowRight" });
  expect(anomalyTab).toHaveAttribute("aria-selected", "true");
  expect(anomalyTab).toHaveFocus();

  fireEvent.keyDown(anomalyTab, { key: "ArrowLeft" });
  expect(lowestTab).toHaveAttribute("aria-selected", "true");

  fireEvent.keyDown(lowestTab, { key: "Home" });
  expect(anomalyTab).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(anomalyTab, { key: "End" });
  expect(lowestTab).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", lowestTab.id);
}
