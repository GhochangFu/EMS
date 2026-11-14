import { z } from "zod";

/**
 * `F4.361` / ADR 0132 decision 2 — `GET /api/v1/filter-options`: the
 * organizations, location tree, asset groups and assets a caller **reads**,
 * which back the Organization, Location, Asset group and Asset pickers on
 * `/alarms` and `/rules`.
 *
 * Every schema is one plain `z.object` (ADR 0030): no `.merge()`, `.extend()`
 * or intersection. The types are exported from this file, not `src/index.ts`,
 * which sits at the §4.5 cap (the `maintenance-windows.ts` precedent).
 */

export const filterOptionOrganizationSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
});

/**
 * One node of the readable tree. `parentId` is `null` for a root **and** for a
 * node whose parent the caller cannot read (ADR 0098 Drafter choice 8), so no
 * id of an unlisted node leaks.
 */
export const filterOptionLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  parentId: z.string().nullable(),
  organizationId: z.string(),
});

/**
 * One readable asset group. `assetIds` (ADR 0132 build note 2) is its members
 * that are in the same answer's `assets` list, so "Asset group narrows Asset"
 * works in the browser.
 */
export const filterOptionAssetGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  locationId: z.string(),
  organizationId: z.string(),
  assetIds: z.array(z.string()),
});

export const filterOptionAssetSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  locationId: z.string(),
  organizationId: z.string(),
});

export const filterOptionsResponseSchema = z.object({
  organizations: z.array(filterOptionOrganizationSchema),
  locations: z.array(filterOptionLocationSchema),
  assetGroups: z.array(filterOptionAssetGroupSchema),
  assets: z.array(filterOptionAssetSchema),
});

export type FilterOptionOrganization = z.infer<typeof filterOptionOrganizationSchema>;
export type FilterOptionLocation = z.infer<typeof filterOptionLocationSchema>;
export type FilterOptionAssetGroup = z.infer<typeof filterOptionAssetGroupSchema>;
export type FilterOptionAsset = z.infer<typeof filterOptionAssetSchema>;
export type FilterOptionsResponse = z.infer<typeof filterOptionsResponseSchema>;
