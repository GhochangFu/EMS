import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import { adminAssetDtoSchema } from "@bms/shared/contracts";
import type { AdminAssetDto } from "@bms/shared";

import * as assetsApi from "../../api/admin/assets";
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
function asset(overrides: Pick<AdminAssetDto, "id" | "code" | "name">): AdminAssetDto {
  return adminAssetDtoSchema.parse({
    siteName: "Plant 1",
    locationId: "22222222-2222-4222-8222-222222222222",
    locationName: "Plant 1",
    organizationCode: "ESKOM",
    rtuId: null,
    rtuDisplayName: null,
    domain: "electrical",
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
});

const VOCABULARIES = {
  ruleCategories: [],
  assetDomains: [{ code: "electrical", label: "Electrical", sortOrder: 10, active: true }],
  alarmSeverities: [],
  alarmSkills: [],
  assetRoles: [],
};

function stubApi(): void {
  vi.spyOn(assetsApi, "fetchAdminAssets").mockResolvedValue({
    items: [FIRST, SECOND],
  } as never);
  vi.spyOn(vocabApi, "fetchVocabularies").mockResolvedValue(VOCABULARIES as never);
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
