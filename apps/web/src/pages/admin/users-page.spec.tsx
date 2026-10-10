import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AuthUser } from "../../stores/auth-store";
import { UsersAdminPage } from "./users-page";

/**
 * `F3.78` (ADR 0089, plan U7) — the users and access screen, rendered (ADR 0042).
 *
 * Assertions live here; `users-page.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock (ADR 0014).
 *
 * **`fetch` is stubbed in every case.** An unstubbed `fetch` reaches the real API on :4000. The
 * stub answers by method and path, records every call, and answers an unknown path 404 so a
 * stray request is visible rather than silent.
 *
 * **Every case except the local-mode one stubs OIDC.** `isOidcEnabled()` needs
 * `VITE_AUTH_MODE=oidc`, `VITE_OIDC_ISSUER` and `VITE_OIDC_CLIENT_ID`; with any of them unset
 * every action button is disabled and an "is enabled" or "calls fetch" assertion would fail for
 * the wrong reason, while an "is disabled" one would pass for the wrong reason.
 */

const LOCAL_SENTENCE = "User administration needs Keycloak; this deployment runs local sign-in.";
const UNLINKED_SENTENCE = "This user must sign in once before it can be changed.";

const orgAdmin = { id: "u-oa", email: "oa@bms.local", displayName: "Org Admin", role: "organization_admin" } as unknown as AuthUser;
const globalAdmin = { id: "u-ga", email: "ga@bms.local", displayName: "Global Admin", role: "admin" } as unknown as AuthUser;
const locationAdmin = { id: "u-la", email: "la@bms.local", displayName: "Loc Admin", role: "location_admin" } as unknown as AuthUser;

const ORG_ID = "33333333-3333-3333-3333-333333333333";
const LINKED_ID = "11111111-1111-1111-1111-111111111111";
const UNLINKED_ID = "22222222-2222-2222-2222-222222222222";
const DEACTIVATED_ID = "44444444-4444-4444-4444-444444444444";
const ORG_ADMIN_ROW_ID = "77777777-7777-7777-7777-777777777777";
const GRANT_A_ID = "aaaaaaaa-0000-0000-0000-00000000000a";
const GRANT_B_ID = "bbbbbbbb-0000-0000-0000-00000000000b";

function userRow(id: string, displayName: string, over: Record<string, unknown> = {}) {
  return {
    id,
    email: `${displayName.split(" ")[0]?.toLowerCase()}@example.test`,
    displayName,
    role: "viewer",
    organizationId: ORG_ID,
    linked: true,
    disabledAt: null,
    lastLoginAt: null,
    createdAt: new Date(0).toISOString(),
    ...over,
  };
}

const USERS = {
  items: [
    userRow(LINKED_ID, "Ada Linked"),
    userRow(UNLINKED_ID, "Uma Unlinked", { linked: false }),
    userRow(DEACTIVATED_ID, "Dev Deactivated", { disabledAt: new Date(0).toISOString() }),
    // `F4.200`: a two-word role, so the Role column shows a label the old `replace(/_/g, " ")`
    // could never produce ("organization admin" against "Organization Administrator").
    userRow(ORG_ADMIN_ROW_ID, "Ola Organizer", { role: "organization_admin" }),
  ],
};

const ORGS = {
  items: [{ id: ORG_ID, code: "ACME", name: "Acme Works", active: true, currency: "INR", timezone: "Asia/Kolkata", meta: null, createdAt: new Date(0).toISOString() }],
};

function grant(id: string, targetName: string, effective: boolean) {
  return {
    id,
    kind: "location",
    targetId: "55555555-5555-5555-5555-555555555555",
    targetName,
    organizationId: ORG_ID,
    effective,
    createdAt: new Date(0).toISOString(),
  };
}

const GRANTS = { items: [grant(GRANT_A_ID, "Plant North", true), grant(GRANT_B_ID, "Plant South", false)] };

function written(user: Record<string, unknown>, followUp: string | null = null) {
  return { user, followUp };
}

type Call = { path: string; method: string; body: unknown };
type Reply = { status: number; body: unknown };
type Routes = Record<string, Reply | (() => Reply)>;

