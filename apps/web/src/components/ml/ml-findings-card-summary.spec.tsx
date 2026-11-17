import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type {
  MlFindingSegment,
  MlFindingsCard as MlFindingsCardData,
  MlFindingsKind,
  MlFindingsParagraphCard,
  MlFindingsParagraphResponse,
  MlFindingsSummaryResponse,
} from "@bms/shared/contracts";

import * as mlApi from "../../api/ml";
import {
  ML_COMPUTED_FACTS_HEADING,
  ML_FINDINGS_HEADING,
  ML_PARAGRAPH_LABEL,
  ML_SUMMARY_COMPACT_NOTE,
  ML_SUMMARY_NOTE,
  MlFindingsCard,
} from "./ml-findings-card";

/**
 * `E1.9g` (ADR 0135 Amendment 10 decisions 1, 2, 4 and 5; plan 4.4–4.7, T2.3) — the AI summary
 * box, the code chips and the folded "Computed facts". The reads are stubbed at `api/ml`; every
 * name is made up. `ml-findings-card-summary.test.tsx` is the Vitest entry point.
 */

const ORG_P = "aaaaaaaa-3333-4333-8333-000000000001";
const ORG_Q = "aaaaaaaa-3333-4333-8333-000000000002";
const ASSET_1 = "dddddddd-3333-4333-8333-000000000001";
const ASSET_2 = "dddddddd-3333-4333-8333-000000000002";
const HREF_1 = `/asset-history/${ASSET_1}?points=kw`;
const HREF_2 = `/asset-history/${ASSET_2}?points=flow_m3h`;

/** S4: the second asset's code is not the start of its label, so a chip that parses `label` fails. */
const ASSETS = [
  { ref: "A1", assetId: ASSET_1, code: "PR-1", label: "PR-1 · Pine Ridge RTU", href: HREF_1 },
  { ref: "A2", assetId: ASSET_2, code: "Q7", label: "North Tank Gateway · Pine Ridge", href: HREF_2 },
];

const FACT_TEXT = [
  "9 unusual hours in the last 7 days, on 2 of 6 scored assets.",
  "Strongest signal: PR-1 — 4 hours marked by both methods.",
  "Q7: 3 unusual hours, last 16 Nov 08:00; points flow_m3h.",
  "Marks from the Baseline method alone are a weak signal; marks from both methods are the strongest.",
];

const card = (organizationId: string, code: string, name: string, factCount = 4): MlFindingsCardData => ({
  organizationId,
  organizationCode: code,
  organizationName: name,
  facts: [
    { id: "A1", segments: [{ text: FACT_TEXT[0] as string }] },
    { id: "A2", segments: [{ text: "Strongest signal: " }, { assetRef: "A1" }, { text: " — 4 hours marked by both methods." }] },
    { id: "A3", segments: [{ assetRef: "A2" }, { text: ": 3 unusual hours, last 16 Nov 08:00; points flow_m3h." }] },
    { id: "A4", segments: [{ text: FACT_TEXT[3] as string }] },
  ].slice(0, factCount) as MlFindingsCardData["facts"],
  assets: factCount >= 3 ? ASSETS : ASSETS.slice(0, 1),
});

const CARD_P = card(ORG_P, "ORGP", "Pine Ridge Dairy");
const CARD_Q = card(ORG_Q, "ORGQ", "Quarry Lane Works");

const summary = (...cards: MlFindingsCardData[]): MlFindingsSummaryResponse => ({ asOf: "2026-11-16T09:00:00.000Z", cards });

/** Three sentences: a count headline, then two points that each start with a chip. */
const THREE: MlFindingSegment[] = [
  { text: "There were 9 unusual hours on 2 of 6 scored assets. " },
  { assetRef: "A1" },
  { text: " carries the strongest signal with 4 hours. " },
  { assetRef: "A2" },
  { text: " had 3 unusual hours." },
];

const sentencesText = (n: number): MlFindingSegment[] => [
  { text: Array.from({ length: n }, (_, i) => `Point ${i} holds.`).join(" ") },
];

