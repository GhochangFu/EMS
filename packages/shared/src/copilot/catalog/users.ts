import { addUserGrantBodySchema, userGrantKindSchema } from "../../contracts/user-grants";
import {
  copilotCreateUserBodySchema,
  copilotUpdateUserBodySchema,
  createUserBodySchema,
  updateUserBodySchema,
} from "../../contracts/users";
import { emptyBody, fieldList, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, ExcludedRoute } from "./types";

const USER = { kind: "user", param: "id" } as const;

/** The grant kinds as a card names them. */
const GRANT_KIND_WORDS: Readonly<Record<string, string>> = {
  organization: "the organization",
  location: "the site",
  asset_group: "the asset group",
};

/**
 * `F3.86` PR 4 / ADR 0099 decision 3 (rulings 6, 17, 20) — users and grants,
 * every one `risk: "access"` (a red card). ADR 0089's checks decide what an
 * administrator may grant; the resolver calls them through `UsersService`
 * and `UserGrantsService`, never a copy.
 *
 * - `temporaryPassword` is `clientOnly`: the Confirm card's password box,
 *   never the model, the pending change or the history.
 * - The model proposes with `copilotCreateUserBodySchema` and
 *   `copilotUpdateUserBodySchema`: never the global `admin` role (the Users
 *   page keeps promotion).
 * - An access change is proposed only when the administrator's own message
 *   asked for one (the access-intent gate, ruling Q3), never in a follow-up.
 * - Revoking a grant is one of the two `DELETE` entries (`DELETE_ALLOWANCE`).
 */
export const USER_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "user.create",
    title: "Create a user",
    method: "POST",
    path: "/admin/users",
    params: {},
    body: createUserBodySchema,
    bodyName: "createUserBodySchema",
    modelBody: copilotCreateUserBodySchema,
    modelBodyName: "copilotCreateUserBodySchema",
    clientOnly: ["temporaryPassword"],
    risk: "access",
    target: { kind: "organization", manage: "user" },
    refs: [],
    formulas: [],
    steps: [
      { id: "account", title: "Account", fields: ["email", "displayName"] },
      { id: "role", title: "Role", fields: ["role", "organizationId"] },
    ],
    summary: ({ body, organizationName }) =>
      `Create the user ${quoted(text(body, "displayName"))} (${text(body, "email")}) as ${text(body, "role")} in ${organizationName}.`,
  },
  {
    id: "user.update",
    title: "Edit a user",
    method: "PATCH",
    path: "/admin/users/:id",
    params: { id: uuidParam },
    body: updateUserBodySchema,
    bodyName: "updateUserBodySchema",
    modelBody: copilotUpdateUserBodySchema,
    modelBodyName: "copilotUpdateUserBodySchema",
    clientOnly: [],
    risk: "access",
    target: USER,
    refs: [],
    formulas: [],
    steps: [
      { id: "account", title: "Account", fields: ["displayName"] },
      { id: "role", title: "Role", fields: ["role", "organizationId"] },
    ],
    summary: ({ body, targetName }) => `Change ${fieldList(body)} of the user ${quoted(targetName)}.`,
  },
  {
    id: "user.deactivate",
    title: "Deactivate a user",
    method: "POST",
    path: "/admin/users/:id/deactivate",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "access",
    target: USER,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Deactivate the user ${quoted(targetName)}: the account can no longer sign in.`,
  },
  {
    id: "user.reactivate",
    title: "Reactivate a user",
    method: "POST",
    path: "/admin/users/:id/reactivate",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "access",
    target: USER,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) => `Reactivate the user ${quoted(targetName)}: the account can sign in again.`,
  },
  {
    id: "userGrant.add",
    title: "Grant access",
    method: "POST",
    path: "/admin/users/:id/grants",
    params: { id: uuidParam },
    body: addUserGrantBodySchema,
    bodyName: "addUserGrantBodySchema",
    clientOnly: [],
    risk: "access",
    target: { kind: "userGrantAdd", param: "id" },
    refs: [],
    formulas: [],
    steps: [{ id: "grant", title: "Grant", fields: ["kind", "targetId"] }],
    summary: ({ body, targetName, refName }) =>
      `Grant ${quoted(targetName)} access to ${GRANT_KIND_WORDS[text(body, "kind")] ?? text(body, "kind")} ${quoted(refName ?? text(body, "targetId"))}.`,
  },
  {
    id: "userGrant.remove",
    title: "Revoke access",
    method: "DELETE",
    path: "/admin/users/:id/grants/:kind/:grantId",
    params: { id: uuidParam, kind: userGrantKindSchema, grantId: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "access",
    target: { kind: "userGrant", param: "grantId", kindParam: "kind", userParam: "id" },
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ params, targetName, refName }) =>
      `Revoke the access of ${quoted(targetName)} to ${GRANT_KIND_WORDS[params.kind ?? ""] ?? params.kind} ${quoted(refName ?? params.grantId ?? "")}.`,
  },
];

/** The area's write routes that are not entries (the temporary-password route is excluded in `index.ts`). */
export const USER_PENDING: readonly ExcludedRoute[] = [];
