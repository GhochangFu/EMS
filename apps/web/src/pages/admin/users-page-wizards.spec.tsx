import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";

import { createUserValues } from "../../components/admin/user-wizards";
import {
  type Call,
  DEACTIVATED_ID,
  GRANTS,
  GRANT_A_ID,
  LINKED_ID,
  ORG_ID,
  USERS,
  addOrganizationGrant,
  fillCreate,
  globalAdmin,
  headersSent,
  openCreateModal,
  openCreateRoleStep,
  openEditWizard,
  openGrants,
  orgAdmin,
  removeGrantAndConfirm,
  renderPage,
  settle,
  stubFetch,
  stubOidc,
  submitEditWizard,
  userRow,
  writes,
  written,
} from "./users-page.spec";

/**
 * `F3.86` PR 4 / ADR 0099 decision 3 (plan §6.5, ruling Q9) — the Users page's and the grants
 * drawer's wizards: `user.create` (its password held in a ref, never in the wizard's values),
 * `user.update` (never for an `admin` row), and `userGrant.add` / `userGrant.remove` (red). A
 * wizard request is the plain route, never `X-Copilot-Change`. Moved beside
 * `users-page.spec.tsx` for the AGENTS.md §4.5 cap; its helpers are that file's. Vitest entry
 * point: the sibling `.test.tsx` (ADR 0014).
 */

const CREATE_SECRET = "Typed-Secret-42!";

/**
 * Create through the wizard with `CREATE_SECRET`, answered 201; returns the call log at Submit.
 * Each case waits on its own assertion: `asyncUtilTimeout` equals the 5 s test timeout, so its
 * `it()` sets a longer one and a mutation reddens at that assertion, not at a timeout.
 */
async function createThroughTheWizard(): Promise<Call[]> {
  stubOidc();
  const calls = stubFetch({
    "POST /api/v1/admin/users": { status: 201, body: written(USERS.items[0] as Record<string, unknown>) },
  });
  renderPage();
  const dialog = await openCreateModal();
  await fillCreate(dialog, CREATE_SECRET);
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  return calls;
}

/** The request is the wizard's four fields and the typed password — the route's whole body. */
export async function theCreateRequestBodyIsTheWizardValuesAndThePassword(): Promise<void> {
  const calls = await createThroughTheWizard();
  await waitFor(() => expect(writes(calls)).toEqual([
    {
      path: "/api/v1/admin/users",
      method: "POST",
      body: {
        email: "new.person@example.test",
        displayName: "New Person",
        role: "viewer",
        organizationId: ORG_ID,
        temporaryPassword: CREATE_SECRET,
      },
    },
  ]));
}

/** The typed password reaches the request: the ref is merged on Submit. */
export async function theCreateRequestCarriesTheTypedPassword(): Promise<void> {
  const calls = await createThroughTheWizard();
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  const body = writes(calls)[0]?.body as Record<string, unknown>;
  expect(body.temporaryPassword).toBe(CREATE_SECRET);
}

/**
 * The wizard's values never hold the password: its Review card — the values, rendered — has the
 * four field rows and no password row, and the markup never holds the secret.
 */
export async function theCreateWizardValuesHoldNoPassword(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage();
  const dialog = await openCreateModal();
  await fillCreate(dialog, CREATE_SECRET);
  const card = within(dialog).getByRole("region", { name: "Create a user" });
  const fields = within(card).getAllByRole("rowheader").map((cell) => cell.textContent);
  expect(fields).toEqual(["Email", "Display name", "Role", "Organization id"]);
  expect(document.body.innerHTML).not.toContain(CREATE_SECRET);
}

/** The values builder itself: exactly the four step fields, never `temporaryPassword`. */
export async function theCreateValuesBuilderHasNoPasswordKey(): Promise<void> {
  const values = createUserValues({ email: "a@b.test", displayName: "A", role: "viewer", organizationId: ORG_ID });
  expect(Object.keys(values)).toEqual(["email", "displayName", "role", "organizationId"]);
}

/** A wizard request is the plain route: no `X-Copilot-Change`, beside the JSON header it does carry. */
export async function theCreateRequestCarriesNoCopilotHeader(): Promise<void> {
  const calls = await createThroughTheWizard();
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  const post = headersSent().find((sent) => sent.method === "POST" && sent.path === "/api/v1/admin/users");
  expect(post?.headers.get("Content-Type")).toBe("application/json");
  expect(post?.headers.has("X-Copilot-Change")).toBe(false);
}

