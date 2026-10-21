import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { resetWizardStore, useWizardStore } from "../../stores/wizard-store";
import {
  BASE,
  GROUP_ID,
  LOC_1,
  LOC_2,
  TEMPLATE_ID,
  draftTemplate,
  publishedSiteTemplate,
  publishedTemplate,
  renderPage,
  roleFreeTemplate,
  stepTitles,
  stubApi,
  stubSiteApi,
} from "./dashboard-template-detail-page.spec";

/**
 * `F3.85` PR 10b / ADR 0099 decision 6 (plan §11.2) — the detail page's
 * lifecycle actions are catalog steppers on the shared `WizardShell`:
 * Publish, Archive and the new draft are Review alone (bodyless entries),
 * Instantiate is Target, Details, Review, and Apply to all sites is Review
 * alone. Moved here from `dashboard-template-detail-page.spec.tsx` (the
 * AGENTS.md §4.5 cap): the instantiate, apply and archive-confirm cases that
 * the wizards rewrite. Vitest entry point: the sibling `.test.tsx` (ADR 0014).
 */

type Seen = { url: string; init: RequestInit };

/** Every request the page puts on the wire, through the real `adminFetch`; each answers `answer`. */
function stubWire(answer: unknown): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return seen;
}

async function onePost(seen: Seen[]): Promise<Seen> {
  await waitFor(() => expect(seen.filter((call) => call.init.method === "POST")).toHaveLength(1));
  return seen.find((call) => call.init.method === "POST") as Seen;
}

const submit = () => userEvent.click(screen.getByRole("button", { name: "Submit" }));
const next = () => userEvent.click(screen.getByRole("button", { name: "Next" }));

/* ---------------------------------------------------------------- publish */

/** Publish opens the `dashboardTemplate.publish` wizard — Review alone — and sends nothing yet. */
export async function publishOpensAReviewOnlyWizard(): Promise<void> {
  const publish = vi.fn(() => Promise.resolve(publishedTemplate()));
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()), publishAdminDashboardTemplate: publish });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Publish" }));

  expect(stepTitles()).toEqual(["1. Review"]);
  expect(publish).not.toHaveBeenCalled();
}

/** Submit on the publish Review publishes the template once, and the wizard closes on success. */
export async function publishSubmitPublishesOnce(): Promise<void> {
  const publish = vi.fn(() => Promise.resolve(publishedTemplate()));
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()), publishAdminDashboardTemplate: publish });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
  await submit();

  await waitFor(() => expect(publish).toHaveBeenCalledWith(TEMPLATE_ID));
  await waitFor(() => expect(screen.queryByRole("list", { name: "Steps" })).toBeNull());
  expect(publish).toHaveBeenCalledTimes(1);
}

/** A refused publish keeps the wizard open with the error on its Review. */
export async function refusedPublishShowsTheErrorOnReview(): Promise<void> {
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()),
    publishAdminDashboardTemplate: () => Promise.reject(new Error("A widget has no binding")),
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
  await submit();

  const card = await screen.findByRole("region", { name: "Publish a dashboard template" });
  expect(await within(card).findByText("A widget has no binding")).toBeInTheDocument();
}

/* ---------------------------------------------------------------- archive */

function stubArchive(archive: (id: string) => Promise<unknown>): void {
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()), archiveAdminDashboardTemplate: archive });
}

/**
 * `F3.73` critique, kept — Archive asks before it archives. The click opens the
 * archive wizard (Review alone) and posts nothing; Cancel closes it with no
 * post; Submit posts once.
 */
