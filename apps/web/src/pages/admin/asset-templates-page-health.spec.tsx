import { screen } from "@testing-library/react";
import { expect } from "vitest";

import { STOCK, listTemplate, renderPage, stubApi } from "./asset-templates-page.spec";

/**
 * The template list's "No health bands" marker (`F4.355`, ADR 0038 Amendment 7
 * B6). Its own file because `asset-templates-page.spec.tsx` is at the §4.5
 * line cap; it reuses that file's fixtures and render helper.
 * `asset-templates-page-health.test.tsx` is the Vitest entry point.
 */

/**
 * `F4.355` (ADR 0038 Amendment 7 B6): a version whose `content` carries no
 * `health.bands` is marked "No health bands"; a banded version is not. Derived
 * in the browser from the list response, so no new route.
 */
export async function aVersionWithoutBandsIsMarkedAndABandedOneIsNot(): Promise<void> {
  const banded = {
    ...(listTemplate({ code: "PUMP", domain: "hvac" }) as Record<string, unknown>),
    content: { contentVersion: 1, health: { bands: [{ code: "ok", label: "OK", minScore: 0 }] } },
  };
  const unbanded = listTemplate({ code: "CHILLER", domain: "hvac" });
  stubApi(STOCK, undefined, { items: [banded, unbanded] });
  renderPage();

  await screen.findByText("CHILLER template");
  const pills = await screen.findAllByText("No health bands");
  expect(pills, "exactly one version — the unbanded one — is marked").toHaveLength(1);
  // The pill sits on a version row; that row's group is CHILLER's, not PUMP's.
  const row = pills[0]!.closest("li");
  expect(row, "the marker is on a version row").not.toBeNull();
  const group = row!.closest("ul")!.parentElement as HTMLElement;
  expect(group.textContent).toContain("CHILLER template");
  expect(group.textContent).not.toContain("PUMP template");
}

/** Positive twin: when every version is banded, nothing is marked. */
export async function noVersionIsMarkedWhenEveryOneIsBanded(): Promise<void> {
  const health = { bands: [{ code: "ok", label: "OK", minScore: 0 }] };
  stubApi(STOCK, undefined, {
    items: [
      { ...(listTemplate({ code: "PUMP", domain: "hvac" }) as Record<string, unknown>), content: { health } },
      { ...(listTemplate({ code: "CHILLER", domain: "hvac" }) as Record<string, unknown>), content: { health } },
    ],
  });
  renderPage();
  await screen.findByText("CHILLER template");
  expect(screen.queryByText("No health bands")).toBeNull();
}