/** The edit wizard sends only the changed field, on the plain route. */
export async function theEditRequestCarriesNoCopilotHeader(): Promise<void> {
  stubOidc();
  const calls = stubFetch({
    [`PATCH /api/v1/admin/users/${LINKED_ID}`]: { status: 200, body: written(USERS.items[0] as Record<string, unknown>) },
  });
  renderPage();
  const dialog = await openEditWizard();
  await userEvent.type(within(dialog).getByLabelText("Display name"), " Jr");
  await submitEditWizard(dialog);
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  expect(writes(calls)).toEqual([
    { path: `/api/v1/admin/users/${LINKED_ID}`, method: "PATCH", body: { displayName: "Ada Linked Jr" } },
  ]);
  const patch = headersSent().find((sent) => sent.method === "PATCH");
  expect(patch?.headers.get("Content-Type")).toBe("application/json");
  expect(patch?.headers.has("X-Copilot-Change")).toBe(false);
}

/** The edit wizard's Role step never offers `admin` either; positive: it offers organization_admin. */
export async function theEditWizardNeverOffersAdmin(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage(globalAdmin);
  const dialog = await openEditWizard();
  await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
  const roles = within(within(dialog).getByRole("combobox", { name: "Role" })).getAllByRole("option").map((o) => o.textContent);
  expect(roles).not.toContain("Administrator");
  expect(roles).toContain("Organization Administrator");
}

const ADMIN_ROW_ID = "12121212-1212-1212-1212-121212121212";
const WITH_ADMIN_ROW = {
  items: [userRow(LINKED_ID, "Ada Linked"), userRow(ADMIN_ROW_ID, "Abe Admin", { role: "admin", organizationId: null })],
};

