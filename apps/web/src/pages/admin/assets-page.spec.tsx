import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import { adminAssetDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetDto } from "@bms/shared";

import * as assetsApi from "../../api/admin/assets";
import * as locationsApi from "../../api/admin/locations";
import * as rtusApi from "../../api/admin/rtus";
import * as assetImagesApi from "../../api/asset-images";
import * as vocabApi from "../../api/vocabularies";
import type { AuthUser } from "../../stores/auth-store";
import { AssetsAdminPage } from "./assets-page";

/**
 * `F3.4` Unit 8 — the "Images" row action on the admin assets screen (owner
 * rulings Q-0 and Q-2). The first spec this page has had.
 *
 * Assertions live here; `assets-page.test.tsx` is the Vitest entry point and
 * carries `@vitest-environment jsdom` (ADR 0014 / ADR 0042 decision 2).
 *
 * Scope is the row action and the panel it opens. The panel's own behaviour —
 * every sentence, the cap, the upload and the delete — is asserted in
 * `components/assets/asset-images-panel.spec.tsx`, and repeating it here would
 * be a second copy of the same claims rendered through a bigger tree.
 */

const user: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

/** A DTO the contract accepts — an off-shape fixture would fail somewhere else. */
function asset(
  overrides: Pick<AdminAssetDto, "id" | "code" | "name"> & Partial<AdminAssetDto>,
): AdminAssetDto {
  return adminAssetDtoSchema.parse({
    siteName: "Plant 1",
    locationId: "22222222-2222-4222-8222-222222222222",
    locationName: "Plant 1",
    organizationCode: "ESKOM",
    rtuId: null,
    rtuDisplayName: null,
    domain: "electrical",
    waterBalanceRole: null,
    active: true,
    templateId: null,
    templateCode: null,
    templateVersion: null,
    meta: null,
    createdAt: "2026-09-16T10:00:00.000Z",
    ...overrides,
  });
}

/**
 * Two rows, not one. The claim is that the panel names **that** row's asset,
 * and a single-row list is satisfied identically by a panel that names the
 * only asset it could have found.
 */
const FIRST = asset({
  id: "11111111-1111-4111-8111-111111111111",
  code: "TRF-01",
  name: "Transformer 1",
});
const SECOND = asset({
  id: "33333333-3333-4333-8333-333333333333",
  code: "PMP-02",
  name: "Pump 2",
  // `E4.3` — the one row with a role, so the edit prefill claim reads a real value.
  waterBalanceRole: "intake",
});

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [{ code: "electrical", label: "Electrical", sortOrder: 10, active: true }],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
  // `E4.3` (ADR 0073 decision 1) — the four seeded rows, in `0080`'s sort order.
  waterBalanceRoles: [
    { code: "intake", label: "Intake", sortOrder: 10, active: true },
    { code: "discharge", label: "Discharge", sortOrder: 20, active: true },
    { code: "reuse", label: "Reuse", sortOrder: 30, active: true },
    { code: "internal", label: "Internal", sortOrder: 40, active: true },
  ],
};

const LOCATION_ID = "22222222-2222-4222-8222-222222222222";