/** Replaces `fetch`; `routes` keys are `"METHOD /api/v1/path"`. Returns the call log. */
function stubFetch(routes: Routes = {}): Call[] {
  const defaults: Routes = {
    "GET /api/v1/admin/users": { status: 200, body: USERS },
    "GET /api/v1/admin/organizations": { status: 200, body: ORGS },
    [`GET /api/v1/admin/users/${LINKED_ID}/grants`]: { status: 200, body: GRANTS },
  };
  const table = { ...defaults, ...routes };
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      calls.push({ path, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      const hit = table[`${method} ${path}`];
      const reply = typeof hit === "function" ? hit() : (hit ?? { status: 404, body: { message: "unstubbed" } });
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

function stubOidc(): void {
  vi.stubEnv("VITE_AUTH_MODE", "oidc");
  vi.stubEnv("VITE_OIDC_ISSUER", "http://keycloak.test/realms/bms");
  vi.stubEnv("VITE_OIDC_CLIENT_ID", "bms-web");
}

function renderPage(as: AuthUser = orgAdmin): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/users"]}>
        <UsersAdminPage user={as} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const writes = (calls: Call[]) => calls.filter((call) => call.method !== "GET");
const listReads = (calls: Call[]) => calls.filter((call) => call.method === "GET" && call.path === "/api/v1/admin/users");

async function openPasswordModal(name = "Ada Linked") {
  await userEvent.click(await screen.findByRole("button", { name: `Temporary password for ${name}` }));
  const dialog = await screen.findByRole("dialog", { name: `Temporary password for ${name}` });
  return { dialog, input: within(dialog).getByLabelText(/Temporary password/) as HTMLInputElement };
}

async function openCreateModal() {
  await userEvent.click(await screen.findByRole("button", { name: "Create user" }));
  return screen.findByRole("dialog", { name: "Create user" });
}

/**
 * `F4.202`: Deactivate asks first. Clicks the row's Deactivate, then the dialog's confirm — the
 * write starts on the confirm, so every case that deactivated with one click goes through here.
 */
async function deactivateAndConfirm(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole("button", { name: `Deactivate ${name}` }));
  const dialog = await screen.findByRole("dialog", { name: `Deactivate ${name}` });
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm deactivate" }));
}

/** `F4.202`: a grant's Remove asks first, in a dialog outside the drawer and above it. */
async function removeGrantAndConfirm(drawer: HTMLElement, grantName: string): Promise<void> {
  await userEvent.click(await within(drawer).findByRole("button", { name: `Remove ${grantName}` }));
  const dialog = await screen.findByRole("dialog", { name: `Remove ${grantName}` });
  await userEvent.click(within(dialog).getByRole("button", { name: "Confirm remove" }));
}

/**
 * A request starts a tick after the click that asked for it, so "nothing was sent" is read only
 * after the timers have had a chance to run.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function fillCreate(dialog: HTMLElement, password: string): Promise<void> {
  await userEvent.type(within(dialog).getByLabelText("Email"), "new.person@example.test");
  await userEvent.type(within(dialog).getByLabelText("Display name"), "New Person");
  await userEvent.selectOptions(within(dialog).getByLabelText("Organization"), ORG_ID);
  await userEvent.type(within(dialog).getByLabelText(/Temporary password/), password);
}

/** Tab — visible to an organization_admin, absent for a location_admin (whose page also refuses). */
export async function showsTheUsersTabToAnOrganizationAdmin(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage(orgAdmin);
  const areas = await screen.findByRole("navigation", { name: "Master data areas" });
  expect(within(areas).getByRole("link", { name: "Users & Access" })).toBeInTheDocument();
  const tabs = screen.getByRole("navigation", { name: "Users & Access" });
  expect(within(tabs).getByRole("link", { name: "Users" })).toBeInTheDocument();
  expect(await screen.findByText("Ada Linked")).toBeInTheDocument();
}

export async function hidesTheUsersTabFromALocationAdmin(): Promise<void> {
  stubOidc();
  const calls = stubFetch();
  renderPage(locationAdmin);
  expect(await screen.findByText("User administration is open to administrators and organization administrators only.")).toBeInTheDocument();
  // Both the area tabs and the sidebar are checked: neither names the area.
  expect(screen.queryAllByRole("link", { name: "Users & Access" })).toEqual([]);
  expect(screen.queryByRole("button", { name: "Create user" })).not.toBeInTheDocument();
  // Positive control: the same layout shows the other areas, so absence is the gate, not a blank page.
  const areas = screen.getByRole("navigation", { name: "Master data areas" });
  expect(within(areas).getByRole("link", { name: "Sites & Equipment" })).toBeInTheDocument();
  // Fails closed before any users request.
  expect(calls.filter((call) => call.path === "/api/v1/admin/users")).toEqual([]);
}

export async function showsTheDeactivatedPill(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage();
  const row = (await screen.findByText("Dev Deactivated")).closest("tr") as HTMLElement;
  expect(within(row).getByText("Deactivated")).toBeInTheDocument();
  // Positive control: an active row carries no such pill.
  const active = screen.getByText("Ada Linked").closest("tr") as HTMLElement;
  expect(within(active).queryByText("Deactivated")).not.toBeInTheDocument();
}

export async function unlinkedEditIsDisabledWithTheSentence(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage();
  const edit = await screen.findByRole("button", { name: "Edit Uma Unlinked" });
  expect(edit).toBeDisabled();
  expect(edit).toHaveAccessibleDescription(UNLINKED_SENTENCE);
  expect(screen.getByText(UNLINKED_SENTENCE)).toBeInTheDocument();
  for (const label of ["Deactivate Uma Unlinked", "Temporary password for Uma Unlinked"]) {
    expect(screen.getByRole("button", { name: label })).toBeDisabled();
  }
}

export async function linkedEditIsEnabled(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage();
  const edit = await screen.findByRole("button", { name: "Edit Ada Linked" });
  expect(edit).toBeEnabled();
  expect(screen.getByRole("button", { name: "Create user" })).toBeEnabled();
  // Only the unlinked row carries the sentence.
  expect(screen.getAllByText(UNLINKED_SENTENCE)).toHaveLength(1);
}

export async function localModeDisablesEveryUserAction(): Promise<void> {
  // No OIDC stub: this is the local sign-in deployment.
  stubFetch();
  renderPage();
  const create = await screen.findByRole("button", { name: "Create user" });
  expect(create).toBeDisabled();
  expect(create).toHaveAccessibleDescription(LOCAL_SENTENCE);
  expect(screen.getByText(LOCAL_SENTENCE)).toBeInTheDocument();
  const edit = await screen.findByRole("button", { name: "Edit Ada Linked" });
  expect(edit).toBeDisabled();
  expect(edit).toHaveAccessibleDescription(LOCAL_SENTENCE);
}

export async function refusesAShortPasswordBeforeFetch(): Promise<void> {
  stubOidc();
  const calls = stubFetch();
  renderPage();
  const { dialog, input } = await openPasswordModal();
  await userEvent.type(input, "elevenchars"); // 11 characters
  expect(input.value).toHaveLength(11);
  await userEvent.click(within(dialog).getByRole("button", { name: "Set password" }));
  expect(await within(dialog).findByText("The temporary password must be at least 12 characters.")).toBeInTheDocument();
  expect(writes(calls)).toEqual([]);
}

export async function refusesAShortPasswordOnCreateBeforeFetch(): Promise<void> {
  stubOidc();
  const calls = stubFetch();
  renderPage();
  const dialog = await openCreateModal();
  await fillCreate(dialog, "elevenchars");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  expect(await within(dialog).findByText("The temporary password must be at least 12 characters.")).toBeInTheDocument();
  expect(writes(calls)).toEqual([]);
}

export async function sendsATwelveCharacterPassword(): Promise<void> {
  stubOidc();
  const calls = stubFetch({
    [`POST /api/v1/admin/users/${LINKED_ID}/temporary-password`]: { status: 200, body: written(USERS.items[0] as Record<string, unknown>) },
  });
  renderPage();
  const { dialog, input } = await openPasswordModal();
  await userEvent.type(input, "twelvechars!"); // 12 characters
  await userEvent.click(within(dialog).getByRole("button", { name: "Set password" }));
  await waitFor(() => {
    expect(writes(calls)).toEqual([
      { path: `/api/v1/admin/users/${LINKED_ID}/temporary-password`, method: "POST", body: { temporaryPassword: "twelvechars!" } },
    ]);
  });
}

export async function passwordInputIsEmptyOnReopen(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage();
  const first = await openPasswordModal();
  expect(first.input.value).toBe("");
  await userEvent.type(first.input, "a-typed-secret-1");
  expect(first.input.value).toBe("a-typed-secret-1");
  await userEvent.click(within(first.dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: /Temporary password for/ })).not.toBeInTheDocument();
  const second = await openPasswordModal();
  expect(second.input.value).toBe("");
}

async function expectFollowUp(sentence: RegExp, others: RegExp[]): Promise<void> {
  expect(await screen.findByText(sentence)).toBeInTheDocument();
  for (const other of others) {
    expect(screen.queryByText(other)).not.toBeInTheDocument();
  }
}

const ENABLE = /Keycloak did not enable the account/;
const DISABLE = /did not disable the account or end its sessions/;
const LOGOUT = /current sessions did not end/;
const ORPHAN = /disabled Keycloak account could not be removed/;
const UNKNOWN = /Keycloak did not confirm the new account/;
const ALL_FOLLOW_UPS = [ENABLE, DISABLE, LOGOUT, ORPHAN, UNKNOWN];
const without = (keep: RegExp) => ALL_FOLLOW_UPS.filter((sentence) => sentence !== keep);

export async function rendersKeycloakEnableFailed(): Promise<void> {
  stubOidc();
  stubFetch({
    [`POST /api/v1/admin/users/${DEACTIVATED_ID}/reactivate`]: { status: 200, body: written(USERS.items[2] as Record<string, unknown>, "keycloak_enable_failed") },
  });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Reactivate Dev Deactivated" }));
  await expectFollowUp(ENABLE, without(ENABLE));
}

export async function rendersKeycloakDisableFailed(): Promise<void> {
  stubOidc();
  stubFetch({
    [`POST /api/v1/admin/users/${LINKED_ID}/deactivate`]: { status: 200, body: written(USERS.items[0] as Record<string, unknown>, "keycloak_disable_failed") },
  });
  renderPage();
  await deactivateAndConfirm("Ada Linked");
  await expectFollowUp(DISABLE, without(DISABLE));
}

export async function rendersKeycloakLogoutFailed(): Promise<void> {
  stubOidc();
  stubFetch({
    [`POST /api/v1/admin/users/${LINKED_ID}/temporary-password`]: { status: 200, body: written(USERS.items[0] as Record<string, unknown>, "keycloak_logout_failed") },
  });
  renderPage();
  const { dialog, input } = await openPasswordModal();
  await userEvent.type(input, "twelvechars!");
  await userEvent.click(within(dialog).getByRole("button", { name: "Set password" }));
  await expectFollowUp(LOGOUT, without(LOGOUT));
}

export async function rendersKeycloakOrphanDisabledAccount(): Promise<void> {
  stubOidc();
  // An ERROR body: the create kept its original status and added the follow-up.
  stubFetch({
    "POST /api/v1/admin/users": {
      status: 500,
      body: { statusCode: 500, message: "Internal server error", followUp: "keycloak_orphan_disabled_account" },
    },
  });
  renderPage();
  const dialog = await openCreateModal();
  await fillCreate(dialog, "twelvechars!");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  await expectFollowUp(ORPHAN, without(ORPHAN));
}

export async function rendersKeycloakCreateOutcomeUnknown(): Promise<void> {
  stubOidc();
  stubFetch({
    "POST /api/v1/admin/users": {
      status: 502,
      body: { statusCode: 502, message: "The identity provider failed", followUp: "keycloak_create_outcome_unknown" },
    },
  });
  renderPage();
  const dialog = await openCreateModal();
  await fillCreate(dialog, "twelvechars!");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  await expectFollowUp(UNKNOWN, without(UNKNOWN));
}

export async function a503ShowsASentenceAndWritesNothingElse(): Promise<void> {
  stubOidc();
  const calls = stubFetch({
    [`PATCH /api/v1/admin/users/${LINKED_ID}`]: {
      status: 503,
      body: { statusCode: 503, message: "User administration is not configured" },
    },
  });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Edit Ada Linked" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit Ada Linked" });
  const name = within(dialog).getByLabelText("Display name");
  await userEvent.clear(name);
  await userEvent.type(name, "Ada Renamed");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByText(/Keycloak is not configured on the server/)).toBeInTheDocument();
  // Exactly the one refused write, and the list was not read again.
  expect(writes(calls)).toHaveLength(1);
  expect(listReads(calls)).toHaveLength(1);
  // The dialog stays open: nothing was saved.
  expect(screen.getByRole("dialog", { name: "Edit Ada Linked" })).toBeInTheDocument();
}

