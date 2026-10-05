import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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
import { AssetGroupsAdminPage } from "./asset-groups-page";

/**
 * `F3.37` (ADR 0049 decision 5) — the asset-group screen, rendered (ADR 0042).
 *
 * Assertions live here; `asset-groups-page.test.tsx` is the Vitest entry point
 * and carries the `@vitest-environment jsdom` docblock, because that is the
 * file Vitest collects.
 *
 * Queries go by role and text (ADR 0042 decision 5).
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
 * mirrored the seed would pass whether or not the component read it.
 */
const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [],
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
      assetId: "asset-3",
      assetCode: "TRF-03",
      assetName: "Transformer 3",
      assetDomain: "electrical",
      role: null,
      roleLabel: null,
    },
    {
      membershipId: "aaaa1111-0000-0000-0000-000000000001",
      assetId: "asset-1",
      assetCode: "TRF-01",
      assetName: "Transformer 1",
      assetDomain: "electrical",
      role: "f337-spec-alpha",
      roleLabel: "Spec Alpha Role",
    },
    {
      membershipId: "aaaa1111-0000-0000-0000-000000000002",
      assetId: "asset-2",
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
 * Assets at the group's location and at another one. `asset-1..3` are the
 * group's members (MEMBERS); `asset-4` is free at the group's location and
 * `asset-5` is free at the other location.
 */
function assetAt(id: string, code: string, name: string, locationId: string) {
  return { id, code, name, locationId, active: true };
}
const ASSETS = [
  assetAt("asset-1", "TRF-01", "Transformer 1", GROUP_LOCATION_ID),
  assetAt("asset-2", "TRF-02", "Transformer 2", GROUP_LOCATION_ID),
  assetAt("asset-3", "TRF-03", "Transformer 3", GROUP_LOCATION_ID),
  assetAt("asset-4", "TRF-04", "Transformer 4", GROUP_LOCATION_ID),
  assetAt("asset-5", "PMP-05", "Pump 5 elsewhere", OTHER_LOCATION_ID),
];
const LOCATIONS = {
  items: [
    { id: GROUP_LOCATION_ID, name: "Plant 1" },
    { id: OTHER_LOCATION_ID, name: "Plant 2" },
  ],
};

function renderPage(as: AuthUser = user): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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

/** Choosing a role sends the code; choosing "No role" sends an explicit null. */
export async function sendsTheCodeAndClearsWithNull(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));

  const select = await screen.findByRole("combobox", { name: "Role for Transformer 3" });
  await userEvent.selectOptions(select, "f337-spec-beta");

  await waitFor(() => {
    expect(api.setAdminAssetGroupMemberRole).toHaveBeenCalledWith(
      "aaaa1111-0000-0000-0000-000000000003",
      "f337-spec-beta",
    );
  });

  const first = await screen.findByRole("combobox", { name: "Role for Transformer 1" });
  await userEvent.selectOptions(first, "");

  await waitFor(() => {
    // `null`, never "" — the API takes an explicit null to clear.
    expect(api.setAdminAssetGroupMemberRole).toHaveBeenCalledWith(
      "aaaa1111-0000-0000-0000-000000000001",
      null,
    );
  });
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

  const select = await screen.findByRole("combobox", { name: "Role for Transformer 3" });
  await userEvent.selectOptions(select, "f337-spec-beta");

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

  await userEvent.click(screen.getByRole("button", { name: "New group" }));
  const dialog = await screen.findByRole("dialog", { name: "New asset group" });
  const select = within(dialog).getByLabelText("Location");
  await waitFor(() => {
    expect(within(select).getAllByRole("option").length).toBe(3);
  });
  await userEvent.selectOptions(select, GROUP_LOCATION_ID);
  await userEvent.type(within(dialog).getByLabelText("Code"), "electrical");
  await userEvent.type(within(dialog).getByLabelText("Name"), "Duplicate");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

  await expectTheSentenceNotTheEnvelope();
}

export async function aRefusedAddShowsTheSentence(): Promise<void> {
  stubApi({ addAdminAssetGroupMember: refused });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));

  const picker = await screen.findByRole("combobox", { name: "Asset to add" });
  await waitFor(() => {
    expect(within(picker).getAllByRole("option").length).toBe(2);
  });
  await userEvent.selectOptions(picker, "asset-4");
  await userEvent.click(screen.getByRole("button", { name: "Add to group" }));

  await expectTheSentenceNotTheEnvelope();
}

export async function aRefusedRemoveShowsTheSentence(): Promise<void> {
  stubApi({ removeAdminAssetGroupMember: refused });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Remove Transformer 1" }));

  await expectTheSentenceNotTheEnvelope();
}