const ok = (organizationId: string, segments: MlFindingSegment[]): MlFindingsParagraphCard => ({
  organizationId,
  state: "ok",
  segments,
  assets: ASSETS,
});

function stub(summaryAnswer: MlFindingsSummaryResponse, paragraph: MlFindingsParagraphResponse) {
  const summarySpy = vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue(summaryAnswer);
  const paragraphSpy = vi.spyOn(mlApi, "fetchMlFindingsParagraph").mockResolvedValue(paragraph);
  return { summarySpy, paragraphSpy };
}

type Props = { kinds?: readonly MlFindingsKind[]; paragraph?: boolean; compact?: boolean };

function view(client: QueryClient, props: Props) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MlFindingsCard kinds={props.kinds ?? ["anomalies"]} scope={{}} paragraph={props.paragraph} compact={props.compact} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderCard(props: Props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(view(client, props));
  return { client, ...result };
}

const section = (): HTMLElement => screen.getByRole("region", { name: ML_FINDINGS_HEADING });
const box = async (): Promise<HTMLElement> =>
  (await screen.findByText(ML_PARAGRAPH_LABEL)).closest<HTMLElement>("[data-ml-paragraph]") as HTMLElement;
const cardOf = (title: string): HTMLElement => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
const factsOf = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll("[data-ml-facts] li")).map((li) => li.textContent ?? "");
const showMore = (root: HTMLElement): HTMLElement | null => within(root).queryByRole("button", { name: /^Show \d+ more$/ });

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