/** The positive control for the 503 case's "not read again": a successful write reads the list again. */
export async function aSuccessfulWriteReadsTheListAgain(): Promise<void> {
  stubOidc();
  const calls = stubFetch({
    [`POST /api/v1/admin/users/${LINKED_ID}/deactivate`]: { status: 200, body: written(USERS.items[0] as Record<string, unknown>) },
  });
  renderPage();
  await deactivateAndConfirm("Ada Linked");
  await waitFor(() => expect(listReads(calls)).toHaveLength(2));
}

export async function a400PolicyRefusalShowsTheServerMessageNotThePassword(): Promise<void> {
  stubOidc();
  const secret = "Correct-Horse-9!";
  stubFetch({
    [`POST /api/v1/admin/users/${LINKED_ID}/temporary-password`]: {
      status: 400,
      body: { statusCode: 400, message: "The password does not meet the sign-in policy", error: "Bad Request" },
    },
  });
  renderPage();
  const { dialog, input } = await openPasswordModal();
  await userEvent.type(input, secret);
  await userEvent.click(within(dialog).getByRole("button", { name: "Set password" }));
  // Adjacent positive: the server's own message is what is on screen.
  expect(await within(dialog).findByText("The password does not meet the sign-in policy")).toBeInTheDocument();
  expect(document.body.textContent).not.toContain(secret);
}

