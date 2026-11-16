import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot, walk, withoutComments } from "./support/source-scan";

/**
 * `F4.380` (the owner's AWS check, 2026-11-16) — every `<input pattern>` in the web app compiles the
 * way Chrome compiles it: `^(?:pattern)$` with the **`v`** flag. Under `v` a bare `-` at the end of
 * a class (`[a-z0-9-]+`) is a syntax error; Chrome logged "Invalid character class" and checked
 * nothing. Inline assertions (a top-level `tests/` file, AGENTS.md §4.6).
 *
 * The scan reads every `pattern="…"`, `pattern={"…"}` and `pattern={NAME}` in `apps/web/src`
 * (specs and tests left out); a `NAME` is resolved to its `export const NAME = "…"` in the same
 * tree, and one that cannot be resolved fails the gate rather than passing unread.
 */

const WEB_SRC = join(repoRoot, "apps/web/src");
const isSource = (path: string): boolean => /\.tsx$/.test(path) && !/\.(spec|test)\.tsx$/.test(path);

/** The `pattern` attributes in one source: literal bodies, or the constant they name. */
function patternAttributes(source: string): ({ literal: string } | { name: string })[] {
  const text = withoutComments(source);
  const out: ({ literal: string } | { name: string })[] = [];
  for (const match of text.matchAll(/\bpattern=(?:"((?:[^"\\]|\\.)*)"|\{\s*"((?:[^"\\]|\\.)*)"\s*\}|\{\s*([A-Za-z_$][\w$]*)\s*\})/g)) {
    if (match[1] !== undefined) out.push({ literal: match[1] });
    else if (match[2] !== undefined) out.push({ literal: JSON.parse(`"${match[2]}"`) as string });
    else out.push({ name: match[3]! });
  }
  return out;
}

/** Every `pattern=` attribute in one source, read or not. */
function rawPatternCount(source: string): number {
  return [...withoutComments(source).matchAll(/\bpattern=/g)].length;
}

/** `export const NAME = "…";` across the tree, its JS string value. */
function exportedStrings(sources: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const source of sources) {
    for (const match of withoutComments(source).matchAll(/export const ([A-Za-z_$][\w$]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g)) {
      out.set(match[1]!, JSON.parse(`"${match[2]}"`) as string);
    }
  }
  return out;
}

/** Why `body` does not compile as Chrome compiles an `<input pattern>`, or `null`. */
function vFlagProblem(body: string): string | null {
  try {
    new RegExp(`^(?:${body})$`, "v");
    return null;
  } catch (error) {
    return String(error);
  }
}

describe("F4.380 every input pattern compiles with the v flag", () => {
  const files = walk(WEB_SRC).filter((path) => /\.(ts|tsx)$/.test(path));
  const sources = new Map(files.map((path) => [path, readFileSync(path, "utf8")]));
  const constants = exportedStrings([...sources.values()]);

  it("reads every pattern= it finds: a form the scan cannot read fails rather than passing unread", () => {
    const unread = [...sources]
      .filter(([path]) => isSource(path))
      .filter(([, source]) => rawPatternCount(source) !== patternAttributes(source).length)
      .map(([path]) => relative(repoRoot, path));
    expect(unread).toEqual([]);
    expect(rawPatternCount("pattern={`[a-z]`} pattern={rules.slug}"), "the raw count sees forms the parser does not").toBe(2);
    expect(patternAttributes("pattern={`[a-z]`} pattern={rules.slug}")).toEqual([]);
  });

  it("finds the pattern attributes (the dashboard slug in both forms)", () => {
    const found = [...sources].filter(([path]) => isSource(path)).flatMap(([, source]) => patternAttributes(source));
    expect(found.length).toBeGreaterThanOrEqual(2);
  });

  it("each one resolves and compiles under v", () => {
    const problems: string[] = [];
    for (const [path, source] of sources) {
      if (!isSource(path)) continue;
      for (const attribute of patternAttributes(source)) {
        const where = relative(repoRoot, path);
        const body = "literal" in attribute ? attribute.literal : constants.get(attribute.name);
        if (body === undefined) {
          problems.push(`${where}: pattern={${"name" in attribute ? attribute.name : ""}} does not resolve to an exported string`);
          continue;
        }
        const problem = vFlagProblem(body);
        if (problem !== null) problems.push(`${where}: ${body} — ${problem}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("the scan is live: it reads each form and refuses the trailing hyphen", () => {
    const sample = 'pattern="[a-z]+" pattern={"[0-9]\\\\-x"} pattern={SLUG}';
    expect(patternAttributes(sample)).toEqual([{ literal: "[a-z]+" }, { literal: "[0-9]\\-x" }, { name: "SLUG" }]);
    expect(exportedStrings(['export const SLUG = "[a-z0-9\\\\-]+";']).get("SLUG")).toBe("[a-z0-9\\-]+");
    expect(vFlagProblem("[a-z0-9-]+"), "the AWS demo's pattern").not.toBeNull();
    expect(vFlagProblem("[a-z0-9\\-]+")).toBeNull();
    expect(patternAttributes("// pattern=\"[a-z-]\""), "a comment is not an attribute").toEqual([]);
  });
});
