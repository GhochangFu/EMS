import {
  copilotUpdateAssetRoleModelBodySchema,
  createAssetRoleBodySchema,
  updateAssetRoleBodySchema,
} from "../../contracts/asset-role-writes";
import { assetRoleCodeSchema } from "../../contracts/operations";
import { fieldList, quoted, text } from "./summary-text";
import type { CatalogEntry, CatalogTarget, ExcludedRoute } from "./types";

/**
 * `F3.87` PR 6 (ADR 0099 Amendment 3 A1, A6; owner ruling Q4) — the unit-role
 * vocabulary. `assetRole.create` is a `fleet` entry (`bms.asset_roles` has no
 * organization; the change lives in the conversation's bound organization)
 * offered to the global admin alone: before a layout whose units name a role
 * the vocabulary lacks, the model proposes this card first, and the other
 * roles' registries never name it. The resolver's `mayManageFleet` and the
 * service's `requireGlobalAdmin` stay the second and third lines.
 *
 * `F4.282` (ADR 0099 Amendment 8, Q17) withdraws Amendment 3 A1's exclusion of
 * `PATCH /admin/vocabularies/asset-roles/:code`: the one route is three entries
 * on a `vocabulary` target — `assetRole.update` (label and sort order, the
 * model's body omits `active`) and the two directions, each a `fixedBody`
 * (`{ active: false }`, `{ active: true }`) whose wizard is the Review step alone.
 * Every entry's `body` is the route's `updateAssetRoleBodySchema`.
 *
 * The summary calls the vocabulary fleet-wide; it never says the role belongs
 * to the bound organization (a `fleet` create's `targetName` is that
 * organization's name, not the role's).
 */
const ASSET_ROLE: CatalogTarget = { kind: "vocabulary", of: "assetRole", param: "code" };

/** The fields every `assetRole.*` edit entry shares: one route, one body. */
const ROLE_PATCH = {
  method: "PATCH",
  path: "/admin/vocabularies/asset-roles/:code",
  params: { code: assetRoleCodeSchema },
  body: updateAssetRoleBodySchema,
  bodyName: "updateAssetRoleBodySchema",
  clientOnly: [],
  offeredTo: ["admin"],
  target: ASSET_ROLE,
  refs: [],
  formulas: [],
} as const satisfies Partial<CatalogEntry>;

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
  {
    ...ROLE_PATCH,
    id: "assetRole.update",
    title: "Edit a unit role",
    modelBody: copilotUpdateAssetRoleModelBodySchema,
    modelBodyName: "copilotUpdateAssetRoleModelBodySchema",
    risk: "edit",
    // D3: `active` is the two direction entries' (their `fixedBody`), so no step offers it.
    steps: [{ id: "role", title: "Role", fields: ["label", "sortOrder"] }],
    summary: ({ body, params, targetName }) =>
      `Change ${fieldList(body)} of the fleet-wide unit role ${quoted(targetName)} (${params.code ?? ""}).`,
  },
  {
    ...ROLE_PATCH,
    id: "assetRole.deactivate",
    title: "Deactivate a unit role",
    fixedBody: { active: false },
    risk: "deactivate",
    steps: [],
    summary: ({ params, targetName }) =>
      `Deactivate the fleet-wide unit role ${quoted(targetName)} (${params.code ?? ""}): every picker stops offering it; group memberships keep it.`,
  },
  {
    ...ROLE_PATCH,
    id: "assetRole.reactivate",
    title: "Reactivate a unit role",
    fixedBody: { active: true },
    risk: "edit",
    steps: [],
    summary: ({ params, targetName }) =>
      `Reactivate the fleet-wide unit role ${quoted(targetName)} (${params.code ?? ""}): every picker offers it again.`,
  },
];

/** `F3.87` PR 6: the create is an entry; nothing waits on a later PR. */
export const ASSET_ROLE_PENDING: readonly ExcludedRoute[] = [];
