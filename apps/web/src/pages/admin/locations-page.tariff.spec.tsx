import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";
import type { AdminLocationDto } from "@bms/shared";

import * as groupsApi from "../../api/admin/asset-groups";
import * as api from "../../api/admin/locations";
import * as orgApi from "../../api/admin/organizations";
import * as copilotApi from "../../api/copilot";
import type { AuthUser } from "../../stores/auth-store";
import { LocationsAdminPage } from "./locations-page";

/**
 * `F4.365` U8 (ADR 0134 decision 3; plan Q10) — the Locations screen's "Tariff" row action opens
 * that location's tariff page, and only that row's. `locations-page.tariff.test.tsx` is the
 * Vitest entry and carries the jsdom docblock.
 */

const ORG_ID = "33333333-3333-3333-3333-333333333333";
const SITE_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_SITE_ID = "22222222-2222-2222-2222-222222222222";

function location(overrides: Partial<AdminLocationDto>): AdminLocationDto {
  return {
    id: SITE_ID,
    parentId: null,
    organizationId: ORG_ID,
    organizationCode: "PHEWB",
    organizationName: "PHE West Bengal",
    code: "F4365-A",
    slug: "f4365-a",
    name: "Tariff site",
    type: "rsmoc",
    typeLabel: "RSMOC",
    province: null,
    capital: null,
    timezone: null,
    floorAreaM2: null,
    latitude: 0,
    longitude: 0,
    active: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function TariffProbe() {
  return <p>tariff page probe</p>;
}

export async function theTariffActionOpensThatLocationsTariffPage(): Promise<void> {
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(api, "fetchAdminLocations").mockResolvedValue({
    items: [location({}), location({ id: OTHER_SITE_ID, code: "F4365-B", slug: "f4365-b", name: "Other site" })],
  });
  vi.spyOn(api, "fetchAdminLocationTypes").mockResolvedValue({ items: [{ code: "rsmoc", label: "RSMOC" }] } as never);
  vi.spyOn(orgApi, "fetchAdminOrganizations").mockResolvedValue({
    items: [{ id: ORG_ID, code: "PHEWB", name: "PHE West Bengal", active: true, meta: null, createdAt: new Date(0).toISOString() }],
  } as never);
  vi.spyOn(groupsApi, "fetchAdminAssetGroups").mockResolvedValue({ items: [] } as never);
  const user = { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" } as unknown as AuthUser;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/locations"]}>
        <Routes>
          <Route path="/admin/locations" element={<LocationsAdminPage user={user} />} />
          <Route path={`/admin/locations/${OTHER_SITE_ID}/tariff`} element={<TariffProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const row = (await screen.findByText("Other site")).closest("tr") as HTMLElement;
  await userEvent.click(within(row).getByRole("button", { name: "Tariff" }));
  expect(await screen.findByText("tariff page probe")).toBeInTheDocument();
}
