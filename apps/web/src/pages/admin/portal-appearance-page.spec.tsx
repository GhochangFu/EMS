import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi } from "vitest";

import * as appearanceApi from "../../api/appearance";
import * as assetsApi from "../../api/assets";
import * as copilotApi from "../../api/copilot";
import * as loginApi from "../../api/login";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { PortalAppearancePage } from "./portal-appearance-page";

/**
 * `F4.341` PR 12 (ADR 0118 decisions 9–11) — `/admin/portal-appearance`: the global admin reads the
 * portal default and saves both values (no Inherit at this level); any other role is sent back to
 * the hub.
 */
function renderAs(role: AuthUser["role"]): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  useAuthStore.setState({ accessToken: "tok", scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] } });
  const user = { id: "u1", email: "admin@bms.local", displayName: "Admin", role } as unknown as AuthUser;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/portal-appearance"]}>
        <Routes>
          <Route path="/admin/portal-appearance" element={<PortalAppearancePage user={user} />} />
          <Route path="/admin" element={<p>hub</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export async function theGlobalAdminSavesThePortalDefault(): Promise<void> {
  vi.spyOn(appearanceApi, "fetchPortalAppearance").mockResolvedValue({
    designSystem: "nexus-soft",
    colourProfile: "nexus",
    updatedAt: null,
    updatedBy: null,
  });
  const put = vi.spyOn(appearanceApi, "setPortalAppearance").mockResolvedValue({
    designSystem: "swiss-grid",
    colourProfile: "nexus",
    updatedAt: null,
    updatedBy: null,
  });
  vi.spyOn(loginApi, "fetchCurrentUser").mockResolvedValue({} as never);
  renderAs("admin");
  await userEvent.click(await screen.findByRole("radio", { name: /Swiss Grid/ }));
  expect(screen.queryByRole("radio", { name: /Inherit/ })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(put).toHaveBeenCalledWith({ designSystem: "swiss-grid", colourProfile: "nexus" }));
}

export function anotherRoleIsSentToTheHub(): void {
  const read = vi.spyOn(appearanceApi, "fetchPortalAppearance");
  renderAs("organization_admin");
  expect(screen.getByText("hub")).toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();
}