export async function archiveAsksBeforeArchiving(): Promise<void> {
  const calls: string[] = [];
  stubArchive((id) => {
    calls.push(id);
    return Promise.resolve({ ...publishedTemplate(), status: "archived" });
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Archive" }));
  expect(calls, "the click archived before the Review was answered").toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(calls, "Cancel archived the template").toHaveLength(0);
  expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Archive" }));
  await submit();
  await waitFor(() => expect(calls).toEqual([TEMPLATE_ID]));
}

/** The archive Review is the red (`deactivate`) card, beside the dialog's own explanation. */
export async function archiveReviewIsTheRedCard(): Promise<void> {
  stubArchive(() => Promise.resolve(publishedTemplate()));
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Archive" }));

  expect(stepTitles()).toEqual(["1. Review"]);
  expect(screen.getByRole("region", { name: "Archive a dashboard template" })).toHaveAttribute("data-risk", "deactivate");
  expect(screen.getByRole("heading", { name: "Archive ELECTRICAL v1" })).toBeInTheDocument();
  expect(screen.getByText(/An archived version can no longer be instantiated/)).toBeInTheDocument();
}

/**
 * `F4.168` H15, as the wizard holds it — while the archive pends, the page's
 * Archive button announces "Archiving…" with `aria-busy` and is disabled, and
 * the Review's own Submit reads "Submitting…".
 */
export async function submittedArchiveAnnouncesArchiving(): Promise<void> {
  stubArchive(() => new Promise<never>(() => {}));
  renderPage();

  const archive = await screen.findByRole("button", { name: "Archive" });
  await userEvent.click(archive);
  await submit();
  await waitFor(() => expect(archive).toHaveAccessibleName("Archiving…"));
  expect(archive).toHaveAttribute("aria-busy", "true");
  expect(archive).toBeDisabled();
  expect(screen.getByRole("button", { name: "Submitting…" })).toHaveAttribute("aria-busy", "true");
}

/* ------------------------------------------------------------------ draft */

/** "Edit this version" opens the `dashboardTemplate.draft` wizard — Review alone — and Submit opens the draft. */
export async function draftWizardOpensANewDraft(): Promise<void> {
  const draft = vi.fn(() => Promise.resolve(draftTemplate()));
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()), createDraftFromAdminDashboardTemplate: draft });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Edit this version" }));
  expect(stepTitles()).toEqual(["1. Review"]);
  expect(draft).not.toHaveBeenCalled();
  await submit();

  await waitFor(() => expect(draft).toHaveBeenCalledWith(TEMPLATE_ID));
}

/* ---------------------------------------------------------- the wire, bodyless */

export type BodylessCase = {
  template: () => unknown;
  open: string;
  path: string;
  site?: boolean;
};

export const BODYLESS: Record<string, BodylessCase> = {
  publish: { template: draftTemplate, open: "Publish", path: "publish" },
  archive: { template: publishedTemplate, open: "Archive", path: "archive" },
  draft: { template: publishedTemplate, open: "Edit this version", path: "draft" },
  applyToSites: { template: publishedSiteTemplate, open: "Apply to all sites", path: "apply-to-sites", site: true },
};

async function bodylessPost(kind: BodylessCase): Promise<Seen> {
  const reads = { fetchAdminDashboardTemplate: () => Promise.resolve(kind.template()) };
  if (kind.site) stubSiteApi(reads);
  else stubApi(reads);
  const seen = stubWire({ made: [], skipped: [] });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: kind.open }));
  await submit();
  return onePost(seen);
}

/**
 * A bodyless wizard sends exactly what the client function sends: a POST to
 * the action's path with no body and no Content-Type (the positive), and no
 * `X-Copilot-Change` header (plan §10.5).
 */
export async function bodylessWizardSendsTheClientRequest(kind: BodylessCase): Promise<void> {
  const post = await bodylessPost(kind);
  expect(post.url).toBe(`${BASE}/api/v1/admin/dashboard-templates/${TEMPLATE_ID}/${kind.path}`);
  expect(post.init.body).toBeUndefined();
  expect(new Headers(post.init.headers).get("Content-Type")).toBeNull();
}

/** The same request carries no `X-Copilot-Change` header; the positive is that the POST fired at the path. */
export async function bodylessWizardAloneSendsNoCopilotHeader(kind: BodylessCase): Promise<void> {
  const post = await bodylessPost(kind);
  expect(post.url).toBe(`${BASE}/api/v1/admin/dashboard-templates/${TEMPLATE_ID}/${kind.path}`);
  expect(new Headers(post.init.headers).get("X-Copilot-Change")).toBeNull();
}

/* ----------------------------------------------------------- apply to sites */

/** Apply to all sites opens the `dashboardTemplate.applyToSites` wizard — Review alone — and posts nothing yet. */
export async function applyOpensAReviewOnlyWizard(): Promise<void> {
  const apply = vi.fn(() => Promise.resolve({ made: [], skipped: [] }));
  stubSiteApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedSiteTemplate()), applySiteTemplate: apply });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Apply to all sites" }));

  expect(stepTitles()).toEqual(["1. Review"]);
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByText(/This copies the template onto every active site/)).toBeInTheDocument();
}

/** The apply Review names where the copies go, never "every active site in ." with an empty name. */
export async function applyReviewNamesTheOrganization(): Promise<void> {
  stubSiteApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedSiteTemplate()) });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Apply to all sites" }));

  const card = screen.getByRole("region", { name: "Apply a site template to every site" });
  expect(card.textContent).toContain("for every active site in its organization.");
}

