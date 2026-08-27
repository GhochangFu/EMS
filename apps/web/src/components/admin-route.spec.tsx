import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect } from "vitest";

import type { UserRole } from "@bms/shared";

import { defaultAdminRoute } from "../lib/admin-access";
import type { AuthUser } from "../stores/auth-store";
import { AdminRoute } from "./admin-route";

/**
 * `E7.1d` — the notification route gate (ADR 0043 Consequences).
 *
 * Assertions live here; `admin-route.test.tsx` is the Vitest entry point and
 * carries the `@vitest-environment jsdom` docblock, because that is the file
 * Vitest collects (ADR 0014, ADR 0042 decision 2).
 *
 * **Why a route test and not only the tab test.** `runNotificationTabTests`
 * pins `visibleMasterDataTabs`, which decides what is *shown*. Hiding a tab is
 * not an access control: `isMasterDataAdmin` admits a `location_admin`, so
 * without `requireNotificationAdmin` that role reaches the channels screen by
 * typing the URL and reads "No channels yet" — `ChannelsService.list` returns
 * `[]` for it unconditionally, so a refusal renders as an empty tenant.
 *
 * The load-bearing assertion is that the guarded child does NOT render.
 * `defaultAdminRoute` answers `/admin/organizations` for every role today, so
 * the redirect target alone would prove almost nothing.
 */

const CHANNELS = "/admin/notification-channels";

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

/** Renders wherever the guard sent us, so a redirect is observable. */
function Elsewhere() {
  const location = useLocation();
  return <p>landed on {location.pathname}</p>;
}

function renderGuard(role: UserRole): void {
  render(
    <MemoryRouter initialEntries={[CHANNELS]}>
      <Routes>
        <Route
          path={CHANNELS}
          element={
            <AdminRoute user={asUser(role)} requireNotificationAdmin>
              <p>CHANNEL ADMIN</p>
            </AdminRoute>
          }
        />
        <Route path="*" element={<Elsewhere />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * The two roles `canManageNotificationChannel` admits reach the screen.
 *
 * `E7.1c` replaced `assertAdminRole` with that predicate, so an
 * `organization_admin` administers its own organizations' channels. A guard
 * that refused it would hide a screen the API serves.
 */
export function admitsTheTwoRolesThatMayManageChannels(): void {
  for (const role of ["admin", "organization_admin"] as const) {
    renderGuard(role);
    expect(screen.getByText("CHANNEL ADMIN"), `${role} must reach the screen`).toBeInTheDocument();
    cleanup();
  }
}

/**
 * A `location_admin` is a master-data admin and is still refused here.
 *
 * This is the defect the prop exists to close, and the only thing that catches
 * its removal: the tab test would stay green, because a tab is not a gate.
 */
export function refusesALocationAdmin(): void {
  renderGuard("location_admin");

  expect(screen.queryByText("CHANNEL ADMIN")).not.toBeInTheDocument();
  expect(screen.getByText(`landed on ${defaultAdminRoute("location_admin")}`)).toBeInTheDocument();
  // The refusal must not be dressed as an empty tenant.
  expect(screen.queryByText(/No channels yet/i)).not.toBeInTheDocument();
}

/**
 * A role that is not a master-data admin at all never reaches the route, with
 * or without the notification gate. The first branch owns that, and this keeps
 * it owned: an operator sent to `/admin/...` belongs on the dashboard.
 */
export function sendsANonAdminRoleToTheDashboard(): void {
  renderGuard("operator");

  expect(screen.queryByText("CHANNEL ADMIN")).not.toBeInTheDocument();
  expect(screen.getByText("landed on /")).toBeInTheDocument();
}

/**
 * Without the flag the route is open to every master-data admin — which is
 * what both notification routes looked like before `E7.1d`, and what deleting
 * the prop from `app.tsx` would restore.
 */
export function staysOpenToMasterDataAdminsWhenTheFlagIsNotSet(): void {
  render(
    <MemoryRouter initialEntries={[CHANNELS]}>
      <Routes>
        <Route
          path={CHANNELS}
          element={
            <AdminRoute user={asUser("location_admin")}>
              <p>CHANNEL ADMIN</p>
            </AdminRoute>
          }
        />
        <Route path="*" element={<Elsewhere />} />
      </Routes>
    </MemoryRouter>,
  );

  expect(screen.getByText("CHANNEL ADMIN")).toBeInTheDocument();
}
