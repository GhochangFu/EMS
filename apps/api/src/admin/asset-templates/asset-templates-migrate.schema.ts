import { z } from "zod";

/**
 * `F2.6` — the request body for a migration preview and for a migration
 * (ADR 0039 decisions 1 and 2).
 *
 * The path `:id` is always the **target** version. The body carries only the
 * asset ids, and the source version is read per asset rather than supplied:
 * nothing stops a selection spanning several versions of one code, and asking
 * the caller for a source version would make the server trust an answer it can
 * derive correctly itself.
 *
 * There is deliberately **no** field echoing a preview back. `migrate` re-runs
 * the preview and refuses if it is not clean, so a client-supplied delta would
 * be a second opinion the server must then decide whether to believe.
 */

/** Same ceiling as `instantiateAssetsBodySchema`'s asset array — one call, one batch. */
const MAX_ASSETS_PER_MIGRATION = 200;

export const migrateAssetsBodySchema = z
  .object({
    assetIds: z
      .array(z.string().uuid())
      .min(1)
      .max(MAX_ASSETS_PER_MIGRATION)
      .describe(
        `The assets to move onto this version. Between 1 and ${MAX_ASSETS_PER_MIGRATION}. ` +
          "Every id must be inside your writable scope and pinned to another version of the " +
          "same template code.",
      ),
  })
  .strict();

export type MigrateAssetsBody = z.infer<typeof migrateAssetsBodySchema>;
