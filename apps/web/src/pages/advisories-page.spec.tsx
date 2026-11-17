import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import { ADVISORY_EMPTY_SENTENCE } from "@bms/shared/contracts";
import type { AdvisoriesResponse, Advisory, FilterOptionsResponse } from "@bms/shared/contracts";
import type { UserRole } from "@bms/shared";

import * as advisoriesApi from "../api/advisories";
import * as copilotApi from "../api/copilot";
import * as filterOptionsApi from "../api/filter-options";
import * as systemStatusApi from "../api/system-status";
import { anAdvisory } from "../components/advisories/advisory-card.spec";
import { OPERATIONAL } from "../components/system-status-indicator.spec";
import { IDS, OPTIONS } from "../lib/scope-filter.spec";
import type { AuthUser } from "../stores/auth-store";
import { ADVISORIES_ERROR_SENTENCE, AdvisoriesPage } from "./advisories-page";

/**
 * `E1.6b` / ADR 0137 (plan T2.3) — the Advisories page. Assertions live here;
 * `advisories-page.test.tsx` is the Vitest entry point. Fixtures are made up.
 */
const AS_OF = "2026-11-16T10:20:00.000Z";
const ASSET_B = "33333333-3333-4333-8333-333333333333";

const TWO: Advisory[] = [
  anAdvisory(),
  anAdvisory({
    id: `${ASSET_B}:low_power_factor`,
    kind: "low_power_factor",
    confidence: "estimated",
    assetId: ASSET_B,
    assetCode: "EM-02",
    assetRtuName: null,
    headline: "Power factor averaged 0.91 over the last 7 days, below 0.95.",
  }),
];

function response(advisories: Advisory[], considered = advisories.length, candidates = considered): AdvisoriesResponse {
  return { asOf: AS_OF, candidates, considered, advisories };
}

function asUser(role: UserRole = "viewer"): AuthUser {
  return { id: "u1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser;
}

function stubShell(options: Promise<FilterOptionsResponse> = Promise.resolve(OPTIONS)): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(filterOptionsApi, "fetchFilterOptions").mockReturnValue(options);
}

function stub(answer: AdvisoriesResponse | Error | Promise<AdvisoriesResponse>) {
  stubShell();
  const spy = vi.spyOn(advisoriesApi, "fetchAdvisories");
  return answer instanceof Error
    ? spy.mockRejectedValue(answer)
    : answer instanceof Promise
      ? spy.mockReturnValue(answer)
      : spy.mockResolvedValue(answer);
}

function renderAt(entry = "/advisories"): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <AdvisoriesPage user={asUser()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

function picker(name: string): HTMLSelectElement {
  return screen.getByRole("combobox", { name }) as HTMLSelectElement;
}

/** The cards render in the server's order, under the header and the two pickers. */
export async function theCardsRenderInTheServersOrder(): Promise<void> {
  stub(response(TWO));
  renderAt();
  await waitFor(() => expect(screen.getAllByTestId("advisory-card")).toHaveLength(2));
  const headlines = screen.getAllByTestId("advisory-headline").map((el) => el.textContent);
  expect(headlines).toEqual(TWO.map((a) => a.headline));
  expect(screen.getByText("Operations · Advisories")).toBeInTheDocument();
  expect(screen.getAllByRole("combobox").map((c) => (c as HTMLSelectElement).labels?.[0]?.textContent)).toEqual([
    "Organization",
    "Location",
  ]);
  const main = screen.getByRole("main");
  expect(main.textContent ?? "").not.toMatch(/alarm/i);
}

/** The `queryFn` is a thunk: the first call is the page's filter alone, never TanStack's context. */
export async function theQueryFnIsAThunk(): Promise<void> {
  const spy = stub(response(TWO));
  renderAt();
  await waitFor(() => expect(spy).toHaveBeenCalled());
  expect(spy.mock.calls[0]).toEqual([{}]);
}

/** While the filter options are pending the read waits (`scope.ready`), and the page says loading. */
export async function theReadWaitsForTheScope(): Promise<void> {
  stubShell(new Promise(() => undefined));
  const spy = vi.spyOn(advisoriesApi, "fetchAdvisories").mockResolvedValue(response([]));
  renderAt(`/advisories?organizationId=${IDS.ORG_A}`);
  expect(await screen.findByText("Loading advisories…")).toBeInTheDocument();
  await new Promise((r) => setTimeout(r, 20));
  expect(spy).not.toHaveBeenCalled();
  expect(screen.queryByText(ADVISORY_EMPTY_SENTENCE)).toBeNull();
}

/**
 * A pending read says loading, never the empty sentence. `isPending` vs `isLoading` (mutation 16)
 * is held by `theReadWaitsForTheScope`, where the query is disabled and only `isPending` is true.
 */
export async function aPendingReadIsLoadingNotEmpty(): Promise<void> {
  stub(new Promise<AdvisoriesResponse>(() => undefined));
  renderAt();
  expect(await screen.findByText("Loading advisories…")).toBeInTheDocument();
  expect(screen.queryByText(ADVISORY_EMPTY_SENTENCE)).toBeNull();
}

/** An empty answer is the fixed empty sentence, and no card. */
export async function anEmptyAnswerSaysWhy(): Promise<void> {
  stub(response([]));
  renderAt();
  expect(await screen.findByText(ADVISORY_EMPTY_SENTENCE)).toBeInTheDocument();
  expect(screen.queryAllByTestId("advisory-card")).toEqual([]);
}

/** A failed read is one fixed sentence with `role="alert"`, and no card or empty sentence. */
export async function aFailedReadShowsOneSentence(): Promise<void> {
  stub(new Error("advisories 403"));
  renderAt();
  expect(await screen.findByRole("alert")).toHaveTextContent(ADVISORIES_ERROR_SENTENCE);
  expect(ADVISORIES_ERROR_SENTENCE).toBe("Could not load the advisories.");
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.queryByText(ADVISORY_EMPTY_SENTENCE)).toBeNull();
  expect(screen.queryAllByTestId("advisory-card")).toEqual([]);
}

