import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { expect, vi } from "vitest";

import type { RuleListItem } from "@bms/shared";
import { RULE_LIVE_LINE } from "@bms/shared/copilot";

import { RuleLifecycleWizard } from "./rule-lifecycle-wizard";
import { RuleToggleWizard } from "./rule-toggle-wizard";

/**
 * `F4.278` (ADR 0099 decision 6, Amendment 8 D3) — the Rule Engine card's
 * lifecycle wizards. The fetch stub records each request, so the method, path,
 * body and headers of a Submit are read from what was sent. Vitest entry point:
 * the sibling `.test.tsx` (jsdom docblock there).
 */

const RULE: RuleListItem = {
  id: "44444444-4444-4444-8444-444444444444",
  code: "CHILLER_HIGH",
  name: "Chiller high",
  description: null,
  category: "hvac",
  ruleType: "threshold",
  source: "operator_rule",
  enabled: true,
  assetId: "55555555-5555-4555-8555-555555555555",
  assetCode: "CH-01",
  assetName: "Chiller 1",
  siteName: "West Campus",
  assetDomain: "hvac",
  pointKey: "supply_temp_c",
  operator: "gt",
  thresholdValue: 3,
  severity: "warning",
  clearHoldSeconds: null,
  lifecycleStatus: "published",
  condition: { window: "latest" },
  action: { type: "notify", target: "Operations" },
  lastEvaluatedAt: null,
  publishedAt: new Date(0).toISOString(),
  archivedAt: null,
  duplicatedFromRuleId: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

type Sent = { url: string; init: RequestInit };

function stubFetch(): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response(JSON.stringify({ ...RULE, enabled: false }), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return sent;
}

function renderIt(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** The disable wizard is the Review step alone, and its card is red. */
export async function theDisableReviewCardIsRed(): Promise<void> {
  stubFetch();
  renderIt(<RuleToggleWizard rule={RULE} onCancel={() => {}} onDone={() => {}} />);
  const card = await screen.findByRole("region", { name: "Disable an alarm rule" });
  expect(card.getAttribute("data-risk")).toBe("deactivate");
}

/** The publish wizard's Review shows D3's live line. */
export async function thePublishReviewShowsTheLiveLine(): Promise<void> {
  stubFetch();
  renderIt(<RuleLifecycleWizard rule={{ ...RULE, lifecycleStatus: "draft" }} action="publish" onCancel={() => {}} onDone={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: "Next" }));
  expect(await screen.findByText(new RegExp(RULE_LIVE_LINE.replace(".", "\.")))).toBeInTheDocument();
}

/** Submit sends `PATCH /api/v1/rules/:id/enabled` with `{ "enabled": false }`, and no `X-Copilot-Change` header. */
export async function theDisableSubmitSendsThePlainRequest(): Promise<void> {
  const sent = stubFetch();
  renderIt(<RuleToggleWizard rule={RULE} onCancel={() => {}} onDone={() => {}} />);
  await userEvent.click(await screen.findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(sent).toHaveLength(1));
  const [request] = sent;
  expect(request?.url).toMatch(new RegExp(`/api/v1/rules/${RULE.id}/enabled$`));
  expect(request?.init.method).toBe("PATCH");
  expect(JSON.parse(String(request?.init.body))).toEqual({ enabled: false });
  const headers = new Headers(request?.init.headers);
  expect(headers.has("X-Copilot-Change")).toBe(false);
}
