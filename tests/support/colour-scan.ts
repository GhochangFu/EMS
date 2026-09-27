import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { blankComments } from "./pending-button-scan";
import { repoRoot, walk } from "./source-scan";

/*
 * `F3.65` — the colour scan `tests/f3.65-colour-roles-gate.test.ts` holds `apps/web` to (ADR 0078,
 * plan `docs/plans/f3.65a-colour-tokens.md` §2.1, §2.5). Five kinds:
 *
 *  - **palette** — a stock Tailwind palette class (`bg-red-600`, `text-white/70`) or a `bms-*`
 *    class (`hover:bg-bms-green-dark`), under any colour utility and any variant;
 *  - **hex** — `#` + 3, 6 or 8 hex digits;
 *  - **func** — an `rgb(`/`rgba(`/`hsl(`/`hsla(` literal whose first argument is a number;
 *  - **dark** — a `dark:` variant;
 *  - **named** — a CSS named colour as the value of a colour attribute, style key or declaration.
 *
 * The first three are counted against a per-file floor; `dark` and `named` are a hard zero. Every
 * function blanks comments first, so prose about a colour is not a colour.
 *
 * This directory holds no `*.test.ts`: a module here is imported rather than run, and it is
 * typechecked as an import of the files that use it.
 */

const WEB_SRC = join(repoRoot, "apps/web/src");

/** Every `.ts` / `.tsx` / `.css` file under `apps/web/src`, minus specs, tests and `test-setup.ts`. */
export function webColourSourceFiles(): string[] {
  return walk(WEB_SRC).filter(
    (f) => /\.(tsx?|css)$/.test(f) && !/\.(spec|test)\.[^.\\/]+$/.test(f) && !/[\\/]test-setup\.ts$/.test(f),
  );
}

const STOCK_PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

/**
 * Every Tailwind utility that takes a colour. `border-l-` and the other sides are one prefix;
 * `ring-offset-` is listed before `ring-` would matter only if the colour could start with
 * `offset`, which none does.
 */
const COLOUR_UTILITIES =
  "bg|text|border(?:-[xytblrse])?|ring(?:-offset)?|divide|outline|fill|stroke|from|via|to|shadow|accent|caret|decoration|placeholder";

/**
 * A stock name needs its numeric shade (`neutral-500`), so the role `neutral-ink` does not match;
 * `black` / `white` stand alone; `bms-` takes every hyphenated tail, so `bms-green-dark` is one
 * class. An opacity modifier `/NN` or `/[…]` stays part of the class. The left guard lets any
 * variant (`hover:`, `[&>svg]:`, `!`) sit in front and strips it from the match.
 */
const PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:${COLOUR_UTILITIES})-(?:(?:${STOCK_PALETTE})-(?:50|[1-9]00|950)|black|white|bms-[a-z]+(?:-[a-z]+)*)` +
    `(?:\\/(?:\\d{1,3}|\\[[^\\]\\s]*\\]))?(?![\\w-])`,
  "g",
);

/** Not after a word character or `&` (`&#123;`), not followed by another hex digit. `_` after is fine. */
const HEX_LITERAL = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;

/**
 * `_` is a space inside a Tailwind arbitrary value, so it may precede the function; so may `(`
 * and `,`. `rgb(var(--x) / <alpha-value>)` is the token mapping, not a literal.
 */
