import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type {
  LocationKpiSummary,
  ResolvedSiteControlRoomViewDto,
  SiteControlRoomViewNotice,
  UserRole,
} from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as controlRoomApi from "../../api/control-room";
import * as locationsApi from "../../api/locations";
import * as systemStatusApi from "../../api/system-status";
import * as vocabApi from "../../api/vocabularies";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { ApiError } from "../../lib/api-error";
import { siteViewNoticeText } from "../../lib/site-view-notice";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { ORG_A, site, USER } from "./organizations-page.spec";
import { ControlRoomSitePage } from "./site-page";

/**
 * `F3.73` plan Task 5.1 (D10, ruling Q5) — the **Make site layout** action on the site page's
 * `no_site_layout` and `dashboard_removed` notices: who sees it, what it POSTs, the resolve read
 * it invalidates, and the 409 `ambiguous` picker fed from the 409 body's candidates.
 *
 * Kept out of `site-page.spec.tsx` (870 lines before this row) for the 1000-line cap, the
 * `site-page-dashboard-retry.spec.tsx` precedent. The real page and the real
 * `MakeSiteLayoutButton` render; `makeSiteLayout` is a spy, so the wire shape and the 409 parse
 * are `api/control-room.spec.ts`'s A4–A6. `GeneratedSiteView` and `ScopedDashboardsList` are
 * mocked (their own suites). `fetch` itself is a spy and `cleanupSiteLayout` fails the case if
 * anything reached it.
 */
vi.mock("../../components/control-room/generated-site-view", () => ({
  GeneratedSiteView: ({ locationId }: { locationId: string }) => (
    <div data-testid="generated-site-view" data-location-id={locationId} />
  ),
}));

vi.mock("../../components/control-room/scoped-dashboards-list", () => ({
  ScopedDashboardsList: () => <div data-testid="scoped-dashboards-list" />,
}));

const LOCATION_ID = "p1";
const GROUP_A = "33333333-3333-4333-8333-333333333333";
const GROUP_B = "44444444-4444-4444-8444-444444444444";

const SITE: LocationKpiSummary = site({ id: LOCATION_ID, name: "Lotapata", organization: ORG_A });

function generatedWith(notice: SiteControlRoomViewNotice | null): ResolvedSiteControlRoomViewDto {
  return {
    locationId: LOCATION_ID,
    kind: "generated",
    dashboardId: null,
    dashboardSlug: null,
    builtinKey: null,
    notice,
  };
}

const MADE: controlRoomApi.MakeSiteLayoutAnswer = {
  kind: "made",
  result: {
    locationId: "11111111-1111-4111-8111-111111111111",
    dashboardId: "22222222-2222-4222-8222-222222222222",
    dashboardSlug: "site-layout-lotapata",
    omittedTabs: [],
    droppedCards: [],
    omittedTiles: [],
    resolution: [],
  },
};

const AMBIGUOUS: controlRoomApi.MakeSiteLayoutAnswer = {
  kind: "ambiguous",
  ambiguous: [
    {
      tabKey: "sld",
      domain: "electrical",
      candidates: [
        { id: GROUP_A, code: "incomer-a", name: "Incomer A" },
        { id: GROUP_B, code: "incomer-b", name: "Incomer B" },
      ],
    },
  ],
};

let fetchSpy: Mock | null = null;

/**
 * Stubs the shell reads, the KPI list and the resolve read (answers in order, the last one
 * repeated), and spies `makeSiteLayout` with `makeAnswers` in order.
 */
function stubReads(
  resolveAnswers: ResolvedSiteControlRoomViewDto[],
  makeAnswers: (controlRoomApi.MakeSiteLayoutAnswer | ApiError)[] = [],
): { resolve: Mock; make: Mock } {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  useAuthStore.setState({ scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] } });
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({
    assetDomains: [{ code: "electrical", label: "Electrical systems", sortOrder: 10, active: true }],
  } as never);
  vi.spyOn(locationsApi, "fetchLocationKpis").mockResolvedValue({ items: [SITE] });
  const resolve = vi.spyOn(controlRoomApi, "fetchResolvedSiteControlRoomView");
  for (const answer of resolveAnswers) {
    resolve.mockResolvedValueOnce(answer);
  }
  resolve.mockResolvedValue(resolveAnswers[resolveAnswers.length - 1] as ResolvedSiteControlRoomViewDto);
  const make = vi.spyOn(controlRoomApi, "makeSiteLayout");
  for (const answer of makeAnswers) {
    if (answer instanceof ApiError) {
      make.mockRejectedValueOnce(answer);
    } else {
      make.mockResolvedValueOnce(answer);
    }
  }
  return { resolve: resolve as unknown as Mock, make: make as unknown as Mock };
}

