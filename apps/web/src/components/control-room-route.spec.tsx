import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, vi } from "vitest";

import { assetListRowSchema } from "@bms/shared/contracts";
import type { AccessibleScope, AssetListRow } from "@bms/shared";

import * as assetsApi from "../api/assets";
import { useAuthStore } from "../stores/auth-store";
import { ControlRoomRoute } from "./control-room-route";

/**
 * `F4.156` — the `/cr-*` route guard.
 *
 * Assertions live here; `control-room-route.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014,
 * ADR 0042 decision 2).
 *
 * The guard decides from the caller's already-filtered `GET /api/v1/assets`
 * body: no readable `CR-*` row sends the caller to `/`. It fails closed while
 * the read is pending (a status line, no page, no redirect — a cold reload of
 * `/cr-*` must not bounce a legitimate user) and treats a failed read as
 * denied. The per-area `asset_group` rule (`canAccessControlRoomPath`) stays
 * on top of it.
 */

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
const PHE_LOCATION: AccessibleScope = {
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

const ELECTRICAL_ONLY: AccessibleScope = {
  kind: "asset_group",
  locations: [],
  assetGroups: [
    {
      id: "66666666-6666-4666-8666-666666666666",
      locationId: "22222222-2222-4222-8222-222222222222",
      code: "electrical",
      name: "Electrical",
      organizationId: "77777777-7777-4777-8777-777777777777",
    },
  ],
  assetIds: [],
};

/** Renders wherever the guard sent us, so a redirect is observable. */
function Elsewhere() {
  const location = useLocation();
  return <p>landed on {location.pathname}</p>;
}

type Read = AssetListRow[] | "pending" | "rejected";

function renderGuard(path: string, scope: AccessibleScope, read: Read): void {
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
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path={path}
            element={
              <ControlRoomRoute>
                <p>CR PAGE</p>
              </ControlRoomRoute>
            }
          />
          <Route path="*" element={<Elsewhere />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** G1 — positive control: a global caller who reads `CR-*` rows opens the page. */
export async function admitsACallerWhoReadsControlRoomAssets(): Promise<void> {
  renderGuard("/cr-hvac", GLOBAL, ESKOM_ROWS);
  expect(await screen.findByText("CR PAGE")).toBeInTheDocument();
}

/** G2 — the defect: a PHE caller reads no `CR-*` row and is sent to `/`. */
export async function sendsACallerWithNoControlRoomAssetHome(): Promise<void> {
  renderGuard("/cr-hvac", PHE_LOCATION, PHE_ROWS);
  expect(await screen.findByText("landed on /")).toBeInTheDocument();
}

/** G3a — while the read is pending the guard renders a status line, not the page. */
export function rendersAStatusLineWhilePending(): void {
  renderGuard("/cr-hvac", GLOBAL, "pending");
  expect(screen.getByRole("status")).toHaveTextContent(/Checking Control Room access/);
}

/**
 * G3b — and it does not redirect while pending. The status line is checked
 * first, so a blank render cannot satisfy the absence.
 */
export function doesNotRedirectWhilePending(): void {
  renderGuard("/cr-hvac", GLOBAL, "pending");
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.queryByText(/landed on/)).toBeNull();
}

/** G4 — a failed read is denied, never pending forever and never granted. */
export async function treatsAFailedReadAsDenied(): Promise<void> {
  renderGuard("/cr-hvac", GLOBAL, "rejected");
  expect(await screen.findByText("landed on /")).toBeInTheDocument();
}

/** G5a — the per-area `asset_group` rule stays on top: electrical-only cannot open HVAC. */
export async function keepsThePerAreaRuleOnTop(): Promise<void> {
  renderGuard("/cr-hvac", ELECTRICAL_ONLY, ESKOM_ROWS);
  expect(await screen.findByText("landed on /")).toBeInTheDocument();
}

/** G5b — per-area positive control: electrical-only opens the SLD. */
export async function admitsTheAreaTheGroupCovers(): Promise<void> {
  renderGuard("/cr-sld", ELECTRICAL_ONLY, ESKOM_ROWS);
  expect(await screen.findByText("CR PAGE")).toBeInTheDocument();
}