/** The bulk action names a made site and a skipped site with its reason, and posts once. */
export async function applyResultTableListsASkippedSitesReason(): Promise<void> {
  const calls: string[] = [];
  stubSiteApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(publishedSiteTemplate()),
    applySiteTemplate: (id: string) => {
      calls.push(id);
      return Promise.resolve({
        made: [
          {
            locationId: LOC_1,
            dashboardId: "d1",
            dashboardSlug: "site-layout-plant-1",
            omittedTabs: [],
            droppedCards: [],
            omittedTiles: [],
            resolution: [],
          },
        ],
        skipped: [{ locationId: LOC_2, reason: "has_view" }],
      });
    },
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Apply to all sites" }));
  expect(calls, "the click posted before the Review was answered").toHaveLength(0);
  await submit();

  expect(await screen.findByRole("cell", { name: "Plant 2" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: /already has a site view/i })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "Plant 1" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: /made/i })).toBeInTheDocument();
  expect(calls).toEqual([TEMPLATE_ID]);
}

/* ------------------------------------------------------------ instantiate */

/** A group template's Instantiate opens Target, Details, Review, and sends nothing yet. */
export async function instantiateOpensTargetDetailsReview(): Promise<void> {
  const instantiate = vi.fn();
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()), instantiateAdminDashboardTemplate: instantiate });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));

  expect(stepTitles()).toEqual(["1. Target", "2. Details", "3. Review"]);
  expect(instantiate).not.toHaveBeenCalled();
}

/** Group arm: pick a group, Next, a slug, Next, Submit. */
async function instantiateGroup(group: string, slug: string): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  // `findByRole` on the option: the select renders before the groups read lands.
  await screen.findByRole("option", { name: /Electrical train/ });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset group" }), group);
  await next();
  await userEvent.type(screen.getByRole("textbox", { name: "Slug" }), slug);
  await next();
  await submit();
}

/**
 * The load-bearing assertion, kept: a `partial` widget is named, with its
 * `matchedMembers` and `boundPoints`, inside the instantiate wizard itself —
 * ADR 0049 Amendment 2 decisions 1 and 6.
 */
export async function resolutionReportNamesAPartialWidget(): Promise<void> {
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()),
    instantiateAdminDashboardTemplate: () =>
      Promise.resolve({
        dashboard: { id: "d1", name: "Electrical train dashboard" },
        resolutions: [
          { widgetKey: "w1", assetRoleCodes: ["incoming-supply"], matchedMembers: 3, boundPoints: 2, outcome: "partial" },
        ],
      }),
  });
  renderPage();

  await instantiateGroup(GROUP_ID, "electrical-p1");

  // Scoped to the table cell: the widget editor below also shows the key "w1".
  await waitFor(() => expect(screen.getByRole("cell", { name: "w1" })).toBeInTheDocument());
  expect(screen.getByRole("cell", { name: "3" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "2" })).toBeInTheDocument();
  expect(screen.getByText(/Partial/)).toBeInTheDocument();
  expect(screen.getByText(/Electrical train dashboard/)).toBeInTheDocument();
}

/** The group arm sends its parsed body: the group, the slug, and the seeded name. */
export async function instantiateSendsTheGroupBody(): Promise<void> {
  const calls: unknown[][] = [];
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()),
    instantiateAdminDashboardTemplate: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve({ dashboard: { id: "d1", name: "x" }, resolutions: [] });
    },
  });
  renderPage();

  await instantiateGroup(GROUP_ID, "electrical-p1");

  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]).toEqual([
    TEMPLATE_ID,
    { assetGroupId: GROUP_ID, slug: "electrical-p1", name: "Electrical overview dashboard" },
  ]);
}

/** The organization-wide sentinel never reaches the wire: the body sends `assetGroupId: null`. */
export async function organizationWideOptionSendsANullAssetGroup(): Promise<void> {
  const calls: unknown[] = [];
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(roleFreeTemplate()),
    instantiateAdminDashboardTemplate: (_id: string, input: unknown) => {
      calls.push(input);
      return Promise.resolve({ dashboard: { id: "d1", name: "Sustainability" }, resolutions: [] });
    },
  });
  renderPage();

  await instantiateGroup("__organization_wide__", "enterprise");

  await waitFor(() => expect(calls).toHaveLength(1));
  expect((calls[0] as { assetGroupId: unknown }).assetGroupId).toBeNull();
}

