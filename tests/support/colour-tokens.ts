import { createRequire } from "node:module";
import { join } from "node:path";

import { repoRoot } from "./source-scan";

/*
 * `F3.65a` — the colour maths the token gates share: parsing `apps/web/src/index.css`'s two
 * `--role: R G B;` blocks (`tests/f3.65a-colour-tokens.test.ts`), WCAG 2.x contrast
 * (`tests/f3.65a-colour-contrast.test.ts`), CIEDE2000 (`tests/f3.65a-colour-mapping-table.test.ts`),
 * and resolving a Tailwind shade name to its hex value against the real `tailwindcss/colors`
 * package.
 *
 * This directory holds no `*.test.ts`: a module here is imported rather than run, and it is
 * typechecked as an import of the files that use it.
 *
 * `tailwindcss` is a dependency of `apps/web`, not of the repo root, so `resolveTailwindShade`
 * loads it through a `createRequire` anchored at `apps/web/package.json` rather than a bare
 * `import`.
 */

export type Channels = [number, number, number];
export type TokenBlocks = { light: Map<string, Channels>; dark: Map<string, Channels> };

const ROLE_LINE = /^--([a-z][a-z0-9-]*)\s*:\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*;/;

function parseBlock(content: string): Map<string, Channels> {
  const map = new Map<string, Channels>();
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || !line.startsWith("--")) continue;
    const m = ROLE_LINE.exec(line);
    if (!m) throw new Error(`malformed colour-token line: "${line}"`);
    map.set(m[1], [Number(m[2]), Number(m[3]), Number(m[4])]);
  }
  return map;
}

/**
 * The `:root { … }` (light) and `:root[data-theme="dark"] { … }` (dark) role blocks of
 * `index.css`: each `--name: R G B;` line as `name → [r, g, b]`. Throws when either block is
 * missing or appears twice — a second block would override the first in the browser while a
 * first-match reader checked only the first. Throws on a malformed line, and throws naming any
 * role that is declared in one theme but not the other — a token file is useless if a role has
 * no value in one theme.
 */
export function parseTokenBlocks(css: string): TokenBlocks {
  const lightBlocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)];
  const darkBlocks = [...css.matchAll(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/g)];
  if (lightBlocks.length === 0) throw new Error('no ":root { … }" light block found');
  if (darkBlocks.length === 0) throw new Error(`no ':root[data-theme="dark"] { … }' dark block found`);
  if (lightBlocks.length > 1) throw new Error(`found ${lightBlocks.length} ':root { … }' blocks; the token file holds one`);
  if (darkBlocks.length > 1) {
    throw new Error(`found ${darkBlocks.length} ':root[data-theme="dark"] { … }' blocks; the token file holds one`);
  }
  const [lightMatch] = lightBlocks;
  const [darkMatch] = darkBlocks;
  const light = parseBlock(lightMatch[1]);
  const dark = parseBlock(darkMatch[1]);
  for (const role of light.keys()) {
    if (!dark.has(role)) throw new Error(`role "${role}" has a light value but no dark value`);
  }
  for (const role of dark.keys()) {
    if (!light.has(role)) throw new Error(`role "${role}" has a dark value but no light value`);
  }
  return { light, dark };
}

