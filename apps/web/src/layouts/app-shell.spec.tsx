import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import { assetListRowSchema } from "@bms/shared/contracts";
import type { AccessibleScope, AssetListRow, UserRole } from "@bms/shared";

import * as assetsApi from "../api/assets";
import { useAuthStore, type AuthUser } from "../stores/auth-store";
import { AppShell } from "./app-shell";

/**
 * `F4.156` — the *Control Room 2D* sidebar group is gated on a readable
 * `CR-*` asset.
 *
 * Assertions live here; `app-shell.test.tsx` is the Vitest entry point and
 * carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042
 * decision 2).
 *
 * The defect: `isVisible` returned `true` for every scope kind except
 * `asset_group`, so a PHE `organization_admin` (scope `kind: "location"`)
 * saw seven links to pages that render Eskom's Control Room. The group now
 * shows only when the caller's `["assets"]` read holds a `CR-*` code; it hides
 * while that read is pending or failed, and the per-area `asset_group` rule
 * stays on top. When no item survives, the group heading hides too.
 */

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

function row(overrides: Pick<AssetListRow, "id" | "code" | "name">): AssetListRow {
  return assetListRowSchema.parse({
    siteName: "Site A",
    domain: "hvac",
    locationId: "22222222-2222-4222-8222-222222222222",
    locationName: "Western Cape control room",
    rtuId: null,
    rtuDisplayName: null,
    telemetrySource: null,
    active: true,
    templateId: null,
    ...overrides,
  });
}

const ESKOM_ROWS: AssetListRow[] = [
  row({ id: "11111111-1111-4111-8111-111111111111", code: "CR-Q1", name: "Q1 Main MCCB" }),
  row({ id: "11111111-1111-4111-8111-111111111112", code: "CR-HVAC-1", name: "Control Room HVAC 1" }),
];

const PHE_ROWS: AssetListRow[] = [
  row({ id: "33333333-3333-4333-8333-333333333333", code: "FEED-PUMP-2", name: "Feed pump 2" }),
];

const GLOBAL: AccessibleScope = { kind: "global", locations: [], assetGroups: [], assetIds: [] };

/** An `organization_admin` gets `kind: "location"` — there is no `organization` kind. */
const LOCATION: AccessibleScope = {
  kind: "location",
  locations: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      code: "PHE-1",
      slug: "phe-1",
      name: "PHE plant",
      type: "smoc_campus",
      province: null,
    },
  ],
  assetGroups: [],
  assetIds: [],
};

const HVAC_ONLY: AccessibleScope = {
  kind: "asset_group",
  locations: [],
  assetGroups: [
    {
      id: "66666666-6666-4666-8666-666666666666",
      locationId: "22222222-2222-4222-8222-222222222222",
      code: "hvac",
      name: "HVAC",
      organizationId: "77777777-7777-4777-8777-777777777777",
    },
  ],
  assetIds: [],
};

const NONE: AccessibleScope = { kind: "none", locations: [], assetGroups: [], assetIds: [] };

type Read = AssetListRow[] | "pending" | "rejected";

function renderShell(scope: AccessibleScope, read: Read): QueryClient {
  const spy = vi.spyOn(assetsApi, "fetchAssets");
  if (read === "pending") {
    spy.mockReturnValue(new Promise<AssetListRow[]>(() => {}));
  } else if (read === "rejected") {
    spy.mockRejectedValue(new Error("assets read failed"));
  } else {
    spy.mockResolvedValue(read);
  }
  useAuthStore.setState({ scope });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <AppShell user={asUser("organization_admin")} kpiRibbon={<span />}>
          body
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

function sidebar(): HTMLElement {
  return screen.getByRole("complementary");
}

function controlRoomLinks(): Element[] {
  return Array.from(sidebar().querySelectorAll('a[href^="/cr-"]'));
}

async function settled(client: QueryClient, status: "success" | "error"): Promise<void> {
  await waitFor(() => {
    expect(client.getQueryState(["assets"])?.status).toBe(status);
  });
}

/** S1 — positive control: a caller who reads `CR-*` rows sees the whole group. */
export async function showsTheGroupToACallerWhoReadsControlRoomAssets(): Promise<void> {
  renderShell(LOCATION, ESKOM_ROWS);
  expect(
    await within(sidebar()).findByRole("link", { name: "CR · Main Dashboard" }),
  ).toBeInTheDocument();
  expect(controlRoomLinks()).toHaveLength(7);
  expect(within(sidebar()).getByText("Control Room 2D")).toBeInTheDocument();
}

/** S2 — the defect: a `location`-scoped caller with no `CR-*` row sees no group. */
export async function hidesTheGroupFromACallerWithNoControlRoomAsset(): Promise<void> {
  const client = renderShell(LOCATION, PHE_ROWS);
  await settled(client, "success");
  expect(controlRoomLinks()).toHaveLength(0);
  expect(within(sidebar()).queryByText("Control Room 2D")).toBeNull();
}

/**
 * S3 — while the read is pending the group is hidden. The Alarm Centre link
 * is the positive control that the sidebar rendered at all.
 */
export function hidesTheGroupWhilePending(): void {
  renderShell(GLOBAL, "pending");
  expect(within(sidebar()).getByRole("link", { name: "Alarm Centre" })).toBeInTheDocument();
  expect(controlRoomLinks()).toHaveLength(0);
}

/** S4 — a failed read hides the group. */
export async function hidesTheGroupWhenTheReadFails(): Promise<void> {
  const client = renderShell(GLOBAL, "rejected");
  await settled(client, "error");
  expect(within(sidebar()).getByRole("link", { name: "Alarm Centre" })).toBeInTheDocument();
  expect(controlRoomLinks()).toHaveLength(0);
}

/** S5 — the per-area `asset_group` rule stays on top of the asset gate. */
export async function keepsThePerAreaRule(): Promise<void> {
  renderShell(HVAC_ONLY, ESKOM_ROWS);
  const nav = within(sidebar());
  expect(await nav.findByRole("link", { name: "CR · Main Dashboard" })).toBeInTheDocument();
  expect(nav.getByRole("link", { name: "CR · HVAC System" })).toBeInTheDocument();
  expect(nav.queryByRole("link", { name: "CR · Electrical SLD" })).toBeNull();
}

/** S6 — a `none` scope sees no Control Room link even when the read holds `CR-*` rows. */
export async function hidesTheGroupFromANoneScope(): Promise<void> {
  const client = renderShell(NONE, ESKOM_ROWS);
  await settled(client, "success");
  expect(controlRoomLinks()).toHaveLength(0);
}

/**
 * S7 — the shell reads the same `["assets"]` key the schematic provider
 * issues, so a Control Room page opened from the sidebar starts from cache.
 */
export async function sharesTheAssetsQueryKey(): Promise<void> {
  const client = renderShell(LOCATION, ESKOM_ROWS);
  await within(sidebar()).findByRole("link", { name: "CR · Main Dashboard" });
  expect(client.getQueryData(["assets"])).toEqual(ESKOM_ROWS);
}
