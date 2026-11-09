import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import * as appearanceApi from "../../api/appearance";
import * as loginApi from "../../api/login";
import * as publicApi from "../../api/public-appearance";
import { useAuthStore } from "../../stores/auth-store";
import { useThemeStore } from "../../stores/theme-store";
import { AppearancePanel } from "./appearance-panel";
import { MyAppearanceDialog, OrganizationAppearanceDialog } from "./appearance-dialogs";

/**
 * `F4.341` PR 12 (ADR 0118 decision 11) — the Appearance panel at its three levels. A choice
 * previews the page (the `<html>` attributes move, the stored values do not); Cancel restores the
 * viewer's own look; Save writes the values, re-reads `/auth/me` and closes; "Inherit (<value>)"
 * writes `null` and previews the inherited value; the portal level has no Inherit.
 */
const html = document.documentElement;

function withClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function signedInOnNexus(): void {
  useAuthStore.setState({ accessToken: "tok" });
  useThemeStore.getState().setDesign("nexus-soft");
  useThemeStore.getState().setProfile("nexus");
}

export async function aChoicePreviewsAndCancelRestores(): Promise<void> {
  signedInOnNexus();
  const onDone = vi.fn();
  withClient(
    <AppearancePanel levelLabel="Organization" initial={{ designSystem: null, colourProfile: null }} allowInherit save={vi.fn()} onDone={onDone} />,
  );
  await userEvent.click(screen.getByRole("radio", { name: /Swiss Grid/ }));
  await userEvent.click(screen.getByRole("radio", { name: /Forest/ }));
  expect(html.getAttribute("data-design")).toBe("swiss-grid");
  expect(html.getAttribute("data-profile")).toBe("forest");
  expect(localStorage.getItem("bms.design")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(html.hasAttribute("data-design")).toBe(false);
  expect(html.hasAttribute("data-profile")).toBe(false);
  expect(onDone).toHaveBeenCalledOnce();
}

export async function saveWritesReReadsMeAndCloses(): Promise<void> {
  signedInOnNexus();
  const save = vi.fn().mockResolvedValue({});
  const me = vi.spyOn(loginApi, "fetchCurrentUser").mockResolvedValue({} as never);
  const onDone = vi.fn();
  withClient(
    <AppearancePanel levelLabel="My" initial={{ designSystem: "bento-ops", colourProfile: null }} allowInherit save={save} onDone={onDone} />,
  );
  const saveButton = screen.getByRole("button", { name: "Save" });
  expect((saveButton as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole("radio", { name: /Navy pop/ }));
  await userEvent.click(saveButton);
  await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith({ designSystem: "bento-ops", colourProfile: "navy-pop" });
  expect(me).toHaveBeenCalledWith("tok");
}

export async function inheritWritesNullAndPreviewsTheInheritedValue(): Promise<void> {
  signedInOnNexus();
  const save = vi.fn().mockResolvedValue({});
  vi.spyOn(loginApi, "fetchCurrentUser").mockResolvedValue({} as never);
  withClient(
    <AppearancePanel
      levelLabel="Organization"
      initial={{ designSystem: "enterprise-flat", colourProfile: "sand" }}
      allowInherit
      inherited={{ designSystem: "control-room-dark", colourProfile: "ocean" }}
      save={save}
      onDone={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("radio", { name: /Inherit \(Control Room Dark\)/ }));
  expect(html.getAttribute("data-design")).toBe("control-room-dark");
  await userEvent.click(screen.getByRole("radio", { name: /Inherit \(Ocean\)/ }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ designSystem: null, colourProfile: null }));
}

export function thePortalLevelHasNoInherit(): void {
  signedInOnNexus();
  withClient(
    <AppearancePanel levelLabel="Portal" initial={{ designSystem: "nexus-soft", colourProfile: "nexus" }} allowInherit={false} save={vi.fn()} onDone={vi.fn()} />,
  );
  expect(screen.queryByRole("radio", { name: /Inherit/ })).toBeNull();
  expect(screen.getAllByRole("radio")).toHaveLength(5 + 9);
}

export async function theOrganizationDialogWritesItsRowAndInheritsThePortal(): Promise<void> {
  signedInOnNexus();
  vi.spyOn(publicApi, "fetchPublicAppearance").mockResolvedValue({ designSystem: "swiss-grid", colourProfile: "lagoon" });
  vi.spyOn(loginApi, "fetchCurrentUser").mockResolvedValue({} as never);
  const put = vi.spyOn(appearanceApi, "setOrganizationAppearance").mockResolvedValue({} as never);
  const org = {
    id: "33333333-3333-4333-8333-333333333333",
    code: "PHEWB",
    name: "PHE West Bengal",
    active: true,
    currency: "INR",
    timezone: "Asia/Kolkata",
    colourProfile: "nexus" as const,
    designSystem: null,
    ingestEnabled: true,
    meta: null,
    createdAt: new Date(0).toISOString(),
  };
  const onClose = vi.fn();
  withClient(<OrganizationAppearanceDialog organization={org} onClose={onClose} />);
  expect(screen.getByRole("dialog", { name: "Appearance — PHE West Bengal" })).toBeInTheDocument();
  await screen.findByRole("radio", { name: /Inherit \(Swiss Grid\)/ });
  expect((screen.getByRole("radio", { name: /Inherit \(Swiss Grid\)/ }) as HTMLInputElement).checked).toBe(true);
  await userEvent.click(screen.getByRole("radio", { name: /Bento Ops/ }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(put).toHaveBeenCalledWith(org.id, { designSystem: "bento-ops", colourProfile: "nexus" });
}

export async function myDialogStartsFromMeAndWritesMyRow(): Promise<void> {
  signedInOnNexus();
  vi.spyOn(loginApi, "fetchCurrentUser").mockResolvedValue({
    user: { id: "u", email: "a@b.c", displayName: "A", role: "operator" },
    scope: { kind: "none", locations: [], assetGroups: [], assetIds: [] },
    colourProfile: "sand",
    appearance: { designSystem: { value: "bento-ops", from: "organization" }, colourProfile: { value: "sand", from: "user" } },
  });
  const put = vi.spyOn(appearanceApi, "setMyAppearance").mockResolvedValue({ designSystem: null, colourProfile: null });
  withClient(<MyAppearanceDialog onClose={vi.fn()} />);
  const inheritDesign = (await screen.findByRole("radio", { name: /Inherit \(Bento Ops\)/ })) as HTMLInputElement;
  expect(inheritDesign.checked).toBe(true);
  expect((screen.getByRole("radio", { name: /^Sand/ }) as HTMLInputElement).checked).toBe(true);
  await userEvent.click(screen.getAllByRole("radio", { name: /^Inherit/ })[1]!);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(put).toHaveBeenCalledWith({ designSystem: null, colourProfile: null }));
}