function stubApi(items: readonly AdminAssetDto[] = [FIRST, SECOND]): void {
  vi.spyOn(assetsApi, "fetchAdminAssets").mockResolvedValue({
    items: [...items],
  } as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
  // The form's location <select> is `required`; one option lets a submit through.
  vi.spyOn(locationsApi, "fetchAdminLocations").mockResolvedValue({
    items: [{ id: LOCATION_ID, name: "Plant 1" }],
  } as never);
  vi.spyOn(rtusApi, "fetchAdminRtus").mockResolvedValue({ items: [] } as never);
  // The panel mounts a gallery as soon as it opens; both reads are stubbed so
  // no row here depends on the network.
  vi.spyOn(assetImagesApi, "fetchAssetImages").mockResolvedValue([]);
  vi.spyOn(assetImagesApi, "fetchAssetImageBlob").mockResolvedValue(
    new Blob(["x"], { type: "image/png" }),
  );
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AssetsAdminPage user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Opens the panel from the second row and returns nothing — the rows are found by role. */
async function openImagesOnTheSecondRow(): Promise<void> {
  const buttons = await screen.findAllByRole("button", { name: "Images" });
  await userEvent.click(buttons[1] as HTMLElement);
}

/**
 * P1 — "Images" on a row opens the panel for that row's asset.
 *
 * The heading carries the code, so a panel wired to the wrong row fails here
 * rather than passing on the presence of any panel at all.
 */
export async function imagesOpensThePanelForThatRow(): Promise<void> {
  stubApi();
  renderPage();

  await openImagesOnTheSecondRow();

  expect(await screen.findByRole("heading", { name: "Images · PMP-02" })).toBeInTheDocument();
}

/**
 * P2 — Close takes the panel away and leaves the list alone.
 *
 * The still-rendered row is the positive control and is asserted **first**:
 * `expect` throws, so an absence check placed ahead of it would also pass on a
 * page that unmounted its whole table.
 */
export async function closeRemovesThePanelAndLeavesTheRow(): Promise<void> {
  stubApi();
  renderPage();

  await openImagesOnTheSecondRow();
  await screen.findByRole("heading", { name: "Images · PMP-02" });
  await userEvent.click(screen.getByRole("button", { name: "Close" }));

  expect(screen.getByText("PMP-02")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Images · PMP-02" })).toBeNull();
}

// ---------------------------------------------------------------------------
// `E4.3` U3 (ADR 0073 decision 1) — the water balance role select. One claim
// per exported function; the options come from the vocabulary stub above.
// ---------------------------------------------------------------------------

/** The role <select>, found by its label once the vocabulary's options have rendered. */
async function openAddAndFindRoleSelect(): Promise<HTMLSelectElement> {
  await userEvent.click(await screen.findByRole("button", { name: "Add asset" }));
  const select = screen.getByRole("combobox", { name: /Water balance role/ }) as HTMLSelectElement;
  // Wait on what the vocabulary produces: the select itself renders before the fetch resolves,
  // holding only the empty option.
  await within(select).findByRole("option", { name: "Reuse" });
  return select;
}

/** Fills the three required text fields and the location, so the form can submit. */
async function fillRequiredFields(): Promise<void> {
  await userEvent.type(screen.getByRole("textbox", { name: "Code" }), "WTR-01");
  await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Water 1");
  await userEvent.type(screen.getByRole("textbox", { name: "Site name" }), "Plant 1");
  const location = screen.getByRole("combobox", { name: /Location/ });
  await within(location).findByRole("option", { name: "Plant 1" });
  await userEvent.selectOptions(location, LOCATION_ID);
}

/** Five options — "not in the balance" first, then the four vocabulary rows. */
export async function roleSelectOffersTheVocabularyAfterAnEmptyOption(): Promise<void> {
  stubApi();
  renderPage();

  const select = await openAddAndFindRoleSelect();

  expect(
    Array.from(select.options).map((option) => [option.value, option.textContent]),
  ).toEqual([
    ["", "Not in the balance"],
    ["intake", "Intake"],
    ["discharge", "Discharge"],
    ["reuse", "Reuse"],
    ["internal", "Internal"],
  ]);
}

/** Saving with `reuse` selected sends `waterBalanceRole: "reuse"`. */
export async function savingWithARoleSendsIt(): Promise<void> {
  stubApi();
  const create = vi.spyOn(assetsApi, "createAdminAsset").mockResolvedValue(FIRST);
  renderPage();

  const select = await openAddAndFindRoleSelect();
  await fillRequiredFields();
  await userEvent.selectOptions(select, "reuse");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0]?.[0]).toMatchObject({ waterBalanceRole: "reuse" });
}

/** Saving with nothing selected sends `null`, never `""` (the schema's `min(1)` would 400). */
export async function savingWithNoRoleSendsNull(): Promise<void> {
  stubApi();
  const create = vi.spyOn(assetsApi, "createAdminAsset").mockResolvedValue(FIRST);
  renderPage();

  await openAddAndFindRoleSelect();
  await fillRequiredFields();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0]?.[0]).toMatchObject({ waterBalanceRole: null });
}

/** Edit prefills the select from the row's stored role. */
export async function editPrefillsTheStoredRole(): Promise<void> {
  stubApi();
  renderPage();

  const edits = await screen.findAllByRole("button", { name: "Edit" });
  await userEvent.click(edits[1] as HTMLElement);
  const select = screen.getByRole("combobox", { name: /Water balance role/ }) as HTMLSelectElement;
  await within(select).findByRole("option", { name: "Intake" });

  expect(select.value).toBe("intake");
}

// ---------------------------------------------------------------------------
// Post-merge sweep L1 — an asset whose stored role is no longer in the vocabulary. Without an
// option for it the select shows its first option ("Not in the balance") while the form still
// holds the code, so the author reads a state the save would not send.
// ---------------------------------------------------------------------------

/** A code the vocabulary stub does not carry: retired since the asset stored it. */
const RETIRED_ROLE = "legacy_blowdown";
const RETIRED = asset({
  id: "44444444-4444-4444-8444-444444444444",
  code: "BLD-03",
  name: "Blowdown 3",
  waterBalanceRole: RETIRED_ROLE,
});

/** Opens Edit on the only row, waiting on a vocabulary option so the list has loaded. */
async function editTheOnlyRowAndFindRoleSelect(): Promise<HTMLSelectElement> {
  const edit = await screen.findByRole("button", { name: "Edit" });
  await userEvent.click(edit);
  const select = screen.getByRole("combobox", { name: /Water balance role/ }) as HTMLSelectElement;
  await within(select).findByRole("option", { name: "Intake" });
  return select;
}

/** Edit of an asset with a retired stored role keeps that code as the select's value. */
export async function editOfARetiredStoredRoleKeepsItsValue(): Promise<void> {
  stubApi([RETIRED]);
  renderPage();

  const select = await editTheOnlyRowAndFindRoleSelect();

  expect(select.value).toBe(RETIRED_ROLE);
}

/** The same edit renders one extra option for the stored code, marked "(retired)". */
export async function editOfARetiredStoredRoleOffersItMarkedRetired(): Promise<void> {
  stubApi([RETIRED]);
  renderPage();

  const select = await editTheOnlyRowAndFindRoleSelect();

  const option = within(select).getByRole("option", { name: `${RETIRED_ROLE} (retired)` });
  expect((option as HTMLOptionElement).value).toBe(RETIRED_ROLE);
}

/** Control: an asset whose stored role is live renders no "(retired)" option. */
export async function editOfALiveStoredRoleOffersNoRetiredOption(): Promise<void> {
  stubApi([SECOND]);
  renderPage();

  const select = await editTheOnlyRowAndFindRoleSelect();

  expect(select.value).toBe("intake");
  expect(
    Array.from(select.options).filter((option) => option.textContent?.includes("(retired)")),
  ).toEqual([]);
}
