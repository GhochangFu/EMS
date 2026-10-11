import { catalogEntry } from "@bms/shared/copilot";

/**
 * `F3.85` PRs 4 and 8 — the `clientOnly` fields of each catalog entry: body
 * keys the user types on the Confirm card and the model never sees (ADR 0099
 * ruling on temporary passwords). The interceptor strips them before it
 * compares the body hash.
 *
 * Read from the action catalog (none in release 1). An unknown entry strips
 * nothing, which is the strict direction — the whole body must then match the
 * stored hash.
 */
export function clientOnlyKeysFor(catalogId: string): readonly string[] {
  return catalogEntry(catalogId)?.clientOnly ?? [];
}
