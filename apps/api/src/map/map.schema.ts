import { z } from "zod";

/**
 * `F2.10` / ADR 0098 decision 11, B4, B12 — the query of `GET /map/sites`.
 *
 * `parentLocationId` narrows the pins to that node's subtree and drops every
 * pin that joins no location. It narrows only: an unreadable or unknown node
 * answers `[]`, never a 403. `.strict()`, so any other key is a 400 (ADR 0029
 * keeps request schemas in `*.schema.ts`).
 */
export const mapSitesQuerySchema = z
  .object({
    parentLocationId: z.string().uuid().optional(),
  })
  .strict();

export type MapSitesQuery = z.infer<typeof mapSitesQuerySchema>;
