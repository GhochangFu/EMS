import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";
import type { SiteLayoutReplacePreviewDto } from "@bms/shared";

import * as replaceApi from "../../api/admin/site-layout-replace";
import { REPLACED_BODY } from "../../api/admin/site-layout-replace.spec";
import * as vocabApi from "../../api/vocabularies";
import { isStaleAfterReplace } from "../../lib/site-layout-replace";
import { expectOnlySlugAndListReadsRefetched, seedDashboardReads } from "../../lib/site-layout-replace.spec";
import { resetWizardStore } from "../../stores/wizard-store";
import { ReplaceSiteLayoutWizard } from "./replace-site-layout-wizard";

/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4 decisions 6, 8 and 9) — **Replace with this version**: the
 * button shows only for a template copy Replace would rebuild, the confirm step shows what is lost
 * and the edit flag, Submit sends the body for the site, and a pending Submit is disabled and
 * announced. The real wizard renders; the two clients are spies, so the wire shape is
 * `api/admin/site-layout-replace.spec.ts`'s. `fetch` itself rejects, so nothing reaches the network.
 */

const LOCATION_ID = REPLACED_BODY.locationId;
const GROUP_B = "44444444-4444-4444-8444-444444444444";

type Edits = SiteLayoutReplacePreviewDto["sites"][number]["edits"];
type Outcome = SiteLayoutReplacePreviewDto["sites"][number]["outcome"];

function preview(outcome: Outcome, edits: Edits): SiteLayoutReplacePreviewDto {
  const held =
    outcome === "no_copy"
      ? null
      : {
          dashboardId: REPLACED_BODY.previousDashboardId,
          templateId: REPLACED_BODY.previousTemplateId,
          templateCode: outcome === "other_template" ? "smoc-standard" : "pump-station-standard",
          version: 1,
        };
  return {
    templateId: REPLACED_BODY.templateId,
    templateCode: "pump-station-standard",
    version: 2,
    sites: [{ locationId: LOCATION_ID, locationName: "Lotapata", held, outcome, edits: held === null ? null : edits }],
  };
}

const WITH_ACTOR: Edits = { count: 3, lastEditedAt: "2026-11-06T10:00:00.000Z", lastEditedBy: "phe-admin@bms.local" };

let queryClient: QueryClient;

function renderWizard(
  answer: SiteLayoutReplacePreviewDto,
  replaceImpl?: (...args: unknown[]) => Promise<replaceApi.ReplaceSiteLayoutAnswer>,
): { replace: Mock } {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("a spec reached the network"))));
  vi.spyOn(replaceApi, "fetchSiteLayoutReplacePreview").mockResolvedValue(answer);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({
    assetDomains: [{ code: "electrical", label: "Electrical systems", sortOrder: 10, active: true }],
  } as never);
  const replace = vi.spyOn(replaceApi, "replaceSiteLayout");
  replace.mockImplementation(replaceImpl ?? (() => Promise.resolve({ kind: "replaced", result: REPLACED_BODY })));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ReplaceSiteLayoutWizard locationId={LOCATION_ID} siteName="Lotapata" />
    </QueryClientProvider>,
  );
  return { replace: replace as unknown as Mock };
}

const BUTTON = { name: "Replace with this version" } as const;
const DIALOG = { name: "Replace a site layout with a published version: Lotapata" } as const;

