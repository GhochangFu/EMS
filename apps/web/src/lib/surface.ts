/**
 * `F3.71` — the user's surface style (ADR 0085 decision 1): Neumorphic or Flat, beside and
 * independent of the Light / Dark theme.
 *
 * The boot script in `apps/web/index.html` reads `localStorage[SURFACE_STORAGE_KEY]` and sets
 * `data-surface` on `<html>` before first paint: `"flat"` only for the exact value `"flat"`,
 * `"neumorphic"` for anything else, a throwing storage included. `index.css` keys the shadow
 * tokens on `:not([data-surface="flat"])` and the flat rules of the surface vocabulary on
 * `:where([data-surface="flat"])`, so a page whose boot script never ran is neumorphic too.
 * `tests/f3.71-surface-gates.test.ts` K1 holds this key equal to the one the boot script reads.
 */
export const SURFACE_STORAGE_KEY = "bms.surface";

export type Surface = "neumorphic" | "flat";

/** The style `<html>` carries now, parsed the way the boot script and `index.css` read it. */
export function readDocumentSurface(): Surface {
  return document.documentElement.dataset.surface === "flat" ? "flat" : "neumorphic";
}
