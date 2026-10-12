import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, vi } from "vitest";

import * as api from "../../api/admin/asset-groups";
import * as assetsApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as organizationsApi from "../../api/admin/organizations";
import * as vocabApi from "../../api/vocabularies";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { resetWizardStore, useWizardStore } from "../../stores/wizard-store";
import { AssetGroupsAdminPage } from "./asset-groups-page";
import * as copilotApi from "../../api/copilot";

/**
 * `F3.37` (ADR 0049 decision 5) — the asset-group screen, rendered (ADR 0042).
 *
 * Assertions live here; `asset-groups-page.test.tsx` is the Vitest entry point
 * and carries the `@vitest-environment jsdom` docblock, because that is the
 * file Vitest collects.
 *
 * Queries go by role and text (ADR 0042 decision 5).
 *
 * `F3.86` PR 3c (ADR 0099 decision 6, ruling Q9): every write is a catalog
 * wizard — group create and edit (Basics → Details → Review), member add
 * (Member → Review), a role change (Role → Review, opened from the row's role
 * picker) and member remove (Review alone, red). The asset ids are uuids now:
 * a member's `assetId` is a body field the wizard checks.
 */

const user: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

const GROUP_LOCATION_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_LOCATION_ID = "44444444-4444-4444-4444-444444444444";
const GROUP_ID = "11111111-1111-1111-1111-111111111111";

const ASSET_1 = "a5500000-0000-4000-8000-000000000001";
const ASSET_2 = "a5500000-0000-4000-8000-000000000002";
const ASSET_3 = "a5500000-0000-4000-8000-000000000003";
const ASSET_4 = "a5500000-0000-4000-8000-000000000004";
const ASSET_5 = "a5500000-0000-4000-8000-000000000005";

const GROUPS = {
  items: [
    {
      id: GROUP_ID,
      code: "electrical",
      name: "Electrical train",
      description: null,
      locationId: "22222222-2222-2222-2222-222222222222",
      locationName: "Plant 1",
      organizationId: "33333333-3333-3333-3333-333333333333",
      memberCount: 3,
      createdAt: new Date(0).toISOString(),
    },
  ],
};

/**
 * Two roles only, and deliberately NOT the seeded 26. The point of the
 * assertion below is that the options come from the fetch — a fixture that
 * mirrored the seed would pass whether or not the component read it. The
 * same holds for the one domain.
 */
const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [{ code: "f386-spec-domain", label: "Spec Domain", sortOrder: 10, active: true }],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [
    { code: "f337-spec-alpha", label: "Spec Alpha Role", sortOrder: 10, active: true },
    { code: "f337-spec-beta", label: "Spec Beta Role", sortOrder: 20, active: true },
  ],
};

/**
 * Two of three members carry the same role — decision 6's N-minus-one case.
 *
 * **Deliberately NOT in `assetCode` order.** The server orders by
 * `assets.code`; the page must render what it was sent. A fixture already in
 * code order is satisfied identically by "render server order" and by
 * `[...members].sort(byAssetCode)`, so it cannot detect the client-side
 * re-sort `rendersMembersInServerOrder` exists to forbid. The API integration
 * fixture INSERTs `c, a, b` for the same reason; this half did not, until it
 * was caught in review.
 */
const MEMBERS = {
  items: [
    {
      membershipId: "aaaa1111-0000-0000-0000-000000000003",
      assetId: ASSET_3,
      assetCode: "TRF-03",
      assetName: "Transformer 3",
      assetDomain: "electrical",
      role: null,
      roleLabel: null,
    },
    {
      membershipId: "aaaa1111-0000-0000-0000-000000000001",
      assetId: ASSET_1,
      assetCode: "TRF-01",
      assetName: "Transformer 1",
      assetDomain: "electrical",
      role: "f337-spec-alpha",
      roleLabel: "Spec Alpha Role",
    },
    {
      membershipId: "aaaa1111-0000-0000-0000-000000000002",
      assetId: ASSET_2,
      assetCode: "TRF-02",
      assetName: "Transformer 2",
      assetDomain: "electrical",
      role: "f337-spec-alpha",
      roleLabel: "Spec Alpha Role",
    },
  ],
  roleCounts: { "f337-spec-alpha": 2 },
};

/**
 * Assets at the group's location and at another one. `ASSET_1..3` are the
 * group's members (MEMBERS); `ASSET_4` is free at the group's location and
 * `ASSET_5` is free at the other location.
 */
