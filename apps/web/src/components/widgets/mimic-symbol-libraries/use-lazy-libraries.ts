import { useEffect, useSyncExternalStore } from "react";

import { ensureLibraryShapes, libraryShapesVersion, subscribeLibraryShapes } from ".";

/**
 * `F3.32h` — loads the lazy libraries of `codes` on mount and redraws the caller when a load
 * settles. A static or unknown code is a no-op. Returns the store version, so a caller can key a
 * memo on it.
 */
export function useLazyLibraries(codes: readonly string[]): number {
  const version = useSyncExternalStore(subscribeLibraryShapes, libraryShapesVersion, libraryShapesVersion);
  const joined = codes.join(",");
  useEffect(() => {
    if (joined !== "") void ensureLibraryShapes(joined.split(","));
  }, [joined]);
  return version;
}
