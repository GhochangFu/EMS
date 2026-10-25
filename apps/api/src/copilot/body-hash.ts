import { createHash } from "node:crypto";

import { canonicalJson, withoutPaths } from "@bms/shared/copilot";

/**
 * `F3.85` PR 4 / ADR 0099 drafter choice 5 — the SHA-256 (hex) of a request
 * body in canonical form, after removing the catalog entry's `clientOnly`
 * fields: the values the user types on the Confirm card (a temporary
 * password), which the model never saw and the stored hash cannot hold.
 *
 * `clientOnly` names top-level keys of a JSON object or, since `F4.279` (Q12),
 * dotted paths to nested ones (`config.url`), stripped by the shared
 * `withoutPaths` the web's Confirm sets them with; any other body is hashed
 * whole. The hashed value is the object `@Body()` hands the controller —
 * there is no global pipe in this API, and every catalog controller parses
 * its own body.
 */
export function bodyHash(body: unknown, clientOnly: readonly string[] = []): string {
  return createHash("sha256").update(canonicalJson(withoutPaths(body, clientOnly))).digest("hex");
}
