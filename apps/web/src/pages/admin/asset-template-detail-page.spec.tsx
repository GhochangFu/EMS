import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AdminAssetTemplateDto } from "@bms/shared";

import * as api from "../../api/admin/asset-templates";
import * as locationsApi from "../../api/admin/locations";
import * as orgApi from "../../api/admin/organizations";
import * as rtusApi from "../../api/admin/rtus";
import * as vocabApi from "../../api/vocabularies";
import type { AuthUser } from "../../stores/auth-store";
import { AssetTemplateDetailPage } from "./asset-template-detail-page";
import * as copilotApi from "../../api/copilot";

/**
 * `F3.2` — the asset-template detail page's two new surfaces (ADR 0067
 * decision 7, Q5), rendered (ADR 0042). The first `.spec.tsx` for this page;
 * model: `dashboard-template-detail-page.spec.tsx`.
 *
 * Assertions live here; `asset-template-detail-page.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock, because
 * that is the file Vitest collects (ADR 0014, ADR 0042 decision 2).
 *
 * **What these cases gate that nothing cheaper can.** The *wording* of both
 * sentences is `lib/default-dashboards-report.spec.ts`'s, and the badge is
 * `dashboards-page.spec.tsx`'s. What is only provable by rendering this page
 * is the **gate on the button** — published AND a role that may author — and
 * that the instantiate dialog stops closing on success. Plan §9 listed both as
 * browser-only claims; they are not, and this file is the cheaper gate the
 * browser pass may now skip.
 */

const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";

function asUser(role: string, email: string): AuthUser {
  return { id: "u1", email, displayName: role, role } as unknown as AuthUser;
}

/** `canAuthorTemplates` admits `admin`; ADR 0038 decision 10 refuses `location_admin`. */
const admin = asUser("admin", "admin@bms.local");
const locationAdmin = asUser("location_admin", "wc-admin@bms.local");

function draftTemplate(): AdminAssetTemplateDto {
  return {
    id: TEMPLATE_ID,
    organizationId: ORG_ID,
    organizationCode: "IX",
    organizationName: "Ion Exchange",
    code: "electrical-feeder",
    version: 1,
    name: "Feeder",
    assetType: "feeder",
    domain: "electrical",
    description: null,
    status: "draft",
    content: { contentVersion: 1 },
    publishedAt: null,
    archivedAt: null,
    stockCode: null,
    stockVersion: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    points: [],
  } as unknown as AdminAssetTemplateDto;
}

function publishedTemplate(): AdminAssetTemplateDto {
  return {
    ...draftTemplate(),
    status: "published",
    publishedAt: new Date(0).toISOString(),
  } as unknown as AdminAssetTemplateDto;
}

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
  dashboardSections: [],
  waterBalanceRoles: [],
};

/**
 * Everything the chrome and the default (Details) tab fetch. The page opens on
 * `details` — `resolveTemplateTab(null)` — so `fetchVocabularies` is reached on
 * every render here, and the instantiate dialog's `HierarchyFilterBar` reaches
 * the other three.
 */
function stubApi(overrides: Partial<Record<string, unknown>> = {}): void {
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [{ id: ORG_ID, code: "IX", name: "Ion Exchange", active: true }],
  } as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({
    items: [{ id: LOCATION_ID, name: "West Campus", organizationId: ORG_ID, active: true }],
  } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [] } as never);
  for (const [name, impl] of Object.entries(overrides)) {
    vi.spyOn(api, name as keyof typeof api).mockImplementation(impl as never);
  }
}