/**
 * The secret is not in the markup after a refusal. `textContent` never includes attribute values, so
 * only `innerHTML` sees a controlled input's mirrored `value` attribute.
 */
export async function a400LeavesNoPasswordInTheMarkup(): Promise<void> {
  stubOidc();
  const secret = "Correct-Horse-9!";
  stubFetch({
    [`POST /api/v1/admin/users/${LINKED_ID}/temporary-password`]: {
      status: 400,
      body: { statusCode: 400, message: "The password does not meet the sign-in policy", error: "Bad Request" },
    },
  });
  renderPage();
  const { dialog, input } = await openPasswordModal();
  await userEvent.type(input, secret);
  await userEvent.click(within(dialog).getByRole("button", { name: "Set password" }));
  expect(await within(dialog).findByText("The password does not meet the sign-in policy")).toBeInTheDocument();
  expect(document.body.innerHTML).not.toContain(secret);
}

export async function a400ClearsThePasswordInput(): Promise<void> {
  stubOidc();
  stubFetch({
    [`POST /api/v1/admin/users/${LINKED_ID}/temporary-password`]: {
      status: 400,
      body: { statusCode: 400, message: "The password does not meet the sign-in policy", error: "Bad Request" },
    },
  });
  renderPage();
  const { dialog, input } = await openPasswordModal();
  await userEvent.type(input, "Correct-Horse-9!");
  await userEvent.click(within(dialog).getByRole("button", { name: "Set password" }));
  expect(await within(dialog).findByText("The password does not meet the sign-in policy")).toBeInTheDocument();
  expect(input.value).toBe("");
}

export async function aFailedCreateLeavesNoPasswordInTheMarkup(): Promise<void> {
  stubOidc();
  const secret = "Correct-Horse-9!";
  stubFetch({
    "POST /api/v1/admin/users": {
      status: 400,
      body: { statusCode: 400, message: "The password does not meet the sign-in policy", error: "Bad Request" },
    },
  });
  renderPage();
  const dialog = await openCreateModal();
  await fillCreate(dialog, secret);
  await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  expect(await within(dialog).findByText("The password does not meet the sign-in policy")).toBeInTheDocument();
  expect(document.body.innerHTML).not.toContain(secret);
}

export async function aFailedCreateClearsThePasswordInput(): Promise<void> {
  stubOidc();
  stubFetch({
    "POST /api/v1/admin/users": {
      status: 400,
      body: { statusCode: 400, message: "The password does not meet the sign-in policy", error: "Bad Request" },
    },
  });
  renderPage();
  const dialog = await openCreateModal();
  await fillCreate(dialog, "Correct-Horse-9!");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
  expect(await within(dialog).findByText("The password does not meet the sign-in policy")).toBeInTheDocument();
  expect((within(dialog).getByLabelText(/Temporary password/) as HTMLInputElement).value).toBe("");
  // The rest of the form survives, so the admin corrects only the password.
  expect((within(dialog).getByLabelText("Email") as HTMLInputElement).value).toBe("new.person@example.test");
}

