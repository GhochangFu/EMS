import { createAssetRoleBodySchema } from "../../contracts/asset-role-writes";
import { quoted, text } from "./summary-text";
import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F3.87` PR 6 (ADR 0099 Amendment 3 A1, A6; owner ruling Q4) — the unit-role
 * vocabulary. `assetRole.create` is a `fleet` entry (`bms.asset_roles` has no
 * organization; the change lives in the conversation's bound organization)
 * offered to the global admin alone: before a layout whose units name a role
 * the vocabulary lacks, the model proposes this card first, and the other
 * roles' registries never name it. The resolver's `mayManageFleet` and the
 * service's `requireGlobalAdmin` stay the second and third lines. The role
 * edit and retire stay on their page (`EXCLUDED_ROUTES`).
 *
 * The summary calls the vocabulary fleet-wide; it never says the role belongs
 * to the bound organization (a `fleet` create's `targetName` is that
 * organization's name, not the role's).
 */
export const ASSET_ROLE_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "assetRole.create",
    title: "Add a unit role",
    method: "POST",
    path: "/admin/vocabularies/asset-roles",
    params: {},
    body: createAssetRoleBodySchema,
    bodyName: "createAssetRoleBodySchema",
    clientOnly: [],
    offeredTo: ["admin"],
    risk: "create",
    target: { kind: "fleet" },
    refs: [],
    formulas: [],
    steps: [{ id: "role", title: "Role", fields: ["code", "label", "sortOrder"] }],
    summary: ({ body }) =>
      `Add the unit role ${quoted(text(body, "code"))} (${text(body, "label")}) to the fleet-wide role vocabulary.`,
  },
];

/** `F3.87` PR 6: the create is an entry; nothing waits on a later PR. */
export const ASSET_ROLE_PENDING: readonly ExcludedRoute[] = [];