function assetAt(id: string, code: string, name: string, locationId: string) {
  return { id, code, name, locationId, active: true };
}
const ASSETS = [
  assetAt(ASSET_1, "TRF-01", "Transformer 1", GROUP_LOCATION_ID),
  assetAt(ASSET_2, "TRF-02", "Transformer 2", GROUP_LOCATION_ID),
  assetAt(ASSET_3, "TRF-03", "Transformer 3", GROUP_LOCATION_ID),
  assetAt(ASSET_4, "TRF-04", "Transformer 4", GROUP_LOCATION_ID),
  assetAt(ASSET_5, "PMP-05", "Pump 5 elsewhere", OTHER_LOCATION_ID),
];
const LOCATIONS = {
  items: [
    { id: GROUP_LOCATION_ID, name: "Plant 1" },
    { id: OTHER_LOCATION_ID, name: "Plant 2" },
  ],
};

/** Presses the open wizard's Next. */
async function next(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

/** The open wizard's step list, as rendered: "1. Basics", … */
function stepTitles(): string[] {
  return within(screen.getByRole("list", { name: "Steps" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

/** The step the wizard has open (`aria-current="step"`). */
function currentStep(): string {
  return screen.getByRole("list", { name: "Steps" }).querySelector('[aria-current="step"]')?.textContent ?? "";
}

/**
 * `F4.202` / ruling Q9: a member's Remove opens a Review-alone wizard; the
 * request starts on its Submit.
 */
async function removeMemberAndConfirm(assetName: string): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: `Remove ${assetName}` }));
  const dialog = await screen.findByRole("dialog", { name: `Remove ${assetName} from Electrical train` });
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
}

/** Picks `role` in the row's role picker, which opens the role wizard, then walks Role → Review → Submit. */
async function setRoleThroughTheWizard(assetName: string, role: string): Promise<void> {
  const select = await screen.findByRole("combobox", { name: `Role for ${assetName}` });
  await waitFor(() => {
    expect(within(select).getAllByRole("option").length).toBe(3);
  });
  await userEvent.selectOptions(select, role);
  const dialog = await screen.findByRole("dialog", { name: `Set the role of ${assetName}` });
  expect(within(dialog).getByRole("combobox", { name: "Role" })).toHaveValue(role);
  await next();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
}

/** Opens the add-member wizard of the selected group and waits for its picker to list the free asset. */
async function openAddMember(): Promise<HTMLSelectElement> {
  await userEvent.click(await screen.findByRole("button", { name: "Add an asset" }));
  const picker = (await screen.findByRole("combobox", { name: "Asset to add" })) as HTMLSelectElement;
  await waitFor(() => {
    expect(within(picker).getAllByRole("option").length).toBe(2);
  });
  return picker;
}

/** Opens New group and fills Basics (a location picked first), then Next to Details. */
async function fillCreateBasics(locationId: string, code: string, name: string): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole("button", { name: "New group" }));
  const dialog = await screen.findByRole("dialog", { name: "New asset group" });
  const select = within(dialog).getByLabelText("Location");
  await waitFor(() => {
    expect(within(select).getAllByRole("option").length).toBe(3);
  });
  await userEvent.selectOptions(select, locationId);
  await userEvent.type(within(dialog).getByLabelText("Code"), code);
  await userEvent.type(within(dialog).getByLabelText("Name"), name);
  await next();
  return dialog;
}

/** A request starts a tick after the click; "nothing was sent" is read after timers have run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function renderPage(as: AuthUser = user): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AssetGroupsAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * `adminAssetGroupsQueryKey` is a readonly tuple, not a function, so the
 * override map is keyed on the callable exports only — a `Partial<typeof api>`
 * would offer a key `vi.spyOn` cannot take.
 */
type ApiFn =
  | "fetchAdminAssetGroups"
  | "fetchAdminAssetGroupMembers"
  | "setAdminAssetGroupMemberRole"
  | "createAdminAssetGroup"
  | "updateAdminAssetGroup"
  | "addAdminAssetGroupMember"
  | "removeAdminAssetGroupMember";

