import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { blankComments } from "./pending-button-scan";
import { repoRoot, walk } from "./source-scan";

/*
 * `F3.65` — the colour scan `tests/f3.65-colour-roles-gate.test.ts` holds `apps/web` to (ADR 0078,
 * plan `docs/plans/f3.65a-colour-tokens.md` §2.1, §2.5). Three counted kinds:
 *
 *  - **palette** — a stock Tailwind palette class (`bg-red-600`, `text-white/70`) or a `bms-*`
 *    class (`hover:bg-bms-green-dark`), under any colour utility and any variant;
 *  - **hex** — `#` + 3, 6 or 8 hex digits;
 *  - **func** — an `rgb(`/`rgba(`/`hsl(`/`hsla(`/`oklch(`/`oklab(`/`lab(`/`lch(`/`hwb(` literal
 *    whose first argument is a number or `from`, and every `color-mix(`;
 *
 * and six hard-zero kinds, each a `file:line label` finding (`colourFindings`):
 *
 *  - **`dark:` variant**;
 *  - **theme variant** — an arbitrary variant that targets the theme attribute
 *    (`[[data-theme=dark]_&]:`, `data-[theme=dark]:`);
 *  - **named colour** — a CSS named colour as the value of a colour attribute, style key or
 *    declaration;
 *  - **`prefers-color-scheme`** and **`matchMedia(`** — the theme is the stored choice, never the
 *    OS preference (ADR 0078 decision 4);
 *  - **`text-on-dark` on an opaque accent fill** — one class string holding `bg-accent` or
 *    `bg-accent-strong` (any variant, no `/NN`) and `text-on-dark` (any opacity): white on the dark
 *    accent is 2.09:1, so the pair must be `text-on-accent`.
 *
 * The counted kinds go against a per-file floor. Every function blanks comments first, so prose
 * about a colour is not a colour; an `.html` file has its `<!-- -->` comments blanked too.
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
const COLOUR_FUNCTION = /(?<![A-Za-z0-9$])(?:(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\((?=\s*(?:[\d.]|from\b))|color-mix\()/g;

/** `dark:` as a variant: not the tail of `--on-dark:`, and followed by a class, not a space. */
const DARK_VARIANT = /(?<![\w-])dark:(?=[\w[!-])/g;

/**
 * An arbitrary variant aimed at the theme attribute: a bracketed selector holding `data-theme`
 * (`[[data-theme=dark]_&]:`, `group-[[data-theme=dark]_&]:`, `[html[data-theme=dark]_&]:`) or the
 * `data-[theme…]` shorthand (`data-[theme=dark]:`, `group-data-[theme=dark]:`).
 */
const THEME_VARIANT = /\[[^\s"'`]*data-theme[^\s"'`]*?\]:|data-\[theme[^\]\s]*\]:/g;

/** `prefers-color-scheme` anywhere, and a `matchMedia(` call. */
const PREFERS_COLOR_SCHEME = /prefers-color-scheme/g;
const MATCH_MEDIA = /(?<![\w$])matchMedia\s*\(/g;

/** A class token that paints an opaque accent fill (any variant, `!` allowed, no `/NN`). */
const OPAQUE_ACCENT_FILL = /^(?:\S*:)?!?bg-accent(?:-strong)?$/;
/** A class token that sets `text-on-dark` at any opacity. */
const ON_DARK_TEXT = /^(?:\S*:)?!?text-on-dark(?:\/\S+)?$/;

/**
 * Every class string in `text`: a `"…"` or `'…'` literal on one line, and each backtick template
 * with its `${…}` holes blanked — the strings inside a hole are scanned as quoted literals, so the
 * two branches of a ternary are two strings, never one.
 */
function classStrings(text: string): { start: number; body: string }[] {
  const out: { start: number; body: string }[] = [];
  for (const m of text.matchAll(/"[^"\n]*"|'[^'\n]*'/g)) out.push({ start: m.index + 1, body: m[0].slice(1, -1) });
  for (const m of text.matchAll(/`[^`]*`/g)) {
    out.push({ start: m.index + 1, body: m[0].slice(1, -1).replace(/\$\{[^}]*\}/g, (h) => " ".repeat(h.length)) });
  }
  return out;
}

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

/**
 * Every role class in `src` that carries an opacity modifier: `text-on-dark/70`,
 * `hover:bg-accent/[.06]` (variant stripped). `roles` are the token names (`on-dark`,
 * `line-strong`); `index` is the class's offset in `src`, `modifier` the text after `/`.
 */
export function roleOpacityModifiers(
  src: string,
  roles: string[],
): { index: number; className: string; modifier: string }[] {
  const names = [...roles].sort((a, b) => b.length - a.length).join("|");
  const re = new RegExp(`(?<![\\w-])(?:${COLOUR_UTILITIES})-(?:${names})\\/([^\\s"'\`}]+)`, "g");
  return [...blankComments(src).matchAll(re)].map((m) => ({ index: m.index, className: m[0], modifier: m[1] }));
}

/** One file's counted kinds — the shape of a `FLOOR` row. */
export type ColourFloorRow = { file: string; palette: number; hex: number; func: number };

/**
 * `file:line label` for every hard-zero finding in `src` (see the file docblock for the six
 * labels). A `.html` file has its `<!-- -->` comments blanked, newlines kept.
 */
export function colourFindings(src: string, file: string): string[] {
  const html = file.endsWith(".html") ? src.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " ")) : src;
  const text = blankComments(html);
  const out: string[] = [];
  const at = (index: number): number => text.slice(0, index).split("\n").length;
  for (const m of text.matchAll(DARK_VARIANT)) out.push(`${file}:${at(m.index)} dark: variant`);
  for (const m of text.matchAll(THEME_VARIANT)) out.push(`${file}:${at(m.index)} theme variant ${m[0]}`);
  for (const m of text.matchAll(NAMED_COLOUR)) out.push(`${file}:${at(m.index)} named colour ${m[2] ?? m[3]}`);
  for (const m of text.matchAll(PREFERS_COLOR_SCHEME)) out.push(`${file}:${at(m.index)} prefers-color-scheme`);
  for (const m of text.matchAll(MATCH_MEDIA)) out.push(`${file}:${at(m.index)} matchMedia(`);
  for (const { start, body } of classStrings(text)) {
    const tokens = [...body.matchAll(/\S+/g)];
    const fill = tokens.find((t) => OPAQUE_ACCENT_FILL.test(t[0]));
    if (!fill) continue;
    for (const t of tokens) {
      if (ON_DARK_TEXT.test(t[0])) out.push(`${file}:${at(start + t.index)} text-on-dark on an opaque accent fill ${fill[0]}`);
    }
  }
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
