/**
 * Master-data admin contracts (ADR 0008–0010), audit reads (ADR 0021), asset
 * groups (ADR 0049) and calc parameters.
 *
 * The asset-template contracts moved to `asset-templates.ts` (`F4.150`), the
 * template-migration ones to `template-migration.ts` (`F2.24`).
 */
import { z } from "zod";

import { locationTypeCodeSchema } from "./location-types";
import { assetRoleCodeSchema } from "./operations";
import { pointMetadataFieldsSchema, pointMetadataShape } from "./point-metadata";
import { pointSourceKindSchema } from "./telemetry-entry";

export const masterDataActiveFilterSchema = z.enum(["true", "false", "all"]);

export const adminOrganizationDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  currency: z.string(),
  meta: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});

export const adminLocationDtoSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationCode: z.string(),
  organizationName: z.string(),
  code: z.string(),
  slug: z.string(),
  name: z.string(),
  type: locationTypeCodeSchema,
  typeLabel: z.string(), // F4.162 (ADR 0077 Amendment 1, OQ2) — the joined bms.location_types.label.
  /** `F2.10` (ADR 0098 Amendment 1): null = root OR a parent the caller cannot read. */
  parentId: z.string().nullable(),
  province: z.string().nullable(),
  capital: z.string().nullable(),
  timezone: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  active: z.boolean(),
  meta: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * `F2.10` (ADR 0098 Drafter choice 2, Amendment 1 A3): why a location tree
 * write was refused. There is no `location_parent_cross_org` — a foreign or
 * unknown parent is `location_parent_not_found`, so the check is no oracle.
 */
export const locationWriteRefusalReasonSchema = z.enum([
  "location_parent_not_found",
  "location_parent_cycle",
  "location_depth_exceeded",
  "location_parent_inactive",
  "location_has_active_children",
  "location_inactive",
]);

export const locationWriteRefusalSchema = z.object({
  message: z.string(),
  reason: locationWriteRefusalReasonSchema,
});

export const adminRtuDtoSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  locationName: z.string(),
  organizationCode: z.string(),
  code: z.string(),
  displayName: z.string(),
  sourceType: z.enum(["mqtt", "simulator", "catalog"]),
  domain: z.string().nullable(),
  externalRtuId: z.number().nullable(),
  rtuCode: z.string().nullable(),
  mqttTopic: z.string().nullable(),
  stationCode: z.string().nullable(),
  stationName: z.string().nullable(),
  ingestEnabled: z.boolean(),
  active: z.boolean(),
  meta: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});

export const adminAssetDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  siteName: z.string(),
  // ADR 0018: location is mandatory, gateway is optional. An asset with no
  // gateway is a first-class asset whose points are hand-entered or computed.
  locationId: z.string(),
  locationName: z.string().nullable(),
  organizationCode: z.string().nullable(),
  rtuId: z.string().nullable(),
  rtuDisplayName: z.string().nullable(),
  domain: z.string(),
  waterBalanceRole: z.string().nullable(), // ADR 0073 d1: bms.water_balance_roles; null = none
  // F3.74 / ADR 0088: a breaker's rating and the cause of its last trip, both free text.
  rating: z.string().nullable(),
  tripCause: z.string().nullable(),
  active: z.boolean(),
  // `F2.6` (ADR 0039 decision 8): which template *version* this asset is pinned
  // to. Added because the Versions view is defined as "listing which assets sit
  // on which version", and no other response says it — a migration UI without
  // this can only offer every asset and let the server refuse, teaching the
  // operator by 400. All three are null for a hand-created asset, which is
  // every seeded one.
  templateId: z.string().nullable(),
  templateCode: z.string().nullable(),
  templateVersion: z.number().nullable(),
  meta: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});

