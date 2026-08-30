import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import * as api from "../../api/admin/asset-groups";
import * as vocabApi from "../../api/vocabularies";
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

/** Two of three members carry the same role — decision 6's N-minus-one case. */
const MEMBERS = {
  items: [
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
    {
      membershipId: "aaaa1111-0000-0000-0000-000000000003",
      assetId: "asset-3",
      assetCode: "TRF-03",
      assetName: "Transformer 3",
      assetDomain: "electrical",
      role: null,
      roleLabel: null,
    },
  ],
  roleCounts: { "f337-spec-alpha": 2 },
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
type ApiFn = "fetchAdminAssetGroups" | "fetchAdminAssetGroupMembers" | "setAdminAssetGroupMemberRole";

function stubApi(overrides: Partial<Record<ApiFn, unknown>> = {}): void {
  vi.spyOn(api, "fetchAdminAssetGroups").mockResolvedValue(GROUPS);
  vi.spyOn(api, "fetchAdminAssetGroupMembers").mockResolvedValue(MEMBERS);
  vi.spyOn(api, "setAdminAssetGroupMemberRole").mockResolvedValue(
    MEMBERS.items[0] as never,
  );
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
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
  expect(rendered).toEqual(["TRF-01", "TRF-02", "TRF-03"]);
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
