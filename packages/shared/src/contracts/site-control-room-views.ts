import { z } from "zod";

/**
 * `F3.67` / [ADR 0076](../../../../docs/adr/0076-control-room-for-each-organization.md)
 * decisions 3–5 — the site Control Room view setting (`kind`, an optional
 * dashboard or built-in key) and the effective, fail-safe-applied view a site
 * resolves to.
 *
 * Plain `z.object` throughout — no `.merge()`, no `z.intersection`, no
 * `.readonly()`. Both DTOs are written once as flat objects because there is
 * no shared base to compose from and nothing here is read-only-by-contract
 * (`siteControlRoomViewSettingDtoSchema` is also the write acknowledgement).
 * ADR 0030 decision 2: every response type in `packages/shared/src/index.ts`
 * is `z.infer` of a schema here, so the shape is described once.
 */

/** The three kinds a site's Control Room view can be set to (decision 3). */
export const siteControlRoomViewKindSchema = z.enum(["generated", "dashboard", "builtin"]);

/** The only built-in view key today (decision 4) — a CHECK constraint, not a
 * lookup table, because a new value is always a release. */
export const builtinSiteViewKeySchema = z.enum(["smoc"]);

/** The closed set of fail-safe notices the resolver can attach when it falls
 * back to the generated view (decision 5). */
export const siteControlRoomViewNoticeSchema = z.enum([
  "dashboard_removed",
  "dashboard_out_of_scope",
  "builtin_unknown",
]);

/** `GET`/`PUT /api/v1/admin/locations/:id/control-room-view` — the stored
 * setting, or the no-row default (`kind: "generated"`, every optional field
 * `null`) when a site has never had one set (decision 3). */
export const siteControlRoomViewSettingDtoSchema = z.object({
  locationId: z.string().uuid(),
  organizationId: z.string().uuid(),
  kind: siteControlRoomViewKindSchema,
  dashboardId: z.string().uuid().nullable(),
  builtinKey: builtinSiteViewKeySchema.nullable(),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().uuid().nullable(),
});

/** `GET /api/v1/control-room/sites/:locationId/view` — the effective view
 * after the fail-safe (decision 5): a removed or re-scoped dashboard, or an
 * unknown built-in key, answers `generated` plus a notice rather than a
 * broken page. */
export const resolvedSiteControlRoomViewDtoSchema = z.object({
  locationId: z.string().uuid(),
  kind: siteControlRoomViewKindSchema,
  dashboardId: z.string().uuid().nullable(),
  dashboardSlug: z.string().nullable(),
  builtinKey: builtinSiteViewKeySchema.nullable(),
  notice: siteControlRoomViewNoticeSchema.nullable(),
});
