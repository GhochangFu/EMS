import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { expect } from "vitest";

import { LocationDashboardRedirect } from "./location-dashboard-redirect";

/**
 * `F3.72` (ADR 0087, plan D5) — `/locations/:locationId/dashboard`, the old
 * location dashboard address, now redirects to that site's Assets & RTUs tab
 * (`/control-room/site/:locationId/assets`), where the moved body lives.
 * `ControlRoomScopeRoute` wraps it in `app.tsx` (`tests/f3.72-control-room-entry.test.ts`
 * E4); this suite proves only the redirect itself.
 *
 * Assertions live here; `location-dashboard-redirect.test.tsx` is the Vitest
 * entry point and carries `@vitest-environment jsdom` (ADR 0014, ADR 0042
 * decision 2).
 */

/** Where the redirect lands: the pathname, and how the router got there. */
function Landed() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  return (
    <p data-testid="landed" data-navigation-type={navigationType}>
      {pathname}
    </p>
  );
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/locations/:locationId/dashboard" element={<LocationDashboardRedirect />} />
        <Route path="/control-room/site/:locationId/:tab?" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** R1 — the old address lands on the site's Assets & RTUs tab, replacing the history entry. */
export async function redirectsToTheAssetsTab(): Promise<void> {
  renderAt("/locations/a1/dashboard");

  const landed = await screen.findByTestId("landed");
  expect([landed.textContent, landed.getAttribute("data-navigation-type")]).toEqual([
    "/control-room/site/a1/assets",
    "REPLACE",
  ]);
}

/**
 * R2 — the id is encoded for the path segment: the router decodes `a%20b` to
 * `a b` in `useParams`, and the redirect encodes it back.
 */
export async function encodesTheId(): Promise<void> {
  renderAt("/locations/a%20b/dashboard");

  const landed = await screen.findByTestId("landed");
  expect(landed.textContent).toBe("/control-room/site/a%20b/assets");
}
