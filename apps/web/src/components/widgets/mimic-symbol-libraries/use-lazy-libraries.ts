import { useEffect, useSyncExternalStore } from "react";

import { ensureLibraryShapes, isLazyMimicLibrary, libraryShapesVersion, subscribeLibraryShapes } from ".";

const subscribeToNothing = (): (() => void) => () => undefined;
const noVersion = (): number => 0;

/**
 * `F3.32h` — loads the lazy libraries of `codes` on mount and redraws the caller when a load
 * settles. A caller with no lazy code (a core, Tabler, Lucide, MDI or organization glyph) neither
 * subscribes nor loads, so a load redraws only the glyphs that wait for it. Returns the store
 * version, so a caller can key a memo on it.
 */
export function useLazyLibraries(codes: readonly string[]): number {
  const joined = codes.filter(isLazyMimicLibrary).join(",");
  const lazy = joined !== "";
  const version = useSyncExternalStore(
    lazy ? subscribeLibraryShapes : subscribeToNothing,
    lazy ? libraryShapesVersion : noVersion,
    lazy ? libraryShapesVersion : noVersion,
  );
  useEffect(() => {
    if (joined !== "") void ensureLibraryShapes(joined.split(","));
  }, [joined]);
  return version;
}