export function cleanupReplaceWizard(): void {
  cleanup();
  resetWizardStore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

/** Opens the wizard, Next on Groups, and returns the dialog on Review. */
async function openReview(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", BUTTON));
  const dialog = await screen.findByRole("dialog", DIALOG);
  fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  await within(dialog).findByRole("button", { name: "Submit" });
  return dialog;
}

/** B1 — a template copy Replace would rebuild shows the button; no copy and another template's copy do not. */
export async function theButtonShowsOnlyForATemplateCopy(): Promise<void> {
  renderWizard(preview("replace", WITH_ACTOR));
  expect(await screen.findByRole("button", BUTTON)).toBeInTheDocument();
  cleanupReplaceWizard();

  for (const outcome of ["no_copy", "other_template"] as const) {
    renderWizard(preview(outcome, WITH_ACTOR));
    // The read answered (its spy resolved and the query settled) before the absence is read.
    await waitFor(() => expect(replaceApi.fetchSiteLayoutReplacePreview).toHaveBeenCalledWith(LOCATION_ID));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(screen.queryByRole("button", BUTTON), outcome).toBeNull();
    cleanupReplaceWizard();
  }
}

/** B2 — the confirm step: the held copy, the version, what is lost, and the edit flag with the actor. */
export async function theConfirmStepShowsTheFlagWithTheActor(): Promise<void> {
  renderWizard(preview("replace", WITH_ACTOR));
  const dialog = await openReview();
  const confirm = within(dialog).getByRole("region", { name: "What Replace changes" });
  expect(confirm.textContent).toContain("This site holds pump-station-standard v1. Replace makes it again from pump-station-standard v2.");
  expect(confirm.textContent).toContain("Every builder edit on the copy is lost");
  expect(confirm.textContent).toContain("A drawn mimic is detached");
  expect(within(dialog).getByTestId("replace-edit-flag").textContent).toBe(
    "Edited 3 times since the copy, last on 2026-11-06 by phe-admin@bms.local",
  );
}

/**
 * B3b — opening the wizard reads the preview again, so the confirm step shows an edit made after
 * the page loaded (the button's first read said 3 edits; the second says 5).
 * Mutation, applied once and seen red: drop `previewQ.refetch()` from `start()` → one read, "3 times".
 */
export async function openingTheWizardRefreshesTheEditFlag(): Promise<void> {
  renderWizard(preview("replace", WITH_ACTOR));
  expect(await screen.findByRole("button", BUTTON)).toBeInTheDocument();
  vi.mocked(replaceApi.fetchSiteLayoutReplacePreview).mockResolvedValue(
    preview("replace", { count: 5, lastEditedAt: "2026-11-07T09:00:00.000Z", lastEditedBy: "phe-admin@bms.local" }),
  );
  const dialog = await openReview();
  expect(replaceApi.fetchSiteLayoutReplacePreview).toHaveBeenCalledTimes(2);
  await waitFor(() =>
    expect(within(dialog).getByTestId("replace-edit-flag").textContent).toBe(
      "Edited 5 times since the copy, last on 2026-11-07 by phe-admin@bms.local",
    ),
  );
}

/** B3 — a `location_admin`'s preview carries no actor: the flag has no "by". */
export async function theConfirmStepShowsTheFlagWithoutTheActor(): Promise<void> {
  renderWizard(preview("replace", { count: 2, lastEditedAt: "2026-11-06T10:00:00.000Z" }));
  const dialog = await openReview();
  expect(within(dialog).getByTestId("replace-edit-flag").textContent).toBe("Edited 2 times since the copy, last on 2026-11-06");
}

/** B4 — a copy nobody edited reads "No recorded edit since the copy". */
export async function theConfirmStepShowsNoRecordedEdit(): Promise<void> {
  renderWizard(preview("replace", { count: 0, lastEditedAt: null }));
  const dialog = await openReview();
  expect(within(dialog).getByTestId("replace-edit-flag").textContent).toBe("No recorded edit since the copy");
}

/**
 * B5 — Submit calls the replace client for the page's site with the body (`{}`: the newest version
 * of the copy's own code); the summary names both versions; Close invalidates the site's resolve
 * read and the dashboards read by slug or list (the predicate skips the deleted id's reads).
 */
export async function submitCallsTheReplaceClient(): Promise<void> {
  const { replace } = renderWizard(preview("replace", WITH_ACTOR));
  const dialog = await openReview();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

  expect((await within(dialog).findByText(/Replaced v1 with v2/)).textContent).toContain("site-layout-lotapata");
  expect(replace.mock.calls).toEqual([[LOCATION_ID, {}]]);
  expect(invalidate).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
    ["control-room", "site-view", LOCATION_ID],
    ["dashboards"],
  ]);
  expect(invalidate.mock.calls[1]?.[0]?.predicate).toBe(isStaleAfterReplace);
}

/**
 * B8 — the canvas still mounted with the OLD dashboard id: Close re-reads the slug and list reads, and
 * never the old id's site-widgets, catalog-values or mimic-nodes (the API answers 404 for each).
 */
export async function closeDoesNotRefetchTheDeletedDashboard(): Promise<void> {
  renderWizard(preview("replace", WITH_ACTOR));
  const reads = await seedDashboardReads(queryClient);
  try {
    const dialog = await openReview();
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    await within(dialog).findByText(/Replaced v1 with v2/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await expectOnlySlugAndListReadsRefetched(reads);
  } finally {
    reads.stop();
  }
}

/** B6 — while the Replace pends, Submit is disabled, renamed and `aria-busy`. */
export async function aPendingSubmitIsDisabledAndBusy(): Promise<void> {
  renderWizard(preview("replace", WITH_ACTOR), () => new Promise(() => undefined));
  const dialog = await openReview();
  fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

  const pending = await within(dialog).findByRole("button", { name: "Submitting…" });
  expect([pending.hasAttribute("disabled"), pending.getAttribute("aria-busy")]).toEqual([true, "true"]);
  expect(within(dialog).queryByRole("button", { name: "Submit" })).toBeNull();
}

/** B7 — a 409 `ambiguous` re-opens Groups with the picker; the retry carries the chosen group. */
export async function anAmbiguousAnswerRetriesWithTheChoice(): Promise<void> {
  const answers: replaceApi.ReplaceSiteLayoutAnswer[] = [
    {
      kind: "ambiguous",
      ambiguous: [{ tabKey: "sld", domain: "electrical", candidates: [{ id: GROUP_B, code: "incomer-b", name: "Incomer B" }] }],
    },
    { kind: "replaced", result: REPLACED_BODY },
  ];
  const { replace } = renderWizard(preview("replace", WITH_ACTOR), () => Promise.resolve(answers.shift()!));
  const dialog = await openReview();
  fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

  const picker = await within(dialog).findByRole("group", { name: "Choose an asset group per tab" });
  fireEvent.change(within(picker).getByRole("combobox"), { target: { value: GROUP_B } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  fireEvent.click(await within(dialog).findByRole("button", { name: "Submit" }));

  await within(dialog).findByText(/Replaced v1 with v2/);
  expect(replace.mock.calls).toEqual([
    [LOCATION_ID, {}],
    [LOCATION_ID, { tabGroups: { sld: GROUP_B } }],
  ]);
}
