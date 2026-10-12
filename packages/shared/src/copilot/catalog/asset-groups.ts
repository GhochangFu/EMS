import { setAssetGroupMemberRoleBodySchema } from "../../contracts/admin";
import {
  addAssetGroupMemberBodySchema,
  createAssetGroupBodySchema,
  updateAssetGroupBodySchema,
} from "../../contracts/asset-group-writes";
import { emptyBody, fieldList, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, CatalogTarget, ExcludedRoute } from "./types";

/**
 * `F3.86` PR 3c (ADR 0099 release 2) — the asset groups and their members.
 *
 * A group create names its site (`parent` `locationId`); every other write
 * names its row by the path. A membership is addressed by its own id (the
 * second controller, `admin/asset-group-members`), and the resolver names it
 * "<asset> in <group>", so a member summary names both.
 *
 * `assetGroup.member.remove` is one of the two `DELETE` entries ADR 0099
 * decision 3 (ruling 19) allows (`DELETE_ALLOWANCE`): a hard delete of one
 * membership, red on the card (`risk: "deactivate"`).
 *
 * Whether a new member's asset is an active asset at the group's site is the
 * route's 400 on Confirm, not an authority check; the resolver checks only
 * that the asset is the organization's (`refs`).
 */
const GROUP: CatalogTarget = { kind: "assetGroup", param: "id" };
const MEMBER: CatalogTarget = { kind: "assetGroupMember", param: "id" };

export const ASSET_GROUP_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "assetGroup.create",
    title: "Create an asset group",
    method: "POST",
    path: "/admin/asset-groups",
    params: {},
    body: createAssetGroupBodySchema,
    bodyName: "createAssetGroupBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "parent", field: "locationId", of: "location" },
    refs: [],
    formulas: [],
    steps: [
      { id: "basics", title: "Basics", fields: ["locationId", "code", "name"] },
      { id: "details", title: "Details", fields: ["description", "domain"] },
    ],
    summary: ({ body, targetName, organizationName }) =>
      `Create the asset group ${quoted(text(body, "name"))} (${text(body, "code")}) at ${quoted(targetName)} in ${organizationName}.`,
  },
  {
    id: "assetGroup.update",
    title: "Edit an asset group",
    method: "PATCH",
    path: "/admin/asset-groups/:id",
    params: { id: uuidParam },
    body: updateAssetGroupBodySchema,
    bodyName: "updateAssetGroupBodySchema",
    clientOnly: [],
    risk: "edit",
    target: GROUP,
    refs: [],
    formulas: [],
    steps: [
      { id: "basics", title: "Basics", fields: ["name"] },
      { id: "details", title: "Details", fields: ["description", "domain"] },
    ],
    summary: ({ body, targetName }) => `Change ${fieldList(body)} of the asset group ${quoted(targetName)}.`,
  },
  {
    id: "assetGroup.member.add",
    title: "Add an asset to a group",
    method: "POST",
    path: "/admin/asset-groups/:id/members",
    params: { id: uuidParam },
    body: addAssetGroupMemberBodySchema,
    bodyName: "addAssetGroupMemberBodySchema",
    clientOnly: [],
    risk: "edit",
    target: GROUP,
    refs: [{ field: "assetId", kind: "asset" }],
    formulas: [],
    steps: [{ id: "member", title: "Member", fields: ["assetId", "role"] }],
    summary: ({ body, targetName }) => {
      const role = text(body, "role");
      return `Add the asset ${text(body, "assetId")} to the asset group ${quoted(targetName)}${role ? ` with the role ${role}` : ""}.`;
    },
  },
  {
    id: "assetGroup.member.setRole",
    title: "Set a member's role",
    method: "PATCH",
    path: "/admin/asset-group-members/:id",
    params: { id: uuidParam },
    body: setAssetGroupMemberRoleBodySchema,
    bodyName: "setAssetGroupMemberRoleBodySchema",
    clientOnly: [],
    risk: "edit",
    target: MEMBER,
    refs: [],
    formulas: [],
    steps: [{ id: "role", title: "Role", fields: ["role"] }],
    summary: ({ body, targetName }) => {
      const role = text(body, "role");
      return role ? `Set the role of ${quoted(targetName)} to ${role}.` : `Clear the role of ${quoted(targetName)}.`;
    },
  },
  {
    id: "assetGroup.member.remove",
    title: "Remove an asset from a group",
    method: "DELETE",
    path: "/admin/asset-group-members/:id",
    params: { id: uuidParam },
    body: emptyBody,
    bodyName: null,
    clientOnly: [],
    risk: "deactivate",
    target: MEMBER,
    refs: [],
    formulas: [],
    steps: [],
    summary: ({ targetName }) =>
      `Remove ${quoted(targetName)}: dashboards bound to the group no longer read this asset.`,
  },
];

/** The area's write routes that are not entries: none since PR 3c. */
export const ASSET_GROUP_PENDING: readonly ExcludedRoute[] = [];
