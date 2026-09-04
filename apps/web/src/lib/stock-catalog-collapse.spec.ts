/**
 * Per-browser collapse set for the stock catalog accordion (`F2.17`, Task 2).
 */
import {
  readCollapsedDomains,
  STOCK_CATALOG_COLLAPSE_KEY,
  writeCollapsedDomains,
  type CollapseStorage,
} from "./stock-catalog-collapse";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A minimal in-memory stand-in for `Storage`, for the happy-path tests. */
function memoryStorage(initial: Record<string, string> = {}): CollapseStorage {
  const store = { ...initial };
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
  };
}

/** Nothing stored yields `[]`. */
export function runNothingStoredYieldsEmptyTests(): void {
  const result = readCollapsedDomains(() => memoryStorage());
  assert(Array.isArray(result) && result.length === 0, `expected [], got ${JSON.stringify(result)}`);
}

/** Stored codes read back in order. */
export function runStoredCodesReadBackInOrderTests(): void {
  const storage = memoryStorage({
    [STOCK_CATALOG_COLLAPSE_KEY]: JSON.stringify(["water", "electrical"]),
  });
  const result = readCollapsedDomains(() => storage);
  assert(
    JSON.stringify(result) === JSON.stringify(["water", "electrical"]),
    `expected stored order preserved, got ${JSON.stringify(result)}`,
  );
}

/**
 * A thunk that THROWS on access (`localStorage` itself is unreachable, e.g. a
 * sandboxed iframe) must fail open, never throw.
 */
export function runThrowingThunkFailsOpenTests(): void {
  const result = readCollapsedDomains(() => {
    throw new Error("localStorage is not available in this context");
  });
  assert(Array.isArray(result) && result.length === 0, `expected [] on a throwing thunk, got ${JSON.stringify(result)}`);
}

/** A `getItem` that throws must also fail open, never throw — a different fault than the thunk throwing. */
export function runThrowingGetItemFailsOpenTests(): void {
  const storage: CollapseStorage = {
    getItem: () => {
      throw new Error("getItem denied");
    },
    setItem: () => {
      throw new Error("should not be called");
    },
  };
  const result = readCollapsedDomains(() => storage);
  assert(
    Array.isArray(result) && result.length === 0,
    `expected [] on a throwing getItem, got ${JSON.stringify(result)}`,
  );
}

/** Malformed JSON, a non-array, and a mixed array are all handled without throwing. */
export function runMalformedContentFailsOpenOrFiltersTests(): void {
  const malformed = readCollapsedDomains(() => memoryStorage({ [STOCK_CATALOG_COLLAPSE_KEY]: "{not json" }));
  assert(Array.isArray(malformed) && malformed.length === 0, `malformed JSON must yield [], got ${JSON.stringify(malformed)}`);

  const nonArray = readCollapsedDomains(() => memoryStorage({ [STOCK_CATALOG_COLLAPSE_KEY]: "42" }));
  assert(Array.isArray(nonArray) && nonArray.length === 0, `a non-array value must yield [], got ${JSON.stringify(nonArray)}`);

  const mixed = readCollapsedDomains(() =>
    memoryStorage({ [STOCK_CATALOG_COLLAPSE_KEY]: JSON.stringify(["water", 1, null, "electrical"]) }),
  );
  assert(
    JSON.stringify(mixed) === JSON.stringify(["water", "electrical"]),
    `a mixed array must keep only the strings, got ${JSON.stringify(mixed)}`,
  );
}

/** `writeCollapsedDomains` writes one entry, under the one key, as a sorted JSON array. */
export function runWriteSortsAndWritesOneEntryTests(): void {
  const store: Record<string, string> = {};
  const storage: CollapseStorage = {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => {
      store[key] = value;
    },
  };

  writeCollapsedDomains(() => storage, ["water", "electrical"]);

  const keys = Object.keys(store);
  assert(keys.length === 1 && keys[0] === STOCK_CATALOG_COLLAPSE_KEY, `expected one key ${STOCK_CATALOG_COLLAPSE_KEY}, got ${JSON.stringify(keys)}`);
  assert(
    store[STOCK_CATALOG_COLLAPSE_KEY] === JSON.stringify(["electrical", "water"]),
    `expected a sorted array, got ${store[STOCK_CATALOG_COLLAPSE_KEY]}`,
  );
}

/**
 * Fail-open on write too: reaching the end of this function without a throw
 * IS the assertion. The next visit then renders every group expanded, which
 * is the correct behaviour for a store this module could not update.
 */
export function runWriteSwallowsThrowingAccessorAndSetItemTests(): void {
  writeCollapsedDomains(() => {
    throw new Error("localStorage is not available in this context");
  }, ["water"]);

  writeCollapsedDomains(
    () => ({
      getItem: () => null,
      setItem: () => {
        throw new Error("setItem denied");
      },
    }),
    ["water"],
  );
  // No assertion beyond "did not throw" — that is the whole point of this test.
}