function stubApi(overrides: Partial<Record<ApiFn, unknown>> = {}): void {
  vi.spyOn(api, "fetchAdminAssetGroups").mockResolvedValue(GROUPS);
  vi.spyOn(api, "fetchAdminAssetGroupMembers").mockResolvedValue(MEMBERS);
  vi.spyOn(api, "setAdminAssetGroupMemberRole").mockResolvedValue(
    MEMBERS.items[0] as never,
  );
  vi.spyOn(api, "createAdminAssetGroup").mockResolvedValue(GROUPS.items[0] as never);
  vi.spyOn(api, "updateAdminAssetGroup").mockResolvedValue(GROUPS.items[0] as never);
  vi.spyOn(api, "addAdminAssetGroupMember").mockResolvedValue(MEMBERS.items[0] as never);
  vi.spyOn(api, "removeAdminAssetGroupMember").mockResolvedValue(undefined);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  // Filters by the location argument, as the server does: a stub that ignored
  // it would list every asset and could not tell a filtering picker from not.
  vi.spyOn(assetsApi, "fetchAdminAssets").mockImplementation(((_active: string, locId?: string) =>
    Promise.resolve({
      items: ASSETS.filter((a) => locId === undefined || a.locationId === locId),
    })) as never);
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue(LOCATIONS as never);
  for (const [name, impl] of Object.entries(overrides)) {
    vi.spyOn(api, name as ApiFn).mockImplementation(impl as never);
  }
}

/**
 * **The `F4.43` guard, in its component form.**
 *
 * Every role option must come from the vocabulary fetch. A `<select>` whose
 * value matches no option renders its FIRST option, so a hardcoded list
 * falling behind the table does not look broken — it looks like a different
 * value. The fixture names two roles that appear in no seed and in no source
 * file, so a component with a hardcoded list fails here rather than passing.
 */
export async function rolesComeFromTheVocabularyFetch(): Promise<void> {
  stubApi();
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));

  const select = await screen.findByRole("combobox", { name: "Role for Transformer 1" });

  // Waited for, not read once: the member list and the vocabulary are two
  // queries, so the <select> renders with only "No role" until the second
  // resolves. Reading immediately passes alone and fails under a loaded run —
  // which is exactly what happened the first time this suite ran with the
  // whole project.
  await waitFor(() => {
    // "No role" plus exactly the two fetched roles — no more, no fewer.
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "No role",
      "Spec Alpha Role",
      "Spec Beta Role",
    ]);
  });
  expect((select as HTMLSelectElement).value).toBe("f337-spec-alpha");
}

/**
 * **The `F4.43` gate that actually gates, and the reason it exists.**
 *
 * `rolesComeFromTheVocabularyFetch` above proves the fetched roles are
 * rendered. It does **not** prove there is no hardcoded fallback beside them:
 * mutate the page to `vocabQ.data?.assetRoles ?? HARDCODED_ROLES` and that
 * assertion still passes, because the stub resolves and the fallback branch
 * never runs. `tests/f3.37-asset-role-vocabulary.test.ts` misses it too — the
 * literal-`<option>` scan sees `roles.map`, not the constant behind `??`.
 *
 * This is the only test that executes the empty branch. An empty vocabulary
 * must render exactly one option, "No role". Anything else is a list the
 * component carries itself, which is the revert all of this exists to stop.
 */
export async function anEmptyVocabularyRendersNoRolesOfItsOwn(): Promise<void> {
  stubApi();
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue({
    ...VOCABULARIES,
    assetRoles: [],
  } as never);
  renderPage();

  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  const select = await screen.findByRole("combobox", { name: "Role for Transformer 1" });

  // Waited for, not read once: the member list resolves before the vocabulary,
  // so an immediate read would see the empty select either way and pass for
  // the wrong reason.
  await waitFor(() => {
    expect(screen.getByText("Transformer 3")).toBeInTheDocument();
  });
  expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["No role"]);
}

/**
 * The member list is rendered in the order the server sent it.
 *
 * The server orders by `assets.code`, which is the contract a section template
 * resolves through; a client-side re-sort would silently take that over.
 */
export async function rendersMembersInServerOrder(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));

  await screen.findByText("Transformer 1");
  const rendered = screen
    .getAllByText(/^TRF-0\d$/)
    .map((el) => el.textContent);
  // The fixture's own order, which is NOT sorted — a page that sorts by code
  // renders TRF-01, TRF-02, TRF-03 and fails here.
  expect(rendered).toEqual(["TRF-03", "TRF-01", "TRF-02"]);
}

