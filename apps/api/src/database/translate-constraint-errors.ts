/** Postgres SQLSTATEs a write can raise and a service must not answer with a 500. */
export const UNIQUE_VIOLATION = "23505";
export const FOREIGN_KEY_VIOLATION = "23503";

/**
 * What each constraint violation means for THIS operation. Both handlers see
 * the raw error, so a caller can tell one constraint from another by
 * `.constraint`.
 */
export type ConstraintErrorHandlers = {
  readonly onUnique: (err: unknown) => Error;
  /** Omitted: a foreign-key violation is rethrown, never guessed at. */
  readonly onForeignKey?: (err: unknown) => Error;
};

/**
 * `F4.211` — the name of the constraint a write violated, as the driver
 * reports it. Postgres sets it for a unique index as well as a named
 * constraint, so a write with two unique keys can say which one is taken.
 * `undefined` when the error carries none — the caller then falls back to its
 * default sentence rather than guessing.
 */
export function constraintOf(err: unknown): string | undefined {
  const constraint = (err as { constraint?: unknown } | null)?.constraint;
  return typeof constraint === "string" ? constraint : undefined;
}

/**
 * Turns the constraint violations a write can raise into the answers they are.
 *
 * Without this, `POST` with a value that already exists — the first mistake
 * anyone makes on an admin screen — is a 500. The answer names the field,
 * never the constraint internals: a client should be told "that code is
 * taken", not the index name.
 *
 * **Moved here from `notifications/channels.service.ts` by `F3.78` U6**, so
 * the grants API and the asset-groups API share one translation; the channel
 * messages stay in `ChannelsService`, which passes them as handlers.
 *
 * Any other SQLSTATE is rethrown unchanged — a row-level-security refusal
 * (`42501`) included: what it means is the caller's to decide.
 */
export async function translateConstraintErrors<T>(
  run: () => Promise<T>,
  handlers: ConstraintErrorHandlers,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === UNIQUE_VIOLATION) {
      throw handlers.onUnique(err);
    }
    if (code === FOREIGN_KEY_VIOLATION && handlers.onForeignKey) {
      throw handlers.onForeignKey(err);
    }
    throw err;
  }
}
