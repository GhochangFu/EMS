import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { classStrings, webColourSourceFiles } from "./colour-scan";
import { blankComments, openingTagEnd } from "./pending-button-scan";
import { repoRoot } from "./source-scan";

/*
 * `F3.71` — the scanner behind `tests/f3.71-surface-card-ratchet.test.ts` (ADR 0085 decision 6,
 * plan §4 V1): the surfaces a call site still spells as colour utilities rather than naming with
 * the surface vocabulary.
 *
 *  - **A card**: one class string whose tokens, variants stripped, hold both `bg-surface` and
 *    `border-line`.
 *  - **A field**: an `<input>`, `<select>` or `<textarea>` whose opening tag holds a class string
 *    with `border-line`, or with both `rounded` and `border`.
 *
 * A field styled through a class constant (`className={inputClass}`) is found only when the
 * constant's own string is a card; the sweeps convert those constants by hand.
 */

const bare = (token: string): string => token.replace(/^(?:[^\s:]*:)*!?/, "");

const tokensOf = (body: string): Set<string> => new Set(body.split(/\s+/).filter(Boolean).map(bare));

/** Each spelled-out card and field in `src` (comment-blanked first), as `card:<line>` / `field:<line>`. */
export function surfaceCardFindings(src: string): string[] {
  const text = blankComments(src);
  const lineOf = (at: number): number => text.slice(0, at).split("\n").length;
  const out: string[] = [];
  for (const { start, body } of classStrings(text)) {
    const t = tokensOf(body);
    if (t.has("bg-surface") && t.has("border-line")) out.push(`card:${lineOf(start)}`);
  }
  for (const m of text.matchAll(/<(input|select|textarea)\b/g)) {
    const { end } = openingTagEnd(text, m.index + m[0].length);
    if (end === -1) continue;
    const tag = text.slice(m.index, end);
    const spelled = classStrings(tag).some(({ body }) => {
      const t = tokensOf(body);
      return t.has("border-line") || (t.has("rounded") && t.has("border"));
    });
    if (spelled) out.push(`field:${lineOf(m.index)}`);
  }
  return out;
}

/** Every web source file with at least one finding, by repo-relative path. */
export function surfaceCardCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const full of webColourSourceFiles().filter((f) => /\.tsx?$/.test(f))) {
    const n = surfaceCardFindings(readFileSync(full, "utf8")).length;
    if (n > 0) counts.set(relative(repoRoot, full).split("\\").join("/"), n);
  }
  return counts;
}
