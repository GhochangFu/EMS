import {
  assert,
  harness,
  PAYLOAD,
  PREVIOUS_TOTAL_KWH,
  render,
  renderedOutcome,
  schedule,
} from "./report-render.service.spec";

/**
 * `F4.303` U12 (ADR 0108 Amendment 6 item 8, owner Q9) — compare on a scheduled
 * `energy_consumption` render, over `report-render.service.spec.ts`'s harness.
 * Assertions live here; `report-render-compare.test.ts` is the Vitest entry
 * point (§4.6). A sibling file, not the phase-A spec, for AGENTS.md §4.5.
 *
 * The harness schedule's cadence is `monthly`, so the period the payload names
 * (it starts 2026-09-01) has the previous cadence period 2026-08-01..2026-08-31.
 * Each claim makes ONE render or finish call on a fresh harness, so every count
 * is per call.
 */

const PERIOD = { startDate: PAYLOAD.periodStart, endDate: PAYLOAD.periodEnd };
const PREVIOUS = { startDate: "2026-08-01", endDate: "2026-08-31" };

async function rejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to reject, and it resolved");
}

/** With stored `{ compare: true }`, `energyPdf` receives the period, the asset ids and the previous cadence period. */
export async function assertComparePassesThePreviousPeriodToThePdf(): Promise<void> {
  const h = harness({ schedule: schedule({ params: { compare: true } }) });
  await render(h);
  const pdf = h.reports.calls.filter((c) => c.method === "energyPdf");
  assert(
    pdf.length === 1 && JSON.stringify(pdf[0]?.query) === JSON.stringify(PERIOD) && JSON.stringify(pdf[0]?.rest) === JSON.stringify([PREVIOUS]),
    `expected one energyPdf call with the previous month as its third argument, got ${JSON.stringify(pdf)}`,
  );
}

/** With stored `{ compare: true }`, `energyXlsx` receives the previous cadence period too. */
export async function assertComparePassesThePreviousPeriodToTheXlsx(): Promise<void> {
  const h = harness({ schedule: schedule({ params: { compare: true } }) });
  await render(h);
  const xlsx = h.reports.calls.filter((c) => c.method === "energyXlsx");
  assert(
    xlsx.length === 1 && JSON.stringify(xlsx[0]?.rest) === JSON.stringify([PREVIOUS]),
    `expected one energyXlsx call with the previous month as its third argument, got ${JSON.stringify(xlsx)}`,
  );
}

/** With stored `params: null`, the renders are today's: two calls, neither with a third argument. */
export async function assertNullParamsRendersWithoutAThirdArgument(): Promise<void> {
  const h = harness();
  await render(h);
  const renders = h.reports.calls.filter((c) => c.method === "energyPdf" || c.method === "energyXlsx");
  assert(
    renders.length === 2 && renders.every((c) => c.rest.length === 0),
    `expected two renders with no third argument, got ${JSON.stringify(renders)}`,
  );
}

/** With stored `{ compare: false }`, the renders carry no third argument either. */
export async function assertCompareFalseRendersWithoutAThirdArgument(): Promise<void> {
  const h = harness({ schedule: schedule({ params: { compare: false } }) });
  await render(h);
  const renders = h.reports.calls.filter((c) => c.method === "energyPdf" || c.method === "energyXlsx");
  assert(
    renders.length === 2 && renders.every((c) => c.rest.length === 0),
    `expected two renders with no third argument, got ${JSON.stringify(renders)}`,
  );
}

/** The rendered outcome carries the parsed template, params and previous period for `finish`. */
export async function assertTheOutcomeCarriesTheCompare(): Promise<void> {
  const h = harness({ schedule: schedule({ params: { compare: true } }) });
  const outcome = await render(h);
  assert(outcome.kind === "rendered", `expected a rendered outcome, got ${outcome.kind}`);
  const carried = outcome.kind === "rendered" ? { t: outcome.templateId, p: outcome.params, q: outcome.previousPeriod } : null;
  assert(
    JSON.stringify(carried) === JSON.stringify({ t: "energy_consumption", p: { compare: true }, q: PREVIOUS }),
    `expected the outcome to carry the template, the params and the previous period, got ${JSON.stringify(carried)}`,
  );
}

/** An unknown stored `template_id` throws before any object is put or any row is written. */
export async function assertUnknownTemplateThrowsBeforeAnyPut(): Promise<void> {
  const h = harness({ schedule: schedule({ templateId: "water_balance" }) });
  const err = await rejection(() => render(h));
  assert(err instanceof Error, `expected an Error, got ${String(err)}`);
  assert(
    h.putKeys.length === 0 && h.inserted.length === 0 && h.reports.calls.length === 0,
    `expected no put, no row and no render, got puts=${h.putKeys.length} rows=${h.inserted.length} renders=${h.reports.calls.length}`,
  );
}

/** A stored `params` outside the contract throws before any object is put or any row is written. */
export async function assertMalformedParamsThrowBeforeAnyPut(): Promise<void> {
  const h = harness({ schedule: schedule({ params: { compare: "yes" } }) });
  const err = await rejection(() => render(h));
  assert(err instanceof Error, `expected an Error, got ${String(err)}`);
  assert(
    h.putKeys.length === 0 && h.inserted.length === 0 && h.reports.calls.length === 0,
    `expected no put, no row and no render, got puts=${h.putKeys.length} rows=${h.inserted.length} renders=${h.reports.calls.length}`,
  );
}

/** The positive control beside the two refusals: the default stored row puts both files. */
export async function assertTheDefaultRowPutsBothFiles(): Promise<void> {
  const h = harness();
  await render(h);
  assert(h.putKeys.length === 2 && h.inserted.length === 2, `expected two puts and two rows, got ${h.putKeys.length} and ${h.inserted.length}`);
}

/** With compare, the mail body carries "Previous period: N kWh" directly after the four summary lines. */
export async function assertCompareMailCarriesThePreviousPeriodLine(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome({ params: { compare: true }, previousPeriod: PREVIOUS }));
  const lines = (h.email.messages[0]?.body ?? "").split("\n");
  assert(lines[4] === `Previous period: ${PREVIOUS_TOTAL_KWH} kWh`, `expected the previous-period line fifth, got ${JSON.stringify(lines)}`);
}

/** With compare, the mail reads two previews: the period, then the previous period, on the same asset scope. */
export async function assertCompareMailReadsTwoPreviews(): Promise<void> {
  const h = harness();
  const outcome = renderedOutcome({ params: { compare: true }, previousPeriod: PREVIOUS });
  await h.service.finish(outcome);
  const previews = h.reports.calls.filter((c) => c.method === "energyPreview").map((c) => [c.query, c.assetIds]);
  const assetIds = outcome.kind === "rendered" ? outcome.assetIds : [];
  assert(
    JSON.stringify(previews) === JSON.stringify([[PERIOD, assetIds], [PREVIOUS, assetIds]]),
    `expected the period's preview then the previous period's, got ${JSON.stringify(previews)}`,
  );
}

/** Without compare, the mail reads one preview and carries no previous-period line. */
export async function assertNoCompareMailIsToday(): Promise<void> {
  const h = harness();
  await h.service.finish(renderedOutcome());
  const previews = h.reports.calls.filter((c) => c.method === "energyPreview");
  const body = h.email.messages[0]?.body ?? "";
  assert(
    previews.length === 1 && body.length > 0 && !body.includes("Previous period"),
    `expected one preview and no previous-period line, got ${previews.length} previews and ${JSON.stringify(body)}`,
  );
}
