import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import type { AdminUsersListResponse, CopilotAccessDto, UserRole } from "@bms/shared";

import * as copilotApi from "../../api/admin/copilot-access";
import * as usersApi from "../../api/admin/users";
import { ApiError } from "../../lib/api-error";
import type { AuthUser } from "../../stores/auth-store";
import { CopilotAccessCard } from "./copilot-access-card";

/**
 * `F3.85` PR 3 (ADR 0099 decision 5) — the Copilot access card, rendered
 * (ADR 0042). Assertions live here; `copilot-access-card.test.tsx` is the
 * Vitest entry point and carries the `@vitest-environment jsdom` docblock.
 */

const ORG_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ORG = "44444444-4444-4444-8444-444444444444";

const ACCESS: CopilotAccessDto = {
  organizationId: ORG_ID,
  enabled: false,
  roles: { location_admin: true, asset_group_admin: true },
  overrides: [],
};

const USERS: AdminUsersListResponse = {
  items: [
    {
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      email: "wc-admin@bms.local",
      displayName: "WC admin",
      role: "location_admin",
      organizationId: ORG_ID,
      linked: true,
      disabledAt: null,
      lastLoginAt: null,
      createdAt: new Date(0).toISOString(),
    },
    {
      id: "aaaaaaaa-0000-4000-8000-000000000002",
      email: "operator@bms.local",
      displayName: "An operator",
      role: "operator",
      organizationId: ORG_ID,
      linked: true,
      disabledAt: null,
      lastLoginAt: null,
      createdAt: new Date(0).toISOString(),
    },
    {
      id: "aaaaaaaa-0000-4000-8000-000000000003",
      email: "other@bms.local",
      displayName: "Other organization admin",
      role: "location_admin",
      organizationId: OTHER_ORG,
      linked: true,
      disabledAt: null,
      lastLoginAt: null,
      createdAt: new Date(0).toISOString(),
    },
  ],
};

function userAs(role: UserRole): AuthUser {
  return { id: "u1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser;
}

function renderCard(role: UserRole, access: CopilotAccessDto = ACCESS): void {
  vi.spyOn(copilotApi, "fetchCopilotAccess").mockResolvedValue(access);
  vi.spyOn(copilotApi, "putCopilotAccess").mockImplementation(async (_orgId, body) => ({
    ...access,
    enabled: body.enabled ?? access.enabled,
    roles: { ...access.roles, ...body.roles },
  }));
  vi.spyOn(usersApi, "fetchAdminUsers").mockResolvedValue(USERS);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CopilotAccessCard orgId={ORG_ID} user={userAs(role)} />
    </QueryClientProvider>,
  );
}

/** The global admin switches the organization on: the PUT carries `{ enabled: true }` and nothing else. */
export async function theGlobalAdminSwitchesTheOrganizationOn(): Promise<void> {
  renderCard("admin");
  const orgSwitch = (await screen.findByLabelText("Copilot on for this organization")) as HTMLInputElement;
  expect(orgSwitch.checked).toBe(false);
  expect(orgSwitch.disabled).toBe(false);

  await userEvent.click(orgSwitch);

  await waitFor(() => expect(copilotApi.putCopilotAccess).toHaveBeenCalledWith(ORG_ID, { enabled: true }));
  await waitFor(() => expect(orgSwitch.checked).toBe(true));
}

/** An organization admin sees the organization switch but cannot change it; the role switches stay theirs. */
export async function theOrganizationAdminCannotChangeTheOrganizationSwitch(): Promise<void> {
  renderCard("organization_admin");
  const orgSwitch = (await screen.findByLabelText("Copilot on for this organization")) as HTMLInputElement;
  expect(orgSwitch.disabled).toBe(true);
  expect(screen.getByText(/Only the global admin switches the copilot/)).toBeInTheDocument();
  // Adjacent positive: a role switch is enabled for the same user.
  expect((screen.getByLabelText("Location admins") as HTMLInputElement).disabled).toBe(false);
}

