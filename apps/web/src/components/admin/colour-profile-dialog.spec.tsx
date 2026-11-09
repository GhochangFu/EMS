import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { AdminOrganizationDto } from "@bms/shared";

import * as organizationsApi from "../../api/admin/organizations";
import * as loginApi from "../../api/login";
import { ApiError } from "../../lib/api-error";
import { useAuthStore } from "../../stores/auth-store";
import { useThemeStore } from "../../stores/theme-store";
import { ColourProfileDialog } from "./colour-profile-dialog";

/**
 * `F4.310` PR D (ADR 0110 decision 8) — the colour-profile chooser. Choosing a profile previews it on
 * the whole page (the real role values, no copy of them); Cancel puts the viewer's own profile back;
 * Save sends the `PUT`, re-reads `/auth/me` so the viewer's own page follows a change to its home
 * organization, and refreshes the organization list. Assertions live here; the `.test.tsx` sibling
 * carries the jsdom docblock (ADR 0014).
 */
const ORG: AdminOrganizationDto = {
  id: "33333333-3333-4333-8333-333333333333",
  code: "PHEWB",
  name: "PHE West Bengal",
  active: true,
  currency: "INR",
  timezone: "Asia/Kolkata",
  colourProfile: "nexus",
  designSystem: null,
  ingestEnabled: true,
  meta: null,
  createdAt: new Date(0).toISOString(),
};

function renderDialog(organization: AdminOrganizationDto = ORG) {
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <ColourProfileDialog organization={organization} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose, invalidate };
}

function signedIn(): void {
  useAuthStore.setState({ accessToken: "tok-cp", user: null, scope: null, oidcIdToken: null });
  useThemeStore.getState().setProfile("nexus");
}

export async function d1TheSixProfilesAreOfferedWithTheCurrentOneChosen(): Promise<void> {
  signedIn();
  renderDialog({ ...ORG, colourProfile: "lagoon" });
  const radios = screen.getAllByRole("radio");
  expect(radios.map((r) => r.getAttribute("value"))).toEqual([
    "nexus",
    "ocean",
    "lagoon",
    "indigo",
    "graphite",
    "high-contrast",
    "forest",
    "sand",
    "navy-pop",
  ]);
  expect(screen.getByRole("radio", { name: /Lagoon/ })).toBeChecked();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
}

export async function d2ChoosingAProfilePreviewsItAndCancelRestores(): Promise<void> {
  signedIn();
  const { onClose } = renderDialog();
  await userEvent.click(screen.getByRole("radio", { name: /Ocean/ }));
  expect(document.documentElement.getAttribute("data-profile")).toBe("ocean");
  expect(localStorage.getItem("bms.profile"), "a preview is not stored").toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.documentElement.hasAttribute("data-profile")).toBe(false);
  expect(onClose).toHaveBeenCalled();
}

export async function d3SaveSendsThePutReReadsMeAndRefreshesTheList(): Promise<void> {
  signedIn();
  const put = vi
    .spyOn(organizationsApi, "setOrganizationColourProfile")
    .mockResolvedValue({ ...ORG, colourProfile: "graphite" });
  const me = vi.spyOn(loginApi, "fetchCurrentUser").mockImplementation(async () => {
    useThemeStore.getState().setProfile("graphite");
    return { user: { id: "u", email: "a@b.c", displayName: "A", role: "organization_admin" }, scope: { kind: "none", locations: [], assetGroups: [], assetIds: [] }, colourProfile: "graphite", appearance: { designSystem: { value: "nexus-soft", from: "portal" }, colourProfile: { value: "graphite", from: "organization" } } };
  });
  const { onClose, invalidate } = renderDialog();
  await userEvent.click(screen.getByRole("radio", { name: /Graphite/ }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(put).toHaveBeenCalledWith(ORG.id, "graphite");
  expect(me).toHaveBeenCalledWith("tok-cp");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin", "organizations"] });
  expect(document.documentElement.getAttribute("data-profile")).toBe("graphite");
}

export async function d4ARefusalShowsTheServersSentenceAndKeepsTheDialog(): Promise<void> {
  signedIn();
  vi.spyOn(organizationsApi, "setOrganizationColourProfile").mockRejectedValue(
    new ApiError("Only an administrator of this organization can change its colour profile", 403),
  );
  const { onClose } = renderDialog();
  await userEvent.click(screen.getByRole("radio", { name: /Indigo/ }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only an administrator of this organization");
  expect(onClose).not.toHaveBeenCalled();
}

export async function d5SaveIsBusyAndTheChoiceLockedWhileSaving(): Promise<void> {
  signedIn();
  let release: (v: AdminOrganizationDto) => void = () => undefined;
  vi.spyOn(organizationsApi, "setOrganizationColourProfile").mockReturnValue(new Promise((r) => (release = r)));
  vi.spyOn(loginApi, "fetchCurrentUser").mockRejectedValue(new Error("not needed"));
  renderDialog();
  await userEvent.click(screen.getByRole("radio", { name: /Ocean/ }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  const saving = screen.getByRole("button", { name: "Saving…" });
  expect(saving).toBeDisabled();
  expect(saving).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("radio", { name: /Lagoon/ }), "the choice is locked while saving").toBeDisabled();
  release({ ...ORG, colourProfile: "ocean" });
}