export async function a404ShowsANotFoundSentence(): Promise<void> {
  stubOidc();
  stubFetch({
    [`POST /api/v1/admin/users/${LINKED_ID}/deactivate`]: { status: 404, body: { statusCode: 404, message: "Not Found" } },
  });
  renderPage();
  await deactivateAndConfirm("Ada Linked");
  expect(await screen.findByText("This user was not found, or it is outside your scope.")).toBeInTheDocument();
}

async function openGrants() {
  await userEvent.click(await screen.findByRole("button", { name: "Grants for Ada Linked" }));
  return screen.findByRole("dialog", { name: "Grants for Ada Linked" });
}

export async function anIneffectiveGrantShowsTheNote(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage();
  const drawer = await openGrants();
  expect(await within(drawer).findByText("Plant South")).toBeInTheDocument();
  // `F4.200`: the shared label, exactly and case-sensitively ("Viewer", never "viewer").
  expect(within(drawer).getAllByText("Not used by the Viewer role.")).toHaveLength(1);
  const south = within(drawer).getByText("Plant South").closest("li") as HTMLElement;
  expect(within(south).getByText("Not used by the Viewer role.")).toBeInTheDocument();
  const north = within(drawer).getByText("Plant North").closest("li") as HTMLElement;
  expect(within(north).queryByText(/Not used by/)).not.toBeInTheDocument();
}

export async function removingAGrantSendsItsIdAndKind(): Promise<void> {
  stubOidc();
  const calls = stubFetch({
    [`DELETE /api/v1/admin/users/${LINKED_ID}/grants/location/${GRANT_A_ID}`]: { status: 200, body: { items: [GRANTS.items[1]] } },
  });
  renderPage();
  const drawer = await openGrants();
  await removeGrantAndConfirm(drawer, "Location grant Plant North");
  await waitFor(() => {
    expect(writes(calls)).toEqual([
      { path: `/api/v1/admin/users/${LINKED_ID}/grants/location/${GRANT_A_ID}`, method: "DELETE", body: undefined },
    ]);
  });
  // The list is the response the server sent back.
  await waitFor(() => expect(within(drawer).queryByText("Plant North")).not.toBeInTheDocument());
  expect(within(drawer).getByText("Plant South")).toBeInTheDocument();
}

/**
 * `F4.168` D4: a pending Remove names the grant being removed, and only that one. The DELETE never
 * settles, so the pending state holds while the assertions run.
 */
export async function aPendingRemoveAnnouncesOnlyItsOwnGrant(): Promise<void> {
  stubOidc();
  stubFetch();
  const real = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "DELETE" ? new Promise<Response>(() => {}) : real(input, init),
    ),
  );
  renderPage();
  const drawer = await openGrants();
  await removeGrantAndConfirm(drawer, "Location grant Plant North");
  const busy = await within(drawer).findByRole("button", { name: "Removing Location grant Plant North" });
  expect(busy).toHaveAttribute("aria-busy", "true");
  const other = within(drawer).getByRole("button", { name: "Remove Location grant Plant South" });
  expect(other).not.toHaveAttribute("aria-busy", "true");
}

export async function aPendingAddAnnouncesItself(): Promise<void> {
  stubOidc();
  stubFetch();
  const real = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST" ? new Promise<Response>(() => {}) : real(input, init),
    ),
  );
  renderPage();
  const drawer = await openGrants();
  await userEvent.selectOptions(within(drawer).getByLabelText("Grant kind"), "organization");
  await within(drawer).findByRole("option", { name: "Acme Works" });
  await userEvent.selectOptions(within(drawer).getByLabelText("Grant target"), ORG_ID);
  await userEvent.click(within(drawer).getByRole("button", { name: "Add grant" }));
  const busy = await within(drawer).findByRole("button", { name: "Adding…" });
  expect(busy).toHaveAttribute("aria-busy", "true");
}

const TARGET_NOT_FOUND_SENTENCE = "That location, group or organization was not found, or it is outside your scope.";
const USER_NOT_FOUND_SENTENCE = "This user was not found, or it is outside your scope.";

async function addOrganizationGrantRefusedWith404(message: string) {
  stubOidc();
  stubFetch({
    [`POST /api/v1/admin/users/${LINKED_ID}/grants`]: { status: 404, body: { statusCode: 404, message } },
  });
  renderPage();
  const drawer = await openGrants();
  await userEvent.selectOptions(within(drawer).getByLabelText("Grant kind"), "organization");
  await within(drawer).findByRole("option", { name: "Acme Works" });
  await userEvent.selectOptions(within(drawer).getByLabelText("Grant target"), ORG_ID);
  await userEvent.click(within(drawer).getByRole("button", { name: "Add grant" }));
  return drawer;
}

/** A missing or out-of-scope grant target is not a missing user. */
export async function aMissingGrantTargetGetsItsOwnSentence(): Promise<void> {
  const drawer = await addOrganizationGrantRefusedWith404("Grant target not found");
  expect(await within(drawer).findByText(TARGET_NOT_FOUND_SENTENCE)).toBeInTheDocument();
  expect(within(drawer).queryByText(USER_NOT_FOUND_SENTENCE)).not.toBeInTheDocument();
}

