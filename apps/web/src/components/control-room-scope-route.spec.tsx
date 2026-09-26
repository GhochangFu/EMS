import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect } from "vitest";

import type { AccessibleScope } from "@bms/shared";

import { useAuthStore } from "../stores/auth-store";
import { ControlRoomScopeRoute } from "./control-room-scope-route";

/**
 * `F3.66` U2, plan decision D3 — assertions live here; `control-room-scope-route.test.tsx`
 * is the Vitest entry point and carries the `@vitest-environment jsdom`
 * docblock (ADR 0014, ADR 0042 decision 2). Harness modelled on
 * `admin-route.spec.tsx`.
 *
 * Fixture shapes match `layouts/app-shell.spec.tsx`'s `GLOBAL`/`LOCATION`/`NONE`
 * (not exported there, so rebuilt here from `AccessibleScope`) rather than
 * inventing new ones.
 */

const ROUTE = "/control-room";

const GLOBAL: AccessibleScope = { kind: "global", locations: [], assetGroups: [], assetIds: [] };

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

const NONE: AccessibleScope = { kind: "none", locations: [], assetGroups: [], assetIds: [] };

/** Renders wherever the guard sent us, so a redirect is observable. */
function Elsewhere() {
  const location = useLocation();
  return <p>landed on {location.pathname}</p>;
}

function renderGuard(scope: AccessibleScope | null): void {
  useAuthStore.setState({ scope });
  render(
    <MemoryRouter initialEntries={[ROUTE]}>
      <Routes>
        <Route
          path={ROUTE}
          element={
            <ControlRoomScopeRoute>
              <p>CR PAGE</p>
            </ControlRoomScopeRoute>
          }
        />
        <Route path="*" element={<Elsewhere />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** G1 — a `global` scope reaches the guarded children. */
export function admitsAGlobalScope(): void {
  renderGuard(GLOBAL);
  expect(screen.getByText("CR PAGE")).toBeInTheDocument();
}

/** G2 — a `location` scope reaches the guarded children too. */
export function admitsALocationScope(): void {
  renderGuard(LOCATION);
  expect(screen.getByText("CR PAGE")).toBeInTheDocument();
}

/** G3 — a `none` scope is redirected to `/`. */
export function redirectsANoneScope(): void {
  renderGuard(NONE);
  expect(screen.queryByText("CR PAGE")).not.toBeInTheDocument();
  expect(screen.getByText("landed on /")).toBeInTheDocument();
}

/**
 * G4a — while the scope is still `null` (pending), the guard renders a
 * status line rather than deciding either way.
 */
export function showsAStatusLineWhileScopeIsPending(): void {
  renderGuard(null);
  expect(screen.getByRole("status")).toHaveTextContent(/Checking Control Room access/);
}

/**
 * G4b — and does NOT redirect while pending: a `null` scope must not fall
 * into the `<Navigate>` branch. The status line is the positive control in
 * this same flow: without it, a guard that renders nothing at all would pass
 * the absence assertion.
 */
export function doesNotRedirectWhileScopeIsPending(): void {
  renderGuard(null);
  expect(screen.getByRole("status")).toHaveTextContent(/Checking Control Room access/);
  expect(screen.queryByText(/landed on/)).not.toBeInTheDocument();
}

export function cleanupGuard(): void {
  cleanup();
  useAuthStore.setState({ scope: null });
}