export async function aRefusedRoleWriteShowsTheSentence(): Promise<void> {
  stubApi({ setAdminAssetGroupMemberRole: refused });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));

  const select = await screen.findByRole("combobox", { name: "Role for Transformer 3" });
  await waitFor(() => {
    expect(within(select).getAllByRole("option").length).toBe(3);
  });
  await userEvent.selectOptions(select, "f337-spec-beta");

  await expectTheSentenceNotTheEnvelope();
}

/** Create sends the location chosen in the modal, with the code and name typed. */
export async function createSendsTheSelectedLocation(): Promise<void> {
  stubApi();
  renderPage();
  await screen.findByRole("button", { name: /Electrical train/ });

  await userEvent.click(screen.getByRole("button", { name: "New group" }));
  const dialog = await screen.findByRole("dialog", { name: "New asset group" });
  const select = within(dialog).getByLabelText("Location");
  await waitFor(() => {
    expect(within(select).getAllByRole("option").length).toBe(3);
  });
  await userEvent.selectOptions(select, OTHER_LOCATION_ID);
  await userEvent.type(within(dialog).getByLabelText("Code"), "f378-spec-grp");
  await userEvent.type(within(dialog).getByLabelText("Name"), "Spec group");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(api.createAdminAssetGroup).toHaveBeenCalledWith({
      locationId: OTHER_LOCATION_ID,
      code: "f378-spec-grp",
      name: "Spec group",
      description: null,
    });
  });
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

  await userEvent.click(await screen.findByRole("button", { name: "New group" }));
  const dialog = await screen.findByRole("dialog", { name: "New asset group" });
  const select = within(dialog).getByLabelText("Location");
  await waitFor(() => {
    expect(within(select).getAllByRole("option").length).toBe(3);
  });
  await userEvent.selectOptions(select, OTHER_LOCATION_ID);
  await userEvent.type(within(dialog).getByLabelText("Code"), "f378-spec-grp");
  await userEvent.type(within(dialog).getByLabelText("Name"), "Spec group");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

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

  const picker = await screen.findByRole("combobox", { name: "Asset to add" });
  await waitFor(() => {
    // asset-4 only: asset-1..3 are already members, asset-5 is at another location.
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Add an asset…",
      "Transformer 4 (TRF-04)",
    ]);
  });
  expect(assetsApi.fetchAdminAssets).toHaveBeenCalledWith("true", GROUP_LOCATION_ID);
}

/** Adding sends the group id and the picked asset id. */
export async function addSendsTheAssetId(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));

  const picker = await screen.findByRole("combobox", { name: "Asset to add" });
  await waitFor(() => {
    expect(within(picker).getAllByRole("option").length).toBe(2);
  });
  await userEvent.selectOptions(picker, "asset-4");
  await userEvent.click(screen.getByRole("button", { name: "Add to group" }));

  await waitFor(() => {
    expect(api.addAdminAssetGroupMember).toHaveBeenCalledWith(GROUP_ID, { assetId: "asset-4" });
  });
}

/** Removing sends the membership id, then re-reads the members query. */
export async function removeInvalidatesTheMembersQuery(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Remove Transformer 1" }));

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

/**
 * Starts a removal of Transformer 1 that never settles, so the page stays in
 * the pending state the two cases below read.
 */
async function startAPendingRemoval(): Promise<void> {
  stubApi({ removeAdminAssetGroupMember: () => new Promise<never>(() => {}) });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Remove Transformer 1" }));
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

/** Edit sends name and description for the group, and never a `code` key. */
export async function editNeverSendsCode(): Promise<void> {
  stubApi();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await userEvent.click(await screen.findByRole("button", { name: "Edit group" }));

  const dialog = await screen.findByRole("dialog", { name: "Edit asset group" });
  // The code is shown as text, not as a field.
  expect(within(dialog).queryByLabelText("Code")).toBeNull();
  const name = within(dialog).getByLabelText("Name");
  await userEvent.clear(name);
  await userEvent.type(name, "Renamed train");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => {
    expect(api.updateAdminAssetGroup).toHaveBeenCalledTimes(1);
  });
  const [id, body] = vi.mocked(api.updateAdminAssetGroup).mock.calls[0] as [string, object];
  expect(id).toBe(GROUP_ID);
  expect(body).toEqual({ name: "Renamed train", description: null });
  expect("code" in body).toBe(false);
}

/** A role with no write gate sees the groups and none of the write controls. */
export async function aReadOnlyRoleSeesNoWriteControls(): Promise<void> {
  stubApi();
  renderPage({ ...user, role: "viewer" } as unknown as AuthUser);
  await userEvent.click(await screen.findByRole("button", { name: /Electrical train/ }));
  await screen.findByText("Transformer 1");

  expect(screen.queryByRole("button", { name: "New group" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit group" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove Transformer 1" })).toBeNull();
}