function renderPage(user: AuthUser): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/asset-templates/${TEMPLATE_ID}`]}>
        <Routes>
          <Route
            path="/admin/asset-templates/:templateId"
            element={<AssetTemplateDetailPage user={user} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BACKFILL_RESULT = {
  templateId: TEMPLATE_ID,
  templateCode: "electrical-feeder",
  templateVersion: 1,
  assets: [
    {
      assetId: "44444444-4444-4444-8444-444444444444",
      code: "TX-01",
      outcome: "created",
      dashboards: [
        {
          slug: "tx-01-overview",
          view: "overview",
          widgetCount: 3,
          boundPoints: 5,
          omittedFeatured: 0,
          resolutions: [],
        },
      ],
    },
    {
      assetId: "44444444-4444-4444-8444-444444444445",
      code: "TX-02",
      outcome: "skipped_existing",
      dashboards: [],
    },
  ],
  createdCount: 1,
  skippedCount: 1,
  conflictCount: 0,
};

/**
 * Q8's third outcome, on its own fixture: three assets, one of each state.
 *
 * Separate from {@link BACKFILL_RESULT} rather than added to it, because that
 * fixture is the one the summary-sentence case matches whole — a third asset
 * would change the counts in that sentence and grade two rules in one case.
 */
const BACKFILL_WITH_CONFLICT = {
  ...BACKFILL_RESULT,
  assets: [
    ...BACKFILL_RESULT.assets,
    {
      assetId: "44444444-4444-4444-8444-444444444446",
      code: "TX-03",
      outcome: "skipped_slug_conflict",
      dashboards: [],
    },
  ],
  conflictCount: 1,
};

/**
 * The action exists on a published version for a role that may author — ADR
 * 0067 decision 7. Asserted by its accessible name, which is also the string
 * the browser pass matches.
 */
export async function publishedVersionOffersCreateDefaultDashboards(): Promise<void> {
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()) });
  renderPage(admin);

  expect(
    await screen.findByRole("button", { name: "Create default dashboards" }),
  ).toBeInTheDocument();
}

/**
 * A draft does not. The route 409s on a draft (decision 4), so offering the
 * button there would be an affordance whose only outcome is an error banner.
 *
 * The positive control is inside this case: the draft's own Publish button is
 * asserted present, so a fixture that failed to load — which would make every
 * absence assertion pass vacuously — reddens here.
 */
export async function draftDoesNotOfferCreateDefaultDashboards(): Promise<void> {
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(draftTemplate()) });
  renderPage(admin);

  expect(await screen.findByRole("button", { name: "Publish" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Create default dashboards" }),
  ).not.toBeInTheDocument();
}

/**
 * The half of the gate that is about the role rather than the status.
 * `assertCanAuthor` refuses a `location_admin` server-side, and ADR 0038
 * decision 10 makes authoring **role-hidden** here rather than merely refused.
 *
 * Positive control: the same published version renders the read-only notice
 * for this role, so the page is loaded when the absence is asserted.
 */
export async function locationAdminIsNotOfferedCreateDefaultDashboards(): Promise<void> {
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()) });
  renderPage(locationAdmin);

  expect(await screen.findByText(/This version is read-only/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Create default dashboards" }),
  ).not.toBeInTheDocument();
}

/**
 * Decision 5's report reaches the screen: the summary sentence, and one row per
 * asset the backfill considered — the skipped one included, which is what makes
 * a `createdCount 0` second call readable.
 */
export async function theBackfillReportRendersASummaryAndARowPerAsset(): Promise<void> {
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    createDefaultDashboardsFromAdminAssetTemplate: () => Promise.resolve(BACKFILL_RESULT),
  });
  renderPage(admin);

  const button = await screen.findByRole("button", { name: "Create default dashboards" });
  await userEvent.click(button);

  expect(
    await screen.findByText("Created dashboards for 1 asset · 1 already had one"),
  ).toBeInTheDocument();
  expect(screen.getByText("TX-01")).toBeInTheDocument();
  expect(screen.getByText("TX-02")).toBeInTheDocument();
  expect(screen.getByText(/tx-01-overview · 3 widgets · 5 points/)).toBeInTheDocument();
  expect(screen.getByText("Already had one")).toBeInTheDocument();
}

/**
 * Q8 — the third outcome renders as **Slug taken**, not as "Already had one".
 *
 * The cell used to be a binary ternary, so a third outcome fell to the `else`
 * arm and told an operator the asset already had its dashboards while a
 * hand-made row was blocking them. It typechecked, which is why this case
 * exists rather than a type.
 *
 * The two other cells are asserted in the same case as the positive controls
 * on the three-way: a cell that printed "Slug taken" for everything would pass
 * the first assertion alone.
 */
export async function theBackfillReportNamesASlugConflictRow(): Promise<void> {
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    createDefaultDashboardsFromAdminAssetTemplate: () =>
      Promise.resolve(BACKFILL_WITH_CONFLICT),
  });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Create default dashboards" }));

  expect(await screen.findByText("Slug taken")).toBeInTheDocument();
  expect(screen.getByText("Created")).toBeInTheDocument();
  expect(screen.getByText("Already had one")).toBeInTheDocument();
}

/** Q8 — the summary sentence carries the collision clause on the same result. */
export async function theBackfillSummaryNamesTheSlugCollision(): Promise<void> {
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    createDefaultDashboardsFromAdminAssetTemplate: () =>
      Promise.resolve(BACKFILL_WITH_CONFLICT),
  });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Create default dashboards" }));

  expect(
    await screen.findByText("Created dashboards for 1 asset · 1 already had one · 1 slug collision"),
  ).toBeInTheDocument();
}

/**
 * ADR 0067 decisions 3 and 5 — a view whose `featured` list was cut by the
 * `MAX_DASHBOARD_WIDGETS` fallback cap says so.
 *
 * The fixture carries **two** views on one asset: one truncated, one not. The
 * truncated row is the positive control sitting beside the absence check, so
 * "the word `omitted` is not on the intact row" cannot pass because the table
 * failed to render at all. Both assertions are scoped to their own `<li>` —
 * a page-wide `queryByText(/omitted/)` would find the truncated row and prove
 * nothing about its sibling.
 */
export async function aTruncatedViewNamesItsOmittedCount(): Promise<void> {
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    createDefaultDashboardsFromAdminAssetTemplate: () =>
      Promise.resolve({
        ...BACKFILL_RESULT,
        assets: [
          {
            ...BACKFILL_RESULT.assets[0]!,
            dashboards: [
              {
                slug: "tx-01-overview",
                view: "overview",
                widgetCount: 40,
                boundPoints: 40,
                omittedFeatured: 10,
                resolutions: [],
              },
              {
                slug: "tx-01-trends",
                view: "trends",
                widgetCount: 2,
                boundPoints: 2,
                omittedFeatured: 0,
                resolutions: [],
              },
            ],
          },
        ],
      }),
  });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Create default dashboards" }));

  expect(await screen.findByText(/tx-01-overview/)).toHaveTextContent("10 omitted");
  expect(screen.getByText(/tx-01-trends/)).not.toHaveTextContent("omitted");
}

/**
 * ADR 0067 Q5 — the dialog stays open on success, prints the four counts, and
 * offers Close.
 *
 * The three assertions after the sentence are the ones that make this more than
 * a wording check: **Build is gone**, so the result state cannot be clicked
 * into a second batch of assets (the affordance that did not exist while the
 * dialog closed on success), and Close is present, so the dialog is escapable.
 */
export async function theInstantiateDialogStaysOpenAndShowsTheSummary(): Promise<void> {
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    instantiateFromAdminAssetTemplate: () =>
      Promise.resolve({
        templateId: TEMPLATE_ID,
        templateCode: "electrical-feeder",
        templateVersion: 1,
        locationId: LOCATION_ID,
        rtuId: null,
        sourceKind: "unmapped",
        assets: [],
        assetCount: 2,
        pointCount: 8,
        ruleCount: 3,
        disabledRuleCount: 1,
        dashboardCount: 2,
      }),
  });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));

  // `HierarchyFilterBar` renders its selects unlabelled, and the Details tab
  // behind the dialog renders comboboxes of its own — taking "the first
  // combobox" found the domain picker instead. The location select is the one
  // holding the location's own option, so it is reached through that.
  const locationOption = await screen.findByRole("option", { name: "West Campus" });
  await userEvent.selectOptions(locationOption.closest("select")!, LOCATION_ID);
  await userEvent.type(screen.getByLabelText("Asset 1 code"), "TX-01");
  await userEvent.click(screen.getByRole("button", { name: /^Build 1 asset$/ }));

  expect(
    await screen.findByText("Built 2 assets · 8 points · 3 rules · 2 dashboards"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Build/ })).not.toBeInTheDocument();
}

/**
 * Review (code) — a running backfill disables the OTHER actions on this page.
 *
 * `busy` is the page's one "an action is in flight" flag and it listed four
 * mutations, not five: the backfill was missing, so while it ran every
 * lifecycle button stayed live. Archiving or drafting a version mid-backfill is
 * exactly the race the flag exists to prevent — the backfill writes across
 * every location of the organization from the version it started with.
 *
 * Asserted on **Archive**, never on the backfill button itself: that one
 * already carried `|| defaultDashboardsM.isPending` of its own, so it is
 * disabled with or without this fix and would prove nothing. The enabled
 * assertion before the click is the positive control — without it, a render
 * that failed to reach the actions at all would pass the disabled assertion.
 */
export async function aRunningBackfillDisablesTheLifecycleActions(): Promise<void> {
  let release: (() => void) | undefined;
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    createDefaultDashboardsFromAdminAssetTemplate: () =>
      new Promise((resolve) => {
        release = () => resolve(BACKFILL_RESULT);
      }),
  });
  renderPage(admin);

  expect(await screen.findByRole("button", { name: "Archive" })).toBeEnabled();

  await userEvent.click(await screen.findByRole("button", { name: "Create default dashboards" }));

  expect(
    await screen.findByRole("button", { name: "Creating default dashboards…" }),
    "the backfill must report itself as running",
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Archive" }),
    "a lifecycle action must not stay clickable while the backfill runs — " +
      "defaultDashboardsM.isPending belongs in `busy`",
  ).toBeDisabled();

  release?.();
  await screen.findByText("Created dashboards for 1 asset · 1 already had one");
}

/**
 * `F4.168` B6 arrange — a published template; Archive is clicked, its Review
 * submitted (`F4.254` PR 2: Archive opens the `assetTemplate.archive` wizard)
 * and `archiveM` held pending. Resolves with the button once "Archiving…" shows.
 */
async function archiveHeldPending(): Promise<HTMLElement> {
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    archiveAdminAssetTemplate: () => new Promise(() => {}),
  });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Archive" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  return screen.findByRole("button", { name: "Archiving…" });
}

/**
 * `F4.168` B6 — the actions map shares `busy`, but each action's own name is
 * keyed on its own mutation: Archive becomes "Archiving…", with
 * `aria-busy="true"`, while `archiveM` is pending.
 */
export async function archiveAnnouncesArchiving(): Promise<void> {
  const pending = await archiveHeldPending();
  expect(pending).toHaveAttribute("aria-busy", "true");
}

/**
 * `F4.168` B6 — "Edit this version", a sibling that CAN pend (on `draftM`),
 * keeps its name and is not busy while Archive pends. A label keyed on the
 * shared `busy` would rename it "Creating draft…".
 */
export async function editThisVersionKeepsItsNameWhileArchivePends(): Promise<void> {
  await archiveHeldPending();
  const edit = screen.getByRole("button", { name: "Edit this version" });
  expect(edit).toHaveAttribute("aria-busy", "false");
}

/** `F4.168` B6 — Instantiate, which never pends, is not busy while Archive pends. */
export async function instantiateIsNotBusyWhileArchivePends(): Promise<void> {
  await archiveHeldPending();
  expect(screen.getByRole("button", { name: "Instantiate" })).toHaveAttribute("aria-busy", "false");
}

/** `F4.168` B6 — the shared `busy` still disables Instantiate while Archive pends. */
export async function instantiateIsDisabledWhileArchivePends(): Promise<void> {
  await archiveHeldPending();
  expect(screen.getByRole("button", { name: "Instantiate" })).toBeDisabled();
}

/**
 * `F3.85` PR 11a (ADR 0099 decision 6, plan §11.3 unit 3) — **Publish** opens
 * the `assetTemplate.publish` wizard, which is Review alone (a bodyless
 * entry), and sends nothing until **Submit**. The absence (no call) sits
 * beside its positive: the wizard dialog with its Review step is on screen.
 */
export async function publishOpensTheReviewAndSendsNothing(): Promise<void> {
  const publish = vi.fn(() => Promise.resolve(publishedTemplate()));
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(draftTemplate()),
    publishAdminAssetTemplate: publish,
  });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Publish" }));

  const dialog = screen.getByRole("dialog", { name: "Publish this version" });
  expect(within(dialog).getByRole("button", { name: "Submit" })).toBeInTheDocument();
  expect(publish).not.toHaveBeenCalled();
}

/** `F3.85` PR 11a — Submit on the publish Review sends the publish for this template. */
export async function publishSubmitSendsThePublish(): Promise<void> {
  const publish = vi.fn(() => Promise.resolve(publishedTemplate()));
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(draftTemplate()),
    publishAdminAssetTemplate: publish,
  });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => {
    expect(publish).toHaveBeenCalledTimes(1);
  });
  expect(publish).toHaveBeenCalledWith(TEMPLATE_ID);
}

/**
 * `F3.85` PR 11a — the publish wizard alone sends **no** `X-Copilot-Change`
 * header (plan §10.5 as built). `publishAdminAssetTemplate` is left unspied
 * and the global `fetch` is stubbed, because the header is only observable on
 * the request. The positive comes first: the `POST …/publish` fired.
 */
export async function thePublishWizardSendsNoCopilotHeader(): Promise<void> {
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(draftTemplate()) });
  const seen: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(publishedTemplate()), { status: 200 });
  });
  try {
    renderPage(admin);

    await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => {
      expect(seen.map((request) => request.url).filter((url) => url.endsWith("/publish"))).toHaveLength(1);
    });

    const request = seen.find((candidate) => candidate.url.endsWith("/publish"));
    expect(request?.url).toMatch(new RegExp(`/api/v1/admin/asset-templates/${TEMPLATE_ID}/publish$`));
    expect(request?.init.method).toBe("POST");
    const headers = new Headers(request?.init.headers);
    expect([...headers.keys()].filter((name) => name.toLowerCase() === "x-copilot-change")).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
}

const PUBLISH_REFUSED = "Point kw is referenced by a KPI but is not declared.";

/** Publish, Submit, and the server refuses. */
async function submitARefusedPublish(): Promise<void> {
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(draftTemplate()),
    publishAdminAssetTemplate: () => Promise.reject(new Error(PUBLISH_REFUSED)),
  });
  renderPage(admin);
  await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
}

/**
 * Post-merge finding N3 — a refused Publish shows its sentence on the wizard
 * card, inside the Publish dialog. The positive half of the next case.
 */
export async function aRefusedPublishShowsTheSentenceOnTheCard(): Promise<void> {
  await submitARefusedPublish();
  const dialog = screen.getByRole("dialog", { name: "Publish this version" });
  expect(await within(dialog).findByText(PUBLISH_REFUSED)).toBeInTheDocument();
}

/**
 * N3 — and only there: the page banner behind the 30% scrim does not repeat
 * it. Before the fix `publishM`'s `onError` also set the page's action error.
 * Mutation: restore `onError: onActionError` on `publishM` => red.
 */
export async function aRefusedPublishShowsTheSentenceOnce(): Promise<void> {
  await submitARefusedPublish();
  const dialog = screen.getByRole("dialog", { name: "Publish this version" });
  await within(dialog).findByText(PUBLISH_REFUSED);
  expect(screen.getAllByText(PUBLISH_REFUSED)).toHaveLength(1);
}

/* ---------- F4.254 PR 2 — Archive and the new draft are Review-only wizards (plan §4.4, §4.5) ---------- */

function archivedTemplate(): AdminAssetTemplateDto {
  return {
    ...publishedTemplate(),
    status: "archived",
    archivedAt: new Date(0).toISOString(),
  } as unknown as AdminAssetTemplateDto;
}

/** The next draft the draft route answers: a different row at a higher version. */
const NEXT_DRAFT_ID = "55555555-5555-4555-8555-555555555555";
function nextDraft(): AdminAssetTemplateDto {
  return { ...draftTemplate(), id: NEXT_DRAFT_ID, version: 2 } as unknown as AdminAssetTemplateDto;
}

/** Archive opens the `assetTemplate.archive` Review (Submit on screen) and sends nothing yet. */
export async function archiveOpensTheReviewAndSendsNothing(): Promise<void> {
  const archive = vi.fn(() => Promise.resolve(archivedTemplate()));
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()), archiveAdminAssetTemplate: archive });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Archive" }));

  const dialog = screen.getByRole("dialog", { name: "Archive this version" });
  expect(within(dialog).getByRole("button", { name: "Submit" })).toBeInTheDocument();
  expect(archive).not.toHaveBeenCalled();
}

/** Submit on the archive Review sends the archive for this template, once. */
export async function archiveSubmitSendsTheArchive(): Promise<void> {
  const archive = vi.fn(() => Promise.resolve(archivedTemplate()));
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()), archiveAdminAssetTemplate: archive });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Archive" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => {
    expect(archive).toHaveBeenCalledTimes(1);
  });
  expect(archive).toHaveBeenCalledWith(TEMPLATE_ID);
}

/**
 * The archive Review is red: its card carries the entry's `deactivate` risk
 * (`asset-status-wizard`'s rule, asserted as `point-keys-page.spec.tsx` does).
 * Mutation: `risk: "edit"` on `assetTemplate.archive` → red.
 */
export async function theArchiveReviewIsRed(): Promise<void> {
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()) });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Archive" }));

  expect(screen.getByRole("region", { name: "Archive an asset template" })).toHaveAttribute("data-risk", "deactivate");
}

/**
 * The archive wizard alone sends **no** `X-Copilot-Change` header. The API
 * function is left unspied and `fetch` stubbed, because the header is only
 * observable on the request. The positive comes first: the `POST …/archive` fired.
 */
export async function theArchiveWizardSendsNoCopilotHeader(): Promise<void> {
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()) });
  const seen: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(archivedTemplate()), { status: 200 });
  });
  try {
    renderPage(admin);

    await userEvent.click(await screen.findByRole("button", { name: "Archive" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => {
      expect(seen.map((request) => request.url).filter((url) => url.endsWith("/archive"))).toHaveLength(1);
    });

    const request = seen.find((candidate) => candidate.url.endsWith("/archive"));
    expect(request?.url).toMatch(new RegExp(`/api/v1/admin/asset-templates/${TEMPLATE_ID}/archive$`));
    expect(request?.init.method).toBe("POST");
    const headers = new Headers(request?.init.headers);
    expect([...headers.keys()].filter((name) => name.toLowerCase() === "x-copilot-change")).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
}

const ARCHIVE_REFUSED = "Template is outside your access scope";

/** A refused archive shows its sentence on the card and nowhere else (N3, as publish does). */
export async function aRefusedArchiveShowsTheSentenceOnce(): Promise<void> {
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    archiveAdminAssetTemplate: () => Promise.reject(new Error(ARCHIVE_REFUSED)),
  });
  renderPage(admin);
  await userEvent.click(await screen.findByRole("button", { name: "Archive" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  const dialog = screen.getByRole("dialog", { name: "Archive this version" });
  await within(dialog).findByText(ARCHIVE_REFUSED);
  expect(screen.getAllByText(ARCHIVE_REFUSED)).toHaveLength(1);
}

/** "Edit this version" opens the `assetTemplate.draft` Review and sends nothing yet. */
export async function draftOpensTheReviewAndSendsNothing(): Promise<void> {
  const draft = vi.fn(() => Promise.resolve(nextDraft()));
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()), createDraftFromAdminAssetTemplate: draft });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Edit this version" }));

  const dialog = screen.getByRole("dialog", { name: "Edit this version" });
  expect(within(dialog).getByRole("region", { name: "Start a new draft of an asset template" })).toBeInTheDocument();
  expect(draft).not.toHaveBeenCalled();
}

/** Submit on the draft Review sends the draft for this template, once. */
export async function draftSubmitSendsTheDraft(): Promise<void> {
  const draft = vi.fn(() => Promise.resolve(nextDraft()));
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()), createDraftFromAdminAssetTemplate: draft });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Edit this version" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => {
    expect(draft).toHaveBeenCalledTimes(1);
  });
  expect(draft).toHaveBeenCalledWith(TEMPLATE_ID);
}

/**
 * A draft that succeeds closes its Review. The page moves to the new row on
 * the same route element, so an open flag left set would reopen the Review
 * there. The positive first: the move happened (the new row was read and rendered).
 */
export async function aSubmittedDraftClosesItsReview(): Promise<void> {
  const read = vi.fn((id: string) => Promise.resolve(id === NEXT_DRAFT_ID ? nextDraft() : publishedTemplate()));
  stubApi({
    fetchAdminAssetTemplate: read,
    createDraftFromAdminAssetTemplate: () => Promise.resolve(nextDraft()),
  });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Edit this version" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => {
    expect(read).toHaveBeenCalledWith(NEXT_DRAFT_ID);
  });
  // The new row has rendered — not the loading branch, which renders no dialog either way.
  expect(await screen.findByText("Feeder · v2")).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Edit this version" })).toBeNull();
}

/** On an archived version the same draft Review is "Revive as a new draft". */
export async function reviveIsTheDraftWizardOnAnArchivedVersion(): Promise<void> {
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(archivedTemplate()) });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Revive as a new draft" }));

  const dialog = screen.getByRole("dialog", { name: "Revive as a new draft" });
  expect(within(dialog).getByRole("region", { name: "Start a new draft of an asset template" })).toBeInTheDocument();
}

/**
 * A submitted archive closes its Review. The positive first: the page now
 * reads the archived version (the read answers `archived` once the archive
 * went through), so the close is not the loading branch rendering no dialog.
 * Mutation: `archiveM` `onSuccess` back to `afterChange` → the dialog stays → red.
 */
export async function aSubmittedArchiveClosesItsReview(): Promise<void> {
  let archived = false;
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(archived ? archivedTemplate() : publishedTemplate()),
    archiveAdminAssetTemplate: () => {
      archived = true;
      return Promise.resolve(archivedTemplate());
    },
  });
  renderPage(admin);

  await userEvent.click(await screen.findByRole("button", { name: "Archive" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  expect(await screen.findByText("archived")).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Archive this version" })).toBeNull();
}

/**
 * C1 — a refusal that arrives after the user cancelled the dialog has no card
 * to show it, so the page banner does, once. The archive is held until the
 * dialog is cancelled, then refused.
 * Mutation: drop `archiveM`'s `onError` → no message anywhere → red.
 */
export async function aRefusalAfterCancellingShowsOnThePageBanner(): Promise<void> {
  let refuse: (() => void) | undefined;
  stubApi({
    fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()),
    archiveAdminAssetTemplate: () =>
      new Promise((_, reject) => {
        refuse = () => reject(new Error(ARCHIVE_REFUSED));
      }),
  });
  renderPage(admin);
  await userEvent.click(await screen.findByRole("button", { name: "Archive" }));
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Archive this version" })).toBeNull();

  refuse?.();

  expect(await screen.findByText(ARCHIVE_REFUSED)).toBeInTheDocument();
  expect(screen.getAllByText(ARCHIVE_REFUSED)).toHaveLength(1);
}

/**
 * The draft wizard alone sends **no** `X-Copilot-Change` header, as the
 * archive and publish wizards do. Positive first: the `POST …/draft` fired.
 * Mutation: add the header to the draft request → red.
 */
export async function theDraftWizardSendsNoCopilotHeader(): Promise<void> {
  stubApi({ fetchAdminAssetTemplate: () => Promise.resolve(publishedTemplate()) });
  const seen: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(nextDraft()), { status: 200 });
  });
  try {
    renderPage(admin);

    await userEvent.click(await screen.findByRole("button", { name: "Edit this version" }));
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => {
      expect(seen.filter((request) => request.url.endsWith("/draft"))).toHaveLength(1);
    });

    const request = seen.find((candidate) => candidate.url.endsWith("/draft"));
    expect(request?.url).toMatch(new RegExp(`/api/v1/admin/asset-templates/${TEMPLATE_ID}/draft$`));
    expect(request?.init.method).toBe("POST");
    const headers = new Headers(request?.init.headers);
    expect([...headers.keys()].filter((name) => name.toLowerCase() === "x-copilot-change")).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
}