/** A role switch sends only that role. */
export async function aRoleSwitchSendsOnlyThatRole(): Promise<void> {
  renderCard("organization_admin");
  await userEvent.click(await screen.findByLabelText("Asset group admins"));
  await waitFor(() =>
    expect(copilotApi.putCopilotAccess).toHaveBeenCalledWith(ORG_ID, { roles: { asset_group_admin: false } }),
  );
}

/**
 * The exception picker offers only administrators of this organization, as
 * the server allows: not an operator, not another organization's admin.
 */
export async function thePickerOffersOnlyThisOrganizationsAdministrators(): Promise<void> {
  renderCard("organization_admin");
  const picker = (await screen.findByLabelText("Administrator")) as HTMLSelectElement;
  await waitFor(() => expect(picker.options.length).toBe(2));
  const labels = [...picker.options].map((option) => option.textContent);
  expect(labels).toEqual(["Choose an administrator", "WC admin (wc-admin@bms.local)"]);

  await userEvent.selectOptions(picker, "aaaaaaaa-0000-4000-8000-000000000001");
  await userEvent.click(screen.getByRole("button", { name: "Deny" }));
  await waitFor(() =>
    expect(copilotApi.putCopilotAccess).toHaveBeenCalledWith(ORG_ID, {
      override: { userId: "aaaaaaaa-0000-4000-8000-000000000001", allow: false },
    }),
  );
}

/**
 * Code review (PR 3): once a pick is saved, the user leaves the picker's
 * options, so the selection must reset too — a kept selection left Allow and
 * Deny enabled for a user the picker no longer shows. Here the PUT mock returns
 * the new exception, as the server does. Mutation: drop the reset → red.
 */
export async function aSavedPickResetsThePicker(): Promise<void> {
  renderCard("organization_admin");
  vi.mocked(copilotApi.putCopilotAccess).mockImplementation(async (_orgId, body) => ({
    ...ACCESS,
    overrides: body.override && body.override.allow !== null ? [{ userId: body.override.userId, allow: body.override.allow }] : [],
  }));
  const picker = (await screen.findByLabelText("Administrator")) as HTMLSelectElement;
  await waitFor(() => expect(picker.options.length).toBe(2));
  await userEvent.selectOptions(picker, "aaaaaaaa-0000-4000-8000-000000000001");
  await userEvent.click(screen.getByRole("button", { name: "Allow" }));

  expect(await screen.findByText("Allowed")).toBeInTheDocument();
  expect(picker.value).toBe("");
  expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Deny" }) as HTMLButtonElement).disabled).toBe(true);
}

/** An existing exception is listed by name and removed with `allow: null`. */
export async function anExceptionIsListedAndRemoved(): Promise<void> {
  renderCard("organization_admin", {
    ...ACCESS,
    overrides: [{ userId: "aaaaaaaa-0000-4000-8000-000000000001", allow: true }],
  });
  const remove = await screen.findByRole("button", {
    name: "Remove exception for WC admin (wc-admin@bms.local)",
  });
  expect(screen.getByText("Allowed")).toBeInTheDocument();
  await userEvent.click(remove);
  await waitFor(() =>
    expect(copilotApi.putCopilotAccess).toHaveBeenCalledWith(ORG_ID, {
      override: { userId: "aaaaaaaa-0000-4000-8000-000000000001", allow: null },
    }),
  );
}

/** A refused PUT shows the server's sentence, not the JSON envelope. */
export async function aRefusalShowsTheServersSentence(): Promise<void> {
  renderCard("organization_admin");
  vi.mocked(copilotApi.putCopilotAccess).mockRejectedValue(
    new ApiError(
      JSON.stringify({ message: "A copilot exception can name only an administrator of this organization", statusCode: 403 }),
      403,
    ),
  );
  await userEvent.click(await screen.findByLabelText("Location admins"));
  const banner = await screen.findByRole("alert");
  expect(banner).toHaveTextContent("A copilot exception can name only an administrator of this organization");
  expect(banner.textContent).not.toContain("statusCode");
}
