import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AccessibleScope } from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as copilotApi from "../../api/copilot";
import * as loginApi from "../../api/login";
import * as systemStatusApi from "../../api/system-status";
import { AppearancePanel } from "../../components/appearance/appearance-panel";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { useAuthStore, type AuthUser } from "../../stores/auth-store";
import { previewDesign, useThemeStore } from "../../stores/theme-store";
import { AppShell } from "../app-shell";

/**
 * `F4.346` (ADR 0118 Amendment 3 decision 3, plan S5) — the Appearance preview changes the shell.
 * `previewDesign` sets a preview in the theme store as well as the attribute, and `AppShell`
 * selects the shell from `preview ?? design`. The viewer here is on `control-room-dark` (the rail):
 * choosing Swiss Grid renders the sidebar shell; Cancel restores the rail; Save keeps the value the
 * re-read `/auth/me` stores.
 */
const GLOBAL: AccessibleScope = { kind: "global", locations: [], assetGroups: [], assetIds: [] };

const isRail = () => screen.queryByTestId("rail-status-strip") !== null;
const isSidebar = () => screen.queryByTestId("shell-sidebar-slot") !== null;

function renderShellWithPanel(save: () => Promise<unknown>, onDone: () => void): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  useAuthStore.setState({ scope: GLOBAL, accessToken: "tok" });
  useThemeStore.getState().setDesign("control-room-dark");
  const user = { id: "u1", email: "admin@bms.local", displayName: "admin", role: "admin" } as unknown as AuthUser;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <AppShell user={user} kpiRibbon={<span />}>
          <AppearancePanel levelLabel="My" initial={{ designSystem: null, colourProfile: null }} allowInherit save={save} onDone={onDone} />
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export async function aPreviewSwitchesTheShellAndCancelRestoresIt(): Promise<void> {
  renderShellWithPanel(vi.fn(), vi.fn());
  expect(isRail()).toBe(true);
  await userEvent.click(screen.getByRole("radio", { name: /Swiss Grid/ }));
  expect(isSidebar()).toBe(true);
  expect(isRail()).toBe(false);
  expect(useThemeStore.getState().design).toBe("control-room-dark");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(isRail()).toBe(true);
  expect(useThemeStore.getState().preview).toBeNull();
}

export async function saveKeepsTheSavedValue(): Promise<void> {
  vi.spyOn(loginApi, "fetchCurrentUser").mockImplementation(async () => {
    useThemeStore.getState().setDesign("swiss-grid");
    return {} as never;
  });
  const onDone = vi.fn();
  renderShellWithPanel(vi.fn().mockResolvedValue({}), onDone);
  await userEvent.click(screen.getByRole("radio", { name: /Swiss Grid/ }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  expect(useThemeStore.getState().preview).toBeNull();
  expect(useThemeStore.getState().design).toBe("swiss-grid");
  expect(isSidebar()).toBe(true);
  expect(document.documentElement.getAttribute("data-design")).toBe("swiss-grid");
}

export function previewDesignNullClearsTheStorePreview(): void {
  useThemeStore.getState().setDesign("enterprise-flat");
  act(() => previewDesign("bento-ops"));
  expect(useThemeStore.getState().preview).toBe("bento-ops");
  expect(useThemeStore.getState().design).toBe("enterprise-flat");
  act(() => previewDesign(null));
  expect(useThemeStore.getState().preview).toBeNull();
  expect(document.documentElement.getAttribute("data-design")).toBe("enterprise-flat");
}