/**
 * The per-role count is visible.
 *
 * ADR 0049 decision 6 ruled "unresolved role -> zero bindings -> no data
 * bound", which was written for match/no-match. Two of three members carrying
 * a role renders a widget that looks right and is one short, and that is
 * invisible unless something counts.
 */
export async function showsHowManyMembersCarryEachRole(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));

  expect((await screen.findAllByText("2 with this role")).length).toBe(2);
  // The member with no role contributes to no count.
  expect(screen.getAllByText("—").length).toBeGreaterThan(0);
}

/**
 * Choosing a role sends the code; choosing "No role" sends an explicit null —
 * each through the role wizard, and only on its Submit.
 */
export async function sendsTheCodeAndClearsWithNull(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));

  await setRoleThroughTheWizard("Transformer 3", "f337-spec-beta");
  await waitFor(() => {
    expect(api.setAdminAssetGroupMemberRole).toHaveBeenCalledWith(
      "aaaa1111-0000-0000-0000-000000000003",
      "f337-spec-beta",
    );
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  await setRoleThroughTheWizard("Transformer 1", "");
  await waitFor(() => {
    // `null`, never "" — the API takes an explicit null to clear.
    expect(api.setAdminAssetGroupMemberRole).toHaveBeenCalledWith(
      "aaaa1111-0000-0000-0000-000000000001",
      null,
    );
  });
}

/** Ruling Q9: picking a role sends nothing until the wizard's Submit; the Review shows Now beside After. */
export async function aRolePickWaitsForTheReview(): Promise<void> {
  // A write that never settles: were the pick to send one, the wizard would stay open and only
  // the no-call assertions below could fail.
  stubApi({ setAdminAssetGroupMemberRole: () => new Promise<never>(() => {}) });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  const select = await screen.findByRole("combobox", { name: "Role for Transformer 1" });
  await waitFor(() => expect(within(select).getAllByRole("option").length).toBe(3));
  await userEvent.selectOptions(select, "f337-spec-beta");
  await screen.findByRole("dialog", { name: "Set the role of Transformer 1" });
  await settle();
  expect(api.setAdminAssetGroupMemberRole, "the pick sent the role before the Review").not.toHaveBeenCalled();
  await next();
  const card = await screen.findByRole("region", { name: "Set a member's role" });
  const row = within(card).getByRole("row", { name: /^Role/ });
  expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["f337-spec-alpha", "f337-spec-beta"]);
  await settle();
  expect(api.setAdminAssetGroupMemberRole).not.toHaveBeenCalled();
}

/**
 * A refused write is visible text, not a silent no-op.
 *
 * The API's 400 names the live codes, and losing that to a swallowed rejection
 * would make a mistyped import look like a working one.
 */
export async function showsTheServerRefusal(): Promise<void> {
  stubApi({
    setAdminAssetGroupMemberRole: (() =>
      Promise.reject(new Error('role "nope" is not a live value'))) as never,
  });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));

  await setRoleThroughTheWizard("Transformer 3", "f337-spec-beta");

  expect(await screen.findByRole("alert")).toHaveTextContent(/not a live value/);
}

/**
 * `F4.197` — an `ApiError` carries the whole response body, so a refusal read
 * through `err.message` showed `{"statusCode":409,…}` in the banner. Each write
 * site reads it through `apiErrorMessage`; one case per site, because a site
 * left on `err.message` reddens only its own case.
 */
const REFUSAL_SENTENCE = "An asset group with that code already exists at this location";
const refused = () =>
  Promise.reject(
    new ApiError(`{"statusCode":409,"message":"${REFUSAL_SENTENCE}","error":"Conflict"}`, 409),
  );

async function expectTheSentenceNotTheEnvelope(): Promise<void> {
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(REFUSAL_SENTENCE);
  expect(alert.textContent).not.toContain("statusCode");
}

export async function aRefusedSaveShowsTheSentence(): Promise<void> {
  stubApi({ createAdminAssetGroup: refused });
  renderPage();
  await screen.findByRole("button", { name: /Electrical train/ });

  const dialog = await fillCreateBasics(GROUP_LOCATION_ID, "electrical", "Duplicate");
  await next();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

  await expectTheSentenceNotTheEnvelope();
}

export async function aRefusedAddShowsTheSentence(): Promise<void> {
  stubApi({ addAdminAssetGroupMember: refused });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));

  const picker = await openAddMember();
  await userEvent.selectOptions(picker, ASSET_4);
  await next();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await expectTheSentenceNotTheEnvelope();
}

