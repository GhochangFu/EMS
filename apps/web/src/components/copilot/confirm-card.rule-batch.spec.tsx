import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { CopilotPendingChangeDto } from "@bms/shared";
import { catalogEntry, RULE_LIVE_LINE } from "@bms/shared/copilot";

import { ConfirmCard } from "./confirm-card";

/**
 * `F4.289` (ADR 0099 Amendment 9 E3; owner rulings P2, 2026-10-29) — a batch
 * rule card: one table row per proposed rule with the server's check beside it,
 * a checkbox per row, and a red card. Confirm sends every stored rule and the
 * unticked indexes as `excludedRows`. The card calls the real executor; `fetch`
 * is stubbed and read (an unstubbed fetch reaches `:4000`). Vitest entry point:
 * the sibling `.test.tsx` (jsdom).
 */

const ASSET = "77777777-7777-4777-8777-777777777777";
const RULE = {
  name: "Supply high",
  ruleType: "threshold",
  assetId: ASSET,
  pointKey: "supply_temp_c",
  operator: "gt",
  thresholdValue: 12,
  severity: "warning",
  condition: { window: "latest" },
  action: { type: "notify", target: "Operations" },
};
const RULES = [RULE, { ...RULE, name: "Return high", pointKey: "return_temp_c", thresholdValue: 18 }, { ...RULE, name: "Flow low", pointKey: "flow_lps", operator: "lt", thresholdValue: 2 }];
const CHECK = { assetCode: "CH-01", operator: "gt", severity: "warning", buckets: 10_080 };
const CHECKS = [
  { ...CHECK, row: 1, pointKey: "supply_temp_c", thresholdValue: 12, matchNow: "no", firings: 0 },
  { ...CHECK, row: 2, pointKey: "return_temp_c", thresholdValue: 18, matchNow: "yes", firings: 4 },
  { ...CHECK, row: 3, pointKey: "flow_lps", operator: "lt", thresholdValue: 2, matchNow: "no sample", firings: null },
];

function batchChange(checks: unknown = CHECKS): CopilotPendingChangeDto {
  const entry = catalogEntry("rule.createBatch")!;
  return {
    id: "88888888-8888-4888-8888-888888888888",
    catalogId: "rule.createBatch",
    method: "POST",
    path: "/api/v1/rules/batch",
    body: { rules: RULES, checks },
    summary: entry.summary({ body: { rules: RULES }, params: {}, targetName: "Org X", organizationName: "Org X" }),
    risk: "create",
    proposedAt: "2026-10-29T10:00:00.000Z",
    expiresAt: "2026-10-29T10:15:00.000Z",
    ifMatch: null,
  };
}

/** Renders the card with `fetch` stubbed; returns the sent bodies, parsed. */
function renderCard(change: CopilotPendingChangeDto = batchChange()): unknown[] {
  const sent: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ items: [] }), { status: 201 });
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ConfirmCard change={change} onApplied={() => {}} onRejected={() => {}} onGone={() => {}} onRouteFailed={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return sent;
}

const table = () => screen.getByRole("table", { name: "Proposed rules" });
const bodyRows = () => within(table()).getAllByRole("row").slice(1);
const confirmButton = () => screen.getByRole("button", { name: "Confirm" });

/** Every row is listed with its check, and every box starts ticked. */
export function theTableListsEveryRowWithItsCheckAndTicksAll(): void {
  renderCard();
  const rows = bodyRows();
  expect(rows).toHaveLength(3);
  const cells = within(rows[1]!).getAllByRole("cell").map((cell) => cell.textContent);
  expect(cells.slice(0, 8)).toEqual(["2", "CH-01", "return_temp_c", "gt", "18", "warning", "yes", "4"]);
  expect([0, 1, 2].map((index) => (screen.getByTestId(`copilot-rule-row-${index}`) as HTMLInputElement).checked)).toEqual([true, true, true]);
}

/** Unticking row 2 sends every stored rule and `excludedRows: [1]`, and never the card-only checks. */
export async function untickingARowSendsItsIndexAndKeepsEveryRule(): Promise<void> {
  const sent = renderCard();
  fireEvent.click(screen.getByTestId("copilot-rule-row-1"));
  fireEvent.click(confirmButton());
  await waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toEqual({ rules: RULES, excludedRows: [1] });
}

/** With every row unticked there is nothing to create: Confirm is disabled. */
export function untickingEveryRowDisablesConfirm(): void {
  renderCard();
  fireEvent.click(screen.getByTestId("copilot-rule-row-0"));
  fireEvent.click(screen.getByTestId("copilot-rule-row-1"));
  expect((confirmButton() as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByTestId("copilot-rule-row-2"));
  expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
}

/** A `checks` value that is not a list still lists every rule from its own fields, with a dash for the computed cells. */
export function aMalformedChecksValueStillListsTheRules(): void {
  renderCard(batchChange("x"));
  const rows = bodyRows();
  expect(rows).toHaveLength(3);
  const cells = within(rows[1]!).getAllByRole("cell").map((cell) => cell.textContent);
  expect(cells.slice(0, 8)).toEqual(["2", "—", "return_temp_c", "gt", "18", "warning", "—", "—"]);
}

/** Ruling P2: the card is red although its risk is `create`, and its summary carries D3's live line. */
export function theBatchCardIsRedAndCarriesTheLiveLine(): void {
  renderCard();
  const card = screen.getByRole("region", { name: "Create and publish alarm rules" });
  expect(card.getAttribute("data-risk")).toBe("create");
  expect(card.className).toContain("border-critical-line");
  expect(card.textContent).toContain(RULE_LIVE_LINE);
}

/** `excludedRows` is a client-only field with no box: no password input, and the rows are not a field row. */
export function noPasswordBoxIsShownForExcludedRows(): void {
  renderCard();
  const card = screen.getByRole("region", { name: "Create and publish alarm rules" });
  expect(card.querySelector('input[type="password"]')).toBeNull();
  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect((confirmButton() as HTMLButtonElement).disabled).toBe(false);
}
