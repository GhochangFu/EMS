import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect } from "vitest";

import { LegacyAssetHistoryRedirect } from "./legacy-asset-history-redirect";

/**
 * `E1.4b` — the legacy `/assets/:assetId/history` path still lands on `/asset-history/:assetId`
 * with its query, and the id is encoded (PR 3 security review). Entry point:
 * `legacy-asset-history-redirect.test.tsx` (ADR 0014).
 */
function Landing() {
  const { pathname, search } = useLocation();
  return <p data-testid="landing">{`${pathname}${search}`}</p>;
}

function renderAt(entry: string): void {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/assets/:assetId/history" element={<LegacyAssetHistoryRedirect />} />
        <Route path="/asset-history/:assetId" element={<Landing />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The legacy path lands on the history page with its query kept. */
export async function theLegacyPathLandsWithItsQuery(): Promise<void> {
  renderAt("/assets/11111111-1111-4111-8111-111111111111/history?range=7d&points=kw");
  expect((await screen.findByTestId("landing")).textContent).toBe(
    "/asset-history/11111111-1111-4111-8111-111111111111?range=7d&points=kw",
  );
}

/** A decoded `..%2F` stays inside `/asset-history/`, never climbing to another route. */
export async function anEncodedSlashStaysInsideTheHistoryPath(): Promise<void> {
  renderAt("/assets/..%2Fadmin/history");
  expect((await screen.findByTestId("landing")).textContent).toBe("/asset-history/..%2Fadmin");
}