export async function aRefusedRemoveShowsTheSentence(): Promise<void> {
  stubApi({ removeAdminAssetGroupMember: refused });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await removeMemberAndConfirm("Transformer 1");

  await expectTheSentenceNotTheEnvelope();
}

export async function aRefusedRoleWriteShowsTheSentence(): Promise<void> {
  stubApi({ setAdminAssetGroupMemberRole: refused });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));

  await setRoleThroughTheWizard("Transformer 3", "f337-spec-beta");

  await expectTheSentenceNotTheEnvelope();
}

/**
 * Create sends the location chosen in the wizard, with the code and name
 * typed — exactly the body Review showed, once. (`F3.86` PR 3c: the
 * body-equality assertion a dropped `createValues` field reddens.)
 */
export async function createSendsTheSelectedLocation(): Promise<void> {
  stubApi();
  renderPage();
  await screen.findByRole("button", { name: /Electrical train/ });

  const dialog = await fillCreateBasics(OTHER_LOCATION_ID, "f378-spec-grp", "Spec group");
  await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Domain" }), "f386-spec-domain");
  await next();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

  await waitFor(() => {
    expect(vi.mocked(api.createAdminAssetGroup).mock.calls).toEqual([
      [{ locationId: OTHER_LOCATION_ID, code: "f378-spec-grp", name: "Spec group", description: null, domain: "f386-spec-domain" }],
    ]);
  });
}

/** `F3.86` PR 3c — the create wizard's steps are the catalog entry's, in its order, then Review. */
export async function createStepsAreBasicsDetailsReview(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "New group" }));
  await screen.findByRole("dialog", { name: "New asset group" });
  expect(stepTitles()).toEqual(["1. Basics", "2. Details", "3. Review"]);
}

/** The PR 9 regression: a location picked first in a fresh wizard stays picked. */
export async function aLocationPickedFirstStays(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "New group" }));
  const dialog = await screen.findByRole("dialog", { name: "New asset group" });
  const select = within(dialog).getByLabelText("Location") as HTMLSelectElement;
  await waitFor(() => expect(within(select).getAllByRole("option").length).toBe(3));
  await userEvent.selectOptions(select, OTHER_LOCATION_ID);
  expect(select.value).toBe(OTHER_LOCATION_ID);
  await userEvent.type(within(dialog).getByLabelText("Code"), "x");
  expect((within(dialog).getByLabelText("Location") as HTMLSelectElement).value).toBe(OTHER_LOCATION_ID);
}

/** An unpicked location holds Basics: the wizard is not a `<form>`, so `required` cannot. */
export async function anUnpickedLocationHoldsTheBasicsStep(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "New group" }));
  const dialog = await screen.findByRole("dialog", { name: "New asset group" });
  await userEvent.type(within(dialog).getByLabelText("Code"), "f386-x");
  await userEvent.type(within(dialog).getByLabelText("Name"), "No site");
  await next();
  await screen.findByRole("alert");
  expect(currentStep()).toBe("1. Basics");
  expect(api.createAdminAssetGroup).not.toHaveBeenCalled();
}

/**
 * The header rule: a wizard used alone sends the plain request — no
 * `X-Copilot-Change`. Read on the wire for the create and for the `DELETE`,
 * with `fetch` stubbed and the REAL API functions running; the positive is
 * that each request went out, to its route.
 */
export async function theWizardsSendNoCopilotHeader(): Promise<void> {
  stubApi();
  vi.mocked(api.createAdminAssetGroup).mockRestore();
  vi.mocked(api.removeAdminAssetGroupMember).mockRestore();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(JSON.stringify(GROUPS.items[0]), { status: 201 });
  });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await removeMemberAndConfirm("Transformer 1");
  const dialog = await fillCreateBasics(GROUP_LOCATION_ID, "f386-hdr", "Header check");
  await next();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

  const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
  await waitFor(() => expect(calls.some((call) => call.init.method === "POST")).toBe(true));
  const del = calls.find((call) => call.init.method === "DELETE") as { url: string; init: RequestInit };
  expect(del.url).toBe(`${base}/api/v1/admin/asset-group-members/aaaa1111-0000-0000-0000-000000000001`);
  expect(new Headers(del.init.headers).get("X-Copilot-Change")).toBeNull();
  const post = calls.find((call) => call.init.method === "POST") as { url: string; init: RequestInit };
  expect(post.url).toBe(`${base}/api/v1/admin/asset-groups`);
  expect(new Headers(post.init.headers).get("X-Copilot-Change")).toBeNull();
}

