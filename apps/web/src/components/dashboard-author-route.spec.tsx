import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect } from "vitest";

import type { UserRole } from "@bms/shared";

import type { AuthUser } from "../stores/auth-store";
import { DashboardAuthorRoute } from "./dashboard-author-route";

/**
 * `F3.63` — the dashboard-authoring route gate (ADR 0047 Amendment 6 §Q1
 * point 1).
 *
 * Assertions live here; `dashboard-author-route.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock, because that is
 * the file Vitest collects (ADR 0014, ADR 0042 decision 2). Shape follows
 * `admin-route.spec.tsx`.
 */

const BUILDER = "/admin/dashboards";

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
    <MemoryRouter initialEntries={[BUILDER]}>
      <Routes>
        <Route
          path={BUILDER}
          element={
            <DashboardAuthorRoute user={asUser(role)}>
              <p>BUILDER</p>
            </DashboardAuthorRoute>
          }
        />
        <Route path="*" element={<Elsewhere />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The load-bearing case: `asset_group_admin` reaches the builder, not `AdminRoute`'s refusal. */
export function admitsAnAssetGroupAdmin(): void {
  renderGuard("asset_group_admin");
  expect(screen.getByText("BUILDER")).toBeInTheDocument();
}

/** `location_admin` still reaches the builder — the widening added a role, it did not drop one. */
export function stillAdmitsALocationAdmin(): void {
  renderGuard("location_admin");
  expect(screen.getByText("BUILDER")).toBeInTheDocument();
}

/** `operator` is not an authoring role and is sent to `/`. */
export function sendsAnOperatorToTheDashboard(): void {
  renderGuard("operator");
  expect(screen.queryByText("BUILDER")).not.toBeInTheDocument();
  expect(screen.getByText("landed on /")).toBeInTheDocument();
}

/** `viewer` is not an authoring role and is sent to `/`. */
export function sendsAViewerToTheDashboard(): void {
  renderGuard("viewer");
  expect(screen.queryByText("BUILDER")).not.toBeInTheDocument();
  expect(screen.getByText("landed on /")).toBeInTheDocument();
}
