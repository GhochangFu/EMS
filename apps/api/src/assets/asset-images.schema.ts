import { z } from "zod";

/**
 * `F3.3` (ADR 0066 decision 6) — the path parameters of the two asset-image
 * read routes.
 *
 * **Why neither schema is in `openapi-registry.ts` or the strict-body
 * ledger.** The registry binds a route to the `*BodySchema`/`*QuerySchema`
 * that validates its payload (ADR 0029 decisions 1 and 3), and
 * `tests/adr-0029-openapi-contract.test.ts` scans controllers for exactly
 * those two suffixes. Both routes here take no body and no query — only
 * path parameters, which Nest's own reflection describes — so there is
 * nothing to register and no node enters `strict-body-ledger.data.ts`,
 * the same as `EscalationProfilesController_list` (the comment at
 * `openapi-registry.ts` says so). The schemas live in a `*.schema.ts`
 * anyway, rather than inline in the controller, so a later query parameter
 * has a home the registry can already see.
 *
 * A failed `.parse()` throws `ZodError`, which the global `ZodErrorFilter`
 * (`main.ts`) turns into a 400 — so a non-uuid segment never reaches the
 * access check or a pool.
 */
export const assetImageParamsSchema = z
  .object({ assetId: z.string().uuid(), imageId: z.string().uuid() })
  .strict();

export type AssetImageParams = z.infer<typeof assetImageParamsSchema>;

/** `:assetId` on the list route. */
export const assetIdParamSchema = z.string().uuid();