/** A copilot `fill_step` fills the named step's fields only; a field of another step is ignored. */
export async function aFillFillsTheNamedStepOnly(): Promise<void> {
  resetWizardStore();
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "New group" }));
  const dialog = await screen.findByRole("dialog", { name: "New asset group" });
  act(() => {
    useWizardStore.getState().receiveFill({
      catalogId: "assetGroup.create",
      stepId: "basics",
      values: { code: "f386-filled", name: "Filled group", description: "not a Basics field" },
    });
  });
  await waitFor(() => expect(within(dialog).getByLabelText("Code")).toHaveValue("f386-filled"));
  expect(within(dialog).getByLabelText("Name")).toHaveValue("Filled group");
  // The fill moved nothing: the step is still Basics, with no location picked.
  expect(currentStep()).toBe("1. Basics");
  await userEvent.selectOptions(within(dialog).getByLabelText("Location"), GROUP_LOCATION_ID);
  await next();
  expect(await within(dialog).findByLabelText("Description")).toHaveValue("");
}

/**
 * A group created at a location other than the filter's must stay visible and
 * selected: the page moves the filter to the saved group's location, so its
 * Edit button and member list belong to a group that is in the list.
 */
export async function createAtAnotherLocationMovesTheFilterThere(): Promise<void> {
  stubApi();
  const saved = {
    ...GROUPS.items[0],
    id: "55555555-5555-5555-5555-555555555555",
    code: "f378-spec-grp",
    name: "Spec group",
    locationId: OTHER_LOCATION_ID,
    locationName: "Plant 2",
  };
  vi.spyOn(api, "createAdminAssetGroup").mockResolvedValue(saved as never);
  vi.spyOn(api, "fetchAdminAssetGroups").mockImplementation(((locId?: string) =>
    Promise.resolve(locId === OTHER_LOCATION_ID ? { items: [saved] } : GROUPS)) as never);
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [{ id: "33333333-3333-3333-3333-333333333333", code: "ORG", name: "Org" }],
  } as never);
  renderPage();
  await screen.findByRole("button", { name: /Electrical train/ });

  // Put the filter bar on Plant 1.
  const orgOption = await screen.findByRole("option", { name: /ORG/ });
  await userEvent.selectOptions(
    orgOption.closest("select") as HTMLSelectElement,
    "33333333-3333-3333-3333-333333333333",
  );
  const plantOne = await screen.findByRole("option", { name: "Plant 1" });
  await userEvent.selectOptions(plantOne.closest("select") as HTMLSelectElement, GROUP_LOCATION_ID);
  await waitFor(() => {
    expect(api.fetchAdminAssetGroups).toHaveBeenCalledWith(GROUP_LOCATION_ID);
  });

  const dialog = await fillCreateBasics(OTHER_LOCATION_ID, "f378-spec-grp", "Spec group");
  await next();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

  expect(await screen.findByRole("button", { name: "Edit group" })).toBeVisible();
}

function PathProbe(): JSX.Element {
  return <output aria-label="current path">{useLocation().pathname}</output>;
}

/**
 * The filter bar filters this screen; it does not leave it. `HierarchyFilterBar`
 * syncs routes by default, so without `syncRoutes={false}` choosing an
 * organization navigated to that organization's Locations page and the groups
 * could never be filtered (found in the PR4 browser check). The plain
 * `renderPage` cannot see this: with no `<Routes>`, the page stays mounted
 * whatever the path is, hence the path probe.
 */
export async function choosingAnOrganizationStaysOnTheScreen(): Promise<void> {
  stubApi();
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [{ id: "33333333-3333-3333-3333-333333333333", code: "ORG", name: "Org" }],
  } as never);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/asset-groups"]}>
        <AssetGroupsAdminPage user={user} />
        <PathProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const orgOption = await screen.findByRole("option", { name: /ORG/ });
  await userEvent.selectOptions(
    orgOption.closest("select") as HTMLSelectElement,
    "33333333-3333-3333-3333-333333333333",
  );
  // Positive control: the choice took effect (the location select now lists Plant 1).
  expect(await screen.findByRole("option", { name: "Plant 1" })).toBeInTheDocument();
  expect(screen.getByLabelText("current path")).toHaveTextContent(/^\/admin\/asset-groups$/);
}