/** `[r, g, b]` (each 0–255) as a lowercase `#rrggbb` string: `[0, 166, 81]` → `"#00a651"`. */
export function channelsToHex([r, g, b]: Channels): string {
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

/**
 * A six-digit `#RRGGBB` string (either case, `#` optional) as `[r, g, b]`. Three- and eight-digit
 * forms are not handled; every caller passes a token value or a Tailwind six-digit shade.
 */
export function hexToChannels(hex: string): Channels {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function srgbToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of a `#RRGGBB` hex colour. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToChannels(hex);
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG 2.x contrast ratio between two `#RRGGBB` hex colours; order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** `fg` composited over `bg` at `alpha` (0–1), per channel, rounded to the nearest integer. */
export function blendOver(fg: string, bg: string, alpha: number): string {
  const [fr, fgc, fb] = hexToChannels(fg);
  const [br, bgc, bb] = hexToChannels(bg);
  const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  return channelsToHex([mix(fr, br), mix(fgc, bgc), mix(fb, bb)]);
}

function deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function rad(d: number): number {
  return (d * Math.PI) / 180;
}

function labOf(hex: string): [number, number, number] {
  const [r, g, b] = hexToChannels(hex);
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) * 100;
  const Y = (R * 0.2126729 + G * 0.7151522 + B * 0.072175) * 100;
  const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) * 100;
  const Xn = 95.047;
  const Yn = 100.0;
  const Zn = 108.883;
  const f = (t: number) => (t > Math.pow(6 / 29, 3) ? Math.pow(t, 1 / 3) : (1 / 3) * Math.pow(29 / 6, 2) * t + 4 / 29);
  const fx = f(X / Xn);
  const fy = f(Y / Yn);
  const fz = f(Z / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 colour difference between two `#RRGGBB` hex colours (Sharma et al. 2005). */
export function deltaE2000(hexA: string, hexB: string): number {
  const [L1, a1, b1] = labOf(hexA);
  const [L2, a2, b2] = labOf(hexB);
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  let h1p = deg(Math.atan2(b1, a1p));
  if (h1p < 0) h1p += 360;
  let h2p = deg(Math.atan2(b2, a2p));
  if (h2p < 0) h2p += 360;
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp: number;
  if (C1p * C2p === 0) {
    dhp = 0;
  } else {
    const dh = h2p - h1p;
    if (Math.abs(dh) <= 180) dhp = dh;
    else if (dh > 180) dhp = dh - 360;
    else dhp = dh + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp: number;
  if (C1p * C2p === 0) {
    hbarp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hbarp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hbarp = (h1p + h2p + 360) / 2;
  } else {
    hbarp = (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.2 * Math.cos(rad(4 * hbarp - 63));
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbarp, 7) / (Math.pow(Cbarp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/**
 * The seven `bms.*` palette hex values from `apps/web/tailwind.config.js`. Kept as a local
 * constant rather than read from the config, because they leave `tailwind.config.js` in
 * `F3.65c` once the ratchet gate is at zero, at which point this constant is the historical
 * record — `resolveTailwindShade` still needs to resolve `bms-green` etc. for `tests/`
 * fixtures and the mapping table until then.
 */
const BMS_HEX: Record<string, string> = {
  "bms-green": "#00A651",
  "bms-green-light": "#3DCD58",
  "bms-green-dark": "#007C3C",
  "bms-header": "#1D2430",
  "bms-canvas": "#F2F4F7",
  "bms-ink": "#1A2230",
  "bms-muted": "#4A5464",
};

let tailwindColors: Record<string, unknown> | null = null;

function loadTailwindColors(): Record<string, unknown> {
  if (tailwindColors) return tailwindColors;
  const require = createRequire(join(repoRoot, "apps/web/package.json"));
  tailwindColors = require("tailwindcss/colors") as Record<string, unknown>;
  return tailwindColors;
}

/**
 * The hex value Tailwind (or the `bms.*` palette) resolves `shadeName` to — `"gray-200"`,
 * `"bms-green"`, `"white"`, `"black"`. Throws if the name resolves to nothing.
 */
export function resolveTailwindShade(shadeName: string): string {
  if (shadeName in BMS_HEX) return BMS_HEX[shadeName];
  if (shadeName === "white") return "#FFFFFF";
  if (shadeName === "black") return "#000000";
  const m = /^([a-z]+)-(\d{2,3})$/.exec(shadeName);
  if (!m) throw new Error(`cannot resolve Tailwind shade "${shadeName}"`);
  const [, family, scale] = m;
  const colors = loadTailwindColors();
  const famValue = colors[family];
  const value =
    famValue && typeof famValue === "object" ? (famValue as Record<string, unknown>)[scale] : undefined;
  if (typeof value !== "string") throw new Error(`cannot resolve Tailwind shade "${shadeName}"`);
  return value;
}
