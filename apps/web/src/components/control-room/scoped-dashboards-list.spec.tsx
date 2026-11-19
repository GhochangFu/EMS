import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { DashboardDto, DashboardSummaryDto } from "@bms/shared";

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

function dashboard(opts: {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  locationId?: string | null;
}): DashboardSummaryDto {
  return {
    id: opts.id,
    organizationId: opts.organizationId,
    slug: opts.slug,
    name: opts.name,
    description: null,
    locationId: opts.locationId ?? null,
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    assetCode: null,
    assetRtuName: null,
    assetLocationName: null,
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

function renderList(props: { organizationId?: string; locationId?: string; omitTemplateCopies?: boolean }): void {
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

/**
 * The key carries `locationId`: on ONE `QueryClient`, the organization's list and a site's list
 * are two cache entries. With the location out of the key the site would show the
 * organization's cached rows at once (a mount refetch would still make the call, so the call
 * count alone cannot gate it): the site's read is held pending, so its loading line must show
 * and the organization's row must not.
 */
export async function theKeyCarriesTheLocationId(): Promise<void> {
  const spy = vi
    .spyOn(dashboardsApi, "fetchDashboards")
    .mockResolvedValueOnce(TWO_ORGS)
    .mockReturnValueOnce(new Promise(() => undefined));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (props: { organizationId?: string; locationId?: string }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ScopedDashboardsList {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const { rerender } = render(tree({ organizationId: ORG_ID }));
  expect(await screen.findByText("Site A Overview")).toBeInTheDocument();

  rerender(tree({ organizationId: ORG_ID, locationId: LOCATION_ID }));

  expect(await screen.findByText("Loading dashboards…")).toBeInTheDocument();
  expect(screen.queryByText("Site A Overview"), "the organization's rows reached the site").toBeNull();
  expect(spy).toHaveBeenCalledTimes(2);
  expect(spy.mock.calls[0]).toEqual([ORG_ID, undefined, undefined, undefined]);
  expect(spy.mock.calls[1]).toEqual([ORG_ID, undefined, undefined, LOCATION_ID]);
}

/*
 * `F4.240` part b (ADR 0140 decision 3h, plan Task 1.5, owner ruling Q1 (a)) — `omitTemplateCopies`
 * leaves out a dashboard scoped at the location whose detail carries a `templateId` (the station's
 * old site-layout copy). The list DTO has no template stamp, so each row scoped at the location is
 * detail-read, under the viewer's own key. The names are chosen so a name rule would keep the
 * copy and drop the other row: the copy is "Daily Ops", the kept row "Station Overview".
 */

const COPY = dashboard({
  id: "77777777-7777-4777-8777-777777777777",
  organizationId: ORG_ID,
  slug: "daily-ops",
  name: "Daily Ops",
  locationId: LOCATION_ID,
});
const OWN = dashboard({
  id: "88888888-8888-4888-8888-888888888888",
  organizationId: ORG_ID,
  slug: "station-overview",
  name: "Station Overview",
  locationId: LOCATION_ID,
});
const GROUP_SCOPED = dashboard({
  id: "99999999-9999-4999-8999-999999999999",
  organizationId: ORG_ID,
  slug: "group-energy",
  name: "Group Energy",
});

/** A detail read that answers `templateId` per slug; a slug mapped to `"error"` rejects. */
function stubDetails(templateIds: Record<string, string | null | "error" | "pending">) {
  return vi.spyOn(dashboardsApi, "fetchDashboard").mockImplementation((slug: string) => {
    const templateId = templateIds[slug];
    if (templateId === "error") {
      return Promise.reject(new Error("dashboards/:slug 503"));
    }
    if (templateId === "pending") {
      return new Promise<DashboardDto>(() => undefined);
    }
    return Promise.resolve({ templateId: templateId ?? null } as unknown as DashboardDto);
  });
}

function rowNames(): string[] {
  return Array.from(document.querySelectorAll("li > span")).map((span) => span.textContent ?? "");
}

/** D1 — with `omitTemplateCopies`, the row whose detail carries a `templateId` is left out. */
export async function omitsTheTemplateCopy(): Promise<void> {
  stubList({ items: [COPY, OWN] });
  const details = stubDetails({ "daily-ops": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "station-overview": null });
  renderList({ organizationId: ORG_ID, locationId: LOCATION_ID, omitTemplateCopies: true });

  expect(await screen.findByText("Station Overview")).toBeInTheDocument();
  expect(rowNames()).toEqual(["Station Overview"]);
  expect(details.mock.calls.map((call) => call.slice(0, 2))).toEqual(
    expect.arrayContaining([
      ["daily-ops", ORG_ID],
      ["station-overview", ORG_ID],
    ]),
  );
}

/**
 * D1b — the detail read shares `SiteDashboardView`'s key (`["dashboards","detail",slug,org]`): a
 * detail already in that cache entry decides the row, and no detail read is made for it. The
 * client's `staleTime` is `Infinity` so a mount does not refetch the seeded entry; the stub answers
 * `templateId: null`, so a read under any other key would list the copy.
 */
export async function aCachedDetailUnderTheViewersKeyDecidesTheRow(): Promise<void> {
  stubList({ items: [COPY, OWN] });
  const details = stubDetails({ "daily-ops": null, "station-overview": null });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(["dashboards", "detail", COPY.slug, ORG_ID], {
    templateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  } as unknown as DashboardDto);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ScopedDashboardsList organizationId={ORG_ID} locationId={LOCATION_ID} omitTemplateCopies />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText("Station Overview")).toBeInTheDocument();
  expect(rowNames()).toEqual(["Station Overview"]);
  expect(details.mock.calls.map((call) => call[0])).not.toContain(COPY.slug);
}

/** D2 — without the prop both rows are listed and no detail is read (D1's control). */
export async function withoutThePropEveryRowIsListed(): Promise<void> {
  stubList({ items: [COPY, OWN] });
  const details = stubDetails({ "daily-ops": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "station-overview": null });
  renderList({ organizationId: ORG_ID, locationId: LOCATION_ID });

  expect(await screen.findByText("Station Overview")).toBeInTheDocument();
  expect(rowNames()).toEqual(["Daily Ops", "Station Overview"]);
  expect(details).not.toHaveBeenCalled();
}

/** D3 — a failed detail read keeps its row. */
export async function aFailedDetailReadKeepsItsRow(): Promise<void> {
  stubList({ items: [COPY, OWN] });
  stubDetails({ "daily-ops": "error", "station-overview": null });
  renderList({ organizationId: ORG_ID, locationId: LOCATION_ID, omitTemplateCopies: true });

  expect(await screen.findByText("Daily Ops")).toBeInTheDocument();
  expect(rowNames()).toEqual(["Daily Ops", "Station Overview"]);
}

/** D4 — a row not scoped at the location (`locationId: null`) is listed and never detail-read. */
export async function aRowNotScopedAtTheLocationIsNotDetailRead(): Promise<void> {
  stubList({ items: [GROUP_SCOPED, OWN] });
  const details = stubDetails({ "station-overview": null });
  renderList({ organizationId: ORG_ID, locationId: LOCATION_ID, omitTemplateCopies: true });

  expect(await screen.findByText("Group Energy")).toBeInTheDocument();
  expect(rowNames()).toEqual(["Group Energy", "Station Overview"]);
  expect(details.mock.calls.map((call) => call[0])).toEqual(["station-overview"]);
}

/** D5 — while a detail read is pending, the loading line shows and no row. */
export async function aPendingDetailReadShowsTheLoadingLine(): Promise<void> {
  stubList({ items: [COPY, OWN] });
  const details = stubDetails({ "daily-ops": "pending", "station-overview": null });
  renderList({ organizationId: ORG_ID, locationId: LOCATION_ID, omitTemplateCopies: true });

  // A detail read only starts once the list has answered, so the list is settled here.
  await waitFor(() => expect(details).toHaveBeenCalledTimes(2));
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByText("Loading dashboards…")).toBeInTheDocument();
  expect(rowNames()).toEqual([]);
}

export function cleanupList(): void {
  cleanup();
  vi.restoreAllMocks();
}