/** The picker offers the group's location's free assets, and nothing else. */
export async function pickerListsOnlyTheGroupsLocation(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));

  await userEvent.click(await screen.findByRole("button", { name: "Add an asset" }));
  const picker = await screen.findByRole("combobox", { name: "Asset to add" });
  await waitFor(() => {
    // ASSET_4 only: ASSET_1..3 are already members, ASSET_5 is at another location.
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Pick an asset…",
      "Transformer 4 (TRF-04)",
    ]);
  });
  expect(assetsApi.fetchAdminAssets).toHaveBeenCalledWith("true", GROUP_LOCATION_ID);
}

/** Adding sends the group id and the picked asset id — and the role picked beside it. */
export async function addSendsTheAssetId(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));

  const picker = await openAddMember();
  await userEvent.selectOptions(picker, ASSET_4);
  expect(stepTitles()).toEqual(["1. Member", "2. Review"]);
  await next();
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  await waitFor(() => {
    expect(vi.mocked(api.addAdminAssetGroupMember).mock.calls).toEqual([[GROUP_ID, { assetId: ASSET_4 }]]);
  });
}

/** An unpicked asset holds the Member step. */
export async function anUnpickedAssetHoldsTheMemberStep(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await openAddMember();
  await next();
  await screen.findByRole("alert");
  expect(currentStep()).toBe("1. Member");
  expect(api.addAdminAssetGroupMember).not.toHaveBeenCalled();
}

/** Removing sends the membership id, then re-reads the members query. */
export async function removeInvalidatesTheMembersQuery(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await removeMemberAndConfirm("Transformer 1");

  await waitFor(() => {
    expect(api.removeAdminAssetGroupMember).toHaveBeenCalledWith(
      "aaaa1111-0000-0000-0000-000000000001",
    );
  });
  // One read on selecting the group, one after the removal.
  await waitFor(() => {
    expect(api.fetchAdminAssetGroupMembers).toHaveBeenCalledTimes(2);
  });
}

/** Decision 3, ruling 19: the remove Review is the red (`deactivate`) card, one step, beside the dialog's sentence. */
export async function theRemoveReviewIsTheRedCard(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Remove Transformer 1" }));
  const dialog = await screen.findByRole("dialog", { name: "Remove Transformer 1 from Electrical train" });
  expect(stepTitles()).toEqual(["1. Review"]);
  expect(within(dialog).getByRole("region", { name: "Remove an asset from a group" })).toHaveAttribute(
    "data-risk",
    "deactivate",
  );
  expect(dialog).toHaveTextContent('Remove "Transformer 1 in Electrical train"');
}

/**
 * Starts a removal of Transformer 1 that never settles, so the page stays in
 * the pending state the two cases below read.
 */
async function startAPendingRemoval(): Promise<void> {
  stubApi({ removeAdminAssetGroupMember: () => new Promise<never>(() => {}) });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await removeMemberAndConfirm("Transformer 1");
}

/**
 * F4.168: the row being removed announces it. `removeMember` is one mutation
 * shared by every row, so the name keys on the pending membership id.
 */
export async function theRowBeingRemovedAnnouncesIt(): Promise<void> {
  await startAPendingRemoval();
  const button = await screen.findByRole("button", { name: "Removing Transformer 1…" });
  expect(button).toHaveAttribute("aria-busy", "true");
}

/**
 * The other rows are disabled while the removal runs, but keep their own
 * name: a label keyed on `isPending` alone would announce "Removing" on all.
 */
export async function theOtherRowsKeepTheirName(): Promise<void> {
  await startAPendingRemoval();
  await screen.findByRole("button", { name: "Removing Transformer 1…" });
  const other = screen.getByRole("button", { name: "Remove Transformer 3" });
  expect(other).toHaveAttribute("aria-busy", "false");
}

/**
 * `F4.202`: Cancel sends nothing. The adjacent positives: the wizard opened and named the asset,
 * the group and the result; it is gone after Cancel; the row still reads "Remove".
 */
export async function cancellingMemberRemoveSendsNothing(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Remove Transformer 1" }));
  const dialog = await screen.findByRole("dialog", { name: "Remove Transformer 1 from Electrical train" });
  expect(dialog).toHaveTextContent("Dashboards bound to this group no longer read this asset.");
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await settle();
  expect(screen.getByRole("button", { name: "Remove Transformer 1" })).toHaveAttribute("aria-busy", "false");
  expect(api.removeAdminAssetGroupMember).toHaveBeenCalledTimes(0);
}

