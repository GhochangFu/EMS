/**
 * Per-browser collapse set for the stock catalog accordion (`F2.17`).
 *
 * **The store holds the COLLAPSED codes, never the open ones.** Open is the
 * default state for a domain group, so a domain the next domain pack adds
 * arrives open with no storage migration and no UI edit needed — and an
 * empty or unreadable store means "everything open" rather than "everything
 * closed", which is the safer failure: a missing group is worse than an
 * extra one to scroll past.
 *
 * **The storage arrives as a THUNK** (`() => CollapseStorage`), evaluated
 * inside the `try`, not a `Storage` instance passed directly. `window
 * .localStorage` itself can throw on *access* — a sandboxed iframe, or a
 * browser profile with storage locked down — rather than merely returning
 * `null` from `getItem`. A `try` wrapped around `getItem` alone misses that
 * case; only wrapping the access to the object too closes it, and this repo
 * has been bitten by exactly that gap before.
 *
 * `apps/web/src/layouts/app-shell.tsx:102-107,146-152` reads and writes its
 * own key (`bms-sidebar-collapsed`) via `window.localStorage` directly, with
 * no `try`/`catch` at all. That predates this module and is deliberately NOT
 * changed here — this unit's scope is the stock catalog's own key, not a
 * shared storage helper. Its scope is per browser, exactly as this key's is.
 *
 * Kept pure and in `lib/` for the reason `vocabulary.ts` records — the
 * coverage gate reaches `apps/web/src/lib/**` and nothing above it.
 */
export const STOCK_CATALOG_COLLAPSE_KEY = "bms-stock-catalog-collapsed-domains";

/** The two `Storage` members this module needs — narrow enough to fake in a spec without touching `window`. */
export type CollapseStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * The collapsed domain codes, or `[]` on anything unexpected: no storage
 * access, no stored value, malformed JSON, a non-array, or a thrown error at
 * any step. A mixed array keeps only its string entries.
 */
export function readCollapsedDomains(getStorage: () => CollapseStorage): string[] {
  try {
    const storage = getStorage();
    const raw = storage.getItem(STOCK_CATALOG_COLLAPSE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

/**
 * Writes the collapsed set as one sorted JSON array under the one key.
 * Sorted so the stored value is stable across the same set collapsed in a
 * different order, which keeps a diff of the stored value meaningful.
 *
 * Fails open on write, same as the read side: if the accessor or `setItem`
 * throws, this returns without writing rather than throwing back into the
 * caller — the next visit then renders every group expanded, which is the
 * correct behaviour for a store this module could not update.
 */
export function writeCollapsedDomains(
  getStorage: () => CollapseStorage,
  domains: readonly string[],
): void {
  try {
    const storage = getStorage();
    storage.setItem(STOCK_CATALOG_COLLAPSE_KEY, JSON.stringify([...domains].sort()));
  } catch {
    // Fail open — see the docblock above.
  }
}
