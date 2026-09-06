import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { EnergyCentreSummary, UserRole } from "@bms/shared";

import * as energyApi from "../api/energy-dashboard";
import type { AuthUser } from "../stores/auth-store";
import { EnergyPage } from "./energy-page";

/**
 * `F2.8` — the Energy Centre PUE tile, on a measured ratio and on a null.
 *
 * Assertions live here; `energy-page.test.tsx` is the Vitest entry point and
 * carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042
 * decision 2).
 *
 * This tile read `s.pueEstimate.toFixed(2)` directly, so a nullable contract
 * makes it a `TypeError` on the first unconfigured tenant rather than a dash.
 * The hint changes too: it used to say "same curve as Executive Dashboard",
 * which described the fitted curve ruling 4 deletes.
 */

const NOT_CONFIGURED = "Not configured — no incomer in scope computes site_kw and it_kw";
const MEASURED_HINT = "Σ site kW ÷ Σ IT kW, from the incomers' site_kw / it_kw";

function asUser(role: UserRole): AuthUser {
  return {
    id: "u1",
    email: `${role}@bms.local`,
    displayName: role,
    role,
  } as unknown as AuthUser;
}

function summary(pueEstimate: number | null): EnergyCentreSummary {
  return {
    window: "24h",
    totalKwh: 2345.17,
    peakKw: 414.66,
    pueEstimate,
    indicativeCostZar: 5042.12,
    tariffZarPerKwh: 2.15,
    asOf: "2026-09-05T12:00:00.000Z",
  };
}

/** All three of the page's fetches, because an unstubbed one dials `localhost:4000`. */
function stubEnergyApi(pueEstimate: number | null): void {
  vi.spyOn(energyApi, "fetchEnergySummary").mockResolvedValue(summary(pueEstimate));
  vi.spyOn(energyApi, "fetchEnergySourceMix").mockResolvedValue({ points: [] });
  vi.spyOn(energyApi, "fetchEnergyTopConsumers").mockResolvedValue({ consumers: [] });
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EnergyPage user={asUser("admin")} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** `KpiTile`'s label is a `span` in a flex row in the card, so the card is its grandparent. */
async function tileLabelled(label: string): Promise<HTMLElement> {
  const card = (await screen.findByText(label)).parentElement?.parentElement;
  expect(card, `no KpiTile is labelled ${JSON.stringify(label)}`).toBeTruthy();
  return card as HTMLElement;
}

/** A measured ratio renders to two decimals. */
export async function aMeasuredRatioRendersOnTheEnergyPage(): Promise<void> {
  stubEnergyApi(3.26);
  renderPage();

  const tile = await tileLabelled("PUE");
  expect(await within(tile).findByText("3.26")).toBeInTheDocument();
  expect(within(tile).getByText(MEASURED_HINT)).toBeInTheDocument();
}

/** Nothing configured: the dash and the reason, not a crash and not a zero. */
export async function anUnconfiguredWindowShowsTheDashAndTheReason(): Promise<void> {
  stubEnergyApi(null);
  renderPage();

  const tile = await tileLabelled("PUE");
  expect(await within(tile).findByText("—")).toBeInTheDocument();
  expect(within(tile).getByText(NOT_CONFIGURED)).toBeInTheDocument();
}