/** S1: three sentences — the headline, two points, the label with the mark, the note, the info tint. */
export async function s1ThreeSentencesAreAHeadlineAndTwoPoints(): Promise<void> {
  stub(summary(CARD_P), { cards: [ok(ORG_P, THREE)] });
  renderCard();
  const node = await box();
  expect(ML_PARAGRAPH_LABEL).toBe("AI summary · advisory");
  expect(node.querySelector("[data-ml-headline]")?.textContent).toBe("There were 9 unusual hours on 2 of 6 scored assets.");
  expect(Array.from(node.querySelectorAll("[data-ml-points] li")).map((li) => li.textContent)).toEqual([
    "PR-1 carries the strongest signal with 4 hours.",
    "Q7 had 3 unusual hours.",
  ]);
  expect(node.querySelector("[data-ml-note]")?.textContent).toBe("Written by AI from the facts below. Check them before you act.");
  expect(ML_SUMMARY_NOTE).toBe("Written by AI from the facts below. Check them before you act.");
  expect(node.className).toContain("bg-info-wash");
  expect(node.className).toContain("border-info-line");
  const labelRow = screen.getByText(ML_PARAGRAPH_LABEL);
  expect(labelRow.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
  expect(node.querySelectorAll("svg")).toHaveLength(1);
}

/** S2: one sentence is the headline alone, with no points list. */
export async function s2OneSentenceIsTheHeadlineAlone(): Promise<void> {
  stub(summary(CARD_P), { cards: [ok(ORG_P, sentencesText(1))] });
  renderCard();
  const node = await box();
  expect(node.querySelector("[data-ml-headline]")?.textContent).toBe("Point 0 holds.");
  expect(node.querySelector("[data-ml-points]")).toBeNull();
}

/** S3: six sentences give the headline and four points. */
export async function s3SixSentencesShowFourPoints(): Promise<void> {
  stub(summary(CARD_P), { cards: [ok(ORG_P, sentencesText(6))] });
  renderCard();
  const node = await box();
  expect(Array.from(node.querySelectorAll("[data-ml-points] li")).map((li) => li.textContent)).toEqual([
    "Point 1 holds.",
    "Point 2 holds.",
    "Point 3 holds.",
    "Point 4 holds.",
  ]);
  expect(node.textContent).not.toContain("Point 5");
}

/** S4: a chip, in the box and in a fact line, draws the code; `title` is the full label; the link is unchanged. */
export async function s4ChipsShowTheCodeWithTheLabelAsTitle(): Promise<void> {
  stub(summary(CARD_P), { cards: [ok(ORG_P, THREE)] });
  renderCard();
  const node = await box();
  const inBox = within(node).getAllByRole("link");
  expect(inBox.map((a) => [a.textContent, a.getAttribute("title"), a.getAttribute("href")])).toEqual([
    ["PR-1", "PR-1 · Pine Ridge RTU", HREF_1],
    ["Q7", "North Tank Gateway · Pine Ridge", HREF_2],
  ]);
  const facts = section().querySelector("[data-ml-facts]") as HTMLElement;
  const inFacts = within(facts).getAllByRole("link");
  expect(inFacts.map((a) => [a.textContent, a.getAttribute("title"), a.getAttribute("href")])).toEqual([
    ["PR-1", "PR-1 · Pine Ridge RTU", HREF_1],
  ]);
  for (const link of [...inBox, ...inFacts]) {
    expect(link.textContent).not.toContain(" · ");
  }
}

/** S5: with the box, "Computed facts", two lines and "Show 2 more"; a click shows all four, the button goes. */
export async function s5TheFactsFoldToTwoLinesUnderTheBox(): Promise<void> {
  stub(summary(CARD_P), { cards: [ok(ORG_P, THREE)] });
  renderCard();
  await box();
  const root = section();
  const heading = within(root).getByRole("heading", { level: 3, name: ML_COMPUTED_FACTS_HEADING });
  expect(ML_COMPUTED_FACTS_HEADING).toBe("Computed facts");
  expect(factsOf(root)).toEqual([FACT_TEXT[0], FACT_TEXT[1]]);
  const button = showMore(root) as HTMLElement;
  expect(button.textContent).toBe("Show 2 more");
  expect(button.getAttribute("type")).toBe("button");
  fireEvent.click(button);
  expect(factsOf(root)).toEqual(FACT_TEXT);
  expect(showMore(root)).toBeNull();
  expect(heading.isConnected).toBe(true);
}

/** S6: two facts under the box — the heading and both lines, no button. */
export async function s6TwoFactsShowWithNoButton(): Promise<void> {
  stub(summary(card(ORG_P, "ORGP", "Pine Ridge Dairy", 2)), { cards: [ok(ORG_P, THREE)] });
  renderCard();
  await box();
  const root = section();
  expect(within(root).getByRole("heading", { level: 3, name: ML_COMPUTED_FACTS_HEADING })).toBeInTheDocument();
  expect(factsOf(root)).toEqual([FACT_TEXT[0], FACT_TEXT[1]]);
  expect(showMore(root)).toBeNull();
}

/** S7: no box (`paragraph={false}`, `none`, `pending`) — no heading, every line, no button. */
export async function s7NoBoxShowsEveryLine(): Promise<void> {
  const runs: Array<[Props, MlFindingsParagraphResponse]> = [
    [{ paragraph: false }, { cards: [ok(ORG_P, THREE)] }],
    [{}, { cards: [{ organizationId: ORG_P, state: "none", segments: [], assets: [] }] }],
    [{}, { cards: [{ organizationId: ORG_P, state: "pending", segments: [], assets: [] }] }],
  ];
  for (const [props, answer] of runs) {
    const { paragraphSpy } = stub(summary(CARD_P), answer);
    renderCard(props);
    await screen.findByText("ORGP · Pine Ridge Dairy");
    if (props.paragraph !== false) await waitFor(() => expect(paragraphSpy).toHaveBeenCalled());
    await settle();
    const root = section();
    expect(screen.queryByText(ML_PARAGRAPH_LABEL)).toBeNull();
    expect(within(root).queryByText(ML_COMPUTED_FACTS_HEADING)).toBeNull();
    expect(factsOf(root)).toEqual(FACT_TEXT.map((line) => line));
    expect(showMore(root)).toBeNull();
    cleanup();
    vi.restoreAllMocks();
  }
}

/** S8: compact — the headline and at most 2 points, the compact note, no heading, no button. */
export async function s8CompactShowsTheHeadlineAndTwoPoints(): Promise<void> {
  stub(summary(CARD_P), { cards: [ok(ORG_P, sentencesText(4))] });
  renderCard({ compact: true });
  const node = await box();
  expect(node.querySelector("[data-ml-headline]")?.textContent).toBe("Point 0 holds.");
  expect(Array.from(node.querySelectorAll("[data-ml-points] li")).map((li) => li.textContent)).toEqual([
    "Point 1 holds.",
    "Point 2 holds.",
  ]);
  expect(node.querySelector("[data-ml-note]")?.textContent).toBe("Written by AI from the computed facts.");
  expect(ML_SUMMARY_COMPACT_NOTE).toBe("Written by AI from the computed facts.");
  expect(within(section()).queryByText(ML_COMPUTED_FACTS_HEADING)).toBeNull();
  expect(showMore(section())).toBeNull();
  expect(section().querySelector("[data-ml-facts]")).toBeNull();
}

/** S9: two organizations with boxes — opening one leaves the other folded. */
export async function s9EachCardOpensOnItsOwn(): Promise<void> {
  stub(summary(CARD_P, CARD_Q), { cards: [ok(ORG_P, THREE), ok(ORG_Q, THREE)] });
  renderCard();
  await waitFor(() => expect(screen.getAllByText(ML_PARAGRAPH_LABEL)).toHaveLength(2));
  const p = cardOf("ORGP · Pine Ridge Dairy");
  const q = cardOf("ORGQ · Quarry Lane Works");
  fireEvent.click(showMore(p) as HTMLElement);
  expect(factsOf(p)).toHaveLength(4);
  expect(factsOf(q)).toHaveLength(2);
  expect(showMore(q)?.textContent).toBe("Show 2 more");
}

/** S10: the open state is not kept — unmount and render again, and the facts are folded. */
export async function s10ARemountStartsFolded(): Promise<void> {
  stub(summary(CARD_P), { cards: [ok(ORG_P, THREE)] });
  const first = renderCard();
  await box();
  fireEvent.click(showMore(section()) as HTMLElement);
  expect(factsOf(section())).toHaveLength(4);
  first.unmount();
  render(view(first.client, {}));
  await box();
  expect(factsOf(section())).toHaveLength(2);
  expect(showMore(section())?.textContent).toBe("Show 2 more");
}

/** S11: a later summary with only the "none" line hides the box and the heading. */
export async function s11ANoneSummaryHidesTheBoxAndTheHeading(): Promise<void> {
  const emptied: MlFindingsCardData = {
    ...CARD_P,
    facts: [{ id: "A_NONE", segments: [{ text: "No unusual hours in this selection." }] }],
    assets: [],
  };
  const { summarySpy } = stub(summary(CARD_P), { cards: [ok(ORG_P, THREE)] });
  const { client } = renderCard();
  await box();
  expect(within(section()).getByText(ML_COMPUTED_FACTS_HEADING)).toBeInTheDocument();
  summarySpy.mockResolvedValue(summary(emptied));
  await act(() => client.invalidateQueries({ queryKey: ["ml-findings", "summary"] }));
  await screen.findByText("No unusual hours in this selection.");
  await settle();
  expect(screen.queryByText(ML_PARAGRAPH_LABEL)).toBeNull();
  expect(within(section()).queryByText(ML_COMPUTED_FACTS_HEADING)).toBeNull();
  expect(showMore(section())).toBeNull();
}

/** S12: no alarm or severity colour with a multi-sentence summary, full and compact. */
export async function s12NoAlarmColourInTheBox(): Promise<void> {
  for (const compact of [false, true]) {
    stub(summary(CARD_P), { cards: [ok(ORG_P, sentencesText(5))] });
    renderCard({ compact });
    await box();
    const classes = [section(), ...Array.from(section().querySelectorAll("*"))].map((el) => el.getAttribute("class") ?? "");
    expect(classes.some((c) => c.includes("bg-info-wash"))).toBe(true);
    for (const cls of classes) {
      expect(cls, `compact: ${compact}`).not.toMatch(/critical|warning|severity|ok-|alarm|danger/);
    }
    cleanup();
    vi.restoreAllMocks();
  }
}