const COLOUR_FUNCTION = /(?<![A-Za-z0-9$])(?:rgba?|hsla?)\((?=\s*\d)/g;

/** `dark:` as a variant: not the tail of `--on-dark:`, and followed by a class, not a space. */
const DARK_VARIANT = /(?<![\w-])dark:(?=[\w[!-])/g;

/** The CSS Color 4 named colours, less `transparent` / `currentColor`, which are not a colour choice. */
const CSS_NAMED_COLOURS = [
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black",
  "blanchedalmond", "blue", "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse",
  "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan",
  "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta",
  "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
  "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink",
  "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen",
  "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow", "grey",
  "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender", "lavenderblush",
  "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan", "lightgoldenrodyellow",
  "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon", "lightseagreen",
  "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow", "lime",
  "limegreen", "linen", "magenta", "maroon", "mediumaquamarine", "mediumblue", "mediumorchid",
  "mediumpurple", "mediumseagreen", "mediumslateblue", "mediumspringgreen", "mediumturquoise",
  "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin", "navajowhite", "navy",
  "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod", "palegreen",
  "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum",
  "powderblue", "purple", "rebeccapurple", "red", "rosybrown", "royalblue", "saddlebrown", "salmon",
  "sandybrown", "seagreen", "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray",
  "slategrey", "snow", "springgreen", "steelblue", "tan", "teal", "thistle", "tomato", "turquoise",
  "violet", "wheat", "white", "whitesmoke", "yellow", "yellowgreen",
];

/** A colour-taking SVG attribute, JSX style key or CSS property. */
const COLOUR_PROPERTIES = [
  "color", "fill", "stroke", "background", "background-color", "backgroundColor", "border-color",
  "borderColor", "border-top-color", "borderTopColor", "border-right-color", "borderRightColor",
  "border-bottom-color", "borderBottomColor", "border-left-color", "borderLeftColor",
  "outline-color", "outlineColor", "caret-color", "caretColor", "accent-color", "accentColor",
  "text-decoration-color", "textDecorationColor", "stop-color", "stopColor", "flood-color",
  "floodColor", "lighting-color", "lightingColor",
].join("|");

/**
 * `fill="white"`, `stroke={"red"}`, `color: "red"` (a style object), `color: red;` (CSS). The
 * value must be the whole quoted string, or a bare word ended by `;` or `!` — so a
 * `{ tone: "red" }` vocabulary key, `stroke={GREEN}` (a constant) and `border: 1px solid red`
 * are out of scope.
 */
const NAMED_COLOUR = new RegExp(
  `(?<![\\w-])(?:${COLOUR_PROPERTIES})\\s*[=:]\\s*(?:(?:\\{\\s*)?(["'\`])(${CSS_NAMED_COLOURS.join("|")})\\1|(${CSS_NAMED_COLOURS.join("|")})(?=\\s*[;!]))`,
  "gi",
);

function matches(src: string, re: RegExp): string[] {
  return [...blankComments(src).matchAll(re)].map((m) => m[0]);
}

/** Every palette class in `src`, variants stripped, once per use. */
export function paletteClasses(src: string): string[] {
  return matches(src, PALETTE_CLASS);
}

/** Every hex colour literal in `src`, once per use. */
export function hexLiterals(src: string): string[] {
  return matches(src, HEX_LITERAL);
}

/** Every `rgb(` / `rgba(` / `hsl(` / `hsla(` literal in `src`, as its name and `(`. */
export function colourFunctions(src: string): string[] {
  return matches(src, COLOUR_FUNCTION);
}

/** Every `dark:` variant in `src`. */
export function darkVariants(src: string): string[] {
  return matches(src, DARK_VARIANT);
}

/** Every named colour used as a colour value in `src`, as written. */
export function namedColours(src: string): string[] {
  return [...blankComments(src).matchAll(NAMED_COLOUR)].map((m) => m[2] ?? m[3] ?? "");
}

/** One file's counted kinds — the shape of a `FLOOR` row. */
export type ColourFloorRow = { file: string; palette: number; hex: number; func: number };

/** `file:line kind text` for every hard-zero finding (`dark:`, named colour) in `src`. */
export function colourFindings(src: string, file: string): string[] {
  const text = blankComments(src);
  const out: string[] = [];
  const at = (index: number): number => text.slice(0, index).split("\n").length;
  for (const m of text.matchAll(DARK_VARIANT)) out.push(`${file}:${at(m.index)} dark: variant`);
  for (const m of text.matchAll(NAMED_COLOUR)) out.push(`${file}:${at(m.index)} named colour ${m[2] ?? m[3]}`);
  return out;
}

/**
 * Scan `files` (absolute paths). A file that cannot be read throws — a skipped file would pass
 * every colour in it. `rows` holds only files with a non-zero count, sorted by repo-relative path.
 */
export function scanColourFiles(files: string[]): {
  rows: ColourFloorRow[];
  findings: string[];
  walked: number;
} {
  const rows: ColourFloorRow[] = [];
  const findings: string[] = [];
  for (const full of files) {
    const src = readFileSync(full, "utf8");
    const file = relative(repoRoot, full).split("\\").join("/");
    const row = {
      file,
      palette: paletteClasses(src).length,
      hex: hexLiterals(src).length,
      func: colourFunctions(src).length,
    };
    if (row.palette + row.hex + row.func > 0) rows.push(row);
    findings.push(...colourFindings(src, file));
  }
  rows.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { rows, findings, walked: files.length };
}
