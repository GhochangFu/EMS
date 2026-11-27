import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import { ADVISORY_EMPTY_SENTENCE } from "@bms/shared/contracts";
import type { AdvisoriesResponse, Advisory } from "@bms/shared/contracts";

import * as advisoriesApi from "../../api/advisories";
import { anAdvisory, FIXTURE_ASSET } from "./advisory-card.spec";
import { AssetAdvisoriesSection } from "./asset-advisories-section";

/**
 * `E1.6b` / ADR 0137 (plan T2.5, R-l) — the advisories section of the asset history page: the
 * asset's cards under a heading "Advisories", without the asset link; nothing at all when there is
 * no advisory or the read fails. Entry point: `asset-advisories-section.test.tsx` (ADR 0014).
 */
function answer(advisories: Advisory[]): AdvisoriesResponse {
  return { asOf: "2026-11-16T10:20:00.000Z", candidates: 1, considered: 1, advisories };
}

function renderSection(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AssetAdvisoriesSection assetId={FIXTURE_ASSET} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** One advisory: the heading, its card, and no asset link (the page is the asset's own). */
export async function oneAdvisoryShowsItsCard(): Promise<void> {
  const a = anAdvisory();
  const spy = vi.spyOn(advisoriesApi, "fetchAssetAdvisories").mockResolvedValue(answer([a]));
  renderSection();
  const section = await screen.findByRole("region", { name: "Advisories" });
  expect(within(section).getByTestId("advisory-headline").textContent).toBe(a.headline);
  expect(within(section).queryByRole("link")).toBeNull();
  expect(spy.mock.calls).toEqual([[FIXTURE_ASSET]]);
}

/** No advisory: no heading, no empty sentence, nothing drawn. */
export async function noAdvisoryDrawsNothing(): Promise<void> {
  const spy = vi.spyOn(advisoriesApi, "fetchAssetAdvisories").mockResolvedValue(answer([]));
  renderSection();
  await waitFor(() => expect(spy).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByRole("heading", { name: "Advisories" })).toBeNull();
  expect(screen.queryByText(ADVISORY_EMPTY_SENTENCE)).toBeNull();
}

/**
 * A failed read, settled: no heading, no banner, no alert. A 500 is retried twice (1 s, then 2 s,
 * `retryUnlessForbidden`), so the case waits for the third call before it looks; asserting after
 * the first call would only see the loading state (E1.6b code review).
 */
export async function aFailedReadDrawsNothing(): Promise<void> {
  const spy = vi.spyOn(advisoriesApi, "fetchAssetAdvisories").mockRejectedValue(new Error("asset advisories 500"));
  renderSection();
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(3), { timeout: 6_000 });
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByRole("heading", { name: "Advisories" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(document.body.textContent ?? "").not.toMatch(/advisor/i);
}
