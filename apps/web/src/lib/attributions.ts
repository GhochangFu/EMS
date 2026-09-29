import { MIMIC_SYMBOL_LIBRARIES } from "@bms/shared";

/**
 * `F3.32f` slice 1 (ADR 0086 decision 8) — the rows of the attributions page.
 *
 * One credit is one uploaded or administered file with its author and licence. Slice 1 has none;
 * the field exists so the page renders them the day they arrive.
 */
export type AttributionCredit = {
  readonly file: string;
  readonly author: string;
  readonly licence: string;
};

/** One library on the attributions page. `sourceUrl` and `notice` are null when there is none. */
export type AttributionEntry = {
  readonly code: string;
  readonly name: string;
  readonly version: string;
  readonly licence: string;
  readonly sourceUrl: string | null;
  readonly notice: string | null;
  readonly credits: readonly AttributionCredit[];
};

/**
 * The preloaded libraries as attribution entries, one per registry row in `sortOrder`. The
 * notices come in as a parameter, so this module never imports the web bundle's notice text.
 *
 * Slice 2 adds a `credits` parameter; slice 3 concatenates the organization's entries from the
 * API — data, not page code.
 */
export function globalLibraryAttributions(notices: Readonly<Partial<Record<string, string>>>): readonly AttributionEntry[] {
  return [...MIMIC_SYMBOL_LIBRARIES]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((library) => ({
      code: library.code,
      name: library.label,
      version: library.version,
      licence: library.licence,
      sourceUrl: library.attributionUrl === "" ? null : library.attributionUrl,
      notice: notices[library.code] ?? null,
      credits: [],
    }));
}
