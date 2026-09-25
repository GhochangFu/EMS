import { z } from "zod";

import { builtinSiteViewKeySchema, siteControlRoomViewKindSchema } from "@bms/shared";

/**
 * `F3.67` U4 / ADR 0076 decision 5 — the `PUT
 * /api/v1/admin/locations/:id/control-room-view` body. The enums are imported
 * from `@bms/shared`, never restated (ADR 0030).
 *
 * `z.infer` of this schema is what `SiteControlRoomViewService.putSetting`
 * accepts as `PutSiteControlRoomViewBody` — U3 declared that type by hand
 * because this schema did not exist yet, naming this file as its source of
 * truth. `dashboardId`/`builtinKey` are `.nullish()` so the inferred type
 * stays `string | null | undefined`, matching the service's own type exactly.
 *
 * `.superRefine` enforces the pair rule **two ways**, tighter than migration
 * `0082`'s one-way `dashboard_id` CHECK: a `PUT` states the WHOLE kind, so a
 * caller who sends `builtinKey` alongside `kind: "dashboard"` has a request
 * that contradicts itself, and silently dropping the stray field would be
 * exactly the E7.1f finding — a field the caller believes took effect.
 */
export const putSiteControlRoomViewBodySchema = z
  .object({
    kind: siteControlRoomViewKindSchema,
    dashboardId: z.string().uuid().nullish(),
    builtinKey: builtinSiteViewKeySchema.nullish(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.kind === "dashboard") {
      if (!body.dashboardId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dashboardId"],
          message: "A dashboard view needs a dashboardId",
        });
      }
      if (body.builtinKey != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["builtinKey"],
          message: "A dashboard view must not set builtinKey",
        });
      }
    } else if (body.kind === "builtin") {
      if (!body.builtinKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["builtinKey"],
          message: "A built-in view needs a builtinKey",
        });
      }
      if (body.dashboardId != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dashboardId"],
          message: "A built-in view must not set dashboardId",
        });
      }
    } else {
      if (body.dashboardId != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dashboardId"],
          message: "A generated view must not set dashboardId",
        });
      }
      if (body.builtinKey != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["builtinKey"],
          message: "A generated view must not set builtinKey",
        });
      }
    }
  })
  .describe(
    "kind decides which of dashboardId / builtinKey is required, and the other must be " +
      "absent: dashboard needs dashboardId (no builtinKey), builtin needs builtinKey (no " +
      "dashboardId), generated sets neither.",
  );

export type PutSiteControlRoomViewBody = z.infer<typeof putSiteControlRoomViewBodySchema>;