/** The positive control: a 404 that is not the target's keeps the user sentence in the drawer. */
export async function aMissingUserInTheDrawerKeepsTheUserSentence(): Promise<void> {
  const drawer = await addOrganizationGrantRefusedWith404("Not Found");
  expect(await within(drawer).findByText(USER_NOT_FOUND_SENTENCE)).toBeInTheDocument();
  expect(within(drawer).queryByText(TARGET_NOT_FOUND_SENTENCE)).not.toBeInTheDocument();
}

function holdWrites(): void {
  stubFetch();
  const real = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST" ? new Promise<Response>(() => {}) : real(input, init),
    ),
  );
}

/** `F4.168` D4: the row action in flight names itself and is aria-busy; no other row's action does. */
export async function aPendingDeactivateAnnouncesItselfOnItsRowOnly(): Promise<void> {
  stubOidc();
  holdWrites();
  renderPage();
  await deactivateAndConfirm("Ada Linked");
  const busy = await screen.findByRole("button", { name: "Deactivating Ada Linked…" });
  expect(busy).toHaveAttribute("aria-busy", "true");
  expect(busy).toHaveTextContent("Deactivating…");
  // Positive control: another row's action, and another action on this row, keep their names.
  const other = screen.getByRole("button", { name: "Reactivate Dev Deactivated" });
  expect(other).not.toHaveAttribute("aria-busy", "true");
  expect(other).toHaveTextContent("Reactivate");
  expect(screen.getByRole("button", { name: "Edit Ada Linked" })).not.toHaveAttribute("aria-busy", "true");
}

/** The same action on another row keeps its name: the key is the row, not just the action. */
export async function aPendingDeactivateLeavesTheSameActionOnAnotherRowAlone(): Promise<void> {
  stubOidc();
  stubFetch({
    "GET /api/v1/admin/users": {
      status: 200,
      body: { items: [userRow(LINKED_ID, "Ada Linked"), userRow("66666666-6666-6666-6666-666666666666", "Bea Second")] },
    },
  });
  const real = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST" ? new Promise<Response>(() => {}) : real(input, init),
    ),
  );
  renderPage();
  await deactivateAndConfirm("Ada Linked");
  await screen.findByRole("button", { name: "Deactivating Ada Linked…" });
  const other = screen.getByRole("button", { name: "Deactivate Bea Second" });
  expect(other).not.toHaveAttribute("aria-busy", "true");
  expect(other).toHaveTextContent("Deactivate");
}

export async function aPendingReactivateAnnouncesItself(): Promise<void> {
  stubOidc();
  holdWrites();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Reactivate Dev Deactivated" }));
  const busy = await screen.findByRole("button", { name: "Reactivating Dev Deactivated…" });
  expect(busy).toHaveAttribute("aria-busy", "true");
  expect(busy).toHaveTextContent("Reactivating…");
}

/** The modal-driven actions: the row behind the modal names the save in flight. */
export async function aPendingEditAnnouncesItsRow(): Promise<void> {
  stubOidc();
  stubFetch();
  const real = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PATCH" ? new Promise<Response>(() => {}) : real(input, init),
    ),
  );
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Edit Ada Linked" }));
  const dialog = await screen.findByRole("dialog", { name: /Edit/ });
  await userEvent.type(within(dialog).getByLabelText("Display name"), " Jr");
  await userEvent.click(within(dialog).getByRole("button", { name: /^Save/ }));
  const busy = await screen.findByRole("button", { name: "Saving Ada Linked…", hidden: true });
  expect(busy).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Edit Dev Deactivated", hidden: true })).not.toHaveAttribute("aria-busy", "true");
}

export async function aPendingTemporaryPasswordAnnouncesItsRow(): Promise<void> {
  stubOidc();
  holdWrites();
  renderPage();
  const { dialog, input } = await openPasswordModal();
  await userEvent.type(input, "Correct-Horse-9!");
  await userEvent.click(within(dialog).getByRole("button", { name: /^(Set|Save)/ }));
  const busy = await screen.findByRole("button", { name: "Setting temporary password for Ada Linked…", hidden: true });
  expect(busy).toHaveAttribute("aria-busy", "true");
}

/**
 * ADR 0089 decision 11: grants touch only the database, so local sign-in still manages them.
 * Decision 15 limits the disabled state to the user actions.
 */
export async function localModeKeepsGrantRemoveEnabled(): Promise<void> {
  // No OIDC stub: this is the local sign-in deployment.
  stubFetch();
  renderPage();
  // The user actions are off in this mode (the control for this case's premise).
  expect(await screen.findByRole("button", { name: "Edit Ada Linked" })).toBeDisabled();
  const drawer = await openGrants();
  const remove = await within(drawer).findByRole("button", { name: "Remove Location grant Plant North" });
  expect(remove).toBeEnabled();
  expect(remove).not.toHaveAccessibleDescription(LOCAL_SENTENCE);
}