/**
 * `E4.2` PR 2 sweep, as the wizard holds it — the slug RULE, not emptiness:
 * a typed name as the slug keeps Details open with an alert. The valid slug is
 * the adjacent positive: the same form reaches Review.
 */
export async function aTypedNameAsTheSlugStaysOnDetails(): Promise<void> {
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(roleFreeTemplate()) });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  await screen.findByRole("option", { name: "Organization-wide (no group)" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset group" }), "__organization_wide__");
  await next();
  const slugField = screen.getByRole("textbox", { name: "Slug" });
  await userEvent.type(slugField, "Sustainability Overview");
  await next();
  expect(screen.getByRole("alert").textContent, "a capital and a space are a 400 from the API").toContain("slug");
  expect(screen.getByRole("region", { name: "Details" })).toBeInTheDocument();

  await userEvent.clear(slugField);
  await userEvent.type(slugField, "sustainability-overview");
  await next();
  expect(screen.getByRole("button", { name: "Submit" }), "the positive control — a valid slug reaches Review").toBeEnabled();
}

/**
 * The dialog kept its button disabled until a group was picked; the wizard
 * lets Next pass an empty Target (a step leaves an empty field to Review), and
 * Review refuses the body: an alert shows (the positive) and Submit sends nothing.
 */
export async function noTargetPickedStopsAtReview(): Promise<void> {
  const instantiate = vi.fn();
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()), instantiateAdminDashboardTemplate: instantiate });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  await next();
  await userEvent.type(screen.getByRole("textbox", { name: "Slug" }), "electrical-p1");
  await next();
  await submit();

  const card = screen.getByRole("region", { name: "Make a dashboard from a template" });
  // The union body answers a missing arm key with an opaque message (the shell owns the wording).
  expect(within(card).getByRole("alert").textContent).toBe("body: Invalid input");
  expect(instantiate).not.toHaveBeenCalled();
}

/** A padded slug and name are sent trimmed, as the dialog sent them. */
export async function instantiateTrimsTheSlugAndName(): Promise<void> {
  const calls: unknown[] = [];
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()),
    instantiateAdminDashboardTemplate: (_id: string, input: unknown) => {
      calls.push(input);
      return Promise.resolve({ dashboard: { id: "d1", name: "x" }, resolutions: [] });
    },
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  await screen.findByRole("option", { name: /Electrical train/ });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset group" }), GROUP_ID);
  await next();
  // The Slug field keeps what is typed and trims on blur, as the Name field does (review finding C1).
  const slugField = screen.getByRole("textbox", { name: "Slug" });
  fireEvent.change(slugField, { target: { value: " electrical-p1 " } });
  fireEvent.blur(slugField);
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: " Plant one " } });
  await next();
  await submit();

  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]).toEqual({ assetGroupId: GROUP_ID, slug: "electrical-p1", name: "Plant one" });
}

/** The group arm's wire request: the parsed body (the positive) and no `X-Copilot-Change` header. */
export async function instantiateWizardAloneSendsNoCopilotHeader(): Promise<void> {
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()) });
  const seen = stubWire({ dashboard: { id: "d1", name: "x" }, resolutions: [] });
  renderPage();

  await instantiateGroup(GROUP_ID, "electrical-p1");

  const post = await onePost(seen);
  expect(post.url).toBe(`${BASE}/api/v1/admin/dashboard-templates/${TEMPLATE_ID}/instantiate`);
  expect(JSON.parse(post.init.body as string)).toEqual({
    assetGroupId: GROUP_ID,
    slug: "electrical-p1",
    name: "Electrical overview dashboard",
  });
  expect(new Headers(post.init.headers).get("X-Copilot-Change")).toBeNull();
}

