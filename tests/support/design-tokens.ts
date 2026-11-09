import { DESIGN_TOKENS } from "../../apps/web/src/lib/design";

/*
 * `F4.341` — the parser for `apps/web/src/index.css`'s design-token blocks (plan
 * `docs/plans/f4.341-selectable-design-systems.md` D2). The colour parser
 * (`./colour-tokens.ts`) reads the two role blocks keyed on the root pseudo-class; this one reads
 * the blocks keyed on `html`:
 *
 *  - `html { … }` — the `nexus-soft` base, neumorphic;
 *  - `html:not([data-design])[data-surface="flat"] { … }` — its flat variant;
 *  - `html[data-design="<name>"] { … }` and `html[data-design="<name>"][data-surface="flat"] { … }`
 *    — a design system's pair.
 *
 * The shadow blocks (selectors ending in `:not([data-surface="flat"])`) are the shadow gate's
 * (`tests/f3.71-surface-gates.test.ts` T1–T3) and are skipped here. Any other `html…` block is
 * an unknown selector and throws, so a typo cannot hide a block from the gate.
 *
 * It fails closed: a duplicate block, a token outside `DESIGN_TOKENS`, a colour role, a value
 * with a `#`, `color-mix(` or `backdrop-filter`, and (with `complete`) a missing token all throw.
 */

export type DesignBlock = Map<string, string>;
export type DesignVariants = { neumorphic?: DesignBlock; flat?: DesignBlock };
export type DesignBlocks = { base: { neumorphic: DesignBlock; flat: DesignBlock }; designs: Map<string, DesignVariants> };

const BASE = "html";
const BASE_FLAT = 'html:not([data-design])[data-surface="flat"]';
const DESIGN = /^html\[data-design="([a-z][a-z0-9-]*)"\](\[data-surface="flat"\])?$/;
const SHADOW = /:not\(\[data-surface="flat"\]\)$/;
const FORBIDDEN_VALUE = /#|color-mix\(|backdrop-filter/;
const TOKEN_SET = new Set<string>(DESIGN_TOKENS);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "));
}

function parseBody(selector: string, body: string, roles: ReadonlySet<string>): DesignBlock {
  const out: DesignBlock = new Map();
  for (const raw of body.split(";")) {
    const line = raw.trim();
    if (line === "") continue;
    const m = /^(--[a-z0-9-]+)\s*:\s*([\s\S]+)$/.exec(line);
    if (!m) throw new Error(`${selector}: not a custom-property declaration: "${line}"`);
    const [, name, value] = m;
    if (roles.has(name.slice(2))) throw new Error(`${selector}: sets the colour role ${name}`);
    if (!TOKEN_SET.has(name)) throw new Error(`${selector}: ${name} is not a design token`);
    if (FORBIDDEN_VALUE.test(value)) throw new Error(`${selector}: ${name} holds a forbidden value "${value.trim()}"`);
    if (out.has(name)) throw new Error(`${selector}: ${name} is declared twice`);
    out.set(name, value.trim());
  }
  return out;
}

/** The tokens of `DESIGN_TOKENS` a block does not define. */
export function missingTokens(block: DesignBlock): string[] {
  return DESIGN_TOKENS.filter((t) => !block.has(t));
}

/**
 * Every design block of `css`. `roles` are the colour-role names (without `--`), from
 * `parseTokenBlocks`. The base pair must exist and be complete; a design system's blocks are
 * returned as found (DS1 holds their completeness).
 */
export function parseDesignBlocks(css: string, roles: ReadonlySet<string>): DesignBlocks {
  let base: DesignBlock | undefined;
  let baseFlat: DesignBlock | undefined;
  const designs = new Map<string, DesignVariants>();
  for (const m of stripComments(css).matchAll(/(?<=^|[{}])\s*(html[^{}]*?)\s*\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (SHADOW.test(selector)) continue;
    const body = parseBody(selector, m[2], roles);
    if (selector === BASE) {
      if (base) throw new Error(`duplicate block: ${selector}`);
      base = body;
      continue;
    }
    if (selector === BASE_FLAT) {
      if (baseFlat) throw new Error(`duplicate block: ${selector}`);
      baseFlat = body;
      continue;
    }
    const d = DESIGN.exec(selector);
    if (!d) throw new Error(`unknown design-block selector: ${selector}`);
    const variants = designs.get(d[1]) ?? {};
    const key = d[2] ? "flat" : "neumorphic";
    if (variants[key]) throw new Error(`duplicate block: ${selector}`);
    variants[key] = body;
    designs.set(d[1], variants);
  }
  if (!base) throw new Error(`no "${BASE} { … }" design block found`);
  if (!baseFlat) throw new Error(`no "${BASE_FLAT} { … }" design block found`);
  for (const [selector, block] of [
    [BASE, base],
    [BASE_FLAT, baseFlat],
  ] as const) {
    const missing = missingTokens(block);
    if (missing.length > 0) throw new Error(`${selector}: missing ${missing.join(", ")}`);
  }
  return { base: { neumorphic: base, flat: baseFlat }, designs };
}