export async function localModeKeepsAddGrantEnabled(): Promise<void> {
  stubFetch();
  renderPage();
  expect(await screen.findByRole("button", { name: "Edit Ada Linked" })).toBeDisabled();
  const drawer = await openGrants();
  await userEvent.selectOptions(within(drawer).getByLabelText("Grant kind"), "organization");
  await within(drawer).findByRole("option", { name: "Acme Works" });
  await userEvent.selectOptions(within(drawer).getByLabelText("Grant target"), ORG_ID);
  const add = within(drawer).getByRole("button", { name: "Add grant" });
  expect(add).toBeEnabled();
  expect(add).not.toHaveAccessibleDescription(LOCAL_SENTENCE);
}

export async function addingAGrantSendsItsKindAndTarget(): Promise<void> {
  stubOidc();
  const calls = stubFetch({
    [`POST /api/v1/admin/users/${LINKED_ID}/grants`]: { status: 201, body: GRANTS },
  });
  renderPage();
  const drawer = await openGrants();
  await userEvent.selectOptions(within(drawer).getByLabelText("Grant kind"), "organization");
  await userEvent.selectOptions(await within(drawer).findByRole("option", { name: "Acme Works" }).then(() => within(drawer).getByLabelText("Grant target")), ORG_ID);
  await userEvent.click(within(drawer).getByRole("button", { name: "Add grant" }));
  await waitFor(() => {
    expect(writes(calls)).toEqual([
      { path: `/api/v1/admin/users/${LINKED_ID}/grants`, method: "POST", body: { kind: "organization", targetId: ORG_ID } },
    ]);
  });
}

export async function aGlobalAdminMayCreateAnAdmin(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage(globalAdmin);
  const dialog = await openCreateModal();
  const roles = within(within(dialog).getByLabelText("Role")).getAllByRole("option").map((o) => o.textContent);
  expect(roles).toContain("Administrator");
  expect(roles).toContain("Viewer");
}

export async function anOrganizationAdminIsNotOfferedAdmin(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage(orgAdmin);
  const dialog = await openCreateModal();
  const roles = within(within(dialog).getByLabelText("Role")).getAllByRole("option").map((o) => o.textContent);
  // `F4.200`: the options read the shared labels, so the absence is checked on "Administrator"
  // and the positive control is "Viewer" — the lower-case codes would pass vacuously here.
  expect(roles).not.toContain("Administrator");
  expect(roles).toContain("Viewer");
}

// -- F4.200: the shared role labels -------------------------------------------------------------

/** The Role column reads `lib/role-label.ts`, not the role code with its underscores replaced. */
export async function theRoleColumnShowsTheSharedLabel(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage();
  const row = (await screen.findByText("Ola Organizer")).closest("tr") as HTMLElement;
  expect(within(row).getByText("Organization Administrator")).toBeInTheDocument();
  const viewer = screen.getByText("Ada Linked").closest("tr") as HTMLElement;
  expect(within(viewer).getByText("Viewer")).toBeInTheDocument();
}

export async function theCreateRoleSelectShowsTheSharedLabels(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage();
  const dialog = await openCreateModal();
  const select = within(dialog).getByLabelText("Role");
  expect(within(select).getByRole("option", { name: "Location Administrator" })).toBeInTheDocument();
}

export async function theEditRoleSelectShowsTheSharedLabels(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Edit Ada Linked" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit Ada Linked" });
  const select = within(dialog).getByLabelText("Role");
  expect(within(select).getByRole("option", { name: "Location Administrator" })).toBeInTheDocument();
}

// -- F4.201: grant targets name their location --------------------------------------------------

const GROUP_ID = "88888888-8888-8888-8888-888888888888";
const OTHER_GROUP_ID = "99999999-9999-9999-9999-999999999999";
/** Two locations, each with an "HVAC" group: the name alone cannot tell them apart. */
const ASSET_GROUPS = {
  items: [
    { id: GROUP_ID, code: "hvac", name: "HVAC", description: null, locationId: "55555555-5555-5555-5555-555555555555", locationName: "Plant North", organizationId: ORG_ID, memberCount: 2, createdAt: new Date(0).toISOString() },
    { id: OTHER_GROUP_ID, code: "hvac", name: "HVAC", description: null, locationId: "56565656-5656-5656-5656-565656565656", locationName: "Plant South", organizationId: ORG_ID, memberCount: 1, createdAt: new Date(0).toISOString() },
  ],
};

export async function theTargetSelectNamesTheGroupsLocation(): Promise<void> {
  stubOidc();
  stubFetch({ "GET /api/v1/admin/asset-groups": { status: 200, body: ASSET_GROUPS } });
  renderPage();
  const drawer = await openGrants();
  await userEvent.selectOptions(within(drawer).getByLabelText("Grant kind"), "asset_group");
  const target = within(drawer).getByLabelText("Grant target");
  expect(await within(target).findByRole("option", { name: "HVAC · Plant North" })).toBeInTheDocument();
  expect(within(target).getByRole("option", { name: "HVAC · Plant South" })).toBeInTheDocument();
}

export async function anAssetGroupGrantRowNamesItsLocation(): Promise<void> {
  stubOidc();
  const groupGrant = { ...grant(GRANT_A_ID, "HVAC", true), kind: "asset_group", targetId: GROUP_ID, locationName: "Plant North" };
  stubFetch({ [`GET /api/v1/admin/users/${LINKED_ID}/grants`]: { status: 200, body: { items: [groupGrant] } } });
  renderPage();
  const drawer = await openGrants();
  const row = (await within(drawer).findByText("HVAC")).closest("li") as HTMLElement;
  expect(within(row).getByText("Asset group · Plant North")).toBeInTheDocument();
}

