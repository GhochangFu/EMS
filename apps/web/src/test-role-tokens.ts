import indexCss from "./index.css?raw";

import type { RoleName } from "./lib/theme";

/**
 * `F3.65c` — the two role-token blocks of the real `index.css`, for specs that need a theme's
 * values without a document (plan D3, amended at build).
 *
 * The text arrives through Vite's `?raw` import, not `node:fs`: `apps/web`'s tsconfig carries no
 * `node` types (see `lib/calc-preview.ts`), and `apps/web/vitest.config.ts` includes `index.css`
 * in `test.css` so `?raw` returns the file rather than an empty string. `test-setup.ts` appends
 * the same text to jsdom's `<head>`.
 *
 * Imported by specs only; the app never imports it, so it is never bundled.
 */

/** One theme's `--role: R G B;` lines as `role → "R G B"`. */
export type TokenMap = ReadonlyMap<string, string>;

function block(selector: RegExp): Map<string, string> {
  if (indexCss.trim() === "") {
    throw new Error("index.css?raw is empty — is index.css in apps/web/vitest.config.ts test.css.include?");
  }
  const found = selector.exec(indexCss);
  if (!found) throw new Error(`no ${String(selector)} block in index.css`);
  const map = new Map<string, string>();
  for (const m of found[1].matchAll(/--([a-z][a-z0-9-]*)\s*:\s*(\d{1,3}\s+\d{1,3}\s+\d{1,3})\s*;/g)) {
    map.set(m[1], m[2]);
  }
  return map;
}

/** The light (`:root`) and dark (`:root[data-theme="dark"]`) blocks of `index.css`. */
export const ROLE_TOKENS: { light: TokenMap; dark: TokenMap } = {
  light: block(/:root\s*\{([^}]*)\}/),
  dark: block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/),
};

/** A token map as the injectable source `resolveRoles` takes; a missing role reads `""`. */
export function fromTokenMap(map: TokenMap): (role: RoleName) => string {
  return (role) => map.get(role) ?? "";
}