export const adminAssetPointDtoSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  assetCode: z.string(),
  assetName: z.string(),
  locationId: z.string().nullable(),
  locationName: z.string().nullable(),
  pointKey: z.string(),
  sourceDataKey: z.string(),
  sensorCode: z.string().nullable(),
  unit: z.string().nullable(),
  active: z.boolean(),
  /** ADR 0018 — where this point's provenance comes from. */
  sourceKind: pointSourceKindSchema,
  /**
   * ADR 0018 decision 3 — the RTU this point reads from; `null` for an
   * `unmapped`, `manual` or `computed` point. Surfaced since `F2.7` (ADR 0056
   * decision 3, owner ruling Q-H): once the single-row routes can wire and
   * unwire a point, the response has to show which RTU it landed on.
   */
  rtuId: z.string().nullable(),
  createdAt: z.string(),
  // ADR 0056 decision 1: the five per-asset overrides as stored (`null` = inherit), spread, not merged.
  // ADR 0056 Amendment 3 part A (`F2.25`): `templateDefaults` = the pinned template's five for
  // this key; `null` = nothing to inherit (`mapAssetPointRow`). Effective = coalesce(asset, template).
  ...pointMetadataShape,
  templateDefaults: pointMetadataFieldsSchema.nullable(),
});

export const adminOrganizationSummaryDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
});

export const adminLocationSummaryDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  organizationId: z.string(),
  organizationCode: z.string(),
  organizationName: z.string(),
});

export const adminRtuSummaryDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  displayName: z.string(),
  locationId: z.string(),
  locationName: z.string(),
  organizationId: z.string(),
  organizationCode: z.string(),
});

export const adminAssetSummaryDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  locationId: z.string(),
  locationName: z.string().nullable(),
  rtuId: z.string().nullable(),
  rtuDisplayName: z.string().nullable(),
  organizationId: z.string().nullable(),
  organizationCode: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Audit reads (ADR 0021, `F4.14`)
// ---------------------------------------------------------------------------

/**
 * One `bms.audit_log` row as returned by the read API.
 *
 * `actorId`/`actorEmail` are nullable: the writer resolves the actor by id or
 * email and stores `null` when neither matches, which is preserved rather than
 * rendered as a fabricated identity. `payload` is the verbatim request body of
 * the audited mutation — see ADR 0021 decision 6 before adding a field to any
 * audited request schema.
 */
export const auditLogEntryDtoSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  actorId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  reason: z.string().nullable(),
  payload: z.unknown(),
});