export async function theDrawerRoleLineShowsTheSharedLabel(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage();
  const drawer = await openGrants();
  expect(within(drawer).getByText("Role: Viewer")).toBeInTheDocument();
}

// -- F4.202: confirm before Deactivate and grant Remove -----------------------------------------

const DEACTIVATE_BODY =
  "This ends the user's sessions and closes its live connections. You can reactivate the user later.";

/** The dialog names the user and the result. */
export async function theDeactivateConfirmNamesTheUserAndTheResult(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Deactivate Ada Linked" }));
  const dialog = await screen.findByRole("dialog", { name: "Deactivate Ada Linked" });
  expect(dialog).toHaveTextContent(DEACTIVATE_BODY);
}

/**
 * Cancel sends nothing. The adjacent positives: the dialog did open, it is gone after Cancel, and
 * the row still reads "Deactivate" (not "Deactivating…").
 */
export async function cancellingDeactivateSendsNothing(): Promise<void> {
  stubOidc();
  const calls = stubFetch();
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Deactivate Ada Linked" }));
  const dialog = await screen.findByRole("dialog", { name: "Deactivate Ada Linked" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Deactivate Ada Linked" })).toBeNull());
  await settle();
  expect(screen.getByRole("button", { name: "Deactivate Ada Linked" })).toHaveAttribute("aria-busy", "false");
  expect(writes(calls)).toEqual([]);
}

/** Confirm sends exactly one request — not one on the row click and another on the confirm. */
export async function confirmingDeactivateSendsOneRequest(): Promise<void> {
  stubOidc();
  const calls = stubFetch({
    [`POST /api/v1/admin/users/${LINKED_ID}/deactivate`]: { status: 200, body: written(USERS.items[0] as Record<string, unknown>) },
  });
  renderPage();
  await deactivateAndConfirm("Ada Linked");
  // The confirm closes the dialog in the click that starts the request.
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Deactivate Ada Linked" })).toBeNull());
  await waitFor(() => expect(writes(calls).length).toBeGreaterThan(0));
  await settle();
  expect(writes(calls)).toEqual([{ path: `/api/v1/admin/users/${LINKED_ID}/deactivate`, method: "POST", body: undefined }]);
}

export async function cancellingGrantRemoveSendsNothing(): Promise<void> {
  stubOidc();
  const calls = stubFetch();
  renderPage();
  const drawer = await openGrants();
  await userEvent.click(await within(drawer).findByRole("button", { name: "Remove Location grant Plant North" }));
  const dialog = await screen.findByRole("dialog", { name: "Remove Location grant Plant North" });
  expect(dialog).toHaveTextContent("The user loses the access this grant gives.");
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove Location grant Plant North" })).toBeNull());
  await settle();
  // Positive control: the grant is still listed, and its Remove is not announcing a removal.
  expect(within(drawer).getByRole("button", { name: "Remove Location grant Plant North" })).toHaveAttribute("aria-busy", "false");
  expect(writes(calls)).toEqual([]);
}

export async function confirmingGrantRemoveSendsOneRequest(): Promise<void> {
  stubOidc();
  const calls = stubFetch({
    [`DELETE /api/v1/admin/users/${LINKED_ID}/grants/location/${GRANT_A_ID}`]: { status: 200, body: { items: [GRANTS.items[1]] } },
  });
  renderPage();
  const drawer = await openGrants();
  await removeGrantAndConfirm(drawer, "Location grant Plant North");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove Location grant Plant North" })).toBeNull());
  await waitFor(() => expect(writes(calls).length).toBeGreaterThan(0));
  await settle();
  expect(writes(calls)).toEqual([
    { path: `/api/v1/admin/users/${LINKED_ID}/grants/location/${GRANT_A_ID}`, method: "DELETE", body: undefined },
  ]);
}

/** Reactivate needs no confirm (owner ruling): one click, one request, no dialog. */
export async function reactivateSendsAtOnce(): Promise<void> {
  stubOidc();
  const calls = stubFetch({
    [`POST /api/v1/admin/users/${DEACTIVATED_ID}/reactivate`]: { status: 200, body: written(USERS.items[2] as Record<string, unknown>) },
  });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Reactivate Dev Deactivated" }));
  await waitFor(() => {
    expect(writes(calls)).toEqual([{ path: `/api/v1/admin/users/${DEACTIVATED_ID}/reactivate`, method: "POST", body: undefined }]);
  });
  expect(screen.queryByRole("dialog")).toBeNull();
}

/** "Temporary password" keeps its modal and gets no second confirm: Set password sends. */
export async function temporaryPasswordOpensNoSecondConfirm(): Promise<void> {
  stubOidc();
  const calls = stubFetch({
    [`POST /api/v1/admin/users/${LINKED_ID}/temporary-password`]: { status: 200, body: written(USERS.items[0] as Record<string, unknown>) },
  });
  renderPage();
  const { dialog, input } = await openPasswordModal();
  await userEvent.type(input, "twelvechars!");
  await userEvent.click(within(dialog).getByRole("button", { name: "Set password" }));
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  expect(screen.queryByRole("button", { name: /^Confirm/ })).toBeNull();
}
