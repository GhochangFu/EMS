import { z } from "zod";

import { MIMIC_PATH_DATA_MAX } from "./mimic-shapes";

/**
 * `F3.32f` slice 3 / ADR 0086 decisions 2 and 6 — the organization symbol vocabulary: the key
 * grammars, the upload limits and the view box. The shape grammar itself (the seven tags, the
 * sixteen attributes, the number, path, points and transform expressions) is slice 2's
 * `./mimic-shapes`, reused here and not restated.
 *
 * **A leaf module**: it imports `zod` and `./mimic-shapes` only. `./mimic-layouts` imports the key
 * schemas from here, and the package builds as CommonJS, so an import back into `./mimic-layouts`
 * would evaluate half-initialised. The stored symbol's DTO (it needs the palette groups) lives in
 * `./mimic-layouts`; the library catalog in `./mimic-symbol-library-catalog`.
 *
 * Migration `0093`'s CHECKs restate `MIMIC_ORG_LIBRARY_CODE` and `MIMIC_ORG_SYMBOL_KEY`, and a
 * static gate reads both from this file's text.
 */

/** An organization library's own code: a lower-case letter, then at most 26 more (decision 2). */
export const MIMIC_ORG_LIBRARY_CODE = /^[a-z][a-z0-9]{0,26}$/;

/** An organization library as a layout's `symbolLibraries` names it: `org.<code>`. */
export const MIMIC_ORG_LIBRARY_KEY = /^org\.[a-z][a-z0-9]{0,26}$/;

/** An organization symbol as a node's `symbol` names it: `org.<code>:<name>`. */
export const MIMIC_ORG_SYMBOL_KEY = /^org\.[a-z][a-z0-9]{0,26}:[a-z0-9][a-z0-9-]*$/;

/** The name part of an organization symbol key. */
export const MIMIC_ORG_SYMBOL_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** `mimic_org_symbols.key` and `mimic_layout_nodes.org_symbol_key` are `varchar(64)`. */
export const MAX_MIMIC_ORG_SYMBOL_KEY_CHARS = 64;

/** One uploaded SVG file (decision 6). */
export const MAX_MIMIC_SYMBOL_SVG_BYTES = 65536;

/** Shapes one symbol may hold (decision 6); `mimic_org_symbols_shapes_check` restates it. */
export const MAX_MIMIC_SYMBOL_SHAPES = 200;

/** Characters one `d` may hold (decision 6) — slice 2's bound, not a second one. */
export const MAX_MIMIC_SYMBOL_PATH_CHARS = MIMIC_PATH_DATA_MAX;

/** Symbols one organization library may hold (decision 6). */
export const MAX_MIMIC_ORG_SYMBOLS_PER_LIBRARY = 500;

/**
 * `org.<code>` — a regex check typed as a template literal, so `MimicSymbolLibrarySelection` stays
 * narrower than `string` (plan ruling R1). The message is the class of error only. The
 * `.describe` follows the check so the OpenAPI document states it (ADR 0029 Amendment 1).
 */
export const mimicOrgLibraryKeySchema = z
  .custom<`org.${string}`>((value) => typeof value === "string" && MIMIC_ORG_LIBRARY_KEY.test(value), {
    message: "Unknown symbol library",
  })
  .describe("An organization symbol library, org.<code>: a string matching ^org\\.[a-z][a-z0-9]{0,26}$.");

/** `org.<code>:<name>`, at most 64 characters; typed as a template literal (plan ruling R1). */
export const mimicOrgSymbolKeySchema = z
  .custom<`org.${string}:${string}`>(
    (value) =>
      typeof value === "string" && value.length <= MAX_MIMIC_ORG_SYMBOL_KEY_CHARS && MIMIC_ORG_SYMBOL_KEY.test(value),
    { message: "Unknown mimic symbol" },
  )
  .describe(
    "An organization symbol, org.<code>:<name>: a string of at most 64 characters matching ^org\\.[a-z][a-z0-9]{0,26}:[a-z0-9][a-z0-9-]*$.",
  );

/** `[minX, minY, width, height]`, finite, with a positive width and height. */
export const mimicViewBoxSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite().positive(),
  z.number().finite().positive(),
]);

/** A library's drawing style (ADR 0084 decision 6): outlines, or filled shapes. */
export const mimicSymbolStyleSchema = z.enum(["stroke", "fill"]);