/** Site arm: pick a location, Next past the note, Submit. */
async function instantiateSite(): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  expect(screen.queryByRole("combobox", { name: "Asset group" })).not.toBeInTheDocument();
  await screen.findByRole("option", { name: "Plant 2" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Location" }), LOC_2);
  await next();
  await next();
  await submit();
}

const SITE_RESULT = {
  locationId: LOC_2,
  dashboardId: "d1",
  dashboardSlug: "site-layout-plant-2",
  omittedTabs: [],
  droppedCards: [],
  omittedTiles: [],
  resolution: [],
};

/** A site template's Details step has no name or slug input — the copy is named for its site. */
export async function siteInstantiateDetailsHasNoInputs(): Promise<void> {
  stubSiteApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedSiteTemplate()) });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  await screen.findByRole("option", { name: "Plant 2" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Location" }), LOC_2);
  await next();

  const details = screen.getByRole("region", { name: "Details" });
  expect(details.textContent).toContain("named for its site");
  expect(within(details).queryByRole("textbox")).toBeNull();
}

/** A site template's instantiate picks a location, sends `{ locationId }`, no group. */
export async function siteTemplateInstantiatePicksALocation(): Promise<void> {
  const calls: unknown[][] = [];
  stubSiteApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(publishedSiteTemplate()),
    instantiateSiteTemplate: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve(SITE_RESULT);
    },
  });
  renderPage();

  await instantiateSite();

  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]?.slice(0, 2)).toEqual([TEMPLATE_ID, LOC_2]);
  expect(await screen.findByText(/site-layout-plant-2/)).toBeInTheDocument();
  expect(screen.queryByText(/left out/), "a copy that left out no tile said it did").not.toBeInTheDocument();
}

/** ADR 0087 Amendment 2 — the answer counts the role tiles a copy left out. */
export async function madeSummaryCountsTheTilesLeftOut(): Promise<void> {
  stubSiteApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(publishedSiteTemplate()),
    instantiateSiteTemplate: () =>
      Promise.resolve({
        ...SITE_RESULT,
        omittedTiles: [
          { tabKey: "sld", widgetKey: "sld-pf-tile" },
          { tabKey: "env", widgetKey: "env-humidity-tile" },
        ],
      }),
  });
  renderPage();

  await instantiateSite();

  expect(await screen.findByText(/2 tiles left out \(no point at the site\)/)).toBeInTheDocument();
}

/** The site arm's wire request: exactly `{ locationId }` (the positive) and no `X-Copilot-Change` header. */
export async function siteInstantiateWizardAloneSendsNoCopilotHeader(): Promise<void> {
  stubSiteApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedSiteTemplate()) });
  const seen = stubWire(SITE_RESULT);
  renderPage();

  await instantiateSite();

  const post = await onePost(seen);
  expect(post.url).toBe(`${BASE}/api/v1/admin/dashboard-templates/${TEMPLATE_ID}/instantiate`);
  expect(JSON.parse(post.init.body as string)).toEqual({ locationId: LOC_2 });
  expect(new Headers(post.init.headers).get("X-Copilot-Change")).toBeNull();
}

/**
 * Review finding C1 — the slug RULE for a lowercase slug with a space: the
 * field keeps the space the user typed (it is not trimmed per key into
 * "plantone"), so Details refuses it with an alert, as the dialog kept its
 * button disabled. The positive: the field shows the raw value.
 */
export async function aLowercaseSlugWithASpaceStaysOnDetails(): Promise<void> {
  const instantiate = vi.fn();
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()), instantiateAdminDashboardTemplate: instantiate });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  await screen.findByRole("option", { name: /Electrical train/ });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Asset group" }), GROUP_ID);
  await next();
  const slugField = screen.getByRole("textbox", { name: "Slug" });
  await userEvent.type(slugField, "plant one");
  expect(slugField).toHaveValue("plant one");
  await next();
  expect(screen.getByRole("alert").textContent).toContain("slug");
  expect(screen.getByRole("region", { name: "Details" })).toBeInTheDocument();
  expect(instantiate).not.toHaveBeenCalled();
}

/**
 * Review finding Q1 — a second Submit clears the last refusal before it sends:
 * the old 409 text does not stay beside "Submitting…". The positive: the first
 * refusal showed, and the second request fired.
 */
export async function aSecondSubmitClearsTheLastRefusal(): Promise<void> {
  let calls = 0;
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()),
    instantiateAdminDashboardTemplate: () => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("That slug is taken")) : new Promise<never>(() => {});
    },
  });
  renderPage();

  await instantiateGroup(GROUP_ID, "electrical-p1");
  const card = screen.getByRole("region", { name: "Make a dashboard from a template" });
  expect(await within(card).findByText("That slug is taken")).toBeInTheDocument();

  await submit();
  await waitFor(() => expect(calls).toBe(2));
  expect(await within(card).findByRole("button", { name: "Submitting…" })).toBeInTheDocument();
  expect(within(card).queryByText("That slug is taken")).toBeNull();
}

/**
 * Review finding Q2 — a group-arm body on a site template (the copilot filled
 * the group, slug and name; Location stays empty) is refused before the wire
 * with the template-target message, not sent as `{}`. The positive: the alert.
 */
