import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

export const activeFilterSchema = z.enum(["true", "false", "all"]).default("all");

export const idParamSchema = z.string().uuid();

/**
 * `?active=` on the seven admin list routes.
 *
 * **A BAD VALUE IS A 400 HERE, NOT A `ZodError` AT THE CALLER.** Every one of
 * those routes called this bare, outside the `try`/`catch` its sibling write
 * verbs use, so an unparseable value threw a `ZodError` out of the handler and
 * Nest mapped it to a **500**. `F3.40`'s review found it on the new
 * asset-roles route; the other six inherited it, which is why the fix is here
 * rather than in one controller. AGENTS.md §4.5 — the class, not the instance.
 *
 * **An empty `?active=` means "no filter", not "bad request".** Express hands
 * `?active=` over as `""`, and `??` does not catch an empty string, so this was
 * the likeliest way to reach the 500: a front end appending `?active=${filter}`
 * hits it on the first render, before the user has chosen anything. An omitted
 * value and an empty one carry the same intent, so both resolve to `all`.
 * Anything else — `?active=1`, `?active=yes` — is a caller error and says so.
 */
export function parseActiveFilter(value: string | undefined): boolean | undefined {
  const result = activeFilterSchema.safeParse(value === "" ? undefined : value);
  if (!result.success) {
    throw new BadRequestException(
      `active must be one of true, false or all — received "${value}"`,
    );
  }
  if (result.data === "all") {
    return undefined;
  }
  return result.data === "true";
}