/** Offset-paginated audit list. `F4.22` adds a cursor without removing these. */
export const auditLogListResponseSchema = z.object({
  items: z.array(auditLogEntryDtoSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

/**
 * `F3.37` (ADR 0049 decision 5) — the asset-group admin surface.
 *
 * **Why these reads exist at all.** Before `F3.37` this API exposed no
 * asset-group read of any kind: `AccessControlService` returns groups only as
 * the *calling user's own scope*, and that array is empty for `admin`,
 * `organization_admin` and `location_admin` — precisely the users who
 * administer roles. So the role column had a write endpoint whose only input
 * was a membership id nothing returned. `F3.8` / ADR 0041 decision 10 is the
 * precedent that closed the same gap by shipping the surface in the row rather
 * than after it, "because an item closed with its browser layer marked N/A is
 * not closed".
 *
 * Hanging the control off the asset admin screen was foreclosed by ADR 0049
 * decision 5's own case: the same pump is the raw-water pump in the water
 * group and a monitored load in the electrical one, so the role sits on the
 * *membership* and the surface has to be group-centric.
 */
export const adminAssetGroupDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  locationId: z.string(),
  locationName: z.string().nullable(),
  organizationId: z.string(),
  memberCount: z.number(),
  createdAt: z.string(),
});

export const adminAssetGroupListResponseSchema = z.object({
  items: z.array(adminAssetGroupDtoSchema),
});

/** One row of `bms.asset_group_members`, joined to the asset it names. */
export const adminAssetGroupMemberDtoSchema = z.object({
  membershipId: z.string(),
  assetId: z.string(),
  assetCode: z.string(),
  assetName: z.string(),
  assetDomain: z.string(),
  /** `null` means no role is set — the state every membership was in before 0051. */
  role: z.string().nullable(),
  /** The role's label from `bms.asset_roles`, or `null` when `role` is null. */
  roleLabel: z.string().nullable(),
});

export const adminAssetGroupMembersResponseSchema = z.object({
  /**
   * **Ordered by `assets.code`, and that is a contract rather than an
   * incidental.** `assets.code` is `varchar(64) NOT NULL UNIQUE`, so it is a
   * *total* order — which is what makes it safe. ADR 0049 put no unique index
   * on `(asset_group_id, role)`, because the mock's own nodes are plural
   * ("Chillers 2 of 3", "Primary Pumps 3 running") and one role still maps to
   * one widget however many members match. A role therefore resolves to N
   * bindings, and ordering by `id` or by insertion order would make the same
   * stock template instantiated twice in one organization produce two
   * different tile orders with no visible cause.
   */
  items: z.array(adminAssetGroupMemberDtoSchema),
  /**
   * How many members carry each role code, for the roles present in this group.
   *
   * **This is decision 6's spectrum made visible.** ADR 0049 decision 6 ruled
   * that an unresolved role imports as a widget with zero bindings rendering
   * "no data bound". That was written for match/no-match. With plural roles a
   * group where two of three chillers carry the role renders a widget that
   * *looks* right and is quietly one short. Zero bindings is visible;
   * N-minus-one is not, unless something counts. A display concern and not a
   * stored invariant, so it does not reopen the ADR.
   */
  roleCounts: z.record(z.number()),
});

/**
 * `PATCH /api/v1/admin/asset-group-members/:id` — set or clear one membership's
 * role.
 *
 * `null` clears it. The code is checked against `bms.asset_roles` by
 * `VocabulariesService.assertAssetRole` before the write, so an unknown value
 * is a 400 naming the live codes rather than
 * `asset_group_members_role_fkey` as a 500.
 *
 * **`.strict()`, and it is load-bearing.** The body has exactly one field, so
 * an unrecognised key is a caller error by construction — there is no second
 * thing to set. The specific mistake it catches is silent:
 * `{"role":null,"roleCode":"chiller"}`, from a caller who meant to *set*
 * `chiller`, would otherwise have `roleCode` stripped, **clear** the role, and
 * answer `200`. That is the failure ADR 0029 Amendment 3 exists for, and the
 * decision is recorded in `strict-body-ledger.spec.ts`'s `STRICTNESS_LEDGER`.
 */
export const setAssetGroupMemberRoleBodySchema = z
  .object({
    role: assetRoleCodeSchema.nullable(),
  })
  .strict();

/**
 * `E4.1a` / ADR 0070 decision 2 — one row of the calc parameter vocabulary
 * (`bms.calc_parameter_keys`), as the admin picker reads it. Global, so no
 * organization. `active` is always `true` on the wire today (the read lists
 * the active vocabulary only); carried so a "show retired keys" read needs no
 * contract change. **No `.readonly()`**, matching `adminPointKeyDtoSchema`.
 */
export const calcParameterKeyDtoSchema = z.object({
  code: z.string(),
  label: z.string(),
  unit: z.string().nullable(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});

/**
 * `E4.1a` / ADR 0070 decision 2 — one `bms.calc_parameters` row: the value of
 * one key for one organization at one scope over one validity window. Scope
 * is `locationId` / `assetId`, at most one set; both `null` is the organization
 * scope. `locationName` / `assetCode` are the joined labels the admin table
 * renders, `null` where the scope column is. `effectiveTo` `null` is open-ended.
 */
export const calcParameterDtoSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  key: z.string(),
  locationId: z.string().nullable(),
  assetId: z.string().nullable(),
  locationName: z.string().nullable(),
  assetCode: z.string().nullable(),
  value: z.number(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