export async function aGroupBodyOnASiteTemplateIsRefusedBeforeTheWire(): Promise<void> {
  resetWizardStore();
  const instantiate = vi.fn();
  stubSiteApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedSiteTemplate()), instantiateSiteTemplate: instantiate });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "dashboardTemplate.instantiate", params: { id: TEMPLATE_ID },
      stepId: "target",
      values: { assetGroupId: GROUP_ID },
    }, null);
  });
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "dashboardTemplate.instantiate", params: { id: TEMPLATE_ID },
      stepId: "details",
      values: { name: "Plant one", slug: "plant-one" },
    }, null);
  });
  await next();
  await next();
  await submit();

  const card = screen.getByRole("region", { name: "Make a dashboard from a template" });
  expect(within(card).getByRole("alert").textContent).toContain("This template's target does not take this body");
  expect(instantiate).not.toHaveBeenCalled();
}

/**
 * Review finding Q2, the reverse arm — a site body (`{ locationId }`, the
 * copilot filled it; the seeded Name cleared) on a group template is refused
 * before the wire with the template-target message. Only `templateTargetBodyMessage`
 * holds this direction: the group send has no narrow of its own.
 */
export async function aSiteBodyOnAGroupTemplateIsRefusedBeforeTheWire(): Promise<void> {
  resetWizardStore();
  const instantiate = vi.fn();
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()), instantiateAdminDashboardTemplate: instantiate });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "dashboardTemplate.instantiate", params: { id: TEMPLATE_ID },
      stepId: "target",
      values: { locationId: LOC_1 },
    }, null);
  });
  await next();
  await userEvent.clear(screen.getByRole("textbox", { name: "Name" }));
  await next();
  await submit();

  const card = screen.getByRole("region", { name: "Make a dashboard from a template" });
  expect(within(card).getByRole("alert").textContent).toContain("This template's target does not take this body");
  expect(instantiate).not.toHaveBeenCalled();
}

/**
 * Review finding F2 — an organization-wide fill (`assetGroupId: null`) on a
 * template that binds a role is refused before the wire with the `E4.2`
 * reason. The positive: the alert names the reason.
 */
export async function anOrganizationWideFillOnARoleBoundTemplateIsRefused(): Promise<void> {
  resetWizardStore();
  const instantiate = vi.fn();
  stubApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedTemplate()), instantiateAdminDashboardTemplate: instantiate });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "dashboardTemplate.instantiate", params: { id: TEMPLATE_ID },
      stepId: "target",
      values: { assetGroupId: null },
    }, null);
  });
  await next();
  await userEvent.type(screen.getByRole("textbox", { name: "Slug" }), "electrical-p1");
  await next();
  await submit();

  const card = screen.getByRole("region", { name: "Make a dashboard from a template" });
  expect(within(card).getByRole("alert").textContent).toContain("A template with role bindings needs an asset group");
  expect(instantiate).not.toHaveBeenCalled();
}

/**
 * Review finding F1 — a refused lifecycle call shows its error once: in the
 * open wizard, not again in the page banner behind it.
 */
export async function aRefusedPublishShowsItsErrorOnce(): Promise<void> {
  stubApi({
    fetchAdminDashboardTemplate: () => Promise.resolve(draftTemplate()),
    publishAdminDashboardTemplate: () => Promise.reject(new Error("A widget has no binding")),
  });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Publish" }));
  await submit();

  const card = await screen.findByRole("region", { name: "Publish a dashboard template" });
  expect(await within(card).findByText("A widget has no binding")).toBeInTheDocument();
  expect(screen.getAllByText("A widget has no binding")).toHaveLength(1);
}

/** A `tabGroups` the copilot filled on Target has no input, and is shown as text. */
export async function siteTargetShowsAFilledTabGroups(): Promise<void> {
  resetWizardStore();
  stubSiteApi({ fetchAdminDashboardTemplate: () => Promise.resolve(publishedSiteTemplate()) });
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: "Instantiate" }));
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "dashboardTemplate.instantiate", params: { id: TEMPLATE_ID },
      stepId: "target",
      values: { tabGroups: { sld: "33333333-3333-4333-8333-333333333333" } },
    }, null);
  });

  expect(screen.getByRole("region", { name: "Target" }).textContent).toContain(
    'Tab groups: {"sld":"33333333-3333-4333-8333-333333333333"} (filled by the copilot).',
  );
}
