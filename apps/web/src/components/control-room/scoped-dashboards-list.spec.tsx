import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { DashboardSummaryDto } from "@bms/shared";

import * as dashboardsApi from "../../api/dashboards";
import { ScopedDashboardsList } from "./scoped-dashboards-list";

/**
 * `F3.72` U1, plan D7 — `ScopedDashboardsList`, the library dashboards of one Control Room
 * level: the estate (no filter), an organization, or a site (`locationId`, OQ6).
 *
 * **The whole argument tuple is the claim.** `fetchDashboards` takes four optional positional
 * strings; an organization id in the location slot compiles and a `toHaveBeenCalledWith` on one
 * argument can miss it. Every read case asserts `mock.calls[0]` in full, with distinct ids for
 * the organization and the location.
 *
 * **The Open link's organization comes from the row, not the prop.** The two rows sit in two
 * organizations, and the list is rendered with no organization at all, so a link built from
 * the prop reads `organizationId=undefined` and fails.
 *
 * Assertions live here; `scoped-dashboards-list.test.tsx` is the Vitest entry point and carries
 * the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 */

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ORG_ID = "55555555-5555-4555-8555-555555555555";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";

function dashboard(opts: { id: string; organizationId: string; slug: string; name: string }): DashboardSummaryDto {
  return {
    id: opts.id,
    organizationId: opts.organizationId,
    slug: opts.slug,
    name: opts.name,
    description: null,
    locationId: null,
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    assetCode: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    widgetCount: 1,
  };
}

const TWO_ORGS = {
  items: [
    dashboard({
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: ORG_ID,
      slug: "site-a-overview",
      name: "Site A Overview",
    }),
    dashboard({
      id: "66666666-6666-4666-8666-666666666666",
      organizationId: OTHER_ORG_ID,
      slug: "plant-energy",
      name: "Plant Energy",
    }),
  ],
};

function renderList(props: { organizationId?: string; locationId?: string }): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ScopedDashboardsList {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubList(response = TWO_ORGS) {
  return vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue(response);
}

/** The organization level reads by its organization, and nothing else. */
export async function readsTheListByTheOrganizationId(): Promise<void> {
  const spy = stubList();
  renderList({ organizationId: ORG_ID });

  expect(await screen.findByText("Site A Overview")).toBeInTheDocument();
  expect(spy.mock.calls[0]).toEqual([ORG_ID, undefined, undefined, undefined]);
}

/** The estate reads with no filter at all. */
export async function theEstateReadsWithNoOrganization(): Promise<void> {
  const spy = stubList();
  renderList({});

  expect(await screen.findByText("Site A Overview")).toBeInTheDocument();
  expect(spy.mock.calls[0]).toEqual([undefined, undefined, undefined, undefined]);
}

/** A site reads by its location id, in the location slot, beside its organization. */
export async function aSiteReadsByItsLocationId(): Promise<void> {
  const spy = stubList();
  renderList({ organizationId: ORG_ID, locationId: LOCATION_ID });

  expect(await screen.findByText("Site A Overview")).toBeInTheDocument();
  expect(spy.mock.calls[0]).toEqual([ORG_ID, undefined, undefined, LOCATION_ID]);
}

/** Each row's Open link carries that row's slug and that row's organization. */
export async function eachRowOpensTheViewerWithItsOrganization(): Promise<void> {
  stubList();
  renderList({});

  const section = (await screen.findByText("Site A Overview")).closest("section") as HTMLElement;
  expect(section, "the list is not inside a SectionCard").not.toBeNull();
  const hrefs = within(section)
    .getAllByRole("link", { name: "Open" })
    .map((link) => link.getAttribute("href"));
  expect(hrefs).toEqual([
    `/dashboards/site-a-overview?organizationId=${ORG_ID}`,
    `/dashboards/plant-energy?organizationId=${OTHER_ORG_ID}`,
  ]);
}

/** An empty list is its own sentence, inside the "Dashboards" card. */
export async function anEmptyListShowsTheSentence(): Promise<void> {
  stubList({ items: [] });
  renderList({ organizationId: ORG_ID });

  const sentence = await screen.findByText("No dashboards for this scope.");
  const section = sentence.closest("section") as HTMLElement;
  expect(within(section).getByRole("heading", { name: "Dashboards" })).toBeInTheDocument();
  expect(within(section).queryByRole("link")).toBeNull();
}

/** A failed read shows the unavailable line, not the empty sentence. */
export async function aFailedReadShowsUnavailable(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockRejectedValue(new Error("dashboards 503"));
  renderList({ organizationId: ORG_ID });

  expect(await screen.findByText("Dashboards unavailable.")).toBeInTheDocument();
  expect(screen.queryByText("No dashboards for this scope.")).toBeNull();
}

/** While the read is pending: the loading line, and neither the empty sentence nor a row. */
export async function aPendingReadShowsTheLoadingLine(): Promise<void> {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockReturnValue(new Promise(() => undefined));
  renderList({ organizationId: ORG_ID });

  expect(await screen.findByText("Loading dashboards…")).toBeInTheDocument();
  expect(screen.queryByText("No dashboards for this scope.")).toBeNull();
}

export function cleanupList(): void {
  cleanup();
  vi.restoreAllMocks();
}