function renderPage(role: UserRole = "admin"): void {
  const user = { ...USER, role } as AuthUser;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/control-room/site/${LOCATION_ID}`]}>
        <Routes>
          <Route path="/control-room/site/:locationId/:tab?" element={<ControlRoomSitePage user={user} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BUTTON = { name: "Make site layout" } as const;

/** M1 — `no_site_layout`: the banner carries its own text, and an admin sees the button. */
export async function noSiteLayoutShowsItsTextAndTheButton(): Promise<void> {
  stubReads([generatedWith("no_site_layout")]);
  renderPage();

  const banner = await screen.findByTestId("site-view-notice");
  expect(banner.textContent).toBe("This site has no site layout yet. Showing the generated view.");
  expect(screen.getByRole("button", BUTTON)).toBeInTheDocument();
}

/** M2 — `dashboard_removed`: an admin sees the button too, beside the notice's own text. */
export async function dashboardRemovedShowsTheButton(): Promise<void> {
  stubReads([generatedWith("dashboard_removed")]);
  renderPage();

  const banner = await screen.findByTestId("site-view-notice");
  expect(banner.textContent).toBe(siteViewNoticeText("dashboard_removed"));
  expect(screen.getByRole("button", BUTTON)).toBeInTheDocument();
}

/**
 * M2b — tone: `no_site_layout` is a state, not a fault, so its box is info-toned and not
 * warning-toned; `dashboard_removed` keeps the warning tone. The text element is capped at a
 * readable measure.
 */
export async function noSiteLayoutIsInfoToneAndDashboardRemovedStaysWarning(): Promise<void> {
  stubReads([generatedWith("no_site_layout")]);
  renderPage();
  const infoBox = await screen.findByTestId("site-view-notice-box");
  expect(infoBox.className).toContain("bg-info-wash");
  expect(infoBox.className, "no_site_layout kept the warning colours").not.toContain("warning");
  expect(screen.getByTestId("site-view-notice").className).toContain("max-w-prose");
  cleanup();

  stubReads([generatedWith("dashboard_removed")]);
  renderPage();
  const warnBox = await screen.findByTestId("site-view-notice-box");
  expect(warnBox.className).toContain("bg-warning-wash");
  expect(warnBox.className).not.toContain("info");
}

/** M3 — an `operator` sees the notice and no button (the banner is the positive control). */
export async function anOperatorSeesNoButton(): Promise<void> {
  stubReads([generatedWith("no_site_layout")]);
  renderPage("operator");

  expect(await screen.findByTestId("site-view-notice")).toBeInTheDocument();
  expect(screen.queryByRole("button", BUTTON)).toBeNull();
}

/** M4 — `dashboard_out_of_scope` carries no button, even for an admin (banner as control). */
export async function anOutOfScopeNoticeHasNoButton(): Promise<void> {
  stubReads([generatedWith("dashboard_out_of_scope")]);
  renderPage();

  expect(await screen.findByTestId("site-view-notice")).toBeInTheDocument();
  expect(screen.queryByRole("button", BUTTON)).toBeNull();
}

/**
 * M5 — the click POSTs for the page's site with no choice, and a made copy invalidates the
 * page's resolve read: it is read a second time, and its new answer drops the notice.
 */
export async function aMadeCopyRereadsTheResolveRead(): Promise<void> {
  const { resolve, make } = stubReads([generatedWith("no_site_layout"), generatedWith(null)], [MADE]);
  renderPage();

  fireEvent.click(await screen.findByRole("button", BUTTON));

  await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByTestId("site-view-notice")).toBeNull());
  expect(make.mock.calls).toEqual([[LOCATION_ID, {}]]);
}

/** Clicks the button on a `no_site_layout` site whose first answer is the 409 `ambiguous`. */
async function openThePicker(): Promise<{ make: Mock; picker: HTMLElement }> {
  const { make } = stubReads([generatedWith("no_site_layout")], [AMBIGUOUS, MADE]);
  renderPage();
  fireEvent.click(await screen.findByRole("button", BUTTON));
  const picker = await screen.findByRole("group", { name: "Choose an asset group per tab" });
  return { make, picker };
}

/** M6 — a 409 `ambiguous` opens the picker: one select per tab, listing the candidates' names. */
export async function anAmbiguousAnswerOpensThePicker(): Promise<void> {
  const { picker } = await openThePicker();

  // The tab's label and the domain's vocabulary label, never the raw `sld` key or `electrical` code.
  const select = within(picker).getByRole("combobox", {
    name: "Asset group for the Electrical tab (Electrical systems)",
  });
  expect(picker.textContent, "the picker showed a raw tab key").not.toContain("sld");
  const options = within(select).getAllByRole("option");
  expect(options.map((option) => [option.textContent, (option as HTMLOptionElement).value])).toEqual([
    ["Choose a group", ""],
    ["Incomer A", GROUP_A],
    ["Incomer B", GROUP_B],
  ]);
}

/** M7 — the retry waits for a choice on every ambiguous tab (disabled until then). */
export async function theRetryWaitsForAChoice(): Promise<void> {
  const { picker } = await openThePicker();

  const retry = within(picker).getByRole("button", { name: "Make site layout with these groups" });
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(within(picker).getByRole("combobox"), { target: { value: GROUP_B } });
  expect((retry as HTMLButtonElement).disabled).toBe(false);
}

/**
 * M8 — the retry carries the CHOSEN group in `tabGroups`. The test chooses the SECOND candidate,
 * so a retry that sent the first candidate unchosen goes red.
 */
export async function theRetryCarriesTheChosenGroup(): Promise<void> {
  const { make, picker } = await openThePicker();

  fireEvent.change(within(picker).getByRole("combobox"), { target: { value: GROUP_B } });
  fireEvent.click(within(picker).getByRole("button", { name: "Make site layout with these groups" }));

  await waitFor(() => expect(make).toHaveBeenCalledTimes(2));
  expect(make.mock.calls[1]).toEqual([LOCATION_ID, { tabGroups: { sld: GROUP_B } }]);
}

/** M9 — any other refusal shows the API's sentence in an alert, and no picker. */
export async function aRefusalShowsTheApiMessage(): Promise<void> {
  const refusal = new ApiError(
    JSON.stringify({ statusCode: 409, error: "Conflict", message: "This site already has a Control Room view" }),
    409,
  );
  stubReads([generatedWith("no_site_layout")], [refusal]);
  renderPage();

  fireEvent.click(await screen.findByRole("button", BUTTON));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("This site already has a Control Room view");
  expect(screen.queryByRole("group", { name: "Choose an asset group per tab" })).toBeNull();
}

export function cleanupSiteLayout(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ scope: null });
  expect(networkCalls, "a read reached the network").toEqual([]);
}