/** A capped answer says "Showing 200 of N meters."; a whole one does not. */
export async function aCappedAnswerSaysSo(): Promise<void> {
  stub(response(TWO, 200, 412));
  renderAt();
  expect(await screen.findByText("Showing 200 of 412 meters.")).toBeInTheDocument();
}

export async function aWholeAnswerSaysNothingOfTheCap(): Promise<void> {
  stub(response(TWO));
  renderAt();
  await waitFor(() => expect(screen.getAllByTestId("advisory-card")).toHaveLength(2));
  expect(screen.queryByText(/^Showing \d+ of \d+ meters\.$/)).toBeNull();
}

/** A filter change reads again with `organizationId` and `locationId` only. */
export async function aFilterChangeRefetchesWithTheTwoKeys(): Promise<void> {
  const spy = stub(response(TWO));
  renderAt(`/advisories?assetGroupId=${IDS.G_A1}&assetId=${IDS.AS_A1}`);
  await waitFor(() => expect(spy).toHaveBeenCalled());
  await vi.waitFor(() => expect(picker("Organization").disabled).toBe(false));
  await userEvent.selectOptions(picker("Organization"), IDS.ORG_A);
  await vi.waitFor(() => expect(spy.mock.calls.at(-1)).toEqual([{ organizationId: IDS.ORG_A }]));
  await vi.waitFor(() => expect(picker("Location").disabled).toBe(false));
  await userEvent.selectOptions(picker("Location"), IDS.SITE_B);
  await vi.waitFor(() =>
    expect(spy.mock.calls.at(-1)).toEqual([{ organizationId: IDS.ORG_A, locationId: IDS.SITE_B }]),
  );
  for (const [filter] of spy.mock.calls) {
    expect(Object.keys(filter ?? {}).every((k) => k === "organizationId" || k === "locationId")).toBe(true);
  }
}

/** The list is read again every 15 minutes. */
export async function theListIsReadEveryFifteenMinutes(): Promise<void> {
  stub(response(TWO));
  const client = renderAt();
  await waitFor(() => expect(screen.getAllByTestId("advisory-card")).toHaveLength(2));
  const query = client.getQueryCache().find({ queryKey: ["advisories", null, null] });
  expect((query?.options as { readonly refetchInterval?: unknown } | undefined)?.refetchInterval).toBe(900_000);
}

/** Each card links its asset to its history page. */
export async function eachCardLinksItsAsset(): Promise<void> {
  stub(response(TWO));
  renderAt();
  await waitFor(() => expect(screen.getAllByTestId("advisory-card")).toHaveLength(2));
  const links = screen.getAllByTestId("advisory-card").map((c) => within(c).getByRole("link").getAttribute("href"));
  expect(links).toEqual(TWO.map((a) => `/asset-history/${a.assetId}`));
}