/** An `admin` row's Edit is the old form (Save, no steps), not the `user.update` wizard. */
export async function anAdminRowKeepsTheOldEditForm(): Promise<void> {
  stubOidc();
  stubFetch({ "GET /api/v1/admin/users": { status: 200, body: WITH_ADMIN_ROW } });
  renderPage(globalAdmin);
  await userEvent.click(await screen.findByRole("button", { name: "Edit Abe Admin" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit Abe Admin" });
  expect(within(dialog).getByRole("button", { name: "Save" })).toBeInTheDocument();
  expect(within(dialog).queryByRole("list", { name: "Steps" })).toBeNull();
}

/** The positive beside it: a viewer row's Edit is the wizard (its step list, no Save). */
export async function aViewerRowEditIsTheWizard(): Promise<void> {
  stubOidc();
  stubFetch({ "GET /api/v1/admin/users": { status: 200, body: WITH_ADMIN_ROW } });
  renderPage(globalAdmin);
  const dialog = await openEditWizard();
  expect(within(dialog).getByRole("list", { name: "Steps" })).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Save" })).toBeNull();
}

/** Promotion stays on the Users page: the global admin's "Global role" opens the old form with `admin`. */
export async function theGlobalRoleActionOffersAdmin(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage(globalAdmin);
  await userEvent.click(await screen.findByRole("button", { name: "Global role for Ada Linked" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit Ada Linked" });
  const roles = within(within(dialog).getByRole("combobox", { name: "Role" })).getAllByRole("option").map((o) => o.textContent);
  expect(roles).toContain("Administrator");
}

/** An organization admin has no "Global role" action; positive: the row's Edit is there. */
export async function anOrganizationAdminHasNoGlobalRoleAction(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage(orgAdmin);
  expect(await screen.findByRole("button", { name: "Edit Ada Linked" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Global role for Ada Linked" })).toBeNull();
}

/** The remove wizard is red: its Review card carries `data-risk="access"`. */
export async function theGrantRemoveWizardIsRed(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage();
  const drawer = await openGrants();
  await userEvent.click(await within(drawer).findByRole("button", { name: "Remove Location grant Plant North" }));
  const dialog = await screen.findByRole("dialog", { name: "Remove Location grant Plant North" });
  const card = within(dialog).getByRole("region", { name: "Revoke access" });
  expect(card).toHaveAttribute("data-risk", "access");
  expect(card).toHaveTextContent('Revoke the access of "Ada Linked" to the site "Plant North".');
}

/** Its Submit sends the plain DELETE: the exact path and method, and no `X-Copilot-Change`. */
export async function theGrantRemoveSendsAPlainDelete(): Promise<void> {
  stubOidc();
  const calls = stubFetch({
    [`DELETE /api/v1/admin/users/${LINKED_ID}/grants/location/${GRANT_A_ID}`]: { status: 200, body: { items: [GRANTS.items[1]] } },
  });
  renderPage();
  const drawer = await openGrants();
  await removeGrantAndConfirm(drawer, "Location grant Plant North");
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  const sent = headersSent().find((one) => one.method === "DELETE");
  expect(sent?.path).toBe(`/api/v1/admin/users/${LINKED_ID}/grants/location/${GRANT_A_ID}`);
  expect(sent?.headers.has("X-Copilot-Change")).toBe(false);
}

/** The add wizard's POST is plain too, beside its JSON header. */
export async function theGrantAddCarriesNoCopilotHeader(): Promise<void> {
  stubOidc();
  const calls = stubFetch({
    [`POST /api/v1/admin/users/${LINKED_ID}/grants`]: { status: 201, body: GRANTS },
  });
  renderPage();
  const drawer = await openGrants();
  await addOrganizationGrant(drawer);
  await userEvent.click(await within(drawer).findByRole("button", { name: "Submit" }));
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  const post = headersSent().find((one) => one.method === "POST");
  expect(post?.headers.get("Content-Type")).toBe("application/json");
  expect(post?.headers.has("X-Copilot-Change")).toBe(false);
}

/**
 * `F3.86` PR 4 (plan §6.5, ADR 0099 decision 3): the create wizard's Role step never offers the
 * global `admin`, to a global admin either — this case replaces `F3.78`'s "a global admin may
 * create an admin". Promotion stays on the "Global role" action (`theGlobalRoleActionOffersAdmin`).
 */
export async function theCreateWizardNeverOffersAdminToAGlobalAdmin(): Promise<void> {
  stubOidc();
  stubFetch();
  renderPage(globalAdmin);
  const dialog = await openCreateRoleStep();
  const roles = within(within(dialog).getByRole("combobox", { name: "Role" })).getAllByRole("option").map((o) => o.textContent);
  expect(roles).not.toContain("Administrator");
  expect(roles).toContain("Organization Administrator");
}

/**
 * `F3.86` PR 4 (ruling Q9) replaces `F4.202`'s "Reactivate sends at once": Reactivate is a
 * Review-only wizard. The row click sends nothing; one Submit sends one request and closes it.
 */
export async function reactivateSubmitSendsOneRequest(): Promise<void> {
  stubOidc();
  const calls = stubFetch({
    [`POST /api/v1/admin/users/${DEACTIVATED_ID}/reactivate`]: { status: 200, body: written(USERS.items[2] as Record<string, unknown>) },
  });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Reactivate Dev Deactivated" }));
  const dialog = await screen.findByRole("dialog", { name: "Reactivate Dev Deactivated" });
  await settle();
  expect(writes(calls)).toEqual([]);
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => {
    expect(writes(calls)).toEqual([{ path: `/api/v1/admin/users/${DEACTIVATED_ID}/reactivate`, method: "POST", body: undefined }]);
  });
  expect(screen.queryByRole("dialog")).toBeNull();
}

/** The status wizards are plain too: one POST on the route, no `X-Copilot-Change`. */
async function statusWriteHeaders(
  action: "Deactivate" | "Reactivate",
  name: string,
  path: string,
): Promise<Headers | undefined> {
  stubOidc();
  const calls = stubFetch({ [`POST ${path}`]: { status: 200, body: written(USERS.items[0] as Record<string, unknown>) } });
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: `${action} ${name}` }));
  const dialog = await screen.findByRole("dialog", { name: `${action} ${name}` });
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(writes(calls)).toEqual([{ path, method: "POST", body: undefined }]));
  return headersSent().find((one) => one.method === "POST")?.headers;
}

export async function theDeactivateRequestCarriesNoCopilotHeader(): Promise<void> {
  const headers = await statusWriteHeaders("Deactivate", "Ada Linked", `/api/v1/admin/users/${LINKED_ID}/deactivate`);
  expect(headers).toBeDefined();
  expect(headers?.has("X-Copilot-Change")).toBe(false);
}

export async function theReactivateRequestCarriesNoCopilotHeader(): Promise<void> {
  const headers = await statusWriteHeaders("Reactivate", "Dev Deactivated", `/api/v1/admin/users/${DEACTIVATED_ID}/reactivate`);
  expect(headers).toBeDefined();
  expect(headers?.has("X-Copilot-Change")).toBe(false);
}
