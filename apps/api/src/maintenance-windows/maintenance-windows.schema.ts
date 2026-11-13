import { z } from "zod";

import { maintenanceWindowStateSchema } from "@bms/shared";

import { locationIdQueryField, organizationIdQueryField } from "../alarms/alarm-list.schema";

/**
 * `F4.359` U3 (ADR 0131 decision 14, plan D16) — `GET /maintenance-windows`.
 *
 * Every filter only **narrows** the caller's read scope: `organizationId` and
 * `locationId` are the alarm list's own fields (`locationId` lower-cased for
 * the P2 check, security review I1), and `assetId` is lower-cased the same way
 * because the P2 check compares it with `readableAssetIds` by string. A node or
 * an asset the caller cannot read answers an empty list, never 403.
 *
 * `limit` defaults to 50, at most 100; there is no cursor in this row. An empty
 * `limit=` is absent, as on the alarm list.
 */
export const maintenanceWindowListQuerySchema = z
  .object({
    state: maintenanceWindowStateSchema.optional(),
    assetId: z
      .string()
      .uuid()
      .transform((id) => id.toLowerCase())
      .optional(),
    locationId: locationIdQueryField,
    organizationId: organizationIdQueryField,
    limit: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.coerce.number().int().min(1).max(100).default(50),
    ),
  })
  .strict();

export type MaintenanceWindowListQuery = z.infer<typeof maintenanceWindowListQuerySchema>;
