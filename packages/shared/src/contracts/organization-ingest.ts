import { z } from "zod";

/**
 * `F4.330` (ADR 0115 decision 3) — the body of `PUT /admin/organizations/:id/ingest`, the only
 * writer of `bms.organizations.ingest_enabled`. `.strict()`: an extra key is a 400. The ingest host
 * applies the value at its next reload; each RTU's own `ingestEnabled` is kept as it is.
 */
export const setOrganizationIngestBodySchema = z.object({ ingestEnabled: z.boolean() }).strict();

/** `F4.330` — `{ ingestEnabled }`. Exported from here: `src/index.ts` sits at the 1000-line cap. */
export type SetOrganizationIngestBody = z.infer<typeof setOrganizationIngestBodySchema>;