/** `F4.202`: Submit sends exactly one request — not one on the row click and one on the Submit. */
export async function confirmingMemberRemoveSendsOneRequest(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await removeMemberAndConfirm("Transformer 1");
  // The wizard closes once the removal succeeded.
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Remove Transformer 1 from Electrical train" })).toBeNull(),
  );
  await waitFor(() => expect(api.removeAdminAssetGroupMember).toHaveBeenCalled());
  await settle();
  expect(api.removeAdminAssetGroupMember).toHaveBeenCalledTimes(1);
}

/**
 * `F4.202` review: a member-remove wizard left open does not survive a change of group. Kept
 * open, it would come back naming the newly selected group for a member of the old one.
 */
export async function pickingAnotherGroupClosesTheMemberRemoveDialog(): Promise<void> {
  stubApi();
  const water = { ...GROUPS.items[0], id: "66666666-6666-6666-6666-666666666666", code: "water", name: "Water train" };
  vi.spyOn(api, "fetchAdminAssetGroups").mockResolvedValue({ items: [...GROUPS.items, water] } as never);
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Remove Transformer 1" }));
  // Positive control: the wizard opened.
  await screen.findByRole("dialog", { name: "Remove Transformer 1 from Electrical train" });
  await userEvent.click(screen.getByRole("button", { name: /Water train/ }));
  expect(await screen.findByRole("heading", { name: "Members — Water train" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
}

/** The same for the filter bar: choosing an organization clears the selected group and the wizard. */
export async function changingTheFilterClosesTheMemberRemoveDialog(): Promise<void> {
  stubApi();
  vi.spyOn(organizationsApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [{ id: "33333333-3333-3333-3333-333333333333", code: "ORG", name: "Org" }],
  } as never);
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Remove Transformer 1" }));
  await screen.findByRole("dialog", { name: "Remove Transformer 1 from Electrical train" });
  const orgOption = await screen.findByRole("option", { name: /ORG/ });
  await userEvent.selectOptions(
    orgOption.closest("select") as HTMLSelectElement,
    "33333333-3333-3333-3333-333333333333",
  );
  // Positive control: the filter took effect and the group selection was cleared.
  expect(await screen.findByText("Select a group to set member roles.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
}

/**
 * Edit sends name and description for the group, and never a `code` key — nor
 * a `domain` the author did not pick: the list does not carry the stored one,
 * so sending a value would overwrite it.
 */
export async function editNeverSendsCode(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Edit group" }));

  const dialog = await screen.findByRole("dialog", { name: "Edit asset group" });
  // The code is shown as text, not as a field.
  expect(within(dialog).queryByLabelText("Code")).toBeNull();
  expect(stepTitles()).toEqual(["1. Basics", "2. Details", "3. Review"]);
  const name = within(dialog).getByLabelText("Name");
  await userEvent.clear(name);
  await userEvent.type(name, "Renamed train");
  await next();
  await next();
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

  await waitFor(() => {
    expect(api.updateAdminAssetGroup).toHaveBeenCalledTimes(1);
  });
  const [id, body] = vi.mocked(api.updateAdminAssetGroup).mock.calls[0] as [string, object];
  expect(id).toBe(GROUP_ID);
  expect(body).toEqual({ name: "Renamed train", description: null });
  expect("code" in body).toBe(false);
}

/** The edit's Review shows the stored name beside the new one. */
export async function theEditReviewShowsNowBesideAfter(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Edit group" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit asset group" });
  fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Renamed train" } });
  await next();
  await next();
  const card = await within(dialog).findByRole("region", { name: "Edit an asset group" });
  const row = within(card).getByRole("row", { name: /^Name/ });
  expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Electrical train", "Renamed train"]);
}

/** A role with no write gate sees the groups and none of the write controls. */
export async function aReadOnlyRoleSeesNoWriteControls(): Promise<void> {
  stubApi();
  renderPage({ ...user, role: "viewer" } as unknown as AuthUser);
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await screen.findByText("Transformer 1");

  expect(screen.queryByRole("button", { name: "New group" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit group" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add an asset" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove Transformer 1" })).toBeNull();
}
