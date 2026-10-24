import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { UserRole } from "@bms/shared";

import * as assetsApi from "../api/assets";
import * as copilotApi from "../api/copilot";
import * as maintenanceApi from "../api/maintenance";
import { CREATED, MS_ASSET } from "../components/maintenance-schedule-wizard.spec";
import type { AuthUser } from "../stores/auth-store";
import { MaintenanceSchedulesPage } from "./maintenance-schedules-page";

/**
 * `F4.281` (ADR 0099 Amendment 8 Q16) — the Schedule Centre's steppers are for
 * every role the route admits, operators included, while the copilot dock
 * stays with the four copilot roles. The whole page renders inside its
 * `AppShell`; every read is a spy and `fetch` is refused (`F4.160`: an
 * unstubbed fetch reaches a local API on `:4000`). Vitest entry point: the
 * sibling `.test.tsx`.
 */

function asUser(role: UserRole): AuthUser {
  return { id: "u1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser;
}

function renderPage(role: UserRole): void {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("maintenance-schedules-page.spec: no fetch expected"))));
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([MS_ASSET]);
  vi.spyOn(maintenanceApi, "fetchMaintenanceSchedules").mockResolvedValue({ items: [CREATED] });
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: true, configured: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/maintenance-schedules"]}>
        <MaintenanceSchedulesPage user={asUser(role)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** An operator opens the create stepper, and the page shows no copilot dock button. */
export async function anOperatorGetsTheStepperAndNoDock(): Promise<void> {
  renderPage("operator");
  await screen.findByText(CREATED.title);
  await userEvent.click(screen.getByRole("button", { name: "+ New Schedule" }));
  expect(await screen.findByRole("dialog", { name: "Create maintenance schedule" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open the copilot" })).not.toBeInTheDocument();
}

/** The adjacent positive: an admin on the same page sees the dock button. */
export async function anAdminSeesTheDock(): Promise<void> {
  renderPage("admin");
  expect(await screen.findByRole("button", { name: "Open the copilot" })).toBeInTheDocument();
}
