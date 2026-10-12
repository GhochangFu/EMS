import { z, type ZodTypeAny } from "zod";

import type { CatalogEntry } from "./types";

/**
 * `F3.86` PR 2 / ADR 0099 decision 3 — the body the model proposes with: the
 * entry's `modelBody` when it declares one, else its `body` without the
 * `clientOnly` fields, which the user types on the Confirm card and the model
 * never sees. Moved here from `apps/api` (`F3.85`'s `modelBodySchema`) so the
 * web wizard and the API apply one rule.
 *
 * Without a `modelBody`, an entry with `clientOnly` fields must have a plain
 * object body: `.omit` on a refined body would drop its refinement, so such an
 * entry declares a `modelBody` instead. Anything else is a load error.
 */
export function modelBodyOf(entry: Pick<CatalogEntry, "id" | "body" | "clientOnly" | "modelBody">): ZodTypeAny {
  if (entry.modelBody !== undefined) return entry.modelBody;
  if (entry.clientOnly.length === 0) return entry.body;
  if (!(entry.body instanceof z.ZodObject)) {
    throw new Error(`F3.86: ${entry.id} has clientOnly fields and a body that is not a plain object, so it needs a modelBody`);
  }
  const mask = Object.fromEntries(entry.clientOnly.map((field) => [field, true as const]));
  return entry.body.omit(mask);
}
